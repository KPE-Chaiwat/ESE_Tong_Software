//! One Modbus master session: an actor task that owns the link, the state machine, the poll
//! engine, the write queue, the counters and the traffic log.
//!
//! Rules implemented here (BE-001):
//! - Q-12: never more than one request on the wire. The link is moved into a request task
//!   and comes back with the outcome; the next request starts only after that.
//! - Q-09: queued writes run after the in-flight request and before the next poll cycle.
//! - Q-13: after a timeout / exception / bad response, polling continues at the scan rate.
//! - Q-01 / Q-02: no auto-reconnect; timeouts never cause `disconnected`, only link errors do.
//! - Q-08: on RTU a write to slave 0 returns `broadcastSent` right after it was transmitted.
//!   On Modbus TCP unit id 0 is not a broadcast: the reply is awaited (REV-001 F1).
//! - TCP late replies (an earlier transaction id) are logged and skipped; the wait for the
//!   current reply continues until its deadline (REV-001 F2).
//! - RTU keeps the t3.5 inter-frame gap before every request (REV-001 F6).
//! - Every byte written or read is recorded in the traffic log exactly as on the wire.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use modbus_core::{
    encode_rtu, encode_tcp, parse_rtu_reply, parse_tcp_reply, BadResponse, Reply, Request, Response,
};
use shared_types::{
    BadResponseDetail, BadResponseKind, ConnectionConfig, Counters, ExceptionCode, PollDefinition,
    PollUpdate, SessionSnapshot, SessionState, TrafficDirection, WriteRequest, WriteResult,
};
use tokio::sync::{mpsc, oneshot};
use tokio::task::{JoinError, JoinHandle};
use tokio::time::{sleep_until, Instant};
use transport::{ConnectError, Framing, Link, LinkError, ReceiveError};

use crate::clock::{Clock, SystemClock};
use crate::connector::{connect_reason, link_reason, Connector, SystemConnector};
use crate::emitter::{Emitter, EventSink};
use crate::state_machine::{is_link_up, is_poll_running, Event, StateMachine};
use crate::traffic::TrafficLog;
use crate::validate::{validate_connection, validate_poll, validate_write, ValidationError};

/// Pause after an RTU broadcast before the next request, so slaves can process it
/// (Modbus serial line specification, "turnaround delay").
pub const RTU_BROADCAST_TURNAROUND: Duration = Duration::from_millis(100);

/// Minimum RTU gap between the end of one exchange and the next request (REV-001 F6):
/// `max(t3.5, RTU_MIN_GAP)`. After a timeout the gap is the frame silence
/// (`max(t3.5, 50 ms)`), so a slave that is merely slow can finish before the next send.
pub const RTU_MIN_GAP: Duration = Duration::from_millis(5);

/// How many recent Modbus TCP transaction ids are remembered to recognise late replies.
const RECENT_TXNS: usize = 32;

/// Errors of session commands.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SessionError {
    #[error(transparent)]
    Validation(#[from] ValidationError),
    #[error("Not connected. Connect first.")]
    NotConnected,
    #[error("{0}")]
    InvalidState(String),
    #[error("The session has ended.")]
    Closed,
}

/// Injectable dependencies.
#[derive(Clone)]
pub struct SessionDeps {
    pub clock: Arc<dyn Clock>,
    pub connector: Arc<dyn Connector>,
}

impl Default for SessionDeps {
    fn default() -> Self {
        Self {
            clock: Arc::new(SystemClock),
            connector: Arc::new(SystemConnector),
        }
    }
}

/// Diagnostics for tests (backlog checks).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionStats {
    /// Most traffic frames ever waiting in the emitter at once.
    pub max_pending_frames: usize,
    pub traffic_log_len: usize,
    pub queued_writes: usize,
}

/// Handle to a running session. Dropping every handle (or calling [`Session::close`])
/// stops the actor, which closes the link and aborts any connect or request in progress.
pub struct Session {
    tx: mpsc::UnboundedSender<Command>,
}

