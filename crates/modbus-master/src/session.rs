//! One Modbus master connection with up to 16 polls: an actor task that owns the link, the
//! connection and poll state machines, the scheduler, the write queue, the counters, the
//! traffic log, the per-poll host fields and the routing of poll views.
//!
//! Rules implemented here (BE-001, BE-002, DES-002 sections 1, 7 and 8):
//! - One request on the wire at a time. The link is moved into a request task and comes
//!   back with the outcome; the next request starts only after that.
//! - Queued writes (one FIFO for every window) run after the in-flight request and before
//!   the next poll request; polls are picked by [`Scheduler`] (earliest deadline, least
//!   recently served, no catch-up, no starvation).
//! - A poll's timeout / exception / bad response only changes that poll. Only link errors
//!   or closes change the connection (`disconnected`). No auto-reconnect.
//! - RTU: slave 0 writes are broadcasts (`broadcastSent`); t3.5 gaps; TCP late replies are
//!   logged and skipped (REV-001).
//! - Every byte written or read is recorded in the traffic log exactly as on the wire,
//!   tagged with the request it belongs to (`origin`).
//! - Hosting (attach, detach, pop out, dock, close, layout) only changes routing and
//!   stored UI fields: never the scheduler, the link or the counters (DES-002 8.1).

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::Duration;

use modbus_core::{
    encode_rtu, encode_tcp, parse_rtu_reply, parse_tcp_reply, BadResponse, Reply, Request, Response,
};
use shared_types::{
    BadResponseDetail, BadResponseKind, ConnectionConfig, ConnectionCounters, ConnectionState,
    Counters, DetachReason, ExceptionCode, HandoffRequested, PollConfigInput, PollDefinition,
    PollHostKind, PollId, PollList, PollRemoved, PollUpdate, PollViewEvent, PollViewSettings,
    PollViewSnapshot, Prefs, Profile, ProfileNameChanged, RevealPoll, SaveRequest, SessionEvent,
    SessionSnapshot, ShowTraffic, SubWindowState, TrafficDirection, TrafficFrame, TrafficOrigin,
    ViewDetached, ViewToken, WindowPlacement, WorkspaceItem, WorkspaceLayout, WorkspaceProfile,
    WorkspaceRect, WriteRequest, WriteResult, MAX_POLLS, MAX_POLL_NAME_CHARS,
    PROFILE_SCHEMA_VERSION,
};
use tokio::sync::{mpsc, oneshot};
use tokio::task::{JoinError, JoinHandle};
use tokio::time::{sleep_until, Instant};
use transport::{ConnectError, Framing, Link, LinkError, ReceiveError};

use crate::clock::{Clock, SystemClock};
use crate::connection_state::{ConnEvent, ConnectionMachine};
use crate::connector::{connect_reason, link_reason, Connector, SystemConnector};
use crate::emitter::{SessionEmitter, SessionSink, ViewEmitter, ViewSink};
use crate::poll::{PollEntry, ViewRoute};
use crate::poll_state::{PollEvent, PollMachine};
use crate::scheduler::{on_time_start, Scheduler};
use crate::timer::{NoTimerResolution, PrecisionHold, TimerResolution};
use crate::traffic::TrafficLog;
use crate::validate::{
    validate_connection, validate_handoff, validate_layout, validate_poll, validate_poll_name,
    validate_view_parts, validate_workspace_rect, validate_write, ValidationError,
};

/// Pause after an RTU broadcast before the next request, so slaves can process it
/// (Modbus serial line specification, "turnaround delay").
pub const RTU_BROADCAST_TURNAROUND: Duration = Duration::from_millis(100);

/// Minimum RTU gap between the end of one exchange and the next request (REV-001 F6):
/// `max(t3.5, RTU_MIN_GAP)`. After a timeout the gap is the frame silence
/// (`max(t3.5, 50 ms)`), so a slave that is merely slow can finish before the next send.
pub const RTU_MIN_GAP: Duration = Duration::from_millis(5);

/// How long `mm_dock_poll(requestHandoff: true)` waits for the native window's handoff.
pub const HANDOFF_REQUEST_TIMEOUT: Duration = Duration::from_secs(1);

/// Window of the link load measurement.
pub const LINK_LOAD_WINDOW: Duration = Duration::from_secs(2);

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
    #[error("This poll no longer exists.")]
    PollNotFound(PollId),
    #[error("The session has ended.")]
    Closed,
}

fn invalid(field: &'static str, message: impl Into<String>) -> SessionError {
    SessionError::Validation(ValidationError {
        field,
        message: message.into(),
    })
}

/// Injectable dependencies.
#[derive(Clone)]
pub struct SessionDeps {
    pub clock: Arc<dyn Clock>,
    pub connector: Arc<dyn Connector>,
    /// OS timer precision, held while a poll runs (REPORT-006 D1, see `timer.rs`). The
    /// default is [`NoTimerResolution`]; the desktop app injects its OS implementation.
    pub timer: Arc<dyn TimerResolution>,
}

impl Default for SessionDeps {
    fn default() -> Self {
        Self {
            clock: Arc::new(SystemClock),
            connector: Arc::new(SystemConnector),
            timer: Arc::new(NoTimerResolution),
        }
    }
}

/// Diagnostics for tests (backlog and leak checks).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionStats {
    /// Most traffic frames ever waiting in the W1 emitter at once.
    pub max_pending_frames: usize,
    pub traffic_log_len: usize,
    pub queued_writes: usize,
    /// Poll views currently attached.
    pub attached_views: usize,
    pub polls: usize,
}

/// What the Tauri layer must do after `show_poll`.
#[derive(Debug, Clone, PartialEq)]
pub enum ShowOutcome {
    /// Shown in the workspace (`RevealPoll` was sent): bring W1 to the front.
    Workspace,
    /// Native and open: restore and focus its window.
    FocusNative,
    /// Native and closed: create its window (at this saved placement, if any), then call
    /// [`Session::set_native_open`].
    OpenNative(Option<WindowPlacement>),
}

/// The host fields before [`Session::begin_native_open`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeOpenUndo {
    host: PollHostKind,
    open: bool,
    minimized_at: Option<usize>,
}

/// Host fields of one poll, for the window layer.
#[derive(Debug, Clone, PartialEq)]
pub struct PollHostInfo {
    pub poll_id: PollId,
    pub name: String,
    pub host: PollHostKind,
    pub open: bool,
    pub workspace: Option<WorkspaceRect>,
    pub native: Option<WindowPlacement>,
}

impl PollHostInfo {
    #[must_use]
    pub fn is_native_open(&self) -> bool {
        self.host == PollHostKind::Native && self.open
    }
}

type Call = Box<dyn FnOnce(&mut Actor) + Send>;

enum Command {
    Call(Call),
    Disconnect(oneshot::Sender<()>),
    Shutdown(oneshot::Sender<()>),
}

/// Handle to a running session. Dropping every handle (or calling [`Session::close`])
/// stops the actor, which closes the link and aborts any connect or request in progress.
pub struct Session {
    tx: mpsc::UnboundedSender<Command>,
}

