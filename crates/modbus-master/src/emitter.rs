//! Delivery of events to the UI with an explicit rate and drop policy (BE-001 Q-07, BE-002).
//!
//! **Session channel (W1, [`SessionEmitter`]):**
//! - `ConnectionStateChanged`, `PollStateChanged`, `PollListChanged`, `RevealPoll`,
//!   `PrefsChanged`, `SaveRequested`, `ShowTraffic`: sent immediately, never dropped or
//!   coalesced.
//! - `TrafficFrames`: batched, at most one batch per [`TRAFFIC_INTERVAL`]. No frame is
//!   dropped unless more than [`MAX_PENDING_FRAMES`] pile up inside one window; then the
//!   oldest are dropped and the gap shows in `TrafficFrame.seq`.
//! - `Counters`: at most one per [`COUNTERS_INTERVAL`], latest wins. Reset and re-attach
//!   send immediately.
//!
//! **Poll view channel (one per attached view, [`ViewEmitter`]):**
//! - `PollUpdate`: at most one per [`UPDATE_INTERVAL`] per view; the latest wins (older ones
//!   are dropped). A pending update is always flushed **before** the next
//!   `PollStateChanged`, and discarded when the definition changes. `seq` strictly
//!   increases per poll, so gaps show coalescing.
//! - `PollCounters`: at most one per [`COUNTERS_INTERVAL`] per view, latest wins.
//! - Everything else is sent immediately, never dropped or coalesced.
//!
//! Emitters never block: sinks are fire-and-forget channels (a Tauri `Channel` queues into
//! the webview). A window that cannot keep up sees coalesced updates, never a growing
//! backlog inside the session. A view sink that reports a dead receiver is dropped by the
//! session (no sender leak).

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use shared_types::{
    ConnectionCounters, PollCounters, PollUpdate, PollViewEvent, SessionEvent, TrafficFrame,
    TrafficFrames,
};
use tokio::time::Instant;

pub const TRAFFIC_INTERVAL: Duration = Duration::from_millis(50);
pub const UPDATE_INTERVAL: Duration = Duration::from_millis(50);
pub const COUNTERS_INTERVAL: Duration = Duration::from_millis(100);
pub const MAX_PENDING_FRAMES: usize = 5_000;

/// Receiver of events (a window's channel).
pub trait EventSink<E>: Send + Sync + 'static {
    /// Delivers one event. Returns `false` when the receiver is gone; the event is lost.
    fn send(&self, event: E) -> bool;
}

pub type SessionSink = Arc<dyn EventSink<SessionEvent>>;
pub type ViewSink = Arc<dyn EventSink<PollViewEvent>>;

#[derive(Debug, Clone, Copy)]
struct Throttle {
    interval: Duration,
    last: Option<Instant>,
}

impl Throttle {
    fn new(interval: Duration) -> Self {
        Self {
            interval,
            last: None,
        }
    }

    fn ready_at(&self) -> Instant {
        self.last.map_or_else(Instant::now, |l| l + self.interval)
    }

    fn is_ready(&self, now: Instant) -> bool {
        self.last.is_none_or(|l| now >= l + self.interval)
    }
}

fn earliest(times: impl IntoIterator<Item = Option<Instant>>) -> Option<Instant> {
    times.into_iter().flatten().min()
}

/// Emitter of the W1 session channel.
pub struct SessionEmitter {
    sink: SessionSink,
    frames: VecDeque<TrafficFrame>,
    counters: Option<ConnectionCounters>,
    frames_gate: Throttle,
    counters_gate: Throttle,
    /// Largest number of frames that were ever pending at once (for backlog tests).
    pub max_pending_frames: usize,
}

impl SessionEmitter {
    pub fn new(sink: SessionSink) -> Self {
        Self {
            sink,
            frames: VecDeque::new(),
            counters: None,
            frames_gate: Throttle::new(TRAFFIC_INTERVAL),
            counters_gate: Throttle::new(COUNTERS_INTERVAL),
            max_pending_frames: 0,
        }
    }

    /// Replaces the sink (W1 reloaded). Pending batches are discarded: the caller replays
    /// the traffic log and sends counters.
    pub fn reset(&mut self, sink: SessionSink) {
        *self = Self {
            max_pending_frames: self.max_pending_frames,
            ..Self::new(sink)
        };
    }