impl Session {
    /// Starts a session in `idle`. Must be called inside a Tokio runtime.
    pub fn spawn(sink: Arc<dyn EventSink>, deps: SessionDeps) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        let actor = Actor::new(rx, sink, deps);
        tokio::spawn(actor.run());
        Self { tx }
    }

    async fn request<T>(
        &self,
        make: impl FnOnce(oneshot::Sender<T>) -> Command,
    ) -> Result<T, SessionError> {
        let (ack, rx) = oneshot::channel();
        self.tx.send(make(ack)).map_err(|_| SessionError::Closed)?;
        rx.await.map_err(|_| SessionError::Closed)
    }

    /// T1 / T14. Returns once the session is `connecting`; the outcome arrives as an event.
    ///
    /// # Errors
    /// `Validation`, `InvalidState` (not idle or disconnected), `Closed`.
    pub async fn connect(&self, config: ConnectionConfig) -> Result<(), SessionError> {
        validate_connection(&config)?;
        self.request(|ack| Command::Connect(config, ack)).await?
    }

    /// T4. No-op unless `connecting`.
    ///
    /// # Errors
    /// `Closed`.
    pub async fn cancel_connect(&self) -> Result<(), SessionError> {
        self.request(Command::CancelConnect).await
    }

    /// T12 from L*, T4 from `connecting`, T15 (dismiss) from `disconnected`, no-op in `idle`.
    ///
    /// # Errors
    /// `Closed`.
    pub async fn disconnect(&self) -> Result<(), SessionError> {
        self.request(Command::Disconnect).await
    }

    /// T5 (start / resume) or T11 (apply while polling). Returns once `polling`.
    ///
    /// # Errors
    /// `Validation`, `NotConnected` (no link), `Closed`.
    pub async fn start_poll(&self, poll: PollDefinition) -> Result<(), SessionError> {
        self.request(|ack| Command::StartPoll(poll, ack)).await?
    }

    /// T10. No-op unless the poll is running.
    ///
    /// # Errors
    /// `Closed`.
    pub async fn stop_poll(&self) -> Result<(), SessionError> {
        self.request(Command::StopPoll).await
    }

    /// Queues a write and waits for its result.
    ///
    /// # Errors
    /// `Validation`, `Closed`. "Not connected" is a [`WriteResult::NotConnected`].
    pub async fn write(&self, write: WriteRequest) -> Result<WriteResult, SessionError> {
        let request = validate_write(&write)?;
        self.request(|reply| {
            Command::Write(PendingWrite {
                dto: write,
                request,
                reply,
            })
        })
        .await
    }

    /// # Errors
    /// `Closed`.
    pub async fn reset_counters(&self) -> Result<(), SessionError> {
        self.request(Command::ResetCounters).await
    }

    /// # Errors
    /// `Closed`.
    pub async fn snapshot(&self) -> Result<SessionSnapshot, SessionError> {
        self.request(Command::Snapshot).await
    }

    /// Replaces the event sink (window reloaded) and returns the snapshot. The traffic log
    /// is replayed on the new sink as `TrafficFrames`, followed by `Counters`.
    ///
    /// # Errors
    /// `Closed`.
    pub async fn attach(&self, sink: Arc<dyn EventSink>) -> Result<SessionSnapshot, SessionError> {
        self.request(|ack| Command::Attach(sink, ack)).await
    }

    /// # Errors
    /// `Closed`.
    pub async fn stats(&self) -> Result<SessionStats, SessionError> {
        self.request(Command::Stats).await
    }

    /// Stops the session and waits until the link is closed.
    pub async fn shutdown(&self) {
        let _ = self.request(Command::Shutdown).await;
    }

    /// Stops the session without waiting (for synchronous window-close handlers).
    pub fn close(&self) {
        let (ack, _) = oneshot::channel();
        let _ = self.tx.send(Command::Shutdown(ack));
    }
}

struct PendingWrite {
    dto: WriteRequest,
    request: Request,
    reply: oneshot::Sender<WriteResult>,
}

enum Command {
    Connect(ConnectionConfig, oneshot::Sender<Result<(), SessionError>>),
    CancelConnect(oneshot::Sender<()>),
    Disconnect(oneshot::Sender<()>),
    StartPoll(PollDefinition, oneshot::Sender<Result<(), SessionError>>),
    StopPoll(oneshot::Sender<()>),
    Write(PendingWrite),
    ResetCounters(oneshot::Sender<()>),
    Snapshot(oneshot::Sender<SessionSnapshot>),
    Attach(Arc<dyn EventSink>, oneshot::Sender<SessionSnapshot>),
    Stats(oneshot::Sender<SessionStats>),
    Shutdown(oneshot::Sender<()>),
}

enum Purpose {
    Poll {
        generation: u64,
        def: PollDefinition,
    },
    Write(PendingWrite),
}

struct InflightCtx {
    purpose: Purpose,
    request: Request,
    slave: u8,
    txn_id: u16,
}

