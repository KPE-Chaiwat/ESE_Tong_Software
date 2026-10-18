//! Connection, polls, snapshots and the two event streams of Modbus Master v2
//! (DES-002 sections 1 and 8, BE-002).
//!
//! - One `Channel<SessionEvent>` per connection window (W1), attached by `mm_open_session`.
//! - One `Channel<PollViewEvent>` per attached poll view (a workspace sub-window in W1 or a
//!   native poll window W2), attached by `mm_attach_poll_view`.

use serde::{Deserialize, Deserializer, Serialize};
use ts_rs::TS;

use crate::layout::{DetachReason, LogicalPoint, PollHostKind, WorkspaceLayout, WorkspaceRect};
use crate::modbus::{
    BadResponseDetail, BadResponseKind, ConnectionConfig, Counters, ExceptionCode, PollDefinition,
    PollUpdate, SessionReason, TrafficFrames,
};
use crate::view::{AliasEntry, DisplaySettings, ScaleOverride, ScaleSettings, ValueColumns};
use crate::ValueColorRule;

/// Runtime id of a poll: unique per session, never reused, not saved in profiles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PollId(pub u32);

impl std::fmt::Display for PollId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// Identifies one attachment of a poll view (`mm_attach_poll_view`). Unique per session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ViewToken(#[ts(type = "number")] pub u64);

/// Most polls one connection can have (REQ-002, PM default).
pub const MAX_POLLS: usize = 16;
/// Poll names: 1-48 characters (DES-002 section 4).
pub const MAX_POLL_NAME_CHARS: usize = 48;

/// Checks a poll name except uniqueness (DES-002 section 4, first failing rule).
///
/// # Errors
/// The DES-002 message.
pub fn check_poll_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Enter a poll name.".into());
    }
    if name.chars().count() > MAX_POLL_NAME_CHARS {
        return Err("Poll name must be at most 48 characters.".into());
    }
    if name.trim() != name {
        return Err("Poll name cannot start or end with a space.".into());
    }
    if name.chars().any(char::is_control) {
        return Err("Poll name cannot contain control characters.".into());
    }
    Ok(())
}

/// The DES-002 section 4 message for a duplicate poll name.
#[must_use]
pub fn duplicate_poll_name_message(name: &str) -> String {
    format!("A poll named \"{name}\" already exists on this connection.")
}

/// Poll names are compared ignoring case.
#[must_use]
pub fn same_poll_name(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

/// Link state of the connection (DES-002 1.2, C1-C7). Says nothing about polls.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    Idle,
    Connecting,
    Connected,
    Disconnected,
}

/// State of one poll (DES-002 1.2, PT0-PT8).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum PollState {
    /// The connection is not `connected`.
    Offline,
    /// Link up, poll not running.
    Paused,
    /// Running, last cycle valid (or no cycle finished yet).
    Polling,
    Timeout,
    Exception,
    BadResponse,
}

impl PollState {
    /// `polling | timeout | exception | badResponse` (DES "P*").
    #[must_use]
    pub fn is_running(self) -> bool {
        matches!(
            self,
            Self::Polling | Self::Timeout | Self::Exception | Self::BadResponse
        )
    }
}

/// Connection state plus its details. Payload of `ConnectionStateChanged` (both channels).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub state: ConnectionState,
    /// Set in `disconnected`.
    pub reason: Option<SessionReason>,
    /// The configuration of the current or last connection (from `mm_connect` or
    /// `mm_apply_profile`), for texts like "Connecting to {target}".
    pub config: Option<ConnectionConfig>,
    /// When the state was entered.
    #[ts(type = "number")]
    pub at: u64,
}

/// State of one poll plus its details. Payload of `PollStateChanged` (both channels). Never
/// dropped or coalesced; a repeated ok cycle (polling -> polling) is not re-emitted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollStatus {
    pub poll_id: PollId,
    pub state: PollState,
    /// Failed cycles in a row in timeout / exception / badResponse, else 0.
    pub consecutive_failures: u32,
    /// Set in `exception`.
    pub exception_code: Option<ExceptionCode>,
    /// Set in `badResponse`.
    pub bad_response_kind: Option<BadResponseKind>,
    /// Set in `badResponse`.
    pub bad_response_detail: Option<BadResponseDetail>,
    #[ts(type = "number")]
    pub at: u64,
}

