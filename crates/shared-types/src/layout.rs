//! Poll hosting, workspace layout, window placement and arrange DTOs (DES-002 sections 2.5,
//! 2.8, 2.13, 6.1 and 8.4, BE-002).
//!
//! Geometry is in **logical pixels**. Workspace rectangles are relative to the workspace
//! inner area of the connection window (W1); window placements and monitor work areas are
//! desktop coordinates.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::session::PollId;

/// Where a poll view lives: a sub-window in the W1 workspace or its own native window (W2).
/// `PollSummary.host` is the **last** host kind; `open: false` means the view is closed
/// (the poll is kept and keeps running).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum PollHostKind {
    Workspace,
    Native,
}

/// State of a workspace sub-window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum SubWindowState {
    Normal,
    Minimized,
    Maximized,
}

/// A rectangle in logical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LogicalRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl LogicalRect {
    #[must_use]
    pub fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    /// All four numbers are finite and within +-[`MAX_LOGICAL_COORD`], and the size is
    /// not negative.
    #[must_use]
    pub fn is_valid(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| is_sane_coord(*v))
            && self.width >= 0.0
            && self.height >= 0.0
    }
}

/// Largest absolute logical coordinate or size accepted from the frontend or a profile
/// (REV-004 m4). Real desktops are far smaller; the bound keeps every later integer
/// computation (physical pixels, sums of positions and sizes) far from overflow.
pub const MAX_LOGICAL_COORD: f64 = 1_000_000.0;

/// Finite and within +-[`MAX_LOGICAL_COORD`].
#[must_use]
pub fn is_sane_coord(v: f64) -> bool {
    v.is_finite() && v.abs() <= MAX_LOGICAL_COORD
}

/// A point in logical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct LogicalPoint {
    pub x: f64,
    pub y: f64,
}

impl LogicalPoint {
    /// Both numbers are finite and within +-[`MAX_LOGICAL_COORD`].
    #[must_use]
    pub fn is_valid(&self) -> bool {
        is_sane_coord(self.x) && is_sane_coord(self.y)
    }
}

/// A workspace sub-window rectangle (DES-002 6.1), relative to the workspace inner area.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Integer z-order, higher = in front. Unique among the polls (W1 renumbers duplicates).
    pub z: i32,
    pub state: SubWindowState,
    /// The normal rectangle while maximized, else null.
    pub restore: Option<LogicalRect>,
}

impl WorkspaceRect {
    #[must_use]
    pub fn is_valid(&self) -> bool {
        LogicalRect::new(self.x, self.y, self.width, self.height).is_valid()
            && self.restore.as_ref().is_none_or(LogicalRect::is_valid)
    }
}

/// A native window placement in logical pixels plus the monitor name (DES-002 2.13).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WindowPlacement {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub maximized: bool,
    /// `MonitorInfo.name` of the monitor the window was on.
    pub monitor: String,
}

impl WindowPlacement {
    #[must_use]
    pub fn rect(&self) -> LogicalRect {
        LogicalRect::new(self.x, self.y, self.width, self.height)
    }

    #[must_use]
    pub fn is_valid(&self) -> bool {
        self.rect().is_valid() && self.monitor.chars().count() <= 256
    }
}

/// Where a poll's view is and was (profile `PollProfile.view`, DES-002 6.1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PollViewPlacement {
    /// Last host kind (where Show reopens a closed poll).
    pub host: PollHostKind,
    /// False = closed (kept).
    pub open: bool,
    /// Last sub-window rectangle; null = next cascade slot.
    pub workspace: Option<WorkspaceRect>,
    /// Last native placement; null = anchor / cascade rule.
    pub native: Option<WindowPlacement>,
}

/// One workspace sub-window of `WorkspaceLayout`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceItem {
    pub poll_id: PollId,
    pub rect: WorkspaceRect,
}

/// The W1 workspace layout as stored in Rust (`mm_set_workspace_layout`, snapshot field
/// `workspaceLayout`). Layout values never mark the profile modified.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLayout {
    /// Sub-window rectangles by poll. Polls without a rectangle are absent.
    pub items: Vec<WorkspaceItem>,
    /// Order of the minimized bar.
    pub minimized_order: Vec<PollId>,
    pub tile_mode: bool,
    /// Owned by `mm_set_compact_mode`: ignored in `mm_set_workspace_layout`, filled in output.
    pub compact: bool,
    /// 220-400.
    pub sidebar_width: f64,
    pub sidebar_collapsed: bool,
    pub traffic_expanded: bool,
    /// px; null = the 35% default.
    pub traffic_height: Option<f64>,
}