enum TxnOutcome {
    /// Broadcast written; no reply expected.
    Sent,
    Reply {
        bytes: Vec<u8>,
        at: u64,
        rtt: Duration,
    },
    Timeout {
        partial: Vec<u8>,
        at: u64,
        rtt: Duration,
    },
    Failed {
        error: LinkError,
        partial: Vec<u8>,
        at: u64,
    },
}

/// A complete TCP reply to an earlier transaction that arrived while waiting (REV-001 F2).
struct LateFrame {
    bytes: Vec<u8>,
    at: u64,
    txn: u16,
}

/// What the request task hands back: the link, the outcome and late replies it skipped.
type TxnResult = (Box<dyn Link>, TxnOutcome, Vec<LateFrame>);
type TxnHandle = JoinHandle<TxnResult>;
type ConnectHandle = JoinHandle<Result<Box<dyn Link>, ConnectError>>;

enum Wake {
    Cmd(Command),
    Exit,
    Txn(Result<TxnResult, JoinError>),
    Connect(Result<Result<Box<dyn Link>, ConnectError>, JoinError>),
    Unsolicited(Result<Vec<u8>, LinkError>),
    Tick,
    Flush,
}

struct Actor {
    cmd_rx: mpsc::UnboundedReceiver<Command>,
    clock: Arc<dyn Clock>,
    connector: Arc<dyn Connector>,
    sm: StateMachine,
    emitter: Emitter,
    traffic: TrafficLog,
    counters: Counters,

    config: Option<ConnectionConfig>,
    framing: Framing,
    poll: Option<PollDefinition>,
    poll_request: Option<Request>,
    poll_running: bool,
    /// Incremented whenever the running poll changes or stops; stale results are ignored.
    generation: u64,
    next_poll_at: Instant,
    /// No request may start before this instant (RTU inter-frame gap and broadcast
    /// turnaround). Tokio time, so tests control it with a paused clock.
    quiet_until: Instant,
    poll_seq: u64,
    last_update: Option<PollUpdate>,
    txn_id: u16,
    /// Recently sent TCP transaction ids (excluding the current one).
    recent_txns: VecDeque<u16>,

    /// The idle link. `None` while disconnected or while a request task owns it.
    link: Option<Box<dyn Link>>,
    inflight: Option<TxnHandle>,
    inflight_ctx: Option<InflightCtx>,
    connecting: Option<ConnectHandle>,
    write_queue: VecDeque<PendingWrite>,
}

impl Drop for Actor {
    fn drop(&mut self) {
        // If the actor task itself is aborted, do not leave tasks holding a socket or port.
        if let Some(h) = self.inflight.take() {
            h.abort();
        }
        if let Some(h) = self.connecting.take() {
            h.abort();
        }
    }
}

async fn join_opt<T>(handle: &mut Option<JoinHandle<T>>) -> Result<T, JoinError> {
    match handle.as_mut() {
        Some(h) => h.await,
        None => std::future::pending().await,
    }
}

async fn watch_opt(link: &mut Option<Box<dyn Link>>) -> Result<Vec<u8>, LinkError> {
    match link.as_mut() {
        Some(l) => l.watch().await,
        None => std::future::pending().await,
    }
}

async fn sleep_opt(at: Option<Instant>) {
    match at {
        Some(t) => sleep_until(t).await,
        None => std::future::pending().await,
    }
}

/// One request as run by the request task.
struct Exchange {
    frame: Vec<u8>,
    timeout: Duration,
    broadcast: bool,
    /// TCP: the transaction id of this request and ids sent earlier. A complete reply
    /// carrying an earlier id is a late reply: it is set aside and the wait continues.
    tcp_txn: Option<(u16, Vec<u16>)>,
}

/// Runs one request on its own task: send, then wait for the reply frame.
async fn transact(mut link: Box<dyn Link>, exchange: Exchange, clock: Arc<dyn Clock>) -> TxnResult {
    let mut late = Vec::new();
    if let Err(error) = link.send(&exchange.frame).await {
        let at = clock.now_ms();
        let outcome = TxnOutcome::Failed {
            error,
            partial: Vec::new(),
            at,
        };
        return (link, outcome, late);
    }
    if exchange.broadcast {
        return (link, TxnOutcome::Sent, late);
    }
    let started = Instant::now();
    let deadline = started + exchange.timeout;
    let outcome = loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let result = link.receive_frame(remaining).await;
        let at = clock.now_ms();
        let rtt = started.elapsed();
        match result {
            Ok(bytes) => {
                if let Some(txn) = late_txn(&bytes, exchange.tcp_txn.as_ref()) {
                    late.push(LateFrame { bytes, at, txn });
                    continue;
                }
                break TxnOutcome::Reply { bytes, at, rtt };
            }
            Err(ReceiveError::Timeout { partial }) => {
                break TxnOutcome::Timeout { partial, at, rtt }
            }
            Err(ReceiveError::Link { error, partial }) => {
                break TxnOutcome::Failed { error, partial, at }
            }
        }
    };
    (link, outcome, late)
}