impl Session {
    /// Starts a session in `idle` with no polls. Must be called inside a Tokio runtime.
    pub fn spawn(sink: SessionSink, deps: SessionDeps) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        let actor = Actor::new(rx, sink, deps);
        tokio::spawn(actor.run());
        Self { tx }
    }

    async fn call<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Actor) -> T + Send + 'static,
    ) -> Result<T, SessionError> {
        let (ack, rx) = oneshot::channel();
        let call: Call = Box::new(move |actor| {
            let _ = ack.send(f(actor));
        });
        self.tx
            .send(Command::Call(call))
            .map_err(|_| SessionError::Closed)?;
        rx.await.map_err(|_| SessionError::Closed)
    }

    async fn try_call<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Actor) -> Result<T, SessionError> + Send + 'static,
    ) -> Result<T, SessionError> {
        self.call(f).await?
    }

    // ---- connection ----------------------------------------------------------------

    /// C1. Returns once the connection is `connecting`; the outcome arrives as an event.
    ///
    /// # Errors
    /// `Validation`, `InvalidState` (not idle or disconnected), `Closed`.
    pub async fn connect(&self, config: ConnectionConfig) -> Result<(), SessionError> {
        validate_connection(&config)?;
        self.try_call(move |a| a.connect(config)).await
    }

    /// C4. No-op unless `connecting`.
    ///
    /// # Errors
    /// `Closed`.
    pub async fn cancel_connect(&self) -> Result<(), SessionError> {
        self.call(|a| {
            if a.conn.state() == ConnectionState::Connecting {
                a.cancel_connect();
            }
        })
        .await
    }

    /// C5 from `connected`, C4 from `connecting`, C7 (dismiss) from `disconnected`, no-op
    /// in `idle`.
    ///
    /// # Errors
    /// `Closed`.
    pub async fn disconnect(&self) -> Result<(), SessionError> {
        let (ack, rx) = oneshot::channel();
        self.tx
            .send(Command::Disconnect(ack))
            .map_err(|_| SessionError::Closed)?;
        rx.await.map_err(|_| SessionError::Closed)
    }

    /// # Errors
    /// `Closed`.
    pub async fn set_auto_start_poll(&self, enabled: bool) -> Result<(), SessionError> {
        self.call(move |a| a.auto_start_poll = enabled).await
    }

    // ---- polls ---------------------------------------------------------------------

    /// PT0. Adds a poll at the end of the list. A poll from W1 opens in the workspace, a
    /// poll from a native window (`host: native`) needs its own window (Tauri layer).
    ///
    /// # Errors
    /// `Validation` (`polls` at 16, `name`, definition fields, `aliases`, ...), `Closed`.
    pub async fn add_poll(
        &self,
        input: PollConfigInput,
        host: PollHostKind,
    ) -> Result<PollId, SessionError> {
        self.try_call(move |a| a.add_poll(input, host, None)).await
    }

    /// Duplicates a poll right after the source (DES-002 H3), named "{name} copy".
    ///
    /// # Errors
    /// `PollNotFound`, `Validation` (`polls` at 16), `Closed`.
    pub async fn duplicate_poll(&self, id: PollId) -> Result<PollId, SessionError> {
        self.try_call(move |a| a.duplicate_poll(id)).await
    }

    /// PT8. Its view gets `PollRemoved`; an in-flight request is finished and its reply
    /// discarded.
    ///
    /// # Errors
    /// `PollNotFound`, `Closed`.
    pub async fn remove_poll(&self, id: PollId) -> Result<(), SessionError> {
        self.try_call(move |a| a.remove_poll(id)).await
    }

    /// Apply a definition (PT6 while running, PT6b otherwise). An unchanged definition is a
    /// no-op.
    ///
    /// # Errors
    /// `PollNotFound`, `Validation`, `Closed`.
    pub async fn update_poll(
        &self,
        id: PollId,
        definition: PollDefinition,
    ) -> Result<(), SessionError> {
        self.try_call(move |a| a.update_poll(id, definition)).await
    }

    /// # Errors
    /// `PollNotFound`, `Validation` (`name`), `Closed`.
    pub async fn rename_poll(&self, id: PollId, name: String) -> Result<(), SessionError> {
        self.try_call(move |a| a.rename_poll(id, name)).await
    }

    /// Resume (PT3) / Pause (PT4); sets `active` in every connection state.
    ///
    /// # Errors
    /// `PollNotFound`, `Validation` (RTU slave 0 read), `Closed`.
    pub async fn set_poll_active(&self, id: PollId, active: bool) -> Result<(), SessionError> {
        self.try_call(move |a| a.set_poll_active(id, active)).await
    }

    /// Resume all / Pause all. Polls that cannot start (RTU slave 0) are skipped.
    ///
    /// # Errors
    /// `Closed`.
    pub async fn set_all_polls_active(&self, active: bool) -> Result<(), SessionError> {
        self.call(move |a| {
            let ids: Vec<PollId> = a.polls.iter().map(|p| p.id).collect();
            for id in ids {
                let _ = a.set_poll_active(id, active);
            }
        })
        .await
    }

    /// # Errors
    /// `PollNotFound`, `Validation` (`display`, `scale`, `scaleOverrides`, `aliases`), `Closed`.
    pub async fn set_poll_view(
        &self,
        id: PollId,
        view: PollViewSettings,
    ) -> Result<(), SessionError> {
        self.try_call(move |a| a.set_poll_view(id, view)).await
    }

    /// New list order; must be a full permutation of the current poll ids.
    ///
    /// # Errors
    /// `Validation` (`order`), `Closed`.
    pub async fn reorder_polls(&self, order: Vec<PollId>) -> Result<(), SessionError> {
        self.try_call(move |a| a.reorder(order)).await
    }

    /// Queues a write and waits for its result. `poll_id` tags the traffic.
    ///
    /// # Errors
    /// `Validation`, `Closed`. "Not connected" is a [`WriteResult::NotConnected`].
    pub async fn write(
        &self,
        write: WriteRequest,
        poll_id: Option<PollId>,
    ) -> Result<WriteResult, SessionError> {
        let request = validate_write(&write)?;
        let (reply, rx) = oneshot::channel();
        self.call(move |a| {
            let pending = PendingWrite {
                dto: write,
                request,
                poll_id: poll_id.filter(|id| a.poll(*id).is_some()),
                reply,
            };
            if a.conn.is_connected() {
                a.write_queue.push_back(pending);
            } else {
                let _ = pending.reply.send(WriteResult::NotConnected);
            }
        })
        .await?;
        rx.await.map_err(|_| SessionError::Closed)
    }

    /// Resets one poll's counters, or (None) every counter of the connection.
    ///
    /// # Errors
    /// `PollNotFound`, `Closed`.
    pub async fn reset_counters(&self, id: Option<PollId>) -> Result<(), SessionError> {
        self.try_call(move |a| a.reset_counters(id)).await
    }

    // ---- W1 channel and snapshots ----------------------------------------------------

    /// Attaches W1's channel (replacing the previous one after a reload) and returns the
    /// snapshot. The traffic log is replayed as `TrafficFrames`, then `Counters` follow.
    ///
    /// # Errors
    /// `Closed`.
    pub async fn open(&self, sink: SessionSink) -> Result<SessionSnapshot, SessionError> {
        self.call(move |a| {
            a.emitter.reset(sink);
            let snapshot = a.snapshot();
            let frames = a.traffic.frames();
            a.emitter.replay(&frames);
            let counters = a.counters_dto();
            a.emitter.counters_now(counters);
            snapshot
        })
        .await
    }

    /// # Errors
    /// `Closed`.
    pub async fn snapshot(&self) -> Result<SessionSnapshot, SessionError> {
        self.call(Actor::snapshot).await
    }

    // ---- views and hosts -------------------------------------------------------------

    /// Attaches a poll view channel (DES-002 8.1). Replaces an existing attachment of the
    /// same poll (the old one gets `ViewDetached { replaced }`).
    ///
    /// # Errors
    /// `PollNotFound`; `Validation` (`host`) when `host` is not the poll's host or the
    /// poll is closed; `Closed`.
    pub async fn attach_view(
        &self,
        id: PollId,
        host: PollHostKind,
        sink: ViewSink,
    ) -> Result<PollViewSnapshot, SessionError> {
        self.try_call(move |a| a.attach_view(id, host, sink)).await
    }

    /// Detaches a view. A token that is not the current one is ignored (late detach).
    ///
    /// # Errors
    /// `Closed`.
    pub async fn detach_view(&self, id: PollId, token: ViewToken) -> Result<(), SessionError> {
        self.call(move |a| {
            if let Some(p) = a.poll_mut(id) {
                if p.view.as_ref().is_some_and(|v| v.token == token) {
                    p.view = None;
                    a.handoff_view_gone(id);
                }
            }
        })
        .await
    }

    /// The native window of `id` was destroyed: drop its route; if the poll was still
    /// shown natively, it is now closed (kept).
    ///
    /// # Errors
    /// `Closed`.
    pub async fn native_window_destroyed(&self, id: PollId) -> Result<(), SessionError> {
        self.call(move |a| a.native_window_destroyed(id)).await
    }

    /// Show (H12-H14). With `placement` the poll is shown in the workspace at that
    /// rectangle (list drag); a poll that is open natively must be docked instead.
    ///
    /// # Errors
    /// `PollNotFound`, `Validation`, `Closed`.
    pub async fn show_poll(
        &self,
        id: PollId,
        placement: Option<WorkspaceRect>,
    ) -> Result<ShowOutcome, SessionError> {
        self.try_call(move |a| a.show_poll(id, placement)).await
    }

    /// After the native window was created (pop out, show of a closed native poll, new
    /// poll from a native window): host native, open, handoff stored; a workspace view
    /// gets `ViewDetached { poppedOut }`.
    ///
    /// # Errors
    /// `PollNotFound`, `Validation` (`handoff` too large), `Closed`.
    pub async fn set_native_open(
        &self,
        id: PollId,
        handoff: Option<String>,
    ) -> Result<(), SessionError> {
        self.begin_native_open(id, handoff).await.map(drop)
    }

    /// As [`Session::set_native_open`], but called **before** the native window is created
    /// (REV-004 m6: the new window's first attach then always finds the poll native). If
    /// the window cannot be created, [`Session::undo_native_open`] restores the previous
    /// host fields.
    ///
    /// # Errors
    /// `PollNotFound`, `Validation` (`handoff` too large), `Closed`.
    pub async fn begin_native_open(
        &self,
        id: PollId,
        handoff: Option<String>,
    ) -> Result<NativeOpenUndo, SessionError> {
        self.try_call(move |a| a.set_native_open(id, handoff)).await
    }

    /// Undoes [`Session::begin_native_open`] after the window could not be created: host,
    /// `open` and the minimized-bar position are restored and `PollListChanged` follows (a
    /// workspace sub-window is mounted again by W1 and gets the stored handoff back). A
    /// native view attached meanwhile gets `ViewDetached { closed }`. No-op for a poll that
    /// is gone.
    ///
    /// # Errors
    /// `Closed`.
    pub async fn undo_native_open(
        &self,
        id: PollId,
        undo: NativeOpenUndo,
    ) -> Result<(), SessionError> {
        self.call(move |a| a.undo_native_open(id, &undo)).await
    }

    /// Dock (H5): host workspace, open, `RevealPoll`; the native view gets
    /// `ViewDetached { docked }`. `native` is the window placement to remember.
    ///
    /// # Errors
    /// `PollNotFound`, `Validation`, `Closed`.
    pub async fn dock(
        &self,
        id: PollId,
        handoff: Option<String>,
        rect: Option<WorkspaceRect>,
        native: Option<WindowPlacement>,
    ) -> Result<(), SessionError> {
        self.try_call(move |a| a.dock(id, handoff, rect, native))
            .await
    }

    /// Asks the native view of `id` for its handoff and waits up to 1 s. Without an
    /// attached native view there is nothing to hand off: `Ok(None)` (also when the view
    /// detaches or its window is destroyed while the request waits). Requests for
    /// different polls are independent.
    ///
    /// # Errors
    /// `Validation` (`handoff`) on timeout or refusal (the window answered null);
    /// `InvalidState` while another request for the same poll is waiting;
    /// `PollNotFound` (also when the poll is removed while the request waits); `Closed`.
    pub async fn request_handoff(&self, id: PollId) -> Result<Option<String>, SessionError> {
        let Some(rx) = self.try_call(move |a| a.request_handoff(id)).await? else {
            return Ok(None);
        };
        let refused = || {
            invalid(
                "handoff",
                "The poll window did not hand over its state (a dialog may be open there).",
            )
        };
        match tokio::time::timeout(HANDOFF_REQUEST_TIMEOUT, rx).await {
            Ok(Ok(HandoffAnswer::Provided(Some(handoff)))) => Ok(Some(handoff)),
            Ok(Ok(HandoffAnswer::Provided(None))) | Err(_) => Err(refused()),
            Ok(Ok(HandoffAnswer::ViewGone)) => Ok(None),
            Ok(Ok(HandoffAnswer::PollGone)) => Err(SessionError::PollNotFound(id)),
            Ok(Err(_)) => Err(SessionError::Closed),
        }
    }

    /// The native window's answer to `HandoffRequested` (null = refuse).
    ///
    /// # Errors
    /// `Validation` (`handoff` too large), `Closed`.
    pub async fn provide_handoff(
        &self,
        id: PollId,
        handoff: Option<String>,
    ) -> Result<(), SessionError> {
        validate_handoff(handoff.as_deref())?;
        self.call(move |a| {
            if let Some(tx) = a.pending_handoff.remove(&id) {
                let _ = tx.send(HandoffAnswer::Provided(handoff));
            }
        })
        .await
    }

    /// Close (S6): Keep -> view closed (`ViewDetached { closed }`), poll kept; Delete ->
    /// removed. Returns the host the view was in.
    ///
    /// # Errors
    /// `PollNotFound`, `Closed`.
    pub async fn close_view(&self, id: PollId, keep: bool) -> Result<PollHostKind, SessionError> {
        self.try_call(move |a| {
            let host = a.poll(id).ok_or(SessionError::PollNotFound(id))?.host;
            if keep {
                a.close_view_keep(id);
            } else {
                a.remove_poll(id)?;
            }
            Ok(host)
        })
        .await
    }

    /// Remembers a native window placement (sent before closing, docking or exporting).
    ///
    /// # Errors
    /// `Closed`.
    pub async fn set_native_placement(
        &self,
        id: PollId,
        placement: WindowPlacement,
    ) -> Result<(), SessionError> {
        self.call(move |a| {
            if let Some(p) = a.poll_mut(id) {
                if placement.is_valid() {
                    p.native = Some(placement);
                }
            }
        })
        .await
    }

    /// Host fields of every poll in list order.
    ///
    /// # Errors
    /// `Closed`.
    pub async fn hosts(&self) -> Result<Vec<PollHostInfo>, SessionError> {
        self.call(|a| a.polls.iter().map(host_info).collect()).await
    }

    /// # Errors
    /// `Validation`, `Closed`.
    pub async fn set_workspace_layout(&self, layout: WorkspaceLayout) -> Result<(), SessionError> {
        validate_layout(&layout)?;
        self.call(move |a| a.set_workspace_layout(layout)).await
    }

    /// # Errors
    /// `Closed`.
    pub async fn set_compact(&self, enabled: bool) -> Result<(), SessionError> {
        self.call(move |a| {
            a.compact = enabled;
            a.emit_prefs();
        })
        .await
    }

    /// # Errors
    /// `Closed`.
    pub async fn set_ask_on_poll_close(&self, enabled: bool) -> Result<(), SessionError> {
        self.call(move |a| {
            a.ask_on_poll_close = enabled;
            a.emit_prefs();
        })
        .await
    }

    /// # Errors
    /// `Closed`.
    pub async fn set_profile_name(&self, name: Option<String>) -> Result<(), SessionError> {
        self.call(move |a| {
            a.profile_name.clone_from(&name);
            a.broadcast_views(|| {
                PollViewEvent::ProfileNameChanged(ProfileNameChanged { name: name.clone() })
            });
        })
        .await
    }

    /// Relays Save / Save as from a native window to W1.
    ///
    /// # Errors
    /// `Closed`.
    pub async fn request_save(&self, save_as: bool) -> Result<(), SessionError> {
        self.call(move |a| {
            a.emitter
                .now(SessionEvent::SaveRequested(SaveRequest { save_as }));
        })
        .await
    }

    /// Relays "Show traffic for this poll" to W1.
    ///
    /// # Errors
    /// `Closed`.
    pub async fn show_traffic(&self, id: Option<PollId>) -> Result<(), SessionError> {
        self.call(move |a| {
            a.emitter
                .now(SessionEvent::ShowTraffic(ShowTraffic { poll_id: id }));
        })
        .await
    }

    /// Replaces every poll and the workspace settings by a profile (DES-002 6.3). Views
    /// attached to old polls get `ViewDetached { closed }`. Only while idle or
    /// disconnected.
    ///
    /// # Errors
    /// `InvalidState`, `Validation` (`polls`), `Closed`.
    pub async fn apply_profile(&self, profile: Profile) -> Result<SessionSnapshot, SessionError> {
        self.try_call(move |a| a.apply_profile(profile)).await
    }

    /// Builds a schema 2 profile from the current state (DES-002 6.1). `name` defaults to
    /// the name set by `set_profile_name` (else empty), `connection` to the configuration of
    /// the current or last connection.
    ///
    /// # Errors
    /// `Validation` (`connection`) when no connection settings are known; `Closed`.
    pub async fn export_profile(
        &self,
        name: Option<String>,
        connection: Option<ConnectionConfig>,
        connection_window: Option<WindowPlacement>,
    ) -> Result<Profile, SessionError> {
        self.try_call(move |a| {
            let connection = connection.or_else(|| a.config.clone()).ok_or_else(|| {
                invalid(
                    "connection",
                    "Enter the connection settings before saving the profile.",
                )
            })?;
            let name = name.or_else(|| a.profile_name.clone()).unwrap_or_default();
            Ok(a.export_profile(name, connection, connection_window))
        })
        .await
    }

    /// # Errors
    /// `Closed`.
    pub async fn stats(&self) -> Result<SessionStats, SessionError> {
        self.call(|a| SessionStats {
            max_pending_frames: a.emitter.max_pending_frames,
            traffic_log_len: a.traffic.len(),
            queued_writes: a.write_queue.len(),
            attached_views: a.polls.iter().filter(|p| p.view.is_some()).count(),
            polls: a.polls.len(),
        })
        .await
    }

    /// Stops the session and waits until the link is closed.
    pub async fn shutdown(&self) {
        let (ack, rx) = oneshot::channel();
        if self.tx.send(Command::Shutdown(ack)).is_ok() {
            let _ = rx.await;
        }
    }

    /// Stops the session without waiting (for synchronous window-close handlers).
    pub fn close(&self) {
        let (ack, _) = oneshot::channel();
        let _ = self.tx.send(Command::Shutdown(ack));
    }
}