    /// Sends an event that is never coalesced.
    pub fn now(&mut self, event: SessionEvent) {
        self.sink.send(event);
    }

    pub fn frame(&mut self, frame: TrafficFrame) {
        if self.frames.len() >= MAX_PENDING_FRAMES {
            self.frames.pop_front();
        }
        self.frames.push_back(frame);
        self.max_pending_frames = self.max_pending_frames.max(self.frames.len());
        self.flush_due(Instant::now());
    }

    pub fn counters(&mut self, counters: ConnectionCounters) {
        self.counters = Some(counters);
        self.flush_due(Instant::now());
    }

    /// Sends counters now, ignoring the rate limit.
    pub fn counters_now(&mut self, counters: ConnectionCounters) {
        self.counters = Some(counters);
        self.send_counters();
    }

    /// Sends a batch directly (replay on re-attach), outside the pending queue.
    pub fn replay(&mut self, frames: &[TrafficFrame]) {
        for chunk in frames.chunks(1000) {
            self.sink.send(SessionEvent::TrafficFrames(TrafficFrames {
                frames: chunk.to_vec(),
            }));
        }
    }

    #[must_use]
    pub fn next_flush_at(&self) -> Option<Instant> {
        earliest([
            (!self.frames.is_empty()).then(|| self.frames_gate.ready_at()),
            self.counters
                .as_ref()
                .map(|_| self.counters_gate.ready_at()),
        ])
    }

    pub fn flush_due(&mut self, now: Instant) {
        if !self.frames.is_empty() && self.frames_gate.is_ready(now) {
            self.send_frames();
        }
        if self.counters.is_some() && self.counters_gate.is_ready(now) {
            self.send_counters();
        }
    }

    pub fn flush_all(&mut self) {
        self.send_frames();
        self.send_counters();
    }

    fn send_frames(&mut self) {
        if !self.frames.is_empty() {
            self.frames_gate.last = Some(Instant::now());
            let frames = Vec::from(std::mem::take(&mut self.frames));
            self.sink
                .send(SessionEvent::TrafficFrames(TrafficFrames { frames }));
        }
    }

    fn send_counters(&mut self) {
        if let Some(c) = self.counters.take() {
            self.counters_gate.last = Some(Instant::now());
            self.sink.send(SessionEvent::Counters(c));
        }
    }
}

/// Emitter of one attached poll view.
pub struct ViewEmitter {
    sink: ViewSink,
    update: Option<PollUpdate>,
    counters: Option<PollCounters>,
    update_gate: Throttle,
    counters_gate: Throttle,
    /// False once the sink reported a dead receiver.
    alive: bool,
}

impl ViewEmitter {
    pub fn new(sink: ViewSink) -> Self {
        Self {
            sink,
            update: None,
            counters: None,
            update_gate: Throttle::new(UPDATE_INTERVAL),
            counters_gate: Throttle::new(COUNTERS_INTERVAL),
            alive: true,
        }
    }

    /// False once the receiver is gone; the session then drops this view.
    #[must_use]
    pub fn is_alive(&self) -> bool {
        self.alive
    }

    fn send(&mut self, event: PollViewEvent) {
        if self.alive && !self.sink.send(event) {
            self.alive = false;
        }
    }

    /// Sends an event that is never coalesced. A `PollStateChanged` or
    /// `ConnectionStateChanged` first flushes the pending update, so values never arrive
    /// after the state that followed them (a view must not apply fresh values after it
    /// already shows the link as lost). Updates that must not be shown at all (C5, C7,
    /// Apply) are discarded with [`ViewEmitter::discard_update`] before the state event.
    pub fn now(&mut self, event: PollViewEvent) {
        if matches!(
            event,
            PollViewEvent::PollStateChanged(_) | PollViewEvent::ConnectionStateChanged(_)
        ) {
            self.send_update();
        }
        self.send(event);
    }

    pub fn poll_update(&mut self, update: PollUpdate) {
        self.update = Some(update);
        self.flush_due(Instant::now());
    }

    /// Drops a pending update (the definition changed; its values are obsolete).
    pub fn discard_update(&mut self) {
        self.update = None;
    }

    pub fn counters(&mut self, counters: PollCounters) {
        self.counters = Some(counters);
        self.flush_due(Instant::now());
    }