/// The transaction id of `frame` if it is a reply to an earlier request (REV-001 F2).
/// Ids that were never sent are not "late": they are reported as `transactionMismatch`.
fn late_txn(frame: &[u8], tcp_txn: Option<&(u16, Vec<u16>)>) -> Option<u16> {
    let (current, earlier) = tcp_txn?;
    let id = u16::from_be_bytes([*frame.first()?, *frame.get(1)?]);
    (id != *current && earlier.contains(&id)).then_some(id)
}

fn framing_for(config: &ConnectionConfig) -> Framing {
    match config {
        ConnectionConfig::Tcp { .. } => Framing::Tcp,
        ConnectionConfig::Rtu {
            baud,
            data_bits,
            parity,
            stop_bits,
            ..
        } => {
            let parity_bit = u32::from(*parity != shared_types::Parity::None);
            let bits = 1 + u32::from(*data_bits) + parity_bit + u32::from(*stop_bits);
            Framing::rtu(*baud, bits)
        }
    }
}

fn bad_response_dto(bad: &BadResponse) -> (BadResponseKind, BadResponseDetail) {
    let kind = match bad.kind() {
        modbus_core::BadResponseKind::Crc => BadResponseKind::Crc,
        modbus_core::BadResponseKind::WrongSlave => BadResponseKind::WrongSlave,
        modbus_core::BadResponseKind::WrongFunction => BadResponseKind::WrongFunction,
        modbus_core::BadResponseKind::Malformed => BadResponseKind::Malformed,
        modbus_core::BadResponseKind::TransactionMismatch => BadResponseKind::TransactionMismatch,
        modbus_core::BadResponseKind::ShortFrame => BadResponseKind::ShortFrame,
    };
    let (expected, got) = bad.expected_got().unzip();
    (
        kind,
        BadResponseDetail {
            expected,
            got,
            message: bad.to_string(),
        },
    )
}

fn response_values(response: Response) -> Vec<u16> {
    match response {
        Response::ReadCoils(bits) | Response::ReadDiscreteInputs(bits) => {
            bits.into_iter().map(u16::from).collect()
        }
        Response::ReadHoldingRegisters(regs) | Response::ReadInputRegisters(regs) => regs,
        _ => Vec::new(),
    }
}

fn millis(d: Duration) -> u32 {
    u32::try_from(d.as_millis()).unwrap_or(u32::MAX)
}

impl Actor {
    fn new(
        cmd_rx: mpsc::UnboundedReceiver<Command>,
        sink: Arc<dyn EventSink>,
        deps: SessionDeps,
    ) -> Self {
        let now = Instant::now();
        let at = deps.clock.now_ms();
        Self {
            cmd_rx,
            clock: deps.clock,
            connector: deps.connector,
            sm: StateMachine::new(at),
            emitter: Emitter::new(sink),
            traffic: TrafficLog::default(),
            counters: Counters::default(),
            config: None,
            framing: Framing::Tcp,
            poll: None,
            poll_request: None,
            poll_running: false,
            generation: 0,
            next_poll_at: now,
            quiet_until: now,
            poll_seq: 0,
            last_update: None,
            txn_id: 0,
            recent_txns: VecDeque::with_capacity(RECENT_TXNS),
            link: None,
            inflight: None,
            inflight_ctx: None,
            connecting: None,
            write_queue: VecDeque::new(),
        }
    }

