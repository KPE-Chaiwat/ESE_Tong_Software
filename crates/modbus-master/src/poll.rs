//! One poll of a session: definition, view settings, run state, counters, values and the
//! stored host fields (DES-002 2.5). The routing of its view lives here too.

use std::collections::VecDeque;
use std::time::Duration;

use modbus_core::Request;
use shared_types::{
    AliasEntry, Counters, DisplaySettings, PollConfig, PollCounters, PollDefinition, PollHostKind,
    PollId, PollSummary, PollUpdate, PollViewPlacement, ScaleOverride, ScaleSettings,
    SubWindowState, ValueColumns, ViewToken, WindowPlacement, WorkspaceRect,
};
use tokio::time::Instant;

use crate::emitter::ViewEmitter;
use crate::poll_state::PollMachine;

/// Cycle starts kept for the effective rate (10 intervals).
const EFFECTIVE_RATE_STARTS: usize = 11;

/// A handoff is delivered only when it is at most this old (DES-002 2.5.4).
pub const HANDOFF_MAX_AGE: Duration = Duration::from_secs(10);

/// The attached view of a poll (routing table entry `pollId -> { viewToken, channel, host }`).
pub(crate) struct ViewRoute {
    pub token: ViewToken,
    pub host: PollHostKind,
    pub emitter: ViewEmitter,
}

pub(crate) struct PollEntry {
    pub id: PollId,
    pub name: String,
    pub definition: PollDefinition,
    pub active: bool,
    pub display: DisplaySettings,
    pub color_rules: Vec<shared_types::ValueColorRule>,
    pub scale: Option<ScaleSettings>,
    pub scale_overrides: Vec<ScaleOverride>,
    pub value_columns: ValueColumns,
    pub aliases: Vec<AliasEntry>,
    pub has_unapplied_edits: bool,

    pub machine: PollMachine,
    /// Bumped whenever the poll stops, restarts or the link goes down; results of an older
    /// generation are discarded.
    pub generation: u64,
    /// The read request of the running definition.
    pub request: Option<Request>,
    pub seq: u64,
    pub last_update: Option<PollUpdate>,
    pub last_ok_at: Option<u64>,
    pub counters: Counters,
    pub starts: VecDeque<Instant>,

    pub host: PollHostKind,
    pub open: bool,
    pub workspace: Option<WorkspaceRect>,
    pub native: Option<WindowPlacement>,
    /// Identity of the native host incarnation; old destruction cannot close a replacement.
    pub native_generation: u64,
    pub handoff: Option<(String, Instant)>,
    pub view: Option<ViewRoute>,
}

impl PollEntry {
    pub fn config(&self) -> PollConfig {
        PollConfig {
            poll_id: self.id,
            name: self.name.clone(),
            definition: self.definition.clone(),
            active: self.active,
            display: self.display.clone(),
            color_rules: self.color_rules.clone(),
            scale: self.scale.clone(),
            scale_overrides: self.scale_overrides.clone(),
            value_columns: self.value_columns,
            aliases: self.aliases.clone(),
        }
    }

    pub fn counters_dto(&self) -> PollCounters {
        PollCounters {
            poll_id: self.id,
            counters: self.counters,
            effective_scan_ms: self.effective_scan_ms(),
            last_ok_at: self.last_ok_at,
        }
    }

    pub fn summary(&self) -> PollSummary {
        PollSummary {
            config: self.config(),
            status: self.machine.status(self.id),
            counters: self.counters_dto(),
            host: self.host,
            open: self.open,
            workspace: self.workspace,
            has_unapplied_edits: self.has_unapplied_edits,
        }
    }

    pub fn placement(&self) -> PollViewPlacement {
        PollViewPlacement {
            host: self.host,
            open: self.open,
            workspace: self.workspace,
            native: self.native.clone(),
        }
    }

    pub fn scan(&self) -> Duration {
        Duration::from_millis(u64::from(self.definition.scan_rate_ms))
    }

    /// Records a cycle start for the effective rate.
    pub fn started(&mut self, at: Instant) {
        if self.starts.len() == EFFECTIVE_RATE_STARTS {
            self.starts.pop_front();
        }
        self.starts.push_back(at);
    }

    /// Mean interval of the last (up to) 10 cycles, in ms; null with fewer than 2 starts.
    pub fn effective_scan_ms(&self) -> Option<u32> {
        let (first, last) = (self.starts.front()?, self.starts.back()?);
        let n = u32::try_from(self.starts.len() - 1)
            .ok()
            .filter(|n| *n > 0)?;
        let total = last.duration_since(*first).as_millis();
        u32::try_from((total + u128::from(n) / 2) / u128::from(n)).ok()
    }

    /// Takes the stored handoff if it is fresh enough (delivered once, DES-002 2.5.4).
    pub fn take_handoff(&mut self, now: Instant) -> Option<String> {
        self.handoff
            .take()
            .filter(|(_, at)| now.duration_since(*at) <= HANDOFF_MAX_AGE)
            .map(|(h, _)| h)
    }

    /// Makes the workspace sub-window state `normal` (restored from minimized/maximized).
    pub fn restore_workspace_rect(&mut self) {
        if let Some(r) = &mut self.workspace {
            if r.state == SubWindowState::Maximized {
                if let Some(n) = r.restore.take() {
                    (r.x, r.y, r.width, r.height) = (n.x, n.y, n.width, n.height);
                }
            }
            r.state = SubWindowState::Normal;
            r.restore = None;
        }
    }
}