fn host_info(p: &PollEntry) -> PollHostInfo {
    PollHostInfo {
        poll_id: p.id,
        name: p.name.clone(),
        host: p.host,
        open: p.open,
        workspace: p.workspace,
        native: p.native.clone(),
    }
}

struct PendingWrite {
    dto: WriteRequest,
    request: Request,
    poll_id: Option<PollId>,
    reply: oneshot::Sender<WriteResult>,
}

enum Purpose {
    Poll { id: PollId, generation: u64 },
    Write(PendingWrite),
}

impl Purpose {
    fn origin(&self) -> TrafficOrigin {
        match self {
            Self::Poll { id, .. } => TrafficOrigin::Poll { poll_id: *id },
            Self::Write(pw) => TrafficOrigin::Write {
                poll_id: pw.poll_id,
            },
        }
    }
}

struct InflightCtx {
    purpose: Purpose,
    request: Request,
    slave: u8,
    txn_id: u16,
    started: Instant,
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

/// Busy periods of the link for `linkLoadPct`.
#[derive(Default)]
struct LinkLoad {
    busy: VecDeque<(Instant, Instant)>,
    since: Option<Instant>,
}

impl LinkLoad {
    fn record(&mut self, start: Instant, end: Instant) {
        self.busy.push_back((start, end));
        while self.busy.len() > 1000 {
            self.busy.pop_front();
        }
    }

    fn pct(&mut self, now: Instant, in_flight: Option<Instant>) -> u8 {
        let Some(since) = self.since else { return 0 };
        let from = now
            .checked_sub(LINK_LOAD_WINDOW)
            .map_or(since, |f| f.max(since));
        while self.busy.front().is_some_and(|(_, end)| *end <= from) {
            self.busy.pop_front();
        }
        let window = now.duration_since(from);
        if window.is_zero() {
            return 0;
        }
        let mut busy: Duration = self
            .busy
            .iter()
            .map(|(s, e)| e.duration_since((*s).max(from)))
            .sum();
        if let Some(start) = in_flight {
            busy += now.duration_since(start.max(from));
        }
        let pct = (busy.as_secs_f64() / window.as_secs_f64() * 100.0).round();
        // Clamped to 0-100 just above, so the cast cannot truncate.
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let pct = pct.clamp(0.0, 100.0) as u8;
        pct
    }
}

pub(crate) struct Actor {
    cmd_rx: mpsc::UnboundedReceiver<Command>,
    clock: Arc<dyn Clock>,
    connector: Arc<dyn Connector>,
    conn: ConnectionMachine,
    emitter: SessionEmitter,
    traffic: TrafficLog,
    total: Counters,
    writes: Counters,
    link_load: LinkLoad,