    async fn run(mut self) {
        loop {
            self.dispatch().await;
            let dispatch_at = self.next_dispatch_at();
            let flush_at = self.emitter.next_flush_at();
            let wake = tokio::select! {
                biased;
                cmd = self.cmd_rx.recv() => cmd.map_or(Wake::Exit, Wake::Cmd),
                r = join_opt(&mut self.inflight) => Wake::Txn(r),
                r = join_opt(&mut self.connecting) => Wake::Connect(r),
                r = watch_opt(&mut self.link) => Wake::Unsolicited(r),
                () = sleep_opt(dispatch_at) => Wake::Tick,
                () = sleep_opt(flush_at) => Wake::Flush,
            };
            match wake {
                Wake::Exit => {
                    self.shutdown().await;
                    return;
                }
                Wake::Cmd(Command::Shutdown(ack)) => {
                    self.shutdown().await;
                    let _ = ack.send(());
                    return;
                }
                Wake::Cmd(cmd) => self.handle_command(cmd).await,
                Wake::Txn(r) => {
                    self.inflight = None;
                    self.on_txn(r);
                }
                Wake::Connect(r) => {
                    self.connecting = None;
                    self.on_connect(r);
                }
                Wake::Unsolicited(r) => self.on_unsolicited(r),
                Wake::Tick => {}
                Wake::Flush => self.emitter.flush_due(Instant::now()),
            }
        }
    }

    fn state(&self) -> SessionState {
        self.sm.state()
    }

    fn transition(&mut self, event: Event) {
        match self.sm.apply(event, self.clock.now_ms()) {
            Ok((_, true)) => self.emitter.state(self.sm.snapshot()),
            Ok((_, false)) => {}
            Err(e) => debug_assert!(false, "{e}"),
        }
    }

    fn snapshot(&self) -> SessionSnapshot {
        SessionSnapshot {
            current: self.sm.snapshot(),
            config: self.config.clone(),
            poll: self.poll.clone(),
            counters: self.counters,
            last_update: self.last_update.clone(),
        }
    }

    fn record(
        &mut self,
        at: u64,
        direction: TrafficDirection,
        bytes: Vec<u8>,
        note: Option<String>,
    ) {
        let frame = self
            .traffic
            .record(at, direction, bytes, self.framing, note);
        self.emitter.frame(frame);
    }

    fn bump_counters(&mut self, f: impl FnOnce(&mut Counters)) {
        f(&mut self.counters);
        self.emitter.counters(self.counters);
    }

    async fn handle_command(&mut self, cmd: Command) {
        match cmd {
            Command::Connect(config, ack) => {
                if !matches!(
                    self.state(),
                    SessionState::Idle | SessionState::Disconnected
                ) {
                    let _ = ack.send(Err(SessionError::InvalidState(
                        "Already connected or connecting. Disconnect first.".into(),
                    )));
                    return;
                }
                self.framing = framing_for(&config);
                self.config = Some(config.clone());
                self.transition(Event::Connect);
                let connector = self.connector.clone();
                self.connecting = Some(tokio::spawn(
                    async move { connector.connect(&config).await },
                ));
                let _ = ack.send(Ok(()));
            }
            Command::CancelConnect(ack) => {
                if self.state() == SessionState::Connecting {
                    self.cancel_connect();
                }
                let _ = ack.send(());
            }
            Command::Disconnect(ack) => {
                match self.state() {
                    SessionState::Connecting => self.cancel_connect(),
                    SessionState::Disconnected => {
                        self.last_update = None;
                        self.transition(Event::Dismiss);
                    }
                    s if is_link_up(s) => {
                        self.close_link().await;
                        self.last_update = None;
                        self.transition(Event::Closed);
                    }
                    _ => {}
                }
                let _ = ack.send(());
            }
            Command::StartPoll(def, ack) => {
                let _ = ack.send(self.start_poll(def));
            }
            Command::StopPoll(ack) => {
                if is_poll_running(self.state()) {
                    self.poll_running = false;
                    self.generation += 1;
                    self.transition(Event::PollStopped);
                }
                let _ = ack.send(());
            }
            Command::Write(pw) => {
                if is_link_up(self.state()) {
                    self.write_queue.push_back(pw);
                } else {
                    let _ = pw.reply.send(WriteResult::NotConnected);
                }
            }
            Command::ResetCounters(ack) => {
                self.counters = Counters::default();
                self.emitter.counters_now(self.counters);
                let _ = ack.send(());
            }
            Command::Snapshot(ack) => {
                let _ = ack.send(self.snapshot());
            }
            Command::Attach(sink, ack) => {
                // Pending events are in the traffic log or the snapshot; replay replaces them.
                self.emitter = Emitter::new(sink);
                let _ = ack.send(self.snapshot());
                self.emitter.replay(self.traffic.frames());
                self.emitter.counters_now(self.counters);
            }
            Command::Stats(ack) => {
                let _ = ack.send(SessionStats {
                    max_pending_frames: self.emitter.max_pending_frames,
                    traffic_log_len: self.traffic.len(),
                    queued_writes: self.write_queue.len(),
                });
            }
            Command::Shutdown(ack) => {
                // Handled in `run`; kept for exhaustiveness.
                let _ = ack.send(());
            }
        }
    }

