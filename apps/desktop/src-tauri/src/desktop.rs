//! Native window placement for poll windows (DES-002 2.5.2, 2.8, 2.13), as glue between
//! the pure math in `platform::arrange` and the window system.
//!
//! The window system is behind the small [`Desktop`] trait: `TauriDesktop` in the app and
//! `fake::FakeDesktop` in the tests, so arrange, restore, pop-out placement and the
//! window glue of the commands are tested without a real window. Coordinates: the trait
//! speaks **physical** pixels; logical pixels are physical divided by the scale factor of
//! the monitor the rectangle is on (per-monitor DPI).
//!
//! Sizes of native poll windows (PM decision on REV-004 M1): the DES-002 minimum 480 x 320
//! and every rectangle of arrange and pop out are **outer** sizes (title bar and borders
//! included). The OS enforces a minimum on the client area plus the frame, so a new poll
//! window gets the minimum client size `(480 x 320) - frame`, with the frame measured on
//! the created window ([`native_min_inner`]).

use platform::arrange::{
    arrange, cascade_from, monitor_at, placement_restorable, pop_out_rect, Rect, NATIVE,
};
use shared_types::{
    AppErrorCode, ArrangeLayout, ArrangeResult, ArrangeTarget, LogicalPoint, LogicalRect,
    MonitorInfo, PopOutAnchor, WindowPlacement,
};

use std::collections::HashSet;
use std::sync::{Mutex, PoisonError};

use crate::error::AppError;

/// One monitor in physical pixels.
#[derive(Debug, Clone, PartialEq)]
pub struct MonitorGeom {
    pub name: String,
    pub primary: bool,
    pub work_area: Rect,
    pub scale: f64,
}

/// Widths of the four sides of a window's outer rectangle (physical px).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Insets {
    pub left: i64,
    pub top: i64,
    pub right: i64,
    pub bottom: i64,
}

/// One window in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindowGeom {
    /// Outer rectangle (frame included).
    pub outer: Rect,
    /// Top-left of the client area.
    pub inner_origin: (i64, i64),
    /// Size of the client area; `outer` minus this is the frame.
    pub inner_size: (i64, i64),
    /// The parts of `outer` that are not drawn: on Windows 10 and 11 the outer rectangle
    /// (`GetWindowRect`) includes invisible resize borders on the left, right and bottom
    /// (about 8 px at 100 %, 9 px at 125 %); elsewhere zero (see [`resize_border_insets`]).
    pub invisible: Insets,
    pub scale: f64,
    pub minimized: bool,
    pub maximized: bool,
}

impl WindowGeom {
    /// The visible frame bounds: `outer` without the invisible borders.
    #[must_use]
    pub fn visible(&self) -> Rect {
        shrink(self.outer, self.invisible)
    }
}

fn shrink(r: Rect, i: Insets) -> Rect {
    Rect::new(
        r.x.saturating_add(i.left),
        r.y.saturating_add(i.top),
        r.w.saturating_sub(i.left.saturating_add(i.right)).max(1),
        r.h.saturating_sub(i.top.saturating_add(i.bottom)).max(1),
    )
}

/// The invisible resize borders of a Windows 10/11 window, measured from its rectangles
/// (REV-008 m-5): left, right and bottom are the distances from the outer edge to the
/// client edge; the top edge (caption) is visible. Zero when the numbers are not plausible
/// (negative, or borders as large as the window). The measured side may include the 1 px
/// border line that Windows 10 draws, so the visible edge is exact to within 1 px; this
/// avoids another Win32 call (`DwmGetWindowAttribute`) and the unsafe code it would need.
#[must_use]
pub fn resize_border_insets(
    outer: Rect,
    inner_origin: (i64, i64),
    inner_size: (i64, i64),
) -> Insets {
    let left = inner_origin.0.saturating_sub(outer.x);
    let right = outer
        .right()
        .saturating_sub(inner_origin.0.saturating_add(inner_size.0));
    let bottom = outer
        .bottom()
        .saturating_sub(inner_origin.1.saturating_add(inner_size.1));
    let plausible = left >= 0
        && right >= 0
        && bottom >= 0
        && left.saturating_add(right) < outer.w
        && bottom < outer.h;
    if plausible {
        Insets {
            left,
            top: 0,
            right,
            bottom,
        }
    } else {
        Insets::default()
    }
}

/// What native poll windows need from the window system. `Send + Sync` so the async
/// commands can hold it across `.await`.
pub trait Desktop: Send + Sync {
    /// Monitors, primary first, then by position.
    fn monitors(&self) -> Vec<MonitorGeom>;
    fn window(&self, label: &str) -> Option<WindowGeom>;
    /// OS cursor position.
    fn cursor(&self) -> Option<(i64, i64)>;
    /// Unminimizes and unmaximizes the window, then sets its outer rectangle; maximizes it
    /// afterwards when `maximized`.
    ///
    /// # Errors
    /// The window system's message.
    fn place(&self, label: &str, outer: Rect, maximized: bool) -> Result<(), String>;
    /// Creates a hidden native poll window with the default size (900 x 640 client) and
    /// the minimum client size `min_inner` (logical px).
    ///
    /// # Errors
    /// The window system's message.
    fn create_poll_window(
        &self,
        label: &str,
        route: &str,
        title: &str,
        min_inner: (f64, f64),
    ) -> Result<(), String>;
    /// Sets the minimum client size in logical px.
    ///
    /// # Errors
    /// The window system's message.
    fn set_min_inner_size(&self, label: &str, min_inner: (f64, f64)) -> Result<(), String>;
    fn exists(&self, label: &str) -> bool;
    /// Restores (if minimized), shows and focuses a window. False when it does not exist.
    fn reveal(&self, label: &str) -> bool;
    /// Shows a window without focusing it.
    fn show(&self, label: &str);
    /// Destroys a window without a close request (no S6).
    fn destroy(&self, label: &str);
}

/// Frame (outer minus client size, logical px) assumed when a created poll window cannot
/// be measured. About twice the Windows 11 frame at 100 % (16 x 39: the invisible resize
/// borders plus the caption), so the resulting client minimum (448 x 256) never makes a
/// window larger than an arranged cell; it only allows a slightly smaller window.
pub const FALLBACK_FRAME: (f64, f64) = (32.0, 64.0);

/// The frame of a window (outer minus client size) in **physical** px, or None when the
/// numbers are not plausible (then [`FALLBACK_FRAME`] is used): negative, a bad scale, or a
/// frame as large as the outer minimum.
#[must_use]
pub fn frame_of(w: &WindowGeom) -> Option<(i64, i64)> {
    let (fw, fh) = (
        w.outer.w.saturating_sub(w.inner_size.0),
        w.outer.h.saturating_sub(w.inner_size.1),
    );
    if fw < 0 || fh < 0 || !w.scale.is_finite() || w.scale <= 0.0 {
        return None;
    }
    let (min_w, min_h) = native_outer_min_physical(w.scale);
    (fw < min_w && fh < min_h).then_some((fw, fh))
}

#[allow(clippy::cast_precision_loss)]
fn native_outer_min() -> (f64, f64) {
    (NATIVE.min.0 as f64, NATIVE.min.1 as f64)
}

/// `logical` at `scale` in physical px, rounded **up** (D-002-21: ceil(480 s) x ceil(320 s)).
/// A tiny tolerance keeps exact products (480 x 1.25 = 600) from becoming 601 through
/// floating-point error.
#[must_use]
pub fn ceil_physical(logical: f64, scale: f64) -> i64 {
    #[allow(clippy::cast_possible_truncation)]
    let v = (logical * scale - 1e-6).ceil() as i64;
    v
}

/// The native outer minimum 480 x 320 in physical px at `scale` (D-002-21).
#[must_use]
pub fn native_outer_min_physical(scale: f64) -> (i64, i64) {
    let (w, h) = native_outer_min();
    (ceil_physical(w, scale), ceil_physical(h, scale))
}

/// A logical size that the window system turns into exactly `physical` px at `scale`.
/// tao converts a logical minimum with `round(v x scale)` on every `WM_GETMINMAXINFO` (at
/// the window's current scale); `+ bias` px (|bias| < 0.5) keeps the product off the .5
/// boundary and off a truncation edge, so both rounding and truncation give `physical`.
#[allow(clippy::cast_precision_loss)]
fn logical_for_physical(physical: i64, scale: f64, bias: f64) -> f64 {
    (physical as f64 + bias) / scale
}

/// The minimum client size of a native poll window (logical px, as given to the window
/// system): the DES-002 outer minimum 480 x 320 rounded **up** to physical px at the
/// window's scale, minus the window's measured frame in physical px, converted so that the
/// window system's rounding lands exactly on that client size (REPORT-006 D3: 465 logical
/// was turned into 581.25 -> 581 px at 125 %, an outer width of 599 instead of 600). Without
/// a plausible measurement: the outer minimum minus [`FALLBACK_FRAME`].
#[must_use]
pub fn native_min_inner(w: Option<&WindowGeom>) -> (f64, f64) {
    if let Some(w) = w {
        if let Some((fw, fh)) = frame_of(w) {
            let (min_w, min_h) = native_outer_min_physical(w.scale);
            return (
                logical_for_physical(min_w - fw, w.scale, 0.25),
                logical_for_physical(min_h - fh, w.scale, 0.25),
            );
        }
    }
    let (min_w, min_h) = native_outer_min();
    (min_w - FALLBACK_FRAME.0, min_h - FALLBACK_FRAME.1)
}