    config: Option<ConnectionConfig>,
    framing: Framing,
    auto_start_poll: bool,
    polls: Vec<PollEntry>,
    next_poll_id: u32,
    next_view_token: u64,
    scheduler: Scheduler<Instant>,
    /// No request may start before this instant (RTU inter-frame gap and broadcast
    /// turnaround). Tokio time, so tests control it with a paused clock.
    quiet_until: Instant,
    txn_id: u16,
    /// Recently sent TCP transaction ids (excluding the current one).
    recent_txns: VecDeque<u16>,

    /// The idle link. `None` while disconnected or while a request task owns it.
    link: Option<Box<dyn Link>>,
    inflight: Option<TxnHandle>,
    inflight_ctx: Option<InflightCtx>,
    connecting: Option<ConnectHandle>,
    write_queue: VecDeque<PendingWrite>,

    // UI values stored for W1 (layout never affects scheduling).
    layout: WorkspaceLayout,
    compact: bool,
    ask_on_poll_close: bool,
    profile_name: Option<String>,
    /// Open handoff requests (`mm_dock_poll(requestHandoff: true)`), at most one per poll
    /// (REV-004 m5: requests for different polls never cancel each other).
    pending_handoff: HashMap<PollId, oneshot::Sender<HandoffAnswer>>,

    /// 1 ms OS timer period while a poll runs (REPORT-006 D1).
    precision: PrecisionHold,
    /// Set when the dispatch timer fired: the instant it was armed for. The next dispatch
    /// treats a start within [`timer_slack`] after it as on time (see `dispatch`).
    timer_target: Option<Instant>,
}

/// How a handoff request ended (other than by its 1 s timeout).
#[derive(Debug)]
enum HandoffAnswer {
    /// The native window answered (`None` = refused, for example a dialog is open).
    Provided(Option<String>),
    /// The native view went away first: nothing to hand off, the dock proceeds.
    ViewGone,
    /// The poll was removed (or replaced by a profile) meanwhile.
    PollGone,
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

/// "{name} copy", then "{name} copy 2", ... shortened to 48 characters and unique.
fn copy_name(name: &str, taken: &[&str]) -> String {
    let free = |candidate: &str| {
        !taken
            .iter()
            .any(|t| shared_types::same_poll_name(t, candidate))
    };
    for n in 1.. {
        let suffix = if n == 1 {
            " copy".to_owned()
        } else {
            format!(" copy {n}")
        };
        let keep = MAX_POLL_NAME_CHARS.saturating_sub(suffix.chars().count());
        let base: String = name.chars().take(keep).collect();
        let candidate = format!("{}{suffix}", base.trim_end());
        if free(&candidate) {
            return candidate;
        }
    }
    unreachable!("an unbounded range always finds a free name")
}

fn sort_aliases(aliases: &mut [shared_types::AliasEntry]) {
    aliases.sort_by_key(|a| a.address);
}

impl Actor {
    fn new(cmd_rx: mpsc::UnboundedReceiver<Command>, sink: SessionSink, deps: SessionDeps) -> Self {
        let now = Instant::now();
        let at = deps.clock.now_ms();
        Self {
            cmd_rx,
            clock: deps.clock,
            connector: deps.connector,
            conn: ConnectionMachine::new(at),
            emitter: SessionEmitter::new(sink),
            traffic: TrafficLog::default(),
            total: Counters::default(),
            writes: Counters::default(),
            link_load: LinkLoad::default(),
            config: None,
            framing: Framing::Tcp,
            auto_start_poll: false,
            polls: Vec::new(),
            next_poll_id: 0,
            next_view_token: 0,
            scheduler: Scheduler::default(),
            quiet_until: now,
            txn_id: 0,
            recent_txns: VecDeque::with_capacity(RECENT_TXNS),
            link: None,
            inflight: None,
            inflight_ctx: None,
            connecting: None,
            write_queue: VecDeque::new(),
            layout: WorkspaceLayout::default(),
            compact: false,
            ask_on_poll_close: true,
            profile_name: None,
            pending_handoff: HashMap::new(),
            precision: PrecisionHold::new(deps.timer),
            timer_target: None,
        }
    }

    async fn run(mut self) {
        loop {
            self.dispatch().await;
            self.timer_target = None;
            self.prune_dead_views();
            // Precise wake-ups only while some poll runs on the link.
            self.precision.set(self.scheduler.next_due().is_some());
            let dispatch_at = self.next_dispatch_at();
            let flush_at = self.next_flush_at();
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
                Wake::Cmd(Command::Disconnect(ack)) => {
                    self.disconnect().await;
                    let _ = ack.send(());
                }
                Wake::Cmd(Command::Call(f)) => f(&mut self),
                Wake::Txn(r) => {
                    self.inflight = None;
                    self.on_txn(r);
                }
                Wake::Connect(r) => {
                    self.connecting = None;
                    self.on_connect(r);
                }
                Wake::Unsolicited(r) => self.on_unsolicited(r),
                Wake::Tick => self.timer_target = dispatch_at,
                Wake::Flush => self.flush_due(),
            }
        }
    }

    // ---- lookups and emission --------------------------------------------------------

    fn poll(&self, id: PollId) -> Option<&PollEntry> {
        self.polls.iter().find(|p| p.id == id)
    }

    fn poll_mut(&mut self, id: PollId) -> Option<&mut PollEntry> {
        self.polls.iter_mut().find(|p| p.id == id)
    }

    fn poll_or_err(&mut self, id: PollId) -> Result<&mut PollEntry, SessionError> {
        self.poll_mut(id).ok_or(SessionError::PollNotFound(id))
    }

    fn is_rtu(&self) -> bool {
        self.config.as_ref().is_some_and(ConnectionConfig::is_rtu)
    }

    fn next_flush_at(&self) -> Option<Instant> {
        std::iter::once(self.emitter.next_flush_at())
            .chain(
                self.polls
                    .iter()
                    .filter_map(|p| p.view.as_ref())
                    .map(|v| v.emitter.next_flush_at()),
            )
            .flatten()
            .min()
    }

    fn flush_due(&mut self) {
        let now = Instant::now();
        self.emitter.flush_due(now);
        for p in &mut self.polls {
            if let Some(v) = &mut p.view {
                v.emitter.flush_due(now);
            }
        }
    }

    /// Drops routes whose receiver is gone (window died without detaching).
    fn prune_dead_views(&mut self) {
        for p in &mut self.polls {
            if p.view.as_ref().is_some_and(|v| !v.emitter.is_alive()) {
                p.view = None;
            }
        }
    }

    fn view_send(&mut self, id: PollId, event: PollViewEvent) {
        if let Some(v) = self.poll_mut(id).and_then(|p| p.view.as_mut()) {
            v.emitter.now(event);
        }
    }

    fn broadcast_views(&mut self, event: impl Fn() -> PollViewEvent) {
        for p in &mut self.polls {
            if let Some(v) = &mut p.view {
                v.emitter.now(event());
            }
        }
    }

    fn emit_list(&mut self) {
        let polls = self.polls.iter().map(PollEntry::summary).collect();
        self.emitter
            .now(SessionEvent::PollListChanged(PollList { polls }));
    }

    fn emit_config(&mut self, id: PollId) {
        if let Some(p) = self.poll_mut(id) {
            let config = p.config();
            if let Some(v) = &mut p.view {
                v.emitter.now(PollViewEvent::PollConfigChanged(config));
            }
        }
    }

    fn prefs(&self) -> Prefs {
        Prefs {
            ask_on_poll_close: self.ask_on_poll_close,
            compact: self.compact,
        }
    }

    fn emit_prefs(&mut self) {
        let prefs = self.prefs();
        self.emitter.now(SessionEvent::PrefsChanged(prefs));
        self.broadcast_views(|| PollViewEvent::PrefsChanged(prefs));
    }

    fn counters_dto(&mut self) -> ConnectionCounters {
        let in_flight = self.inflight_ctx.as_ref().map(|c| c.started);
        ConnectionCounters {
            total: self.total,
            writes: self.writes,
            polls: self.polls.iter().map(PollEntry::counters_dto).collect(),
            link_load_pct: self.link_load.pct(Instant::now(), in_flight),
        }
    }

    /// Queues counters for W1 and, when `poll` is given, for that poll's view.
    fn emit_counters(&mut self, poll: Option<PollId>) {
        let counters = self.counters_dto();
        self.emitter.counters(counters);
        if let Some(p) = poll.and_then(|id| self.poll_mut(id)) {
            let dto = p.counters_dto();
            if let Some(v) = &mut p.view {
                v.emitter.counters(dto);
            }
        }
    }

    fn connection_status(&self) -> shared_types::ConnectionStatus {
        self.conn.status(self.config.as_ref())
    }

    fn conn_event(&mut self, event: ConnEvent) {
        match self.conn.apply(event, self.clock.now_ms()) {
            Ok(_) => {
                let status = self.connection_status();
                self.emitter
                    .now(SessionEvent::ConnectionStateChanged(status.clone()));
                self.broadcast_views(|| PollViewEvent::ConnectionStateChanged(status.clone()));
            }
            Err(e) => debug_assert!(false, "{e}"),
        }
    }

    fn poll_event(&mut self, id: PollId, event: PollEvent) {
        let at = self.clock.now_ms();
        let Some(p) = self.poll_mut(id) else { return };
        match p.machine.apply(event, at) {
            Ok((_, true)) => {
                let status = p.machine.status(id);
                if let Some(v) = &mut p.view {
                    v.emitter
                        .now(PollViewEvent::PollStateChanged(status.clone()));
                }
                self.emitter.now(SessionEvent::PollStateChanged(status));
            }
            Ok((_, false)) => {}
            Err(e) => debug_assert!(false, "{e}"),
        }
    }