    fn start_poll(&mut self, def: PollDefinition) -> Result<(), SessionError> {
        if !is_link_up(self.state()) {
            return Err(SessionError::NotConnected);
        }
        let rtu = self.config.as_ref().is_some_and(ConnectionConfig::is_rtu);
        let request = validate_poll(&def, rtu)?;
        if self.poll.as_ref() != Some(&def) {
            self.last_update = None; // T11: old values are dropped
        }
        self.poll = Some(def);
        self.poll_request = Some(request);
        self.poll_running = true;
        self.generation += 1;
        self.next_poll_at = Instant::now();
        self.transition(Event::PollStarted);
        Ok(())
    }

    fn cancel_connect(&mut self) {
        if let Some(h) = self.connecting.take() {
            h.abort(); // the connect future is cancel-safe: no socket or port stays open
        }
        self.transition(Event::ConnectCancelled);
    }

    /// Answers the in-flight write (if any) with `in_flight_result`, and every queued
    /// write, which never left, with `notConnected` (REV-001 F9).
    fn fail_writes(&mut self, current: Option<Purpose>, in_flight_result: WriteResult) {
        if let Some(Purpose::Write(pw)) = current {
            let _ = pw.reply.send(in_flight_result);
        }
        for pw in self.write_queue.drain(..) {
            let _ = pw.reply.send(WriteResult::NotConnected);
        }
    }

    /// Closes the link on user request or shutdown. Emits nothing.
    async fn close_link(&mut self) {
        if let Some(h) = self.inflight.take() {
            h.abort(); // drops the link owned by the request task
                       // Wait for the abort, so the socket or port is closed before `idle` is emitted
                       // and an immediate reconnect cannot find the port still busy (REV-001 N5).
            let _ = h.await;
        }
        let ctx = self.inflight_ctx.take().map(|c| c.purpose);
        self.fail_writes(ctx, WriteResult::LinkLost);
        if let Some(mut link) = self.link.take() {
            link.close().await;
        }
        self.poll_running = false;
        self.generation += 1;
    }

    fn link_lost(&mut self, error: &LinkError) {
        self.link = None;
        let ctx = self.inflight_ctx.take().map(|c| c.purpose);
        self.fail_writes(ctx, WriteResult::LinkLost);
        self.poll_running = false;
        self.generation += 1;
        self.transition(Event::LinkLost(link_reason(error)));
    }

    async fn shutdown(&mut self) {
        if let Some(h) = self.connecting.take() {
            h.abort();
        }
        self.close_link().await;
    }

    fn on_connect(&mut self, result: Result<Result<Box<dyn Link>, ConnectError>, JoinError>) {
        if self.state() != SessionState::Connecting {
            return; // cancelled meanwhile; a link that slipped through is dropped (closed)
        }
        match result {
            Ok(Ok(link)) => {
                self.link = Some(link);
                self.quiet_until = Instant::now();
                self.transition(Event::LinkUp);
            }
            Ok(Err(e)) => self.transition(Event::ConnectFailed(connect_reason(&e))),
            Err(e) => self.transition(Event::ConnectFailed(connect_reason(&ConnectError::Io(
                format!("internal error: {e}"),
            )))),
        }
    }

    fn on_unsolicited(&mut self, result: Result<Vec<u8>, LinkError>) {
        match result {
            Ok(bytes) => {
                let at = self.clock.now_ms();
                self.record(
                    at,
                    TrafficDirection::Rx,
                    bytes,
                    Some("Unexpected bytes while no request was pending (discarded)".into()),
                );
                // RTU: the line was just busy; keep the inter-frame gap before sending.
                self.hold_line(false);
            }
            Err(e) => self.link_lost(&e),
        }
    }

    fn next_dispatch_at(&self) -> Option<Instant> {
        if self.inflight.is_some() || self.link.is_none() {
            return None;
        }
        if !self.write_queue.is_empty() {
            return Some(self.quiet_until);
        }
        self.poll_running
            .then(|| self.next_poll_at.max(self.quiet_until))
    }