/// A window event that matters for the native minimum after a DPI change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GeometryEvent {
    /// `ScaleFactorChanged`: the window is on a monitor with another scale.
    ScaleChanged,
    /// `Resized` or `Moved`: the window has a new rectangle.
    Changed,
    /// `Destroyed`.
    Destroyed,
}

/// When to recompute a native poll window's minimum after a DPI change (D-002-21, REV-008
/// M-1).
///
/// Why not at `ScaleFactorChanged`: on Windows tao sends that event from inside
/// `WM_DPICHANGED`, with the new scale already in effect but **before** it resizes the
/// window for that scale (`SetWindowPos`). The frame measured then (outer minus client
/// size) is still the old monitor's frame, so ceil(480 s_new) minus that frame gave 726 x
/// 492 instead of 720 x 480 after a move from 125 % to 150 %, and 594 x 388 instead of
/// 600 x 400 on the way back. Posting the recompute with `run_on_main_thread` does not
/// defer it either: called on the main thread (where window events run) it runs at once.
///
/// Rule: the scale change marks the window; its next `Resized` or `Moved` (sent by that
/// `SetWindowPos`, when the window already has its new size and frame) takes the mark and
/// asks for the recompute, which the app then posts from a worker thread so that it runs
/// after the DPI message is finished. A resize without an earlier scale change asks for
/// nothing.
#[derive(Debug, Default)]
pub struct ScaleChangeTracker {
    pending: Mutex<HashSet<String>>,
}

impl ScaleChangeTracker {
    /// Records `event` for the window `label`; true when its minimum must be recomputed
    /// now.
    pub fn on_event(&self, label: &str, event: GeometryEvent) -> bool {
        let mut pending = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
        match event {
            GeometryEvent::ScaleChanged => {
                pending.insert(label.to_owned());
                false
            }
            GeometryEvent::Changed => pending.remove(label),
            GeometryEvent::Destroyed => {
                pending.remove(label);
                false
            }
        }
    }
}

/// The W1 work-area clamp of DES-002 2.13 (revision 10, D-002-22, REPORT-006 D5), in
/// physical px of the monitor holding the window, applied to the **visible** frame bounds
/// (REV-008 m-5: `outer` minus the `invisible` resize borders, which may lie outside the
/// work area, so a window whose visible edge is on the work area edge is left alone):
/// 1. the visible size becomes `min(visible, work area)` per axis (so it is reduced only as
///    much as needed and keeps the 960 x 600 minimum whenever that fits, because the OS
///    already keeps the window at least that large);
/// 2. the position is clamped so the visible rectangle lies inside the work area.
///
/// Returns the clamped **outer** rectangle and, per axis, the lowered client minimum
/// (physical px) when the minimum client size plus the visible frame does not fit the work
/// area (Q-002-15: the window then equals the work area in that axis and its minimum is
/// lowered so that it fits).
#[must_use]
pub fn clamp_to_work_area(
    outer: Rect,
    frame: (i64, i64),
    invisible: Insets,
    min_inner: (i64, i64),
    area: Rect,
) -> (Rect, Option<(i64, i64)>) {
    let visible = shrink(outer, invisible);
    let w = visible.w.min(area.w).max(1);
    let h = visible.h.min(area.h).max(1);
    let x = visible.x.min(area.right().saturating_sub(w)).max(area.x);
    let y = visible.y.min(area.bottom().saturating_sub(h)).max(area.y);
    let sides = invisible.left.saturating_add(invisible.right);
    let ends = invisible.top.saturating_add(invisible.bottom);
    let visible_frame = (
        frame.0.saturating_sub(sides).max(0),
        frame.1.saturating_sub(ends).max(0),
    );
    let fits = |min: i64, f: i64, a: i64| min.saturating_add(f) <= a;
    let lowered = (!fits(min_inner.0, visible_frame.0, area.w)
        || !fits(min_inner.1, visible_frame.1, area.h))
    .then(|| {
        (
            min_inner
                .0
                .min(area.w.saturating_sub(visible_frame.0))
                .max(1),
            min_inner
                .1
                .min(area.h.saturating_sub(visible_frame.1))
                .max(1),
        )
    });
    let clamped = Rect::new(
        x.saturating_sub(invisible.left),
        y.saturating_sub(invisible.top),
        w.saturating_add(sides),
        h.saturating_add(ends),
    );
    (clamped, lowered)
}

/// Applies [`clamp_to_work_area`] to the connection window `label` (W1), whose minimum
/// client size is `min_inner` logical px (960 x 600). The monitor is the one holding the
/// centre of the window's visible bounds, else their top-left, else the primary. A maximized or minimized window is
/// left alone (a maximized W1 restores maximized and fits by definition). Nothing is moved
/// when the window already fits.
///
/// # Errors
/// The window system's message.
pub fn clamp_connection_window(
    desktop: &dyn Desktop,
    label: &str,
    min_inner: (f64, f64),
) -> Result<(), String> {
    let Some(w) = desktop.window(label) else {
        return Ok(());
    };
    if w.maximized || w.minimized {
        return Ok(());
    }
    let monitors = desktop.monitors();
    let areas = work_areas(&monitors);
    let visible = w.visible();
    let Some(index) = monitor_at(visible.center(), &areas)
        .or_else(|| monitor_at((visible.x, visible.y), &areas))
        .or((!monitors.is_empty()).then_some(0))
    else {
        return Ok(());
    };
    let m = &monitors[index];
    let frame = (
        w.outer.w.saturating_sub(w.inner_size.0).max(0),
        w.outer.h.saturating_sub(w.inner_size.1).max(0),
    );
    let min_phys = (
        ceil_physical(min_inner.0, m.scale),
        ceil_physical(min_inner.1, m.scale),
    );
    let (rect, lowered) = clamp_to_work_area(w.outer, frame, w.invisible, min_phys, m.work_area);
    if let Some((lw, lh)) = lowered {
        // -0.25 px: the window system's rounding must not make the minimum 1 px larger
        // than the space left by the work area.
        desktop.set_min_inner_size(
            label,
            (
                logical_for_physical(lw, m.scale, -0.25),
                logical_for_physical(lh, m.scale, -0.25),
            ),
        )?;
    }
    if rect != w.outer {
        desktop.place(label, rect, false)?;
    }
    Ok(())
}

/// Sorts monitors: primary first, then left to right, top to bottom.
pub fn sort_monitors(monitors: &mut [MonitorGeom]) {
    monitors.sort_by_key(|m| (!m.primary, m.work_area.x, m.work_area.y));
}

fn to_logical(r: Rect, scale: f64) -> Rect {
    let f = |v: i64| {
        #[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
        let v = (v as f64 / scale).floor() as i64;
        v
    };
    Rect::new(f(r.x), f(r.y), f(r.w), f(r.h))
}

/// Logical to physical by **edges** (REV-004 n2): neighbouring rectangles that share a
/// logical edge share the physical edge too, so tiles never leave 1 px gaps or overlaps
/// at 125 % or 150 %.
fn to_physical(r: Rect, scale: f64) -> Rect {
    let f = |v: i64| {
        #[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
        let v = (v as f64 * scale).round() as i64;
        v
    };
    let (x, y) = (f(r.x), f(r.y));
    Rect::new(
        x,
        y,
        f(r.right()).saturating_sub(x),
        f(r.bottom()).saturating_sub(y),
    )
}

/// [`to_physical`] for a rectangle computed inside the logical work area `area` of the
/// monitor whose physical work area is `physical`: edges on the area's border land exactly
/// on the physical border (the logical area was floored).
fn to_physical_in(r: Rect, scale: f64, area: Rect, physical: Rect) -> Rect {
    let p = to_physical(r, scale);
    let left = if r.x == area.x { physical.x } else { p.x };
    let top = if r.y == area.y { physical.y } else { p.y };
    let right = if r.right() == area.right() {
        physical.right()
    } else {
        p.right()
    };
    let bottom = if r.bottom() == area.bottom() {
        physical.bottom()
    } else {
        p.bottom()
    };
    Rect::new(
        left,
        top,
        right.saturating_sub(left),
        bottom.saturating_sub(top),
    )
}

fn work_areas(monitors: &[MonitorGeom]) -> Vec<Rect> {
    monitors.iter().map(|m| m.work_area).collect()
}