    fn record(
        &mut self,
        at: u64,
        direction: TrafficDirection,
        bytes: Vec<u8>,
        note: Option<String>,
        origin: Option<TrafficOrigin>,
    ) {
        let frame: TrafficFrame =
            self.traffic
                .record(at, direction, bytes, self.framing, note, origin);
        self.emitter.frame(frame);
    }

    /// Counts in `total` and in the bucket of `origin` (a poll or the writes).
    fn count(&mut self, origin: TrafficOrigin, f: impl Fn(&mut Counters)) {
        f(&mut self.total);
        let poll = match origin {
            TrafficOrigin::Poll { poll_id } => {
                if let Some(p) = self.poll_mut(poll_id) {
                    f(&mut p.counters);
                }
                Some(poll_id)
            }
            TrafficOrigin::Write { .. } => {
                f(&mut self.writes);
                None
            }
        };
        self.emit_counters(poll);
    }

    // ---- snapshots -------------------------------------------------------------------

    fn layout_dto(&self) -> WorkspaceLayout {
        WorkspaceLayout {
            items: self
                .polls
                .iter()
                .filter_map(|p| {
                    p.workspace.map(|rect| WorkspaceItem {
                        poll_id: p.id,
                        rect,
                    })
                })
                .collect(),
            minimized_order: self
                .layout
                .minimized_order
                .iter()
                .copied()
                .filter(|id| self.poll(*id).is_some())
                .collect(),
            compact: self.compact,
            ..self.layout.clone()
        }
    }

    fn snapshot(&mut self) -> SessionSnapshot {
        SessionSnapshot {
            connection: self.connection_status(),
            auto_start_poll: self.auto_start_poll,
            polls: self.polls.iter().map(PollEntry::summary).collect(),
            counters: self.counters_dto(),
            workspace_layout: self.layout_dto(),
            compact: self.compact,
            ask_on_poll_close: self.ask_on_poll_close,
            profile_name: self.profile_name.clone(),
        }
    }

    // ---- connection ------------------------------------------------------------------

    fn connect(&mut self, config: ConnectionConfig) -> Result<(), SessionError> {
        if !matches!(
            self.conn.state(),
            ConnectionState::Idle | ConnectionState::Disconnected
        ) {
            return Err(SessionError::InvalidState(
                "Already connected or connecting. Disconnect first.".into(),
            ));
        }
        self.framing = framing_for(&config);
        self.config = Some(config.clone());
        self.conn_event(ConnEvent::Connect);
        let connector = self.connector.clone();
        self.connecting = Some(tokio::spawn(
            async move { connector.connect(&config).await },
        ));
        Ok(())
    }

    fn cancel_connect(&mut self) {
        if let Some(h) = self.connecting.take() {
            h.abort(); // the connect future is cancel-safe: no socket or port stays open
        }
        self.conn_event(ConnEvent::Cancel);
    }

    async fn disconnect(&mut self) {
        match self.conn.state() {
            ConnectionState::Connecting => self.cancel_connect(),
            ConnectionState::Disconnected => {
                self.clear_values();
                self.conn_event(ConnEvent::Dismiss); // C7: stale values are cleared
            }
            ConnectionState::Connected => {
                self.close_link().await;
                self.clear_values();
                self.conn_event(ConnEvent::Disconnect); // C5
                self.polls_link_down();
            }
            ConnectionState::Idle => {}
        }
    }

    /// Clears the last values of every poll (C5, C7).
    fn clear_values(&mut self) {
        let mut changed = Vec::new();
        for p in &mut self.polls {
            p.last_update = None;
            if p.last_ok_at.take().is_some() {
                changed.push(p.id);
            }
            if let Some(v) = &mut p.view {
                v.emitter.discard_update();
            }
        }
        for id in changed {
            self.emit_counters(Some(id));
        }
    }

    /// PT7 for every poll (C5, C6).
    fn polls_link_down(&mut self) {
        self.scheduler.stop_all();
        let ids: Vec<PollId> = self.polls.iter().map(|p| p.id).collect();
        for id in ids {
            if let Some(p) = self.poll_mut(id) {
                p.generation += 1;
                p.request = None;
            }
            self.poll_event(id, PollEvent::LinkDown);
        }
        self.link_load.since = None;
        self.emit_counters(None); // link load is 0 without a link
    }

    /// PT1 / PT2 for every poll (C2).
    fn polls_link_up(&mut self) {
        let now = Instant::now();
        self.link_load = LinkLoad {
            since: Some(now),
            ..LinkLoad::default()
        };
        let rtu = self.is_rtu();
        let auto = self.auto_start_poll;
        let ids: Vec<PollId> = self.polls.iter().map(|p| p.id).collect();
        for id in ids {
            let Some(p) = self.poll_mut(id) else { continue };
            // A poll that cannot run on this link (RTU slave 0 read) comes up paused.
            let request = validate_poll(&p.definition, rtu).ok();
            let start = auto && p.active && request.is_some();
            if start {
                p.request = request;
                p.generation += 1;
                p.starts.clear();
            }
            self.poll_event(id, PollEvent::LinkUp { start });
            if start {
                self.scheduler.set_running(id, true, now);
            }
        }
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
    }

    fn link_lost(&mut self, error: &LinkError) {
        self.link = None;
        let ctx = self.inflight_ctx.take().map(|c| c.purpose);
        self.fail_writes(ctx, WriteResult::LinkLost);
        self.conn_event(ConnEvent::LinkLost(link_reason(error))); // C6: values stay (stale)
        self.polls_link_down();
    }

    async fn shutdown(&mut self) {
        if let Some(h) = self.connecting.take() {
            h.abort();
        }
        self.close_link().await;
        self.emitter.flush_all();
    }

    fn on_connect(&mut self, result: Result<Result<Box<dyn Link>, ConnectError>, JoinError>) {
        if self.conn.state() != ConnectionState::Connecting {
            return; // cancelled meanwhile; a link that slipped through is dropped (closed)
        }
        match result {
            Ok(Ok(link)) => {
                self.link = Some(link);
                self.quiet_until = Instant::now();
                self.conn_event(ConnEvent::LinkUp);
                self.polls_link_up();
            }
            Ok(Err(e)) => self.conn_event(ConnEvent::ConnectFailed(connect_reason(&e))),
            Err(e) => self.conn_event(ConnEvent::ConnectFailed(connect_reason(&ConnectError::Io(
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
                    None,
                );
                // RTU: the line was just busy; keep the inter-frame gap before sending.
                self.hold_line(false);
            }
            Err(e) => self.link_lost(&e),
        }
    }

    // ---- requests --------------------------------------------------------------------

    fn next_dispatch_at(&self) -> Option<Instant> {
        if self.inflight.is_some() || self.link.is_none() {
            return None;
        }
        if !self.write_queue.is_empty() {
            return Some(self.quiet_until);
        }
        self.scheduler
            .next_due()
            .map(|due| due.max(self.quiet_until))
    }

    /// The start that rule 4 (`nextDue = start + scanRate`) uses for a poll request sent
    /// `now`: [`on_time_start`] with the instant the dispatch timer was armed for, when the
    /// timer woke the session for this request (REPORT-006 D1). The physical send time is
    /// unchanged; `effectiveScanMs` keeps measuring it.
    fn scheduled_start(&self, id: PollId, now: Instant) -> Instant {
        let scan = self.poll(id).map_or(Duration::ZERO, PollEntry::scan);
        on_time_start(self.timer_target, now, scan)
    }

    /// Starts the next request if the link is idle: queued writes first, then the poll
    /// the scheduler picks.
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
        } else if let Some(id) = self.scheduler.pick(now) {
            self.scheduler.served(id, self.scheduled_start(id, now));
            let Some(p) = self.poll_mut(id) else {
                self.scheduler.remove(id);
                return;
            };
            p.started(now);
            Purpose::Poll {
                id,
                generation: p.generation,
            }
        } else {
            return;
        };
        self.start_request(purpose).await;
    }