/// What `mm_add_poll` takes. `active` is not part of it: a new poll gets
/// `active = autoStartPoll` (DES-002 1.2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollConfigInput {
    /// 1-48 characters, unique on the connection ignoring case.
    pub name: String,
    pub definition: PollDefinition,
    pub display: DisplaySettings,
    pub color_rules: Vec<ValueColorRule>,
    pub scale: Option<ScaleSettings>,
    /// At most 64.
    pub scale_overrides: Vec<ScaleOverride>,
    pub value_columns: ValueColumns,
    /// At most 2000, unique addresses (any order on input; stored sorted by address).
    pub aliases: Vec<AliasEntry>,
}

/// The stored configuration of a poll. Payload of `PollConfigChanged`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollConfig {
    pub poll_id: PollId,
    pub name: String,
    pub definition: PollDefinition,
    /// Run intent (Resume = true, Pause = false). Never marks the profile modified.
    pub active: bool,
    pub display: DisplaySettings,
    pub color_rules: Vec<ValueColorRule>,
    pub scale: Option<ScaleSettings>,
    pub scale_overrides: Vec<ScaleOverride>,
    pub value_columns: ValueColumns,
    /// Sorted by address.
    pub aliases: Vec<AliasEntry>,
}

/// Argument `view` of `mm_set_poll_view`: a patch. A missing key leaves that value
/// unchanged; `scale: null` removes the scale.
#[derive(Debug, Clone, Default, PartialEq, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollViewSettings {
    #[ts(optional)]
    pub display: Option<DisplaySettings>,
    #[serde(default, deserialize_with = "non_null_patch")]
    #[ts(optional)]
    pub color_rules: Option<Vec<ValueColorRule>>,
    #[serde(default, with = "present")]
    #[ts(as = "Option<ScaleSettings>", optional = nullable)]
    pub scale: Option<Option<ScaleSettings>>,
    #[ts(optional)]
    pub scale_overrides: Option<Vec<ScaleOverride>>,
    #[ts(optional)]
    pub value_columns: Option<ValueColumns>,
    #[ts(optional)]
    pub aliases: Option<Vec<AliasEntry>>,
    #[ts(optional)]
    pub has_unapplied_edits: Option<bool>,
}

/// Distinguishes a present `null` (`Some(None)`) from a missing key (`None`, via default).
mod present {
    use super::{Deserialize, Deserializer};

    pub fn deserialize<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
        d: D,
    ) -> Result<Option<Option<T>>, D::Error> {
        Option::<T>::deserialize(d).map(Some)
    }
}

/// Counters of one poll plus its timing. Payload of `PollCounters` (view channel) and an
/// entry of `ConnectionCounters.polls`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollCounters {
    pub poll_id: PollId,
    /// This poll's requests only (writes are never counted here).
    pub counters: Counters,
    /// Mean interval between the starts of the last (up to) 10 cycles, once at least two
    /// cycles ran since the poll (re)started; else null. The UI shows it when it exceeds
    /// 1.5 x the scan rate (DES-002 2.3.2).
    pub effective_scan_ms: Option<u32>,
    /// Time of the last valid reply of the current definition, null when there is none.
    #[ts(type = "number | null")]
    pub last_ok_at: Option<u64>,
}

/// Connection-wide counters. Payload of `Counters` on the session channel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionCounters {
    /// Everything on the link: polls (including deleted polls) and writes.
    pub total: Counters,
    /// Writes only.
    pub writes: Counters,
    /// One entry per poll, in list order.
    pub polls: Vec<PollCounters>,
    /// Share of the last 2 s the link was busy with a request, 0-100.
    pub link_load_pct: u8,
}

/// One poll as listed in W1 (`PollListChanged`, snapshots).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollSummary {
    pub config: PollConfig,
    pub status: PollStatus,
    pub counters: PollCounters,
    /// Last host kind.
    pub host: PollHostKind,
    /// False = view closed (kept).
    pub open: bool,
    /// Last workspace rectangle (with sub-window state), null = next slot.
    pub workspace: Option<WorkspaceRect>,
    /// Reported by the poll's view through `mm_set_poll_view`; cleared by Close -> Keep.
    pub has_unapplied_edits: bool,
}

/// Result of `mm_open_session`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub connection: ConnectionStatus,
    pub auto_start_poll: bool,
    /// In list order.
    pub polls: Vec<PollSummary>,
    pub counters: ConnectionCounters,
    pub workspace_layout: WorkspaceLayout,
    pub compact: bool,
    pub ask_on_poll_close: bool,
    /// Set by `mm_set_profile_name`.
    pub profile_name: Option<String>,
}