/// `app_list_monitors`: "Display 1" is the primary monitor.
#[must_use]
pub fn list_monitors(desktop: &dyn Desktop) -> Vec<MonitorInfo> {
    desktop
        .monitors()
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            let wa = to_logical(m.work_area, m.scale);
            MonitorInfo {
                id: m.name.clone(),
                label: format!("Display {}", i + 1),
                name: m.name,
                primary: m.primary,
                work_area: wa.to_logical(),
                scale_factor: m.scale,
            }
        })
        .collect()
}

/// The current placement of a window in logical px of its monitor, or None when it is
/// minimized or unknown (the last saved placement then stays).
#[must_use]
pub fn placement_of(desktop: &dyn Desktop, label: &str) -> Option<WindowPlacement> {
    let w = desktop.window(label)?;
    if w.minimized {
        return None;
    }
    let monitors = desktop.monitors();
    let m = &monitors[monitor_at(w.outer.center(), &work_areas(&monitors))?];
    let r = to_logical(w.outer, m.scale).to_logical();
    Some(WindowPlacement {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        maximized: w.maximized,
        monitor: m.name.clone(),
    })
}

/// Where a native poll window opens (physical outer rectangle, maximized).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NativeSpot {
    pub outer: Rect,
    pub maximized: bool,
}

/// DES-002 2.13: a saved placement whose monitor exists and that overlaps its work area by
/// 100 x 60 px is used as is.
fn restored(saved: Option<&WindowPlacement>, monitors: &[MonitorGeom]) -> Option<NativeSpot> {
    let saved = saved?;
    let m = monitors.iter().find(|m| m.name == saved.monitor)?;
    let rect = Rect::from_logical(&saved.rect());
    placement_restorable(rect, Some(to_logical(m.work_area, m.scale))).then(|| NativeSpot {
        outer: to_physical(rect, m.scale),
        maximized: saved.maximized,
    })
}

/// Show of a closed native poll, profile load, or a new native poll: the saved placement
/// (restore rule), else the cascade rule on the reference window's monitor (W1, or the
/// invoking poll window for H2), `k` steps from its top-left.
#[must_use]
pub fn spot_for_show(
    desktop: &dyn Desktop,
    saved: Option<&WindowPlacement>,
    reference_label: &str,
    k: i64,
) -> Option<NativeSpot> {
    let monitors = desktop.monitors();
    if let Some(spot) = restored(saved, &monitors) {
        return Some(spot);
    }
    let reference = desktop.window(reference_label);
    let areas = work_areas(&monitors);
    let index = reference
        .and_then(|w| monitor_at(w.outer.center(), &areas))
        .or((!monitors.is_empty()).then_some(0))?;
    let m = &monitors[index];
    let area = to_logical(m.work_area, m.scale);
    let origin = reference.map_or((area.x, area.y), |w| {
        let o = to_logical(w.outer, m.scale);
        (o.x, o.y)
    });
    let rect = cascade_from(origin, k, NATIVE.default, area);
    Some(NativeSpot {
        outer: to_physical(rect, m.scale),
        maximized: false,
    })
}

/// Pop out (DES-002 2.5.2 step 3): the saved placement when it passes the restore rule,
/// else the anchor: the sub-window's position on screen (rect) or the title bar under the
/// cursor (cursor), with the sub-window's logical size (at least 480 x 320), kept inside
/// the work area of the monitor holding the anchor point.
#[must_use]
pub fn spot_for_pop_out(
    desktop: &dyn Desktop,
    saved: Option<&WindowPlacement>,
    w1_label: &str,
    anchor: &PopOutAnchor,
    size: (f64, f64),
) -> Option<NativeSpot> {
    let monitors = desktop.monitors();
    if let Some(spot) = restored(saved, &monitors) {
        return Some(spot);
    }
    let w1 = desktop.window(w1_label)?;
    let areas = work_areas(&monitors);
    let point = |p: &LogicalPoint, scale: f64| -> (i64, i64) {
        let r = to_physical(
            Rect::from_logical(&LogicalRect::new(p.x, p.y, 0.0, 0.0)),
            scale,
        );
        (r.x, r.y)
    };
    let (top_left, size) = match anchor {
        PopOutAnchor::Rect { rect } => {
            let off = point(
                &LogicalPoint {
                    x: rect.x,
                    y: rect.y,
                },
                w1.scale,
            );
            (
                (
                    w1.inner_origin.0.saturating_add(off.0),
                    w1.inner_origin.1.saturating_add(off.1),
                ),
                (rect.width, rect.height),
            )
        }
        PopOutAnchor::Cursor { grab_offset } => {
            // The grab offset is converted with the scale of the monitor under the cursor,
            // where the new window opens (REV-004 n1), not with the scale of W1.
            let cursor = desktop.cursor()?;
            let scale = monitor_at(cursor, &areas).map_or(w1.scale, |i| monitors[i].scale);
            let off = point(grab_offset, scale);
            (
                (
                    cursor.0.saturating_sub(off.0),
                    cursor.1.saturating_sub(off.1),
                ),
                size,
            )
        }
    };
    let index = monitor_at(top_left, &areas)?;
    let m = &monitors[index];
    let tl = to_logical(Rect::new(top_left.0, top_left.1, 0, 0), m.scale);
    let logical_size = Rect::from_logical(&LogicalRect::new(0.0, 0.0, size.0, size.1));
    let rect = pop_out_rect(
        (tl.x, tl.y),
        (logical_size.w, logical_size.h),
        to_logical(m.work_area, m.scale),
    );
    Some(NativeSpot {
        outer: to_physical(rect, m.scale),
        maximized: false,
    })
}

/// `mm_arrange_poll_windows` (DES-002 2.8 NT/NS/NK/NC and 2.8.5) for the given native
/// windows in list order.
///
/// # Errors
/// `validation` with `field: "monitor"` when the target monitor is gone; `internal` when a
/// window cannot be moved.
pub fn arrange_windows(
    desktop: &dyn Desktop,
    labels: &[String],
    layout: ArrangeLayout,
    target: &ArrangeTarget,
) -> Result<ArrangeResult, AppError> {
    let monitors = desktop.monitors();
    let target_index = match target {
        ArrangeTarget::EachMonitor => None,
        ArrangeTarget::Monitor { monitor_id } => Some(
            monitors
                .iter()
                .position(|m| &m.name == monitor_id)
                .ok_or_else(|| {
                    AppError::new(
                        AppErrorCode::Validation,
                        "That display is no longer connected.",
                    )
                    .with_field("monitor")
                })?,
        ),
    };
    let windows: Vec<(&String, WindowGeom)> = labels
        .iter()
        .filter_map(|l| desktop.window(l).map(|w| (l, w)))
        .collect();
    if windows.is_empty() || monitors.is_empty() {
        return Ok(ArrangeResult {
            arranged: 0,
            overflow: 0,
        });
    }
    let areas = work_areas(&monitors);
    let mut groups: Vec<Vec<&String>> = vec![Vec::new(); monitors.len()];
    for (label, w) in &windows {
        let index = target_index
            .or_else(|| monitor_at(w.outer.center(), &areas))
            .unwrap_or(0);
        groups[index].push(label);
    }
    let mut overflow = 0usize;
    for (m, group) in monitors.iter().zip(&groups) {
        if group.is_empty() {
            continue;
        }
        let area = to_logical(m.work_area, m.scale);
        let arranged = arrange(layout, group.len(), area, &NATIVE);
        overflow += arranged.overflow;
        for (label, rect) in group.iter().zip(arranged.rects) {
            desktop
                .place(
                    label,
                    to_physical_in(rect, m.scale, area, m.work_area),
                    false,
                )
                .map_err(|e| AppError::new(AppErrorCode::Internal, e))?;
        }
    }
    let count = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
    Ok(ArrangeResult {
        arranged: count(windows.len()),
        overflow: count(overflow),
    })
}

/// An in-memory [`Desktop`] for tests.
#[cfg(test)]
pub mod fake {
    use std::collections::BTreeMap;
    use std::sync::{Mutex, MutexGuard, PoisonError};

    use super::{
        monitor_at, resize_border_insets, work_areas, Desktop, MonitorGeom, Rect, WindowGeom,
    };

    /// Called inside `create_poll_window` with the label.
    pub type CreateHook = Box<dyn Fn(&str) + Send + Sync>;

    /// One fake window.
    #[derive(Debug, Clone)]
    pub struct FakeWindow {
        pub geom: WindowGeom,
        /// Minimum client size in logical px (0 x 0 = none).
        pub min_inner: (f64, f64),
        pub visible: bool,
        pub title: String,
        pub route: String,
    }