    async fn start_request(&mut self, purpose: Purpose) {
        let (request, slave) = match &purpose {
            Purpose::Poll { id, .. } => {
                match self.poll(*id).and_then(|p| Some((p.request.clone()?, p))) {
                    Some((request, p)) => (request, p.definition.slave_id),
                    None => return,
                }
            }
            Purpose::Write(pw) => (pw.request.clone(), pw.dto.slave_id),
        };
        let origin = purpose.origin();
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
                    None,
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
        self.record(at, TrafficDirection::Tx, frame.clone(), None, Some(origin));
        self.count(origin, |c| c.requests += 1);

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
            started: Instant::now(),
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
        self.link_load.record(ctx.started, Instant::now());
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
            self.record(
                frame.at,
                TrafficDirection::Rx,
                frame.bytes,
                Some(note),
                None,
            );
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
                    let origin = ctx.purpose.origin();
                    self.record(
                        at,
                        TrafficDirection::Rx,
                        partial,
                        Some("Incomplete frame before the link failed".into()),
                        Some(origin),
                    );
                }
                self.inflight_ctx = Some(ctx);
                self.link_lost(&error);
            }
        }
    }

    /// True when a poll result of `generation` still belongs to the running poll.
    fn is_current(&self, id: PollId, generation: u64) -> bool {
        self.poll(id)
            .is_some_and(|p| p.generation == generation && p.machine.state().is_running())
    }

    fn on_timeout(&mut self, ctx: InflightCtx) {
        let origin = ctx.purpose.origin();
        self.count(origin, |c| c.timeouts += 1);
        match ctx.purpose {
            Purpose::Poll { id, generation } if self.is_current(id, generation) => {
                self.poll_event(id, PollEvent::CycleTimeout);
            }
            Purpose::Poll { .. } => {}
            Purpose::Write(pw) => {
                let _ = pw.reply.send(WriteResult::Timeout);
            }
        }
    }

    fn on_reply(&mut self, ctx: InflightCtx, bytes: Vec<u8>, at: u64, rtt: Duration) {
        let parsed = match self.framing {
            Framing::Tcp => parse_tcp_reply(&ctx.request, ctx.txn_id, ctx.slave, &bytes),
            Framing::Rtu(_) => parse_rtu_reply(&ctx.request, ctx.slave, &bytes),
        };
        let origin = ctx.purpose.origin();
        let note = parsed.as_ref().err().map(|b| format!("Bad response: {b}"));
        self.record(at, TrafficDirection::Rx, bytes, note, Some(origin));
        match &parsed {
            Ok(Reply::Response(_)) => self.count(origin, |c| c.responses += 1),
            Ok(Reply::Exception { .. }) => self.count(origin, |c| {
                c.responses += 1;
                c.errors += 1;
            }),
            Err(_) => self.count(origin, |c| c.errors += 1),
        }

        match ctx.purpose {
            Purpose::Poll { id, generation } => {
                if !self.is_current(id, generation) {
                    return; // paused, changed or deleted while in flight: reply discarded
                }
                match parsed {
                    Ok(Reply::Response(response)) => self.poll_ok(id, response, at, rtt),
                    Ok(Reply::Exception { code, .. }) => {
                        self.poll_event(id, PollEvent::CycleException(ExceptionCode(code.0)));
                    }
                    Err(bad) => {
                        let (kind, detail) = bad_response_dto(&bad);
                        self.poll_event(id, PollEvent::CycleBadResponse(kind, detail));
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

    fn poll_ok(&mut self, id: PollId, response: Response, at: u64, rtt: Duration) {
        let Some(p) = self.poll_mut(id) else { return };
        p.seq += 1;
        let update = PollUpdate {
            poll_id: id,
            seq: p.seq,
            at,
            slave_id: p.definition.slave_id,
            function: p.definition.function,
            start_address: p.definition.start_address,
            values: response_values(response),
            round_trip_ms: millis(rtt),
        };
        p.last_update = Some(update.clone());
        p.last_ok_at = Some(at);
        if let Some(v) = &mut p.view {
            v.emitter.poll_update(update);
        }
        self.poll_event(id, PollEvent::CycleOk);
        self.emit_counters(Some(id));
    }

    // ---- poll management -------------------------------------------------------------

    fn check_room(&self) -> Result<(), SessionError> {
        if self.polls.len() >= MAX_POLLS {
            return Err(invalid("polls", "A connection can have at most 16 polls."));
        }
        Ok(())
    }

    /// Adds a poll (PT0) at `index` (end when None).
    fn add_poll(
        &mut self,
        mut input: PollConfigInput,
        host: PollHostKind,
        index: Option<usize>,
    ) -> Result<PollId, SessionError> {
        self.check_room()?;
        validate_poll_name(&input.name, self.polls.iter().map(|p| p.name.as_str()))?;
        let request = validate_poll(&input.definition, self.is_rtu())?;
        validate_view_parts(
            Some(&input.display),
            input.scale.as_ref(),
            Some(&input.scale_overrides),
            Some(&input.aliases),
        )?;
        sort_aliases(&mut input.aliases);
        let active = self.auto_start_poll;
        let connected = self.conn.is_connected();
        let id = self.new_poll_id();
        let entry = self.entry(id, input, active, connected, Some(request), host);
        let index = index.unwrap_or(self.polls.len()).min(self.polls.len());
        self.polls.insert(index, entry);
        self.after_add(id, active && connected);
        Ok(id)
    }

    fn new_poll_id(&mut self) -> PollId {
        self.next_poll_id += 1;
        PollId(self.next_poll_id)
    }

    fn entry(
        &self,
        id: PollId,
        input: PollConfigInput,
        active: bool,
        connected: bool,
        request: Option<Request>,
        host: PollHostKind,
    ) -> PollEntry {
        let start = connected && active && request.is_some();
        PollEntry {
            id,
            name: input.name,
            definition: input.definition,
            active,
            display: input.display,
            scale: input.scale,
            scale_overrides: input.scale_overrides,
            value_columns: input.value_columns,
            aliases: input.aliases,
            has_unapplied_edits: false,
            machine: PollMachine::added(connected, start, self.clock.now_ms()),
            generation: 0,
            request: if start { request } else { None },
            seq: 0,
            last_update: None,
            last_ok_at: None,
            counters: Counters::default(),
            starts: VecDeque::new(),
            host,
            open: true,
            workspace: None,
            native: None,
            handoff: None,
            view: None,
        }
    }

    fn after_add(&mut self, id: PollId, running: bool) {
        let now = Instant::now();
        let scan = self.poll(id).map_or(Duration::ZERO, PollEntry::scan);
        self.scheduler.insert(id, scan, now);
        if running && self.poll(id).is_some_and(|p| p.request.is_some()) {
            self.scheduler.set_running(id, true, now);
        }
        self.emit_list();
        self.emit_counters(None);
    }

    fn duplicate_poll(&mut self, id: PollId) -> Result<PollId, SessionError> {
        self.check_room()?;
        let index = self
            .polls
            .iter()
            .position(|p| p.id == id)
            .ok_or(SessionError::PollNotFound(id))?;
        let src = &self.polls[index];
        let taken: Vec<&str> = self.polls.iter().map(|p| p.name.as_str()).collect();
        let input = PollConfigInput {
            name: copy_name(&src.name, &taken),
            definition: src.definition.clone(),
            display: src.display.clone(),
            scale: src.scale.clone(),
            scale_overrides: src.scale_overrides.clone(),
            value_columns: src.value_columns,
            aliases: src.aliases.clone(),
        };
        // H3: the source's host kind, the workspace when the source is closed.
        let host = if src.open {
            src.host
        } else {
            PollHostKind::Workspace
        };
        // The copy may not run on this link (RTU slave 0) even if the source was added
        // under TCP; it is then added paused.
        let request = validate_poll(&input.definition, self.is_rtu()).ok();
        let active = self.auto_start_poll;
        let connected = self.conn.is_connected();
        let new_id = self.new_poll_id();
        let entry = self.entry(new_id, input, active, connected, request, host);
        self.polls.insert(index + 1, entry);
        self.after_add(new_id, active && connected);
        Ok(new_id)
    }

    fn remove_poll(&mut self, id: PollId) -> Result<(), SessionError> {
        let index = self
            .polls
            .iter()
            .position(|p| p.id == id)
            .ok_or(SessionError::PollNotFound(id))?;
        let mut p = self.polls.remove(index);
        if let Some(mut v) = p.view.take() {
            v.emitter
                .close_with(PollViewEvent::PollRemoved(PollRemoved { poll_id: id }));
        }
        self.scheduler.remove(id);
        self.layout.minimized_order.retain(|m| *m != id);
        if let Some(tx) = self.pending_handoff.remove(&id) {
            let _ = tx.send(HandoffAnswer::PollGone);
        }
        self.emit_list();
        self.emit_counters(None);
        Ok(())
    }

    fn update_poll(&mut self, id: PollId, definition: PollDefinition) -> Result<(), SessionError> {
        let rtu = self.is_rtu();
        let p = self.poll_or_err(id)?;
        let request = validate_poll(&definition, rtu)?;
        if p.definition == definition {
            return Ok(());
        }
        p.definition = definition;
        p.last_update = None; // old values are dropped (PT6, PT6b)
        p.last_ok_at = None;
        p.starts.clear();
        if let Some(v) = &mut p.view {
            v.emitter.discard_update();
        }
        let running = p.machine.state().is_running();
        let scan = p.scan();
        if running {
            p.request = Some(request);
            p.generation += 1;
        }
        self.scheduler.set_scan(id, scan);
        self.emit_config(id);
        self.poll_event(id, PollEvent::Apply);
        if running {
            self.scheduler.set_running(id, true, Instant::now());
        }
        self.emit_list();
        self.emit_counters(Some(id));
        Ok(())
    }

    fn rename_poll(&mut self, id: PollId, name: String) -> Result<(), SessionError> {
        self.poll_or_err(id)?;
        validate_poll_name(
            &name,
            self.polls
                .iter()
                .filter(|p| p.id != id)
                .map(|p| p.name.as_str()),
        )?;
        let p = self.poll_or_err(id)?;
        if p.name == name {
            return Ok(());
        }
        p.name = name;
        self.emit_config(id);
        self.emit_list();
        Ok(())
    }

    fn set_poll_active(&mut self, id: PollId, active: bool) -> Result<(), SessionError> {
        let rtu = self.is_rtu();
        let connected = self.conn.is_connected();
        let p = self.poll_or_err(id)?;
        let state = p.machine.state();
        let was = p.active;
        if active {
            if connected && state == shared_types::PollState::Paused {
                let request = validate_poll(&p.definition, rtu)?;
                p.request = Some(request);
                p.generation += 1;
                p.starts.clear();
                p.active = true;
                self.poll_event(id, PollEvent::Resume); // PT3
                self.scheduler.set_running(id, true, Instant::now());
            } else {
                p.active = true;
            }
        } else {
            p.active = false;
            if state.is_running() {
                p.generation += 1;
                p.request = None;
                self.scheduler.set_running(id, false, Instant::now());
                self.poll_event(id, PollEvent::Pause); // PT4
            }
        }
        if was != active {
            self.emit_config(id);
            self.emit_list();
        }
        Ok(())
    }

    fn set_poll_view(&mut self, id: PollId, view: PollViewSettings) -> Result<(), SessionError> {
        self.poll_or_err(id)?;
        validate_view_parts(
            view.display.as_ref(),
            view.scale.as_ref().and_then(Option::as_ref),
            view.scale_overrides.as_deref(),
            view.aliases.as_deref(),
        )?;
        let p = self.poll_or_err(id)?;
        let before = p.config();
        let edits_before = p.has_unapplied_edits;
        if let Some(d) = view.display {
            p.display = d;
        }
        if let Some(s) = view.scale {
            p.scale = s;
        }
        if let Some(o) = view.scale_overrides {
            p.scale_overrides = o;
        }
        if let Some(c) = view.value_columns {
            p.value_columns = c;
        }
        if let Some(mut a) = view.aliases {
            sort_aliases(&mut a);
            p.aliases = a;
        }
        if let Some(e) = view.has_unapplied_edits {
            p.has_unapplied_edits = e;
        }
        let config_changed = p.config() != before;
        let edits_changed = p.has_unapplied_edits != edits_before;
        if config_changed {
            self.emit_config(id);
        }
        if config_changed || edits_changed {
            self.emit_list();
        }
        Ok(())
    }

    fn reorder(&mut self, order: Vec<PollId>) -> Result<(), SessionError> {
        let mut sorted = order.clone();
        sorted.sort_unstable();
        sorted.dedup();
        let mut current: Vec<PollId> = self.polls.iter().map(|p| p.id).collect();
        current.sort_unstable();
        if sorted.len() != order.len() || sorted != current {
            return Err(invalid(
                "order",
                "The new order must list every poll of this connection exactly once.",
            ));
        }
        if order.iter().copied().eq(self.polls.iter().map(|p| p.id)) {
            return Ok(());
        }
        let mut polls = std::mem::take(&mut self.polls);
        for id in order {
            if let Some(i) = polls.iter().position(|p| p.id == id) {
                self.polls.push(polls.swap_remove(i));
            }
        }
        self.emit_list();
        self.emit_counters(None);
        Ok(())
    }

    fn reset_counters(&mut self, id: Option<PollId>) -> Result<(), SessionError> {
        match id {
            Some(id) => {
                let p = self.poll_or_err(id)?;
                p.counters = Counters::default();
                let dto = p.counters_dto();
                if let Some(v) = &mut p.view {
                    v.emitter.counters(dto);
                    v.emitter.flush_all();
                }
            }
            None => {
                self.total = Counters::default();
                self.writes = Counters::default();
                for p in &mut self.polls {
                    p.counters = Counters::default();
                    let dto = p.counters_dto();
                    if let Some(v) = &mut p.view {
                        v.emitter.counters(dto);
                        v.emitter.flush_all();
                    }
                }
            }
        }
        let counters = self.counters_dto();
        self.emitter.counters_now(counters);
        Ok(())
    }

    // ---- views and hosts -------------------------------------------------------------

    fn attach_view(
        &mut self,
        id: PollId,
        host: PollHostKind,
        sink: ViewSink,
    ) -> Result<PollViewSnapshot, SessionError> {
        self.next_view_token += 1;
        let token = ViewToken(self.next_view_token);
        let connection = self.connection_status();
        let (compact, ask, profile_name) = (
            self.compact,
            self.ask_on_poll_close,
            self.profile_name.clone(),
        );
        let p = self.poll_or_err(id)?;
        if !p.open || p.host != host {
            return Err(invalid(
                "host",
                if p.open {
                    "This poll is shown in another place."
                } else {
                    "This poll's view is closed."
                },
            ));
        }
        if let Some(mut old) = p.view.take() {
            old.emitter
                .close_with(PollViewEvent::ViewDetached(ViewDetached {
                    poll_id: id,
                    reason: DetachReason::Replaced,
                }));
        }
        let snapshot = PollViewSnapshot {
            view_token: token,
            host,
            connection,
            poll: p.summary(),
            last_update: p.last_update.clone(),
            handoff: p.take_handoff(Instant::now()),
            compact,
            ask_on_poll_close: ask,
            profile_name,
        };
        p.view = Some(ViewRoute {
            token,
            host,
            emitter: ViewEmitter::new(sink),
        });
        Ok(snapshot)
    }

    fn detach_with(&mut self, id: PollId, reason: DetachReason) {
        if let Some(p) = self.poll_mut(id) {
            if let Some(mut v) = p.view.take() {
                v.emitter
                    .close_with(PollViewEvent::ViewDetached(ViewDetached {
                        poll_id: id,
                        reason,
                    }));
            }
        }
    }

    /// A waiting handoff request of `id` has no view to answer it any more.
    fn handoff_view_gone(&mut self, id: PollId) {
        if let Some(tx) = self.pending_handoff.remove(&id) {
            let _ = tx.send(HandoffAnswer::ViewGone);
        }
    }

    fn native_window_destroyed(&mut self, id: PollId) {
        let Some(p) = self.poll_mut(id) else { return };
        if p.view
            .as_ref()
            .is_some_and(|v| v.host == PollHostKind::Native)
        {
            p.view = None;
            self.handoff_view_gone(id);
        }
        let Some(p) = self.poll_mut(id) else { return };
        if p.host == PollHostKind::Native && p.open {
            p.open = false;
            p.has_unapplied_edits = false;
            self.emit_list();
        }
    }

    fn show_poll(
        &mut self,
        id: PollId,
        placement: Option<WorkspaceRect>,
    ) -> Result<ShowOutcome, SessionError> {
        if let Some(rect) = &placement {
            validate_workspace_rect(rect, "placement")?;
        }
        let p = self.poll_or_err(id)?;
        let to_workspace = placement.is_some() || p.host == PollHostKind::Workspace;
        if !to_workspace {
            return Ok(if p.open {
                ShowOutcome::FocusNative
            } else {
                ShowOutcome::OpenNative(p.native.clone())
            });
        }
        if placement.is_some() && p.host == PollHostKind::Native && p.open {
            return Err(SessionError::InvalidState(
                "This poll is open in its own window: dock it instead.".into(),
            ));
        }
        p.host = PollHostKind::Workspace;
        p.open = true;
        match placement {
            Some(mut rect) => {
                rect.state = SubWindowState::Normal;
                rect.restore = None;
                p.workspace = Some(rect);
            }
            None => {
                if p.workspace
                    .is_some_and(|r| r.state == SubWindowState::Minimized)
                {
                    p.restore_workspace_rect();
                }
            }
        }
        self.layout.minimized_order.retain(|m| *m != id);
        self.emit_list();
        self.emitter.now(SessionEvent::RevealPoll(RevealPoll {
            poll_id: id,
            workspace_rect: placement.map(|mut r| {
                r.state = SubWindowState::Normal;
                r.restore = None;
                r
            }),
        }));
        Ok(ShowOutcome::Workspace)
    }

    fn set_native_open(
        &mut self,
        id: PollId,
        handoff: Option<String>,
    ) -> Result<NativeOpenUndo, SessionError> {
        validate_handoff(handoff.as_deref())?;
        let minimized_at = self.layout.minimized_order.iter().position(|m| *m == id);
        let p = self.poll_or_err(id)?;
        let undo = NativeOpenUndo {
            host: p.host,
            open: p.open,
            minimized_at,
        };
        let was_workspace_view = p
            .view
            .as_ref()
            .is_some_and(|v| v.host == PollHostKind::Workspace);
        p.host = PollHostKind::Native;
        p.open = true;
        if handoff.is_some() {
            p.handoff = handoff.map(|h| (h, Instant::now()));
        }
        if was_workspace_view {
            self.detach_with(id, DetachReason::PoppedOut);
        }
        self.layout.minimized_order.retain(|m| *m != id);
        self.emit_list();
        Ok(undo)
    }

    fn undo_native_open(&mut self, id: PollId, undo: &NativeOpenUndo) {
        let Some(p) = self.poll_mut(id) else { return };
        let native_view = p
            .view
            .as_ref()
            .is_some_and(|v| v.host == PollHostKind::Native);
        if native_view {
            self.detach_with(id, DetachReason::Closed);
            self.handoff_view_gone(id);
        }
        let Some(p) = self.poll_mut(id) else { return };
        p.host = undo.host;
        p.open = undo.open;
        if !p.open {
            p.handoff = None;
        }
        if let Some(i) = undo.minimized_at {
            if !self.layout.minimized_order.contains(&id) {
                let i = i.min(self.layout.minimized_order.len());
                self.layout.minimized_order.insert(i, id);
            }
        }
        self.emit_list();
    }

    fn dock(
        &mut self,
        id: PollId,
        handoff: Option<String>,
        rect: Option<WorkspaceRect>,
        native: Option<WindowPlacement>,
    ) -> Result<(), SessionError> {
        validate_handoff(handoff.as_deref())?;
        if let Some(r) = &rect {
            validate_workspace_rect(r, "workspaceRect")?;
        }
        let p = self.poll_or_err(id)?;
        if let Some(n) = native.filter(WindowPlacement::is_valid) {
            p.native = Some(n);
        }
        p.host = PollHostKind::Workspace;
        p.open = true;
        let reveal_rect = rect.map(|mut r| {
            r.state = SubWindowState::Normal;
            r.restore = None;
            r
        });
        match reveal_rect {
            Some(r) => p.workspace = Some(r),
            None => p.restore_workspace_rect(),
        }
        if handoff.is_some() {
            p.handoff = handoff.map(|h| (h, Instant::now()));
        }
        let native_view = p
            .view
            .as_ref()
            .is_some_and(|v| v.host == PollHostKind::Native);
        if native_view {
            self.detach_with(id, DetachReason::Docked);
        }
        self.layout.minimized_order.retain(|m| *m != id);
        self.emit_list();
        self.emitter.now(SessionEvent::RevealPoll(RevealPoll {
            poll_id: id,
            workspace_rect: reveal_rect,
        }));
        Ok(())
    }

    fn request_handoff(
        &mut self,
        id: PollId,
    ) -> Result<Option<oneshot::Receiver<HandoffAnswer>>, SessionError> {
        let p = self.poll_or_err(id)?;
        let has_native_view = p
            .view
            .as_ref()
            .is_some_and(|v| v.host == PollHostKind::Native);
        if !has_native_view {
            return Ok(None);
        }
        if self
            .pending_handoff
            .get(&id)
            .is_some_and(|tx| !tx.is_closed())
        {
            return Err(SessionError::InvalidState(
                "This poll is already being docked.".into(),
            ));
        }
        let (tx, rx) = oneshot::channel();
        self.pending_handoff.insert(id, tx);
        self.view_send(
            id,
            PollViewEvent::HandoffRequested(HandoffRequested { poll_id: id }),
        );
        Ok(Some(rx))
    }

    fn close_view_keep(&mut self, id: PollId) {
        self.detach_with(id, DetachReason::Closed);
        if let Some(p) = self.poll_mut(id) {
            p.open = false;
            p.has_unapplied_edits = false;
            // DES-002 2.11: Keep discards unapplied drafts, so a stored handoff (which
            // carries them) must not restore them on the next Show (REV-004 n4).
            p.handoff = None;
        }
        self.layout.minimized_order.retain(|m| *m != id);
        self.emit_list();
    }

    fn set_workspace_layout(&mut self, layout: WorkspaceLayout) {
        let mut changed = false;
        for item in &layout.items {
            if let Some(p) = self.poll_mut(item.poll_id) {
                if p.workspace != Some(item.rect) {
                    p.workspace = Some(item.rect);
                    changed = true;
                }
            }
        }
        // Unknown ids are dropped and duplicates keep their first place, so an exported
        // profile always passes `profiles_save` (REV-004 m3).
        let mut minimized_order: Vec<PollId> = Vec::new();
        for id in &layout.minimized_order {
            if self.poll(*id).is_some() && !minimized_order.contains(id) {
                minimized_order.push(*id);
            }
        }
        self.layout = WorkspaceLayout {
            items: Vec::new(),
            minimized_order,
            compact: self.compact, // owned by mm_set_compact_mode
            ..layout
        };
        if changed {
            self.emit_list();
        }
    }

    // ---- profiles --------------------------------------------------------------------

    fn apply_profile(&mut self, profile: Profile) -> Result<SessionSnapshot, SessionError> {
        if !matches!(
            self.conn.state(),
            ConnectionState::Idle | ConnectionState::Disconnected
        ) {
            return Err(SessionError::InvalidState(
                "Disconnect before loading a profile.".into(),
            ));
        }
        if profile.polls.len() > MAX_POLLS {
            return Err(invalid("polls", "A connection can have at most 16 polls."));
        }
        // Validate everything before changing anything.
        let mut names: Vec<&str> = Vec::new();
        for (i, pp) in profile.polls.iter().enumerate() {
            let prefix = |e: ValidationError| invalid("polls", format!("Poll {}: {}", i + 1, e));
            validate_poll_name(&pp.name, names.iter().copied()).map_err(prefix)?;
            validate_poll(&pp.definition, false).map_err(prefix)?;
            validate_view_parts(
                Some(&pp.display),
                pp.scale.as_ref(),
                Some(&pp.scale_overrides),
                Some(&pp.aliases),
            )
            .map_err(prefix)?;
            names.push(&pp.name);
        }
        // Old views close without S6; native windows are closed by the window layer.
        let old: Vec<PollId> = self.polls.iter().map(|p| p.id).collect();
        for id in &old {
            self.detach_with(*id, DetachReason::Closed);
            self.scheduler.remove(*id);
        }
        self.polls.clear();
        for (_, tx) in self.pending_handoff.drain() {
            let _ = tx.send(HandoffAnswer::PollGone);
        }

        self.framing = framing_for(&profile.connection);
        self.config = Some(profile.connection.clone());
        self.auto_start_poll = profile.auto_start_poll;
        let at = self.clock.now_ms();
        let now = Instant::now();
        let mut ids = Vec::new();
        for pp in profile.polls {
            let id = self.new_poll_id();
            ids.push(id);
            let mut aliases = pp.aliases;
            sort_aliases(&mut aliases);
            let scan = Duration::from_millis(u64::from(pp.definition.scan_rate_ms));
            self.polls.push(PollEntry {
                id,
                name: pp.name,
                definition: pp.definition,
                active: pp.active,
                display: pp.display,
                scale: pp.scale,
                scale_overrides: pp.scale_overrides,
                value_columns: pp.value_columns,
                aliases,
                has_unapplied_edits: false,
                machine: PollMachine::added(false, false, at),
                generation: 0,
                request: None,
                seq: 0,
                last_update: None,
                last_ok_at: None,
                counters: Counters::default(),
                starts: VecDeque::new(),
                host: pp.view.host,
                open: pp.view.open,
                workspace: pp.view.workspace.filter(WorkspaceRect::is_valid),
                native: pp.view.native.filter(WindowPlacement::is_valid),
                handoff: None,
                view: None,
            });
            self.scheduler.insert(id, scan, now);
        }
        let ws: WorkspaceProfile = profile.workspace;
        let mut seen = Vec::new();
        let minimized_order = ws
            .minimized_order
            .iter()
            .filter_map(|i| usize::try_from(*i).ok().and_then(|i| ids.get(i)).copied())
            .filter(|id| {
                let fresh = !seen.contains(id);
                seen.push(*id);
                fresh
            })
            .collect();
        self.compact = ws.compact;
        self.layout = WorkspaceLayout {
            items: Vec::new(),
            minimized_order,
            tile_mode: ws.tile_mode,
            compact: ws.compact,
            sidebar_width: ws.sidebar_width.clamp(
                shared_types::SIDEBAR_WIDTH_RANGE.0,
                shared_types::SIDEBAR_WIDTH_RANGE.1,
            ),
            sidebar_collapsed: ws.sidebar_collapsed,
            traffic_expanded: ws.traffic_expanded,
            traffic_height: ws.traffic_height.filter(|h| h.is_finite() && *h >= 0.0),
        };
        if self.conn.state() == ConnectionState::Disconnected {
            self.conn_event(ConnEvent::Dismiss); // stale values of the old setup are gone
        }
        self.emit_prefs();
        self.emit_list();
        self.emit_counters(None);
        Ok(self.snapshot())
    }

    fn export_profile(
        &mut self,
        name: String,
        connection: ConnectionConfig,
        connection_window: Option<WindowPlacement>,
    ) -> Profile {
        let index_of = |id: PollId| self.polls.iter().position(|p| p.id == id);
        let minimized_order = self
            .layout
            .minimized_order
            .iter()
            .filter_map(|id| index_of(*id))
            .filter_map(|i| u32::try_from(i).ok())
            .collect();
        Profile {
            schema_version: PROFILE_SCHEMA_VERSION,
            name,
            connection,
            auto_start_poll: self.auto_start_poll,
            connection_window,
            workspace: WorkspaceProfile {
                tile_mode: self.layout.tile_mode,
                compact: self.compact,
                sidebar_width: self.layout.sidebar_width,
                sidebar_collapsed: self.layout.sidebar_collapsed,
                traffic_expanded: self.layout.traffic_expanded,
                traffic_height: self.layout.traffic_height,
                minimized_order,
            },
            polls: self
                .polls
                .iter()
                .map(|p| shared_types::PollProfile {
                    name: p.name.clone(),
                    definition: p.definition.clone(),
                    active: p.active,
                    display: p.display.clone(),
                    scale: p.scale.clone(),
                    scale_overrides: p.scale_overrides.clone(),
                    value_columns: p.value_columns,
                    aliases: p.aliases.clone(),
                    view: p.placement(),
                })
                .collect(),
            migrated_from: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_names_are_unique_and_short() {
        assert_eq!(copy_name("Pump", &["Pump"]), "Pump copy");
        assert_eq!(copy_name("Pump", &["Pump", "pump COPY"]), "Pump copy 2");
        let long = "x".repeat(48);
        let c = copy_name(&long, &[&long]);
        assert_eq!(c.chars().count(), 48);
        assert!(c.ends_with(" copy"));
    }

    #[tokio::test(start_paused = true)]
    async fn link_load_measures_busy_share() {
        let mut l = LinkLoad::default();
        let t0 = Instant::now();
        assert_eq!(l.pct(t0, None), 0);
        l.since = Some(t0);
        tokio::time::advance(Duration::from_millis(1000)).await;
        l.record(t0, t0 + Duration::from_millis(500));
        assert_eq!(l.pct(Instant::now(), None), 50);
        tokio::time::advance(Duration::from_millis(1000)).await;
        // Window is now [0, 2 s]: 500 ms busy + 1000 ms in flight.
        let in_flight = t0 + Duration::from_millis(1000);
        assert_eq!(l.pct(Instant::now(), Some(in_flight)), 75);
        tokio::time::advance(Duration::from_millis(5000)).await;
        assert_eq!(l.pct(Instant::now(), None), 0);
    }
}