impl Default for WorkspaceLayout {
    fn default() -> Self {
        let p = WorkspaceProfile::default();
        Self {
            items: Vec::new(),
            minimized_order: Vec::new(),
            tile_mode: p.tile_mode,
            compact: p.compact,
            sidebar_width: p.sidebar_width,
            sidebar_collapsed: p.sidebar_collapsed,
            traffic_expanded: p.traffic_expanded,
            traffic_height: p.traffic_height,
        }
    }
}

/// Workspace settings saved in a profile (DES-002 6.1). `minimizedOrder` holds indexes into
/// `Profile.polls`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceProfile {
    pub tile_mode: bool,
    pub compact: bool,
    /// 220-400, default 280.
    pub sidebar_width: f64,
    pub sidebar_collapsed: bool,
    pub traffic_expanded: bool,
    /// px; null = the 35% default.
    pub traffic_height: Option<f64>,
    /// Indexes into `polls`, in minimized-bar order.
    pub minimized_order: Vec<u32>,
}

pub const SIDEBAR_WIDTH_RANGE: (f64, f64) = (220.0, 400.0);
pub const DEFAULT_SIDEBAR_WIDTH: f64 = 280.0;

impl Default for WorkspaceProfile {
    fn default() -> Self {
        Self {
            tile_mode: false,
            compact: false,
            sidebar_width: DEFAULT_SIDEBAR_WIDTH,
            sidebar_collapsed: false,
            traffic_expanded: false,
            traffic_height: None,
            minimized_order: Vec::new(),
        }
    }
}

/// Where `mm_pop_out_poll` places the new native window (DES-002 2.5.2). `kind` is the
/// discriminant.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PopOutAnchor {
    /// Button, menu or shortcut: the sub-window rectangle in W1 client coordinates.
    Rect { rect: LogicalRect },
    /// Drag out: the pointer grab offset inside the title bar; the new window is placed
    /// with its title bar under the OS cursor.
    #[serde(rename_all = "camelCase")]
    Cursor { grab_offset: LogicalPoint },
}

/// Optional `placement` argument of `mm_show_poll` (list drag into the workspace).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ShowPollPlacement {
    pub workspace_rect: WorkspaceRect,
}

/// Why a view channel was detached by Rust (`ViewDetached.reason`). No event follows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum DetachReason {
    /// The poll moved to its own native window.
    PoppedOut,
    /// The poll moved back into the workspace.
    Docked,
    /// Another view attached for the same poll.
    Replaced,
    /// Close -> Keep poll (`mm_close_poll_view` with `keep: true`), or a profile load.
    Closed,
}

/// Layouts of `mm_arrange_poll_windows` (DES-002 2.8: NT, NS, NK, NC).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum ArrangeLayout {
    Tile,
    SideBySide,
    Stacked,
    Cascade,
}

/// Target of `mm_arrange_poll_windows` (DES-002 2.8.5). `kind` is the discriminant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ArrangeTarget {
    /// Each window stays on the monitor that holds its center.
    EachMonitor,
    /// Every native poll window of the connection is moved to this monitor.
    #[serde(rename_all = "camelCase")]
    Monitor { monitor_id: String },
}

/// Result of `mm_arrange_poll_windows`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ArrangeResult {
    /// Windows placed (tiled or cascaded), 0 when the connection has no native window.
    pub arranged: u32,
    /// Windows that did not fit the grid and were cascaded on top (toast "{m} windows did
    /// not fit and were cascaded.").
    pub overflow: u32,
}

/// One monitor (`app_list_monitors`). Geometry in logical px of that monitor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    /// Stable id for `ArrangeTarget.monitorId` while the app runs (the OS monitor name).
    pub id: String,
    /// "Display 1", "Display 2", ... (the primary monitor is Display 1).
    pub label: String,
    /// OS monitor name, stored in `WindowPlacement.monitor`.
    pub name: String,
    pub primary: bool,
    /// Work area (taskbar excluded) in logical px.
    pub work_area: LogicalRect,
    pub scale_factor: f64,
}