    /// Starts the next request if the link is idle: queued writes first, then a due poll.
    async fn dispatch(&mut self) {
        if self.inflight.is_some() || self.link.is_none() {
            return;
        }
        let now = Instant::now();
        if now < self.quiet_until {
            return;
        }
        let purpose = if let Some(pw) = self.write_queue.pop_front() {
            Purpose::Write(pw)
        } else if self.poll_running && now >= self.next_poll_at {
            let Some(def) = self.poll.clone() else { return };
            let scan = Duration::from_millis(u64::from(def.scan_rate_ms));
            self.next_poll_at = now + scan;
            Purpose::Poll {
                generation: self.generation,
                def,
            }
        } else {
            return;
        };
        self.start_request(purpose).await;
    }

    async fn start_request(&mut self, purpose: Purpose) {
        let (request, slave) = match &purpose {
            Purpose::Poll { def, .. } => match &self.poll_request {
                Some(r) => (r.clone(), def.slave_id),
                None => return,
            },
            Purpose::Write(pw) => (pw.request.clone(), pw.dto.slave_id),
        };
        let Some(link) = self.link.as_mut() else {
            return;
        };
        // Discard late replies or noise so they cannot be taken for this request's reply.
        match link.drain().await {
            Ok(stale) if !stale.is_empty() => {
                let at = self.clock.now_ms();
                self.record(
                    at,
                    TrafficDirection::Rx,
                    stale,
                    Some("Late or unexpected bytes discarded before the next request".into()),
                );
            }
            Ok(_) => {}
            Err(e) => {
                // Nothing was sent for this request.
                self.fail_writes(Some(purpose), WriteResult::NotConnected);
                self.link_lost(&e);
                return;
            }
        }
        let Ok(pdu) = request.encode_pdu() else {
            // Unreachable: requests are validated before they are queued.
            self.fail_writes(Some(purpose), WriteResult::NotConnected);
            return;
        };
        self.txn_id = self.txn_id.wrapping_add(1);
        let tcp = self.framing == Framing::Tcp;
        let frame = if tcp {
            encode_tcp(self.txn_id, slave, &pdu)
        } else {
            encode_rtu(slave, &pdu)
        };
        let at = self.clock.now_ms();
        self.record(at, TrafficDirection::Tx, frame.clone(), None);
        self.bump_counters(|c| c.requests += 1);

        // REV-001 F1: only RTU has broadcast. On Modbus TCP unit id 0 is an ordinary unit
        // id that servers answer, so the reply is awaited like any other.
        let broadcast = !tcp && slave == 0 && matches!(purpose, Purpose::Write(_));
        // RTU: timeoutMs starts once the request has left the wire (REV-001 F5); the
        // link extends it further while a long reply is still arriving.
        let timeout = Duration::from_millis(u64::from(
            self.config
                .as_ref()
                .map_or(1000, ConnectionConfig::timeout_ms),
        )) + self.framing.transmit_time(frame.len());
        let tcp_txn = tcp.then(|| (self.txn_id, self.recent_txns.iter().copied().collect()));
        if tcp {
            if self.recent_txns.len() == RECENT_TXNS {
                self.recent_txns.pop_front();
            }
            self.recent_txns.push_back(self.txn_id);
        }
        let Some(link) = self.link.take() else {
            return;
        };
        let exchange = Exchange {
            frame,
            timeout,
            broadcast,
            tcp_txn,
        };
        self.inflight = Some(tokio::spawn(transact(link, exchange, self.clock.clone())));
        self.inflight_ctx = Some(InflightCtx {
            purpose,
            request,
            slave,
            txn_id: self.txn_id,
        });
    }

    /// RTU: no request may start before the inter-frame gap has passed (REV-001 F6).
    /// `after_timeout` uses the longer frame silence, because a slow slave may still be
    /// sending its late reply.
    fn hold_line(&mut self, after_timeout: bool) {
        if let Framing::Rtu(timing) = self.framing {
            let gap = if after_timeout {
                timing.silence
            } else {
                timing.t35.max(RTU_MIN_GAP)
            };
            self.quiet_until = self.quiet_until.max(Instant::now() + gap);
        }
    }