/// Result of `mm_attach_poll_view`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollViewSnapshot {
    /// Pass to `mm_detach_poll_view`.
    pub view_token: ViewToken,
    pub host: PollHostKind,
    pub connection: ConnectionStatus,
    pub poll: PollSummary,
    /// Last values of the current definition (also stale ones), so a moved view shows
    /// values at once.
    pub last_update: Option<PollUpdate>,
    /// The opaque handoff stored by pop out / dock, delivered once and at most 10 s old.
    pub handoff: Option<String>,
    pub compact: bool,
    pub ask_on_poll_close: bool,
    pub profile_name: Option<String>,
}

/// Payload of `PollListChanged`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollList {
    /// Every poll, in list order.
    pub polls: Vec<PollSummary>,
}

/// Payload of `RevealPoll`: mount (if needed), place, activate and focus that sub-window.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RevealPoll {
    pub poll_id: PollId,
    /// The rectangle to use (list drag or dock with a rectangle), else null.
    pub workspace_rect: Option<WorkspaceRect>,
}

/// Payload of `PrefsChanged` (both channels).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    pub ask_on_poll_close: bool,
    pub compact: bool,
}

/// Payload of `SaveRequested` (`mm_request_save` from a native poll window).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    /// `Ctrl+Shift+S`.
    pub save_as: bool,
}

/// Payload of `ShowTraffic` (`mm_show_traffic`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ShowTraffic {
    /// Filter the traffic panel to this poll; null = no filter change.
    pub poll_id: Option<PollId>,
}

/// Payload of `DockPreview`. **Phase 2: defined but never sent yet.**
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DockPreview {
    /// Null hides the preview.
    pub poll_id: Option<PollId>,
    /// Cursor in W1 client coordinates.
    pub cursor: Option<LogicalPoint>,
}

/// Events on the W1 `Channel<SessionEvent>`. `type` is the discriminant.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum SessionEvent {
    /// Never dropped or coalesced.
    ConnectionStateChanged(ConnectionStatus),
    /// Any poll. Never dropped or coalesced.
    PollStateChanged(PollStatus),
    /// The whole list, in list order, after any change of names, definitions, `active`,
    /// view settings, host, `open`, workspace rectangle, `hasUnappliedEdits` or order.
    PollListChanged(PollList),
    /// At most one batch per 50 ms.
    TrafficFrames(TrafficFrames),
    /// At most one per 100 ms, latest wins.
    Counters(ConnectionCounters),
    RevealPoll(RevealPoll),
    PrefsChanged(Prefs),
    SaveRequested(SaveRequest),
    ShowTraffic(ShowTraffic),
    /// Phase 2, never sent yet.
    DockPreview(DockPreview),
}

/// Payload of `PollRemoved`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollRemoved {
    pub poll_id: PollId,
}

/// Payload of `ProfileNameChanged`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ProfileNameChanged {
    pub name: Option<String>,
}

/// Payload of `ViewDetached`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ViewDetached {
    pub poll_id: PollId,
    pub reason: DetachReason,
}

/// Payload of `HandoffRequested` (native window only): answer with `mm_provide_handoff`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HandoffRequested {
    pub poll_id: PollId,
}

/// Events on a poll view `Channel<PollViewEvent>`. `type` is the discriminant.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum PollViewEvent {
    BulkOperationPrepare(crate::BulkOperationPrepare),
    BulkOperationRelease(crate::BulkOperationRelease),
    /// Never dropped or coalesced.
    ConnectionStateChanged(ConnectionStatus),
    /// This poll only. Never dropped or coalesced; a pending `PollUpdate` is sent first.
    PollStateChanged(PollStatus),
    /// This poll only. At most one per 50 ms per view, latest wins; `seq` strictly increases.
    PollUpdate(PollUpdate),
    /// Name, definition, `active` or view settings changed (from any window).
    PollConfigChanged(PollConfig),
    /// At most one per 100 ms per view, latest wins.
    PollCounters(PollCounters),
    /// The poll was deleted. No event follows.
    PollRemoved(PollRemoved),
    ProfileNameChanged(ProfileNameChanged),
    PrefsChanged(Prefs),
    /// The view must unmount (sub-window) or its window is being destroyed. No event follows.
    ViewDetached(ViewDetached),
    /// Native window only: answer with `mm_provide_handoff` within 1 s.
    HandoffRequested(HandoffRequested),
}

fn non_null_patch<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}