    /// Monitors and windows in memory. Like Windows (tao answers `WM_GETMINMAXINFO` with
    /// the minimum client size plus the frame), `place` never makes a window smaller than
    /// its minimum client size plus its frame: a window can end up **larger than asked**,
    /// which the arrange tests detect.
    #[derive(Default)]
    pub struct FakeDesktop {
        pub monitors: Vec<MonitorGeom>,
        /// Frame (outer minus client size) at 100 %; physical frame = this x scale.
        pub frame: (i64, i64),
        /// When set, the physical frame at every scale (a fractional logical frame, as the
        /// 18 x 47 px REPORT-006 measured at 125 %).
        pub frame_physical: Option<(i64, i64)>,
        /// Physical frames per scale, before `frame_physical` and `frame` (a window that
        /// moves between monitors of different DPI gets the frame of the new scale).
        pub frames_by_scale: Vec<(f64, (i64, i64))>,
        pub windows: Mutex<BTreeMap<String, FakeWindow>>,
        pub cursor: Option<(i64, i64)>,
        /// Requested outer rectangles of `place`, in order.
        pub placed: Mutex<Vec<(String, Rect)>>,
        /// Every call in order: "create <label>", "place <label>", "reveal <label>",
        /// "show <label>", "destroy <label>".
        pub calls: Mutex<Vec<String>>,
        pub fail_create: Mutex<bool>,
        pub fail_place: Mutex<bool>,
        /// The window that has the focus (in front): the last one `reveal` found.
        pub focused: Mutex<Option<String>>,
        /// Called inside `create_poll_window` (to observe what happened before).
        pub on_create: Option<CreateHook>,
    }

    fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
        m.lock().unwrap_or_else(PoisonError::into_inner)
    }

    #[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
    fn scaled(v: f64, scale: f64) -> i64 {
        (v * scale).round() as i64
    }

    impl FakeDesktop {
        /// The physical frame of a window at `scale`.
        #[must_use]
        #[allow(clippy::cast_precision_loss)]
        pub fn frame_at(&self, scale: f64) -> (i64, i64) {
            if let Some((_, f)) = self
                .frames_by_scale
                .iter()
                .find(|(s, _)| (s - scale).abs() < 1e-9)
            {
                return *f;
            }
            if let Some(f) = self.frame_physical {
                return f;
            }
            (
                scaled(self.frame.0 as f64, scale),
                scaled(self.frame.1 as f64, scale),
            )
        }

        fn scale_at(&self, outer: Rect) -> f64 {
            monitor_at(outer.center(), &work_areas(&self.monitors))
                .map_or(1.0, |i| self.monitors[i].scale)
        }

        fn geom(&self, outer: Rect, scale: f64) -> WindowGeom {
            let (fw, fh) = self.frame_at(scale);
            // Like Windows 10/11: invisible resize borders of half the frame width on the
            // left, right and bottom; the caption makes up the rest of the height.
            let inner_origin = (outer.x + fw / 2, outer.y + fh - fw / 2);
            let inner_size = (outer.w - fw, outer.h - fh);
            WindowGeom {
                outer,
                inner_origin,
                inner_size,
                invisible: resize_border_insets(outer, inner_origin, inner_size),
                scale,
                minimized: false,
                maximized: false,
            }
        }

        /// Adds an existing window with this outer rectangle.
        pub fn insert(&self, label: &str, outer: Rect) {
            let scale = self.scale_at(outer);
            lock(&self.windows).insert(
                label.to_owned(),
                FakeWindow {
                    geom: self.geom(outer, scale),
                    min_inner: (0.0, 0.0),
                    visible: true,
                    title: String::new(),
                    route: String::new(),
                },
            );
        }

        #[must_use]
        pub fn get(&self, label: &str) -> Option<FakeWindow> {
            lock(&self.windows).get(label).cloned()
        }

        #[must_use]
        pub fn calls(&self) -> Vec<String> {
            lock(&self.calls).clone()
        }

        /// The user minimizes a window (it loses the focus).
        pub fn minimize(&self, label: &str) {
            if let Some(w) = lock(&self.windows).get_mut(label) {
                w.geom.minimized = true;
            }
            let mut focused = lock(&self.focused);
            if focused.as_deref() == Some(label) {
                *focused = None;
            }
        }

        /// The user clicks a window (focus and front, no restore).
        pub fn focus(&self, label: &str) {
            *lock(&self.focused) = Some(label.to_owned());
        }

        #[must_use]
        pub fn focused(&self) -> Option<String> {
            lock(&self.focused).clone()
        }

        fn call(&self, what: &str, label: &str) {
            lock(&self.calls).push(format!("{what} {label}"));
        }

        /// The first half of Windows' `WM_DPICHANGED` as tao handles it: the window's scale
        /// is already `scale` (this is when tao sends `ScaleFactorChanged`), but it still
        /// has its old rectangle and therefore the old frame.
        pub fn begin_dpi_change(&self, label: &str, scale: f64) {
            if let Some(w) = lock(&self.windows).get_mut(label) {
                w.geom.scale = scale;
            }
        }

        /// The second half: tao resizes the window to the rectangle Windows suggests for the
        /// new scale (`SetWindowPos`, then `Resized`/`Moved`): the same logical client size,
        /// the new frame, top-left at `at`. The OS minimum applies as in `place`.
        #[allow(clippy::cast_precision_loss)]
        pub fn finish_dpi_change(&self, label: &str, old_scale: f64, at: (i64, i64)) {
            let mut windows = lock(&self.windows);
            let Some(w) = windows.get_mut(label) else {
                return;
            };
            let scale = w.geom.scale;
            let (fw, fh) = self.frame_at(scale);
            let client = (
                scaled(w.geom.inner_size.0 as f64 / old_scale, scale),
                scaled(w.geom.inner_size.1 as f64 / old_scale, scale),
            );
            let min_client = (scaled(w.min_inner.0, scale), scaled(w.min_inner.1, scale));
            let outer = Rect::new(
                at.0,
                at.1,
                client.0.max(min_client.0) + fw,
                client.1.max(min_client.1) + fh,
            );
            w.geom = self.geom(outer, scale);
        }
    }

    impl Desktop for FakeDesktop {
        fn monitors(&self) -> Vec<MonitorGeom> {
            self.monitors.clone()
        }

        fn window(&self, label: &str) -> Option<WindowGeom> {
            lock(&self.windows).get(label).map(|w| w.geom)
        }

        fn cursor(&self) -> Option<(i64, i64)> {
            self.cursor
        }

        fn place(&self, label: &str, outer: Rect, maximized: bool) -> Result<(), String> {
            self.call("place", label);
            if *lock(&self.fail_place) {
                return Err("cannot move the window".into());
            }
            let scale = self.scale_at(outer);
            let (fw, fh) = self.frame_at(scale);
            let mut windows = lock(&self.windows);
            let w = windows.get_mut(label).ok_or("no such window")?;
            // The OS minimum: min client size (rounded to physical) plus the frame.
            let min_outer = (
                scaled(w.min_inner.0, scale) + fw,
                scaled(w.min_inner.1, scale) + fh,
            );
            let actual = Rect::new(
                outer.x,
                outer.y,
                outer.w.max(min_outer.0),
                outer.h.max(min_outer.1),
            );
            w.geom = WindowGeom {
                maximized,
                ..self.geom(actual, scale)
            };
            lock(&self.placed).push((label.to_owned(), outer));
            Ok(())
        }

        fn create_poll_window(
            &self,
            label: &str,
            route: &str,
            title: &str,
            min_inner: (f64, f64),
        ) -> Result<(), String> {
            self.call("create", label);
            if let Some(hook) = &self.on_create {
                hook(label);
            }
            if *lock(&self.fail_create) {
                return Err("cannot create the window".into());
            }
            let primary = self
                .monitors
                .first()
                .map_or(Rect::new(0, 0, 1920, 1032), |m| m.work_area);
            let scale = self.monitors.first().map_or(1.0, |m| m.scale);
            let (fw, fh) = self.frame_at(scale);
            let outer = Rect::new(
                primary.x + 100,
                primary.y + 100,
                scaled(900.0, scale) + fw,
                scaled(640.0, scale) + fh,
            );
            lock(&self.windows).insert(
                label.to_owned(),
                FakeWindow {
                    geom: self.geom(outer, scale),
                    min_inner,
                    visible: false,
                    title: title.to_owned(),
                    route: route.to_owned(),
                },
            );
            Ok(())
        }

        fn set_min_inner_size(&self, label: &str, min_inner: (f64, f64)) -> Result<(), String> {
            let mut windows = lock(&self.windows);
            let w = windows.get_mut(label).ok_or("no such window")?;
            w.min_inner = min_inner;
            Ok(())
        }

        fn exists(&self, label: &str) -> bool {
            lock(&self.windows).contains_key(label)
        }

        fn reveal(&self, label: &str) -> bool {
            self.call("reveal", label);
            let mut windows = lock(&self.windows);
            let Some(w) = windows.get_mut(label) else {
                return false;
            };
            w.visible = true;
            w.geom.minimized = false;
            *lock(&self.focused) = Some(label.to_owned());
            true
        }

        fn show(&self, label: &str) {
            self.call("show", label);
            if let Some(w) = lock(&self.windows).get_mut(label) {
                w.visible = true;
            }
        }

        fn destroy(&self, label: &str) {
            self.call("destroy", label);
            lock(&self.windows).remove(label);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::FakeDesktop;
    use super::*;

    fn monitor(name: &str, primary: bool, area: Rect, scale: f64) -> MonitorGeom {
        MonitorGeom {
            name: name.into(),
            primary,
            work_area: area,
            scale,
        }
    }

    /// 1080p primary at 100 % and a 4K monitor at 200 % on the right; Windows 11 frame
    /// (16 x 39 at 100 %).
    fn two_monitors() -> FakeDesktop {
        FakeDesktop {
            monitors: vec![
                monitor("\\\\.\\DISPLAY1", true, Rect::new(0, 0, 1920, 1032), 1.0),
                monitor(
                    "\\\\.\\DISPLAY2",
                    false,
                    Rect::new(1920, 0, 3840, 2080),
                    2.0,
                ),
            ],
            frame: (16, 39),
            ..FakeDesktop::default()
        }
    }

    fn labels(n: usize) -> Vec<String> {
        (1..=n)
            .map(|i| format!("modbus-master-1-poll-{i}"))
            .collect()
    }

    fn placed(d: &FakeDesktop) -> Vec<Rect> {
        d.placed.lock().unwrap().iter().map(|(_, r)| *r).collect()
    }

    #[test]
    fn monitors_are_listed_primary_first_in_logical_px() {
        let mut d = two_monitors();
        d.monitors.reverse();
        sort_monitors(&mut d.monitors);
        let list = list_monitors(&d);
        assert_eq!(list[0].label, "Display 1");
        assert!(list[0].primary);
        assert_eq!(list[1].id, "\\\\.\\DISPLAY2");
        assert_eq!(
            list[1].work_area,
            LogicalRect::new(960.0, 0.0, 1920.0, 1040.0)
        );
        assert!((list[1].scale_factor - 2.0).abs() < f64::EPSILON);
    }

    #[test]
    fn tile_four_windows_on_the_primary_is_nt_1() {
        let d = two_monitors();
        for (i, l) in labels(4).iter().enumerate() {
            let x = i64::try_from(i).unwrap() * 50;
            d.insert(l, Rect::new(x, 10, 916, 679));
        }
        let r = arrange_windows(
            &d,
            &labels(4),
            ArrangeLayout::Tile,
            &ArrangeTarget::EachMonitor,
        )
        .unwrap();
        assert_eq!((r.arranged, r.overflow), (4, 0));
        assert_eq!(
            placed(&d),
            [
                Rect::new(0, 0, 960, 516),
                Rect::new(960, 0, 960, 516),
                Rect::new(0, 516, 960, 516),
                Rect::new(960, 516, 960, 516)
            ]
        );
    }

    #[test]
    fn each_monitor_arranges_in_place_and_converts_dpi() {
        let d = two_monitors();
        let l = labels(3);
        d.insert(&l[0], Rect::new(10, 10, 900, 640));
        d.insert(&l[1], Rect::new(2500, 100, 1800, 1280));
        d.insert(&l[2], Rect::new(3000, 900, 1800, 1280));
        let r = arrange_windows(
            &d,
            &l,
            ArrangeLayout::SideBySide,
            &ArrangeTarget::EachMonitor,
        )
        .unwrap();
        assert_eq!((r.arranged, r.overflow), (3, 0));
        let outer = |label: &str| d.get(label).unwrap().geom.outer;
        assert_eq!(outer(&l[0]), Rect::new(0, 0, 1920, 1032));
        // 2nd monitor: logical 960..2880 x 1040, two columns of 960 logical = 1920 physical.
        assert_eq!(outer(&l[1]), Rect::new(1920, 0, 1920, 2080));
        assert_eq!(outer(&l[2]), Rect::new(3840, 0, 1920, 2080));
    }

    #[test]
    fn target_monitor_gathers_everything_and_missing_monitor_is_an_error() {
        let d = two_monitors();
        let l = labels(13);
        for name in &l {
            d.insert(name, Rect::new(10, 10, 900, 640));
        }
        let target = ArrangeTarget::Monitor {
            monitor_id: "\\\\.\\DISPLAY1".into(),
        };
        let r = arrange_windows(&d, &l, ArrangeLayout::Tile, &target).unwrap();
        assert_eq!((r.arranged, r.overflow), (13, 1), "NT-3");
        let gone = ArrangeTarget::Monitor {
            monitor_id: "\\\\.\\DISPLAY9".into(),
        };
        let err = arrange_windows(&d, &l, ArrangeLayout::Tile, &gone).unwrap_err();
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(
            (v["code"].as_str(), v["field"].as_str()),
            (Some("validation"), Some("monitor"))
        );
        assert_eq!(v["message"], "That display is no longer connected.");
        // No native window: nothing to do.
        let r =
            arrange_windows(&d, &[], ArrangeLayout::Cascade, &ArrangeTarget::EachMonitor).unwrap();
        assert_eq!((r.arranged, r.overflow), (0, 0));
    }

    #[test]
    fn placement_restore_rule_and_cascade_fallback() {
        let d = two_monitors();
        d.insert("w1", Rect::new(100, 100, 1280, 800));
        let saved = WindowPlacement {
            x: 1000.0,
            y: 100.0,
            width: 900.0,
            height: 640.0,
            maximized: true,
            monitor: "\\\\.\\DISPLAY2".into(),
        };
        let spot = spot_for_show(&d, Some(&saved), "w1", 0).unwrap();
        assert_eq!(spot.outer, Rect::new(2000, 200, 1800, 1280));
        assert!(spot.maximized);
        // Missing monitor: cascade on W1's monitor from W1's top-left.
        let gone = WindowPlacement {
            monitor: "\\\\.\\DISPLAY7".into(),
            ..saved.clone()
        };
        let spot = spot_for_show(&d, Some(&gone), "w1", 1).unwrap();
        assert_eq!(spot.outer, Rect::new(148, 148, 900, 640));
        assert!(!spot.maximized);
        // Too little overlap with the work area: cascade too.
        let off = WindowPlacement { x: 2790.0, ..saved };
        assert_eq!(
            spot_for_show(&d, Some(&off), "w1", 0).unwrap().outer,
            Rect::new(124, 124, 900, 640)
        );
    }

    #[test]
    fn pop_out_from_rect_and_cursor_anchors() {
        let mut d = two_monitors();
        d.insert("w1", Rect::new(100, 100, 1280, 800));
        let anchor = PopOutAnchor::Rect {
            rect: LogicalRect::new(300.0, 200.0, 640.0, 368.0),
        };
        let spot = spot_for_pop_out(&d, None, "w1", &anchor, (0.0, 0.0)).unwrap();
        // Client origin (108, 131) + (300, 200); size at least 480 x 320.
        assert_eq!(spot.outer, Rect::new(408, 331, 640, 368));
        // Near the right edge: kept inside the work area.
        let anchor = PopOutAnchor::Rect {
            rect: LogicalRect::new(1600.0, 900.0, 300.0, 200.0),
        };
        let spot = spot_for_pop_out(&d, None, "w1", &anchor, (0.0, 0.0)).unwrap();
        assert_eq!(spot.outer, Rect::new(1440, 712, 480, 320));
        // Cursor on the 200 % monitor with a 20 x 10 grab offset: converted with the
        // cursor monitor's scale (REV-004 n1), so the title bar point under the cursor is
        // 40 x 20 physical px from the window's top-left.
        d.cursor = Some((3000, 400));
        let anchor = PopOutAnchor::Cursor {
            grab_offset: LogicalPoint { x: 20.0, y: 10.0 },
        };
        let spot = spot_for_pop_out(&d, None, "w1", &anchor, (640.0, 368.0)).unwrap();
        assert_eq!(spot.outer, Rect::new(2960, 380, 1280, 736));
    }

    /// REV-004 m4: extreme anchors and saved placements never overflow (they are also
    /// rejected at the command boundary).
    #[test]
    fn extreme_geometry_never_panics() {
        let mut d = two_monitors();
        d.insert("w1", Rect::new(100, 100, 1280, 800));
        d.cursor = Some((i64::MAX, i64::MIN));
        for v in [1e300, -1e300, f64::MAX, f64::NAN, 1e15] {
            for anchor in [
                PopOutAnchor::Rect {
                    rect: LogicalRect::new(v, v, v, v),
                },
                PopOutAnchor::Cursor {
                    grab_offset: LogicalPoint { x: v, y: -v },
                },
            ] {
                let saved = WindowPlacement {
                    x: v,
                    y: v,
                    width: v,
                    height: 640.0,
                    maximized: false,
                    monitor: "\\\\.\\DISPLAY1".into(),
                };
                if let Some(spot) = spot_for_pop_out(&d, Some(&saved), "w1", &anchor, (v, v)) {
                    let area = d.monitors.iter().map(|m| m.work_area);
                    assert!(
                        area.clone().any(|a| a.contains(spot.outer.x, spot.outer.y)),
                        "{v}: {spot:?}"
                    );
                }
                let _ = spot_for_show(&d, Some(&saved), "w1", i64::MAX);
            }
        }
    }

    #[test]
    fn current_placement_in_logical_px() {
        let d = two_monitors();
        d.insert("p", Rect::new(2000, 200, 1800, 1280));
        let p = placement_of(&d, "p").unwrap();
        assert_eq!(p.rect(), LogicalRect::new(1000.0, 100.0, 900.0, 640.0));
        assert_eq!(p.monitor, "\\\\.\\DISPLAY2");
        d.windows
            .lock()
            .unwrap()
            .get_mut("p")
            .unwrap()
            .geom
            .minimized = true;
        assert!(placement_of(&d, "p").is_none());
    }

    #[test]
    fn minimum_client_size_is_the_outer_minimum_minus_the_measured_frame() {
        let geom = |outer: Rect, inner: (i64, i64), scale: f64| WindowGeom {
            outer,
            inner_origin: (0, 0),
            inner_size: inner,
            invisible: Insets::default(),
            scale,
            minimized: false,
            maximized: false,
        };
        // Windows 11 at 100 %: 16 x 39 frame; +0.25 px keeps the rounding off the edge.
        let w = geom(Rect::new(0, 0, 916, 679), (900, 640), 1.0);
        assert_eq!(native_min_inner(Some(&w)), (464.25, 281.25));
        // 150 %: 24 x 59 physical; the client minimum is 696 x 421 physical.
        let w = geom(Rect::new(0, 0, 1374, 1019), (1350, 960), 1.5);
        assert_eq!(native_min_inner(Some(&w)), (696.25 / 1.5, 421.25 / 1.5));
        // REPORT-006 at 125 %: 18 x 47 physical; DES-002 2.6: 582 x 353 physical.
        let w = geom(Rect::new(0, 0, 1143, 847), (1125, 800), 1.25);
        let (lw, lh) = native_min_inner(Some(&w));
        assert_eq!(((lw * 1.25).round(), (lh * 1.25).round()), (582.0, 353.0));
        assert_eq!(((lw * 1.25).trunc(), (lh * 1.25).trunc()), (582.0, 353.0));
        // Not measurable or implausible: the fallback frame.
        assert_eq!(native_min_inner(None), (448.0, 256.0));
        let w = geom(Rect::new(0, 0, 900, 640), (916, 679), 1.0);
        assert_eq!(native_min_inner(Some(&w)), (448.0, 256.0), "negative frame");
        let w = geom(Rect::new(0, 0, 900, 640), (300, 300), 0.0);
        assert_eq!(native_min_inner(Some(&w)), (448.0, 256.0), "scale 0");
        let w = geom(Rect::new(0, 0, 1900, 640), (300, 300), 1.0);
        assert_eq!(
            native_min_inner(Some(&w)),
            (448.0, 256.0),
            "frame >= minimum"
        );
    }

    /// Creates `n` poll windows the way `poll_windows::create` does (fallback minimum at
    /// build time, then the measured one) and arranges them.
    fn arrange_created(d: &FakeDesktop, n: usize, measured: bool) -> Vec<String> {
        let l = labels(n);
        for label in &l {
            d.create_poll_window(label, "r", "t", native_min_inner(None))
                .unwrap();
            if measured {
                let min = native_min_inner(d.window(label).as_ref());
                d.set_min_inner_size(label, min).unwrap();
            }
        }
        arrange_windows(d, &l, ArrangeLayout::Tile, &ArrangeTarget::EachMonitor).unwrap();
        l
    }

    /// Every window got exactly the requested outer rectangle and nothing overlaps or
    /// leaves the work area.
    fn assert_fits(d: &FakeDesktop, l: &[String], tiled: usize, area: Rect) {
        let requested: Vec<(String, Rect)> = d.placed.lock().unwrap().clone();
        for (label, want) in &requested {
            let got = d.get(label).unwrap().geom.outer;
            assert_eq!(got, *want, "{label} is larger than its cell");
        }
        let rects: Vec<Rect> = l[..tiled]
            .iter()
            .map(|x| d.get(x).unwrap().geom.outer)
            .collect();
        for (i, a) in rects.iter().enumerate() {
            assert!(a.x >= area.x && a.right() <= area.right(), "{a:?}");
            assert!(a.y >= area.y && a.bottom() <= area.bottom(), "{a:?}");
            for b in &rects[i + 1..] {
                assert_eq!(a.intersection(b), (0, 0).max(a.intersection(b)));
                let (w, h) = a.intersection(b);
                assert!(w == 0 || h == 0, "{a:?} overlaps {b:?}");
            }
        }
    }

    /// REV-004 M1 (PM decision: 480 x 320 is the outer size): with a real frame and the OS
    /// minimum enforced, NT-2 (3 x 3 at 640 x 344) and NT-3 (4 x 3 at 480 x 344) fit a
    /// 1920 x 1032 work area: three rows end at 1032, nothing overlaps.
    #[test]
    fn nt_2_and_nt_3_fit_with_a_frame_and_the_os_minimum() {
        let area = Rect::new(0, 0, 1920, 1032);
        for (n, tiled, cell) in [(9, 9, (640, 344)), (13, 12, (480, 344))] {
            let d = two_monitors();
            let l = arrange_created(&d, n, true);
            assert_fits(&d, &l, tiled, area);
            let last = d.get(&l[tiled - 1]).unwrap().geom.outer;
            assert_eq!(last.bottom(), 1032, "three rows fill the work area exactly");
            assert_eq!((last.w, last.h), cell);
            // At the minimum the window is exactly 480 x 320 outside.
            d.place(&l[0], Rect::new(0, 0, 100, 100), false).unwrap();
            let min = d.get(&l[0]).unwrap().geom.outer;
            assert_eq!((min.w, min.h), (480, 320));
        }
        // Without the measurement (fallback frame) the cells still fit.
        let d = two_monitors();
        let l = arrange_created(&d, 13, false);
        assert_fits(&d, &l, 12, area);
    }

    /// The same on the 200 % monitor and on a 150 % monitor with a fractional frame.
    #[test]
    fn nt_cells_fit_at_high_dpi() {
        for scale in [1.5, 2.0] {
            #[allow(clippy::cast_possible_truncation)]
            let area = Rect::new(0, 0, (1920.0 * scale) as i64, (1032.0 * scale) as i64);
            let d = FakeDesktop {
                monitors: vec![monitor("\\\\.\\DISPLAY1", true, area, scale)],
                frame: (16, 39),
                ..FakeDesktop::default()
            };
            let l = arrange_created(&d, 13, true);
            assert_fits(&d, &l, 12, area);
        }
    }

    /// The test above fails with the old rule (480 x 320 as the CLIENT minimum): the OS
    /// makes every NT-2 window taller than its 344 px cell.
    #[test]
    fn a_client_minimum_of_480_x_320_would_not_fit() {
        let d = two_monitors();
        let l = labels(9);
        for label in &l {
            d.create_poll_window(label, "r", "t", (480.0, 320.0))
                .unwrap();
        }
        arrange_windows(&d, &l, ArrangeLayout::Tile, &ArrangeTarget::EachMonitor).unwrap();
        let w = d.get(&l[8]).unwrap().geom.outer;
        assert_eq!((w.w, w.h), (640, 359), "taller than the 344 px cell");
        assert!(w.bottom() > 1032, "the third row ends under the taskbar");
    }

    /// REV-004 n2: at 125 % the physical tiles share edges and fill the work area exactly.
    #[test]
    fn tiles_have_no_physical_gaps_at_125_percent() {
        let area = Rect::new(0, 0, 2559, 1389); // odd sizes: the logical area is floored
        let d = FakeDesktop {
            monitors: vec![monitor("\\\\.\\DISPLAY1", true, area, 1.25)],
            ..FakeDesktop::default()
        };
        let l = labels(9);
        for x in &l {
            d.insert(x, Rect::new(10, 10, 900, 640));
        }
        arrange_windows(&d, &l, ArrangeLayout::Tile, &ArrangeTarget::EachMonitor).unwrap();
        let r: Vec<Rect> = placed(&d);
        for row in 0..3 {
            let cells = &r[row * 3..row * 3 + 3];
            assert_eq!(cells[0].x, 0);
            assert_eq!(cells[0].right(), cells[1].x);
            assert_eq!(cells[1].right(), cells[2].x);
            assert_eq!(cells[2].right(), area.right());
        }
        assert_eq!(r[0].bottom(), r[3].y);
        assert_eq!(r[3].bottom(), r[6].y);
        assert_eq!(r[8].bottom(), area.bottom());
    }

    const D1: &str = "\\\\.\\DISPLAY1";

    /// REPORT-006 D3 / D-002-21: at every scale and with whole or fractional frames, a
    /// native window dragged below its minimum stops at exactly ceil(480 s) x ceil(320 s)
    /// physical px outside. The fake applies the minimum like tao (`round(v x scale)` plus
    /// the frame).
    #[test]
    fn native_minimum_outer_size_is_exact_at_every_scale() {
        let expected = [
            (1.0, (480, 320)),
            (1.25, (600, 400)),
            (1.5, (720, 480)),
            (1.75, (840, 560)),
            (2.0, (960, 640)),
        ];
        for (scale, outer_min) in expected {
            assert_eq!(native_outer_min_physical(scale), outer_min);
            #[allow(clippy::cast_possible_truncation)]
            let area = Rect::new(0, 0, (1920.0 * scale) as i64, (1032.0 * scale) as i64);
            #[allow(clippy::cast_possible_truncation)]
            let scaled = |v: f64| (v * scale).round() as i64;
            // Whole frames at 100 % scaled, the REPORT-006 frame and odd fractional ones.
            for frame in [
                (scaled(16.0), scaled(39.0)),
                (18, 47),
                (17, 45),
                (23, 59),
                (scaled(14.4) + 1, scaled(37.6) + 1),
            ] {
                let d = FakeDesktop {
                    monitors: vec![monitor(D1, true, area, scale)],
                    frame_physical: Some(frame),
                    ..FakeDesktop::default()
                };
                let l = labels(1);
                d.create_poll_window(&l[0], "r", "t", native_min_inner(None))
                    .unwrap();
                let min = native_min_inner(d.window(&l[0]).as_ref());
                d.set_min_inner_size(&l[0], min).unwrap();
                d.place(&l[0], Rect::new(10, 10, 50, 50), false).unwrap();
                let got = d.get(&l[0]).unwrap().geom.outer;
                assert_eq!((got.w, got.h), outer_min, "scale {scale}, frame {frame:?}");
                // Truncating instead of rounding gives the same size.
                #[allow(clippy::cast_possible_truncation)]
                let trunc = |v: f64| (v * scale) as i64;
                assert_eq!(
                    (trunc(min.0) + frame.0, trunc(min.1) + frame.1),
                    outer_min,
                    "truncation, scale {scale}, frame {frame:?}"
                );
            }
        }
    }

    /// A W1 as the OS shows it: outer rectangle with the frame, client minimum 960 x 600.
    fn w1_desktop(area: Rect, scale: f64, frame: (i64, i64), outer: Rect) -> FakeDesktop {
        let d = FakeDesktop {
            monitors: vec![monitor(D1, true, area, scale)],
            frame_physical: Some(frame),
            ..FakeDesktop::default()
        };
        d.insert("w1", outer);
        d.set_min_inner_size("w1", (960.0, 600.0)).unwrap();
        d
    }

    /// REPORT-006 D5 / D-002-22 / CHK2-A7: the default W1 cascaded at (254, 163) physical
    /// with an outer size of 1618 x 1047 on a 1920 x 1020 work area at 125 % (frame 18 x
    /// 47, invisible borders 9 px left, right and bottom): it is moved up and only its
    /// visible height is reduced, to the work area height; the invisible bottom border may
    /// lie below the work area (REV-008 m-5).
    #[test]
    fn w1_is_clamped_to_the_work_area_at_creation() {
        let area = Rect::new(0, 0, 1920, 1020);
        let d = w1_desktop(area, 1.25, (18, 47), Rect::new(254, 163, 1618, 1047));
        clamp_connection_window(&d, "w1", (960.0, 600.0)).unwrap();
        let w = d.get("w1").unwrap();
        assert_eq!(w.geom.outer, Rect::new(254, 0, 1618, 1029));
        assert_eq!(w.geom.visible(), Rect::new(263, 0, 1600, 1020));
        assert_eq!(w.geom.inner_size.0, 1600, "inner width stays 1280 logical");
        assert_eq!(w.min_inner, (960.0, 600.0), "minimum kept");
        // At 100 % on a 1920 x 1032 work area the default W1 fits: nothing is touched.
        let area = Rect::new(0, 0, 1920, 1032);
        let d = w1_desktop(area, 1.0, (16, 39), Rect::new(100, 100, 1296, 839));
        clamp_connection_window(&d, "w1", (960.0, 600.0)).unwrap();
        assert!(d.calls().iter().all(|c| !c.starts_with("place")));
        // Only the position: cascaded past the right and bottom edges; the visible edges
        // end on the work area edges.
        let d = w1_desktop(area, 1.0, (16, 39), Rect::new(700, 300, 1296, 839));
        clamp_connection_window(&d, "w1", (960.0, 600.0)).unwrap();
        let g = d.get("w1").unwrap().geom;
        assert_eq!(g.outer, Rect::new(632, 201, 1296, 839));
        assert_eq!((g.visible().right(), g.visible().bottom()), (1920, 1032));
    }

    /// CHK2-A8: a restored W1 of 1900 x 1000 physical at (100, 300) fits the work area at
    /// 125 %, reduced only as needed; a larger one at 100 % becomes the work area (visible
    /// bounds); maximized and minimized are left alone; a window on monitor 2 uses its work
    /// area.
    #[test]
    fn w1_is_clamped_to_the_work_area_at_restore() {
        let d = w1_desktop(
            Rect::new(0, 0, 1920, 1020),
            1.25,
            (18, 47),
            Rect::new(100, 300, 1900, 1000),
        );
        clamp_connection_window(&d, "w1", (960.0, 600.0)).unwrap();
        let g = d.get("w1").unwrap().geom;
        assert_eq!(g.outer, Rect::new(29, 29, 1900, 1000));
        assert_eq!(g.visible(), Rect::new(38, 29, 1882, 991));
        let d = w1_desktop(
            Rect::new(0, 0, 1920, 1032),
            1.0,
            (16, 39),
            Rect::new(100, 300, 2500, 1400),
        );
        clamp_connection_window(&d, "w1", (960.0, 600.0)).unwrap();
        let g = d.get("w1").unwrap().geom;
        assert_eq!(g.visible(), Rect::new(0, 0, 1920, 1032));
        assert_eq!(g.outer, Rect::new(-8, 0, 1936, 1040));
        for maximized in [true, false] {
            let d = w1_desktop(
                Rect::new(0, 0, 1920, 1032),
                1.0,
                (16, 39),
                Rect::new(100, 300, 1900, 1000),
            );
            {
                let mut ws = d.windows.lock().unwrap();
                let g = &mut ws.get_mut("w1").unwrap().geom;
                if maximized {
                    g.maximized = true;
                } else {
                    g.minimized = true;
                }
            }
            clamp_connection_window(&d, "w1", (960.0, 600.0)).unwrap();
            assert!(d.calls().is_empty(), "left alone");
        }
        // On the 200 % monitor 2 (work area x 1920..5760, y 0..2080).
        let mut d = two_monitors();
        d.frame_physical = Some((32, 78));
        d.insert("w1", Rect::new(3000, 1500, 2592, 1678));
        clamp_connection_window(&d, "w1", (960.0, 600.0)).unwrap();
        let g = d.get("w1").unwrap().geom;
        assert_eq!(g.outer, Rect::new(3000, 418, 2592, 1678));
        assert_eq!(g.visible().bottom(), 2080);
    }

    /// REV-008 m-5: a W1 whose visible edge is on the work area edge is left alone, even
    /// though its invisible resize borders (9 px at 125 %, 8 px at 100 %) lie outside, with
    /// the work area at the origin, at a non-zero origin (taskbar on the left) and on a
    /// monitor left of the primary. A visible edge outside is still moved in, and only up
    /// to the visible edge.
    #[test]
    fn w1_whose_visible_edges_touch_the_work_area_is_left_alone() {
        let area = Rect::new(0, 0, 1920, 1020);
        for outer in [
            // Visible left edge on the screen edge (outer x -9), e.g. after Snap.
            Rect::new(-9, 100, 1618, 900),
            Rect::new(0, 100, 1618, 900),
            // Visible bottom edge on the taskbar (outer bottom 9 px below it).
            Rect::new(100, 129, 1618, 900),
            // Visible right edge on the screen edge.
            Rect::new(311, 100, 1618, 900),
            // All three at once (a window that fills the work area).
            Rect::new(-9, 0, 1938, 1029),
        ] {
            let d = w1_desktop(area, 1.25, (18, 47), outer);
            clamp_connection_window(&d, "w1", (960.0, 600.0)).unwrap();
            assert!(
                d.calls().iter().all(|c| !c.starts_with("place")),
                "{outer:?} was moved"
            );
            assert_eq!(d.get("w1").unwrap().geom.outer, outer);
        }
        // One more pixel out: moved in by exactly that pixel.
        let d = w1_desktop(area, 1.25, (18, 47), Rect::new(-10, 130, 1618, 900));
        clamp_connection_window(&d, "w1", (960.0, 600.0)).unwrap();
        assert_eq!(
            d.get("w1").unwrap().geom.outer,
            Rect::new(-9, 129, 1618, 900)
        );
        // Work area with a non-zero origin (taskbar of 62 px on the left), 100 %.
        let area = Rect::new(62, 0, 1858, 1032);
        let d = w1_desktop(area, 1.0, (16, 39), Rect::new(54, 50, 1296, 839));
        clamp_connection_window(&d, "w1", (960.0, 600.0)).unwrap();
        assert!(
            d.calls().is_empty(),
            "visible left edge on the taskbar edge"
        );
        let d = w1_desktop(area, 1.0, (16, 39), Rect::new(40, 50, 1296, 839));
        clamp_connection_window(&d, "w1", (960.0, 600.0)).unwrap();
        assert_eq!(
            d.get("w1").unwrap().geom.outer,
            Rect::new(54, 50, 1296, 839)
        );
        // A monitor left of the primary (negative coordinates).
        let area = Rect::new(-1920, 0, 1920, 1032);
        let d = w1_desktop(area, 1.0, (16, 39), Rect::new(-1928, 10, 1296, 839));
        clamp_connection_window(&d, "w1", (960.0, 600.0)).unwrap();
        assert!(d.calls().is_empty());
        // The former rule (whole outer rectangle inside) would have moved the first window.
        let (rect, _) = clamp_to_work_area(
            Rect::new(-9, 100, 1618, 900),
            (18, 47),
            Insets::default(),
            (1200, 750),
            Rect::new(0, 0, 1920, 1020),
        );
        assert_eq!(rect.x, 0);
    }

    #[test]
    fn invisible_borders_are_measured_from_the_rectangles() {
        // 125 %: outer 1618 x 1047, client 1600 x 1000 at (9, 38) from the top-left.
        let outer = Rect::new(-9, 100, 1618, 1047);
        let insets = resize_border_insets(outer, (0, 138), (1600, 1000));
        assert_eq!(
            insets,
            Insets {
                left: 9,
                top: 0,
                right: 9,
                bottom: 9
            }
        );
        // Implausible numbers: none.
        assert_eq!(
            resize_border_insets(outer, (-50, 138), (1600, 1000)),
            Insets::default()
        );
        assert_eq!(
            resize_border_insets(Rect::new(0, 0, 10, 10), (0, 0), (0, 0)),
            Insets::default()
        );
    }

    /// Q-002-15: a work area smaller than the 960 x 600 minimum (1280 x 672 physical at
    /// 150 %): the window's visible bounds equal the work area in the axes that do not fit,
    /// and its minimum is lowered so the OS lets it fit.
    #[test]
    fn w1_on_a_work_area_smaller_than_its_minimum_fits_entirely() {
        let area = Rect::new(0, 0, 1280, 672);
        let d = w1_desktop(area, 1.5, (24, 59), Rect::new(30, 40, 1944, 1259));
        clamp_connection_window(&d, "w1", (960.0, 600.0)).unwrap();
        let w = d.get("w1").unwrap();
        assert_eq!(
            w.geom.visible(),
            area,
            "the OS minimum no longer pushes it out"
        );
        assert_eq!(w.geom.outer, Rect::new(-12, 0, 1304, 684));
        #[allow(clippy::cast_possible_truncation)]
        let px = |v: f64| (v * 1.5).round() as i64;
        // Visible frame: 0 px wide (the side borders are invisible), 47 px high.
        assert!(px(w.min_inner.0) <= 1280, "{:?}", w.min_inner);
        assert!(px(w.min_inner.1) + 47 <= 672, "{:?}", w.min_inner);
        // The pure rule: only the axis that does not fit is lowered; the other keeps the
        // 960 logical (1440 px) minimum because it fits.
        let borders = Insets {
            left: 12,
            top: 0,
            right: 12,
            bottom: 12,
        };
        let (rect, lowered) = clamp_to_work_area(
            Rect::new(0, 0, 1700, 1000),
            (24, 59),
            borders,
            (1440, 900),
            Rect::new(0, 0, 2560, 672),
        );
        assert_eq!(rect, Rect::new(0, 0, 1700, 684));
        assert_eq!(lowered, Some((1440, 625)));
        let (_, lowered) = clamp_to_work_area(
            Rect::new(0, 0, 1700, 1000),
            (24, 59),
            borders,
            (1440, 900),
            Rect::new(0, 0, 2560, 1400),
        );
        assert_eq!(lowered, None);
    }

    /// 125 % primary and a 150 % monitor on its right, with the frames REPORT-006 and
    /// BE-002 use (18 x 47 and 24 x 59 physical), and one native poll window on the
    /// primary with its measured minimum.
    fn mixed_dpi() -> (FakeDesktop, String) {
        let d = FakeDesktop {
            monitors: vec![
                monitor(D1, true, Rect::new(0, 0, 2400, 1290), 1.25),
                monitor(
                    "\\\\.\\DISPLAY2",
                    false,
                    Rect::new(2400, 0, 2880, 1548),
                    1.5,
                ),
            ],
            frames_by_scale: vec![(1.25, (18, 47)), (1.5, (24, 59))],
            ..FakeDesktop::default()
        };
        let label = labels(1).remove(0);
        d.create_poll_window(&label, "r", "t", native_min_inner(None))
            .unwrap();
        crate::commands::poll_windows::refresh_min_size(&d, &label);
        (d, label)
    }

    /// The outer size of `label` after a drag below its minimum at `at`.
    fn shrunk(d: &FakeDesktop, label: &str, at: (i64, i64)) -> (i64, i64) {
        d.place(label, Rect::new(at.0, at.1, 50, 50), false)
            .unwrap();
        let o = d.get(label).unwrap().geom.outer;
        (o.w, o.h)
    }

    /// One move between monitors as Windows and tao do it, with the window events in their
    /// real order, handled like the app (`lib.rs::on_geometry_event`): `ScaleFactorChanged`
    /// while the window still has its old rectangle, then the resize for the new scale
    /// and its `Resized` and `Moved` events.
    fn dpi_move(
        d: &FakeDesktop,
        tracker: &ScaleChangeTracker,
        label: &str,
        (old, new): (f64, f64),
        at: (i64, i64),
    ) {
        let refresh = crate::commands::poll_windows::refresh_min_size;
        d.begin_dpi_change(label, new);
        if tracker.on_event(label, GeometryEvent::ScaleChanged) {
            refresh(d, label);
        }
        d.finish_dpi_change(label, old, at);
        for _ in 0..2 {
            if tracker.on_event(label, GeometryEvent::Changed) {
                refresh(d, label);
            }
        }
    }

    /// REV-008 M-1 / D-002-21 / CHK2-F13 [MON2]: a W2 dragged from 125 % to 150 % and back
    /// stops at exactly 720 x 480 and 600 x 400 outside. This fails when the minimum is
    /// recomputed at `ScaleFactorChanged` (726 x 492 and 594 x 388, see below).
    #[test]
    fn native_minimum_is_exact_after_a_move_between_monitors_of_different_dpi() {
        let (d, label) = mixed_dpi();
        let tracker = ScaleChangeTracker::default();
        assert_eq!(shrunk(&d, &label, (100, 100)), (600, 400));
        dpi_move(&d, &tracker, &label, (1.25, 1.5), (2500, 100));
        assert_eq!(shrunk(&d, &label, (2500, 100)), (720, 480));
        dpi_move(&d, &tracker, &label, (1.5, 1.25), (300, 100));
        assert_eq!(shrunk(&d, &label, (300, 100)), (600, 400));
        // Again, after the window was resized on the way.
        dpi_move(&d, &tracker, &label, (1.25, 1.5), (2600, 200));
        assert_eq!(shrunk(&d, &label, (2600, 200)), (720, 480));
    }

    /// The defect M-1 describes, reproduced by the fake: measuring at `ScaleFactorChanged`
    /// uses the old frame with the new scale.
    #[test]
    fn measuring_at_the_scale_event_uses_the_old_frame() {
        let refresh = crate::commands::poll_windows::refresh_min_size;
        let (d, label) = mixed_dpi();
        d.begin_dpi_change(&label, 1.5);
        refresh(&d, &label);
        d.finish_dpi_change(&label, 1.25, (2500, 100));
        assert_eq!(shrunk(&d, &label, (2500, 100)), (726, 492));
        d.begin_dpi_change(&label, 1.25);
        refresh(&d, &label);
        d.finish_dpi_change(&label, 1.5, (300, 100));
        assert_eq!(shrunk(&d, &label, (300, 100)), (594, 388));
    }

    #[test]
    fn only_the_first_resize_after_a_scale_change_recomputes() {
        let t = ScaleChangeTracker::default();
        assert!(!t.on_event("a", GeometryEvent::Changed), "no scale change");
        assert!(!t.on_event("a", GeometryEvent::ScaleChanged));
        assert!(!t.on_event("b", GeometryEvent::Changed), "another window");
        assert!(t.on_event("a", GeometryEvent::Changed));
        assert!(!t.on_event("a", GeometryEvent::Changed), "only once");
        // Two scale changes before the resize: one recompute.
        t.on_event("a", GeometryEvent::ScaleChanged);
        t.on_event("a", GeometryEvent::ScaleChanged);
        assert!(t.on_event("a", GeometryEvent::Changed));
        assert!(!t.on_event("a", GeometryEvent::Changed));
        // A destroyed window forgets its mark (a new window may reuse the label).
        t.on_event("a", GeometryEvent::ScaleChanged);
        assert!(!t.on_event("a", GeometryEvent::Destroyed));
        assert!(!t.on_event("a", GeometryEvent::Changed));
    }
}