    /// Sends pending events and then `last` (the final event of this channel).
    pub fn close_with(&mut self, last: PollViewEvent) {
        self.flush_all();
        self.send(last);
        self.alive = false;
    }

    #[must_use]
    pub fn next_flush_at(&self) -> Option<Instant> {
        earliest([
            self.update.as_ref().map(|_| self.update_gate.ready_at()),
            self.counters
                .as_ref()
                .map(|_| self.counters_gate.ready_at()),
        ])
    }

    pub fn flush_due(&mut self, now: Instant) {
        if self.update.is_some() && self.update_gate.is_ready(now) {
            self.send_update();
        }
        if self.counters.is_some() && self.counters_gate.is_ready(now) {
            self.send_counters();
        }
    }

    pub fn flush_all(&mut self) {
        self.send_update();
        self.send_counters();
    }

    fn send_update(&mut self) {
        if let Some(u) = self.update.take() {
            self.update_gate.last = Some(Instant::now());
            self.send(PollViewEvent::PollUpdate(u));
        }
    }

    fn send_counters(&mut self) {
        if let Some(c) = self.counters.take() {
            self.counters_gate.last = Some(Instant::now());
            self.send(PollViewEvent::PollCounters(c));
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use shared_types::{Counters, PollId, PollState, PollStatus, TrafficDirection};

    struct Recorder<E>(Mutex<Vec<E>>, bool);
    impl<E: Send + 'static> EventSink<E> for Recorder<E> {
        fn send(&self, event: E) -> bool {
            self.0.lock().unwrap().push(event);
            self.1
        }
    }
    fn recorder<E>() -> Arc<Recorder<E>> {
        Arc::new(Recorder(Mutex::new(Vec::new()), true))
    }

    fn frame(seq: u64) -> TrafficFrame {
        TrafficFrame {
            seq,
            at: 0,
            direction: TrafficDirection::Tx,
            bytes: vec![],
            slave_id: None,
            function: None,
            exception_code: None,
            note: None,
            origin: None,
        }
    }

    fn update(seq: u64) -> PollUpdate {
        PollUpdate {
            poll_id: PollId(1),
            seq,
            at: 0,
            slave_id: 1,
            function: 3,
            start_address: 0,
            values: vec![],
            round_trip_ms: 0,
        }
    }

    fn status() -> PollStatus {
        PollStatus {
            poll_id: PollId(1),
            state: PollState::Timeout,
            consecutive_failures: 1,
            exception_code: None,
            bad_response_kind: None,
            bad_response_detail: None,
            at: 0,
        }
    }

    fn pc(requests: u64) -> PollCounters {
        PollCounters {
            poll_id: PollId(1),
            counters: Counters {
                requests,
                ..Counters::default()
            },
            effective_scan_ms: None,
            last_ok_at: None,
        }
    }

    #[tokio::test(start_paused = true)]
    async fn traffic_is_batched_per_window() {
        let rec = recorder();
        let mut e = SessionEmitter::new(rec.clone());
        e.frame(frame(1)); // first one goes out at once
        e.frame(frame(2));
        e.frame(frame(3));
        assert_eq!(rec.0.lock().unwrap().len(), 1);
        let due = e.next_flush_at().unwrap();
        assert_eq!(due - Instant::now(), TRAFFIC_INTERVAL);
        tokio::time::advance(TRAFFIC_INTERVAL).await;
        e.flush_due(Instant::now());
        let events = rec.0.lock().unwrap().clone();
        assert_eq!(events.len(), 2);
        match &events[1] {
            SessionEvent::TrafficFrames(b) => assert_eq!(b.frames.len(), 2),
            other => panic!("{other:?}"),
        }
        assert!(e.next_flush_at().is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn pending_frames_are_capped() {
        let rec = recorder();
        let mut e = SessionEmitter::new(rec.clone());
        for i in 0..(MAX_PENDING_FRAMES as u64 + 10) {
            e.frame(frame(i));
        }
        assert_eq!(e.max_pending_frames, MAX_PENDING_FRAMES);
        e.flush_all();
        let events = rec.0.lock().unwrap().clone();
        match events.last().unwrap() {
            SessionEvent::TrafficFrames(b) => {
                assert_eq!(b.frames.len(), MAX_PENDING_FRAMES);
                assert_eq!(b.frames[0].seq, 10);
            }
            other => panic!("{other:?}"),
        }
    }

    fn kinds(events: &[PollViewEvent]) -> Vec<String> {
        events
            .iter()
            .map(|ev| match ev {
                PollViewEvent::PollUpdate(u) => format!("u{}", u.seq),
                PollViewEvent::PollStateChanged(_) => "state".into(),
                PollViewEvent::PollCounters(c) => format!("c{}", c.counters.requests),
                _ => "other".into(),
            })
            .collect()
    }

    #[tokio::test(start_paused = true)]
    async fn view_updates_coalesce_and_flush_before_state() {
        let rec = recorder();
        let mut e = ViewEmitter::new(rec.clone());
        e.poll_update(update(1));
        e.poll_update(update(2));
        e.poll_update(update(3));
        e.now(PollViewEvent::PollStateChanged(status()));
        // Update 2 was replaced by 3 (latest wins); 3 is flushed before the state.
        assert_eq!(kinds(&rec.0.lock().unwrap()), ["u1", "u3", "state"]);
    }

    /// REV-004 m1: a connection state change (C6 within 50 ms of a good cycle) also flushes
    /// the pending update first, so a view never applies values after "disconnected".
    #[tokio::test(start_paused = true)]
    async fn view_update_is_flushed_before_a_connection_state_change() {
        let rec = recorder();
        let mut e = ViewEmitter::new(rec.clone());
        e.poll_update(update(1));
        e.poll_update(update(2)); // pending (within 50 ms of update 1)
        let lost = shared_types::ConnectionStatus {
            state: shared_types::ConnectionState::Disconnected,
            reason: None,
            config: None,
            at: 0,
        };
        e.now(PollViewEvent::ConnectionStateChanged(lost.clone()));
        e.now(PollViewEvent::PollStateChanged(status()));
        let got = rec.0.lock().unwrap().clone();
        assert_eq!(kinds(&got), ["u1", "u2", "other", "state"]);
        assert!(matches!(got[2], PollViewEvent::ConnectionStateChanged(_)));
        assert!(e.next_flush_at().is_none(), "nothing left to flush");
        // A discarded update (C5 / C7) is not resurrected by the state event.
        tokio::time::advance(UPDATE_INTERVAL).await;
        e.poll_update(update(3));
        e.poll_update(update(4));
        e.discard_update();
        e.now(PollViewEvent::ConnectionStateChanged(lost));
        let got = rec.0.lock().unwrap().clone();
        assert_eq!(kinds(&got[4..]), ["u3", "other"]);
    }

    #[tokio::test(start_paused = true)]
    async fn view_counters_at_most_every_100ms_latest_wins() {
        let rec = recorder();
        let mut e = ViewEmitter::new(rec.clone());
        for i in 1..=10 {
            e.counters(pc(i));
            tokio::time::advance(Duration::from_millis(10)).await;
            e.flush_due(Instant::now());
        }
        tokio::time::advance(COUNTERS_INTERVAL).await;
        e.flush_due(Instant::now());
        assert_eq!(kinds(&rec.0.lock().unwrap()), ["c1", "c10"]);
    }

    #[tokio::test(start_paused = true)]
    async fn discarded_update_is_never_sent() {
        let rec = recorder();
        let mut e = ViewEmitter::new(rec.clone());
        e.poll_update(update(1));
        e.poll_update(update(2));
        e.discard_update();
        tokio::time::advance(UPDATE_INTERVAL).await;
        e.flush_due(Instant::now());
        assert_eq!(kinds(&rec.0.lock().unwrap()), ["u1"]);
        assert!(e.next_flush_at().is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn dead_view_sink_is_reported() {
        let rec: Arc<Recorder<PollViewEvent>> = Arc::new(Recorder(Mutex::new(Vec::new()), false));
        let mut e = ViewEmitter::new(rec.clone());
        assert!(e.is_alive());
        e.now(PollViewEvent::PollStateChanged(status()));
        assert!(!e.is_alive());
        e.now(PollViewEvent::PollStateChanged(status()));
        assert_eq!(
            rec.0.lock().unwrap().len(),
            1,
            "nothing is sent after death"
        );
    }
}