    fn on_txn(&mut self, result: Result<TxnResult, JoinError>) {
        let Some(ctx) = self.inflight_ctx.take() else {
            return;
        };
        let (link, outcome, late) = match result {
            Ok(r) => r,
            Err(e) => {
                self.inflight_ctx = Some(ctx);
                self.link_lost(&LinkError::Io(format!("internal error: {e}")));
                return;
            }
        };
        for frame in late {
            let note = format!("Late reply to transaction {} (discarded)", frame.txn);
            self.record(frame.at, TrafficDirection::Rx, frame.bytes, Some(note));
        }
        match outcome {
            TxnOutcome::Sent => {
                self.link = Some(link);
                if let Framing::Rtu(timing) = self.framing {
                    let gap = RTU_BROADCAST_TURNAROUND.max(timing.t35);
                    self.quiet_until = Instant::now() + gap;
                }
                if let Purpose::Write(pw) = ctx.purpose {
                    let _ = pw.reply.send(WriteResult::BroadcastSent);
                }
            }
            TxnOutcome::Reply { bytes, at, rtt } => {
                self.link = Some(link);
                self.hold_line(false);
                self.on_reply(ctx, bytes, at, rtt);
            }
            TxnOutcome::Timeout { partial, at, rtt } => {
                self.link = Some(link);
                self.hold_line(true);
                if partial.is_empty() {
                    self.on_timeout(ctx);
                } else {
                    // Some bytes but not a whole frame: a bad (short) response, not a timeout.
                    self.on_reply(ctx, partial, at, rtt);
                }
            }
            TxnOutcome::Failed { error, partial, at } => {
                drop(link);
                if !partial.is_empty() {
                    self.record(
                        at,
                        TrafficDirection::Rx,
                        partial,
                        Some("Incomplete frame before the link failed".into()),
                    );
                }
                self.inflight_ctx = Some(ctx);
                self.link_lost(&error);
            }
        }
    }

    fn on_timeout(&mut self, ctx: InflightCtx) {
        self.bump_counters(|c| c.timeouts += 1);
        match ctx.purpose {
            Purpose::Poll { generation, .. } if self.is_current(generation) => {
                self.transition(Event::CycleTimeout);
            }
            Purpose::Poll { .. } => {}
            Purpose::Write(pw) => {
                let _ = pw.reply.send(WriteResult::Timeout);
            }
        }
    }

    fn is_current(&self, generation: u64) -> bool {
        self.poll_running && generation == self.generation
    }

    fn on_reply(&mut self, ctx: InflightCtx, bytes: Vec<u8>, at: u64, rtt: Duration) {
        let parsed = match self.framing {
            Framing::Tcp => parse_tcp_reply(&ctx.request, ctx.txn_id, ctx.slave, &bytes),
            Framing::Rtu(_) => parse_rtu_reply(&ctx.request, ctx.slave, &bytes),
        };
        let note = parsed.as_ref().err().map(|b| format!("Bad response: {b}"));
        self.record(at, TrafficDirection::Rx, bytes, note);
        match &parsed {
            Ok(Reply::Response(_)) => self.bump_counters(|c| c.responses += 1),
            Ok(Reply::Exception { .. }) => self.bump_counters(|c| {
                c.responses += 1;
                c.errors += 1;
            }),
            Err(_) => self.bump_counters(|c| c.errors += 1),
        }

        match ctx.purpose {
            Purpose::Poll { generation, def } => {
                if !self.is_current(generation) {
                    return; // poll stopped or replaced while this request was in flight
                }
                match parsed {
                    Ok(Reply::Response(response)) => {
                        self.poll_seq += 1;
                        let update = PollUpdate {
                            seq: self.poll_seq,
                            at,
                            slave_id: def.slave_id,
                            function: def.function,
                            start_address: def.start_address,
                            values: response_values(response),
                            round_trip_ms: millis(rtt),
                        };
                        self.last_update = Some(update.clone());
                        self.emitter.poll_update(update);
                        self.transition(Event::CycleOk);
                    }
                    Ok(Reply::Exception { code, .. }) => {
                        self.transition(Event::CycleException(ExceptionCode(code.0)));
                    }
                    Err(bad) => {
                        let (kind, detail) = bad_response_dto(&bad);
                        self.transition(Event::CycleBadResponse(kind, detail));
                    }
                }
            }
            Purpose::Write(pw) => {
                let result = match parsed {
                    Ok(Reply::Response(_)) => WriteResult::Ok,
                    Ok(Reply::Exception { code, .. }) => WriteResult::Exception {
                        code: ExceptionCode(code.0),
                    },
                    Err(bad) => {
                        let (kind, detail) = bad_response_dto(&bad);
                        WriteResult::BadResponse { kind, detail }
                    }
                };
                let _ = pw.reply.send(result);
            }
        }
    }
}
