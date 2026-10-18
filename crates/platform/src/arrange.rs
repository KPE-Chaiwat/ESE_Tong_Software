//! Pure window layout math (DES-002 2.5.2, 2.8 and 2.13). No windowing types: the Tauri
//! layer converts monitors and windows to [`Rect`]s in logical pixels, calls these
//! functions and applies the result. The same rules serve the workspace (WT, WC) and native
//! windows (NT, NS, NK, NC); only [`Params`] differ.

use shared_types::{ArrangeLayout, LogicalRect};

/// An integer rectangle in logical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
}

impl Rect {
    #[must_use]
    pub const fn new(x: i64, y: i64, w: i64, h: i64) -> Self {
        Self { x, y, w, h }
    }

    /// Floors a logical rectangle (fractional work areas at 125% scaling). Values are
    /// clamped to +-[`MAX_COORD`] (NaN becomes 0), so extreme input never overflows the
    /// integer math below (REV-004 m4; the boundary rejects such input anyway).
    #[must_use]
    pub fn from_logical(r: &LogicalRect) -> Self {
        Self::new(
            clamp_coord(r.x),
            clamp_coord(r.y),
            clamp_coord(r.width),
            clamp_coord(r.height),
        )
    }

    #[must_use]
    pub fn right(&self) -> i64 {
        self.x.saturating_add(self.w)
    }

    #[must_use]
    pub fn bottom(&self) -> i64 {
        self.y.saturating_add(self.h)
    }

    #[must_use]
    pub fn to_logical(self) -> LogicalRect {
        #[allow(clippy::cast_precision_loss)]
        let f = |v: i64| v as f64;
        LogicalRect::new(f(self.x), f(self.y), f(self.w), f(self.h))
    }

    #[must_use]
    pub fn contains(&self, x: i64, y: i64) -> bool {
        x >= self.x && x < self.right() && y >= self.y && y < self.bottom()
    }

    #[must_use]
    pub fn center(&self) -> (i64, i64) {
        (
            self.x.saturating_add(self.w / 2),
            self.y.saturating_add(self.h / 2),
        )
    }

    /// Width and height of the overlap with `other` (0 when they do not overlap).
    #[must_use]
    pub fn intersection(&self, other: &Rect) -> (i64, i64) {
        let w = self
            .right()
            .min(other.right())
            .saturating_sub(self.x.max(other.x));
        let h = self
            .bottom()
            .min(other.bottom())
            .saturating_sub(self.y.max(other.y));
        (w.max(0), h.max(0))
    }
}

/// Largest absolute integer coordinate [`Rect::from_logical`] produces: far beyond any
/// desktop, far below `i64` overflow even after scaling and adding.
pub const MAX_COORD: i64 = 1 << 40;

fn clamp_coord(v: f64) -> i64 {
    // `as` saturates and maps NaN to 0; the clamp keeps sums far from overflow.
    #[allow(clippy::cast_possible_truncation)]
    let v = v.floor() as i64;
    v.clamp(-MAX_COORD, MAX_COORD)
}

/// Gap, minimum and default size of the windows being arranged (DES-002 2.8 table).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Params {
    pub gap: i64,
    pub min: (i64, i64),
    pub default: (i64, i64),
}

/// Workspace sub-windows: gap 8, minimum 320 x 180, default 640 x 368.
pub const WORKSPACE: Params = Params {
    gap: 8,
    min: (320, 180),
    default: (640, 368),
};

/// Native poll windows: gap 0, minimum 480 x 320, default 900 x 640.
pub const NATIVE: Params = Params {
    gap: 0,
    min: (480, 320),
    default: (900, 640),
};

/// Cascade step (DES-002 2.8.4).
pub const CASCADE_STEP: i64 = 24;

/// Rectangles in the order of the windows (list order) and how many were cascaded on top
/// because they did not fit the grid.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Arranged {
    pub rects: Vec<Rect>,
    pub overflow: usize,
}

fn ceil_div(a: i64, b: i64) -> i64 {
    (a + b - 1) / b
}

fn ceil_sqrt(n: i64) -> i64 {
    let mut c = 0;
    while c * c < n {
        c += 1;
    }
    c
}

fn max_grid(area: Rect, p: &Params) -> (i64, i64) {
    let cols = ((area.w + p.gap) / (p.min.0 + p.gap)).max(1);
    let rows = ((area.h + p.gap) / (p.min.1 + p.gap)).max(1);
    (cols, rows)
}

/// Lays out `n` windows on a `cols x rows` grid (DES-002 2.8.1 steps 4-8).
fn grid(n: usize, cols: i64, rows: i64, area: Rect, p: &Params) -> Arranged {
    let n_i = i64::try_from(n).unwrap_or(i64::MAX);
    let g = p.gap;
    let tiled = n_i.min(cols * rows);
    let cell_w = (area.w - (cols - 1) * g) / cols;
    let cell_h = (area.h - (rows - 1) * g) / rows;
    let extra_w = area.w - (cols * cell_w + (cols - 1) * g);
    let extra_h = area.h - (rows * cell_h + (rows - 1) * g);
    let used_rows = ceil_div(tiled.max(1), cols);
    let last_row_count = tiled - (used_rows - 1) * cols;
    let mut rects = Vec::with_capacity(n);
    for i in 0..tiled {
        let (r, c) = (i / cols, i % cols);
        let in_last_row = r == used_rows - 1;
        let mut h = cell_h;
        if in_last_row {
            h += extra_h;
        }
        let y = area.y + r * (cell_h + g);
        let rect = if in_last_row && last_row_count < cols {
            // Step 6: the k windows of a short last row share the full width.
            let k = last_row_count;
            let w = (area.w - (k - 1) * g) / k;
            let extra = area.w - (k * w + (k - 1) * g);
            let w = if c == k - 1 { w + extra } else { w };
            let base = (area.w - (k - 1) * g) / k;
            Rect::new(area.x + c * (base + g), y, w, h)
        } else {
            let w = if c == cols - 1 {
                cell_w + extra_w
            } else {
                cell_w
            };
            Rect::new(area.x + c * (cell_w + g), y, w, h)
        };
        rects.push(rect);
    }
    // Step 8: overflow windows are cascaded from the top-left with the cell size.
    for j in 0..(n_i - tiled) {
        let (x, y) = cascade_offset(j);
        rects.push(Rect::new(area.x + x, area.y + y, cell_w, cell_h));
    }
    Arranged {
        rects,
        overflow: usize::try_from(n_i - tiled).unwrap_or(0),
    }
}

fn cascade_offset(i: i64) -> (i64, i64) {
    (
        CASCADE_STEP * (i % 10) + 240 * (i / 10),
        CASCADE_STEP * (i % 10),
    )
}

/// Tile (WT, NT), DES-002 2.8.1.
#[must_use]
pub fn tile(n: usize, area: Rect, p: &Params) -> Arranged {
    if n == 0 {
        return Arranged {
            rects: Vec::new(),
            overflow: 0,
        };
    }
    let n_i = i64::try_from(n).unwrap_or(i64::MAX);
    let (max_cols, max_rows) = max_grid(area, p);
    let mut cols = max_cols.min(ceil_sqrt(n_i));
    let mut rows = ceil_div(n_i, cols);
    if rows > max_rows {
        cols = max_cols;
        rows = max_rows.min(ceil_div(n_i, cols));
    }
    grid(n, cols, rows, area, p)
}

/// Side by side (NS), DES-002 2.8.2: one row.
#[must_use]
pub fn side_by_side(n: usize, area: Rect, p: &Params) -> Arranged {
    if n == 0 {
        return Arranged {
            rects: Vec::new(),
            overflow: 0,
        };
    }
    let (max_cols, _) = max_grid(area, p);
    let cols = i64::try_from(n).unwrap_or(i64::MAX).min(max_cols);
    grid(n, cols, 1, area, p)
}

/// Stacked (NK), DES-002 2.8.3: one column.
#[must_use]
pub fn stacked(n: usize, area: Rect, p: &Params) -> Arranged {
    if n == 0 {
        return Arranged {
            rects: Vec::new(),
            overflow: 0,
        };
    }
    let (_, max_rows) = max_grid(area, p);
    let rows = i64::try_from(n).unwrap_or(i64::MAX).min(max_rows);
    grid(n, 1, rows, area, p)
}

/// Cascade (WC, NC), DES-002 2.8.4. Never overflows.
#[must_use]
pub fn cascade(n: usize, area: Rect, p: &Params) -> Arranged {
    let n_i = i64::try_from(n).unwrap_or(i64::MAX);
    let m = n_i.min(10);
    let w = p
        .min
        .0
        .max(p.default.0.min(area.w - CASCADE_STEP * (m - 1)));
    let h = p
        .min
        .1
        .max(p.default.1.min(area.h - CASCADE_STEP * (m - 1)));
    let rects = (0..n_i)
        .map(|i| {
            let (x, y) = cascade_offset(i);
            Rect::new(area.x + x, area.y + y, w, h)
        })
        .collect();
    Arranged { rects, overflow: 0 }
}

/// Dispatches on the layout.
#[must_use]
pub fn arrange(layout: ArrangeLayout, n: usize, area: Rect, p: &Params) -> Arranged {
    match layout {
        ArrangeLayout::Tile => tile(n, area, p),
        ArrangeLayout::SideBySide => side_by_side(n, area, p),
        ArrangeLayout::Stacked => stacked(n, area, p),
        ArrangeLayout::Cascade => cascade(n, area, p),
    }
}

/// Index of the monitor (by work area) that contains the point, else the nearest one.
#[must_use]
pub fn monitor_at(point: (i64, i64), work_areas: &[Rect]) -> Option<usize> {
    if let Some(i) = work_areas.iter().position(|a| a.contains(point.0, point.1)) {
        return Some(i);
    }
    work_areas
        .iter()
        .enumerate()
        .min_by_key(|(_, a)| {
            let dx =
                a.x.saturating_sub(point.0)
                    .max(point.0.saturating_sub(a.right()))
                    .max(0);
            let dy =
                a.y.saturating_sub(point.1)
                    .max(point.1.saturating_sub(a.bottom()))
                    .max(0);
            dx.saturating_mul(dx).saturating_add(dy.saturating_mul(dy))
        })
        .map(|(i, _)| i)
}

/// The DES-002 2.13 restore rule: the saved monitor exists and the rectangle overlaps its
/// work area by at least 100 x 60 px.
#[must_use]
pub fn placement_restorable(rect: Rect, monitor_work_area: Option<Rect>) -> bool {
    monitor_work_area.is_some_and(|area| {
        let (w, h) = rect.intersection(&area);
        w >= 100 && h >= 60
    })
}

/// The DES-002 2.13 fallback: the `k`-th cascade position from `origin` (W1's top-left) in
/// 24 px steps; a window that would leave the work area wraps to its top-left + 24.
#[must_use]
pub fn cascade_from(origin: (i64, i64), k: i64, size: (i64, i64), work_area: Rect) -> Rect {
    let step = CASCADE_STEP.saturating_mul(k.saturating_add(1));
    let (mut x, mut y) = (origin.0.saturating_add(step), origin.1.saturating_add(step));
    if x.saturating_add(size.0) > work_area.right() || y.saturating_add(size.1) > work_area.bottom()
    {
        x = work_area.x.saturating_add(CASCADE_STEP);
        y = work_area.y.saturating_add(CASCADE_STEP);
    }
    keep_inside(Rect::new(x, y, size.0, size.1), work_area)
}

/// Moves (and if needed shrinks) a window so it lies inside the work area.
#[must_use]
pub fn keep_inside(rect: Rect, area: Rect) -> Rect {
    let w = rect.w.min(area.w).max(0);
    let h = rect.h.min(area.h).max(0);
    let x = rect
        .x
        .clamp(area.x, area.right().saturating_sub(w).max(area.x));
    let y = rect
        .y
        .clamp(area.y, area.bottom().saturating_sub(h).max(area.y));
    Rect::new(x, y, w, h)
}

/// The pop-out placement of DES-002 2.5.2 step 3 from an anchor: `top_left` of the new
/// window and its wanted size (at least the native minimum), kept inside the work area of
/// the monitor that holds `anchor_point`.
#[must_use]
pub fn pop_out_rect(top_left: (i64, i64), size: (i64, i64), work_area: Rect) -> Rect {
    let size = (size.0.max(NATIVE.min.0), size.1.max(NATIVE.min.1));
    keep_inside(Rect::new(top_left.0, top_left.1, size.0, size.1), work_area)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(x: i64, y: i64, w: i64, h: i64) -> Rect {
        Rect::new(x, y, w, h)
    }

    const WS: Rect = Rect::new(8, 8, 1316, 700);
    const FHD: Rect = Rect::new(0, 0, 1920, 1032);

    #[test]
    fn wt_1_four_windows() {
        let a = tile(4, WS, &WORKSPACE);
        assert_eq!(
            a.rects,
            [
                r(8, 8, 654, 346),
                r(670, 8, 654, 346),
                r(8, 362, 654, 346),
                r(670, 362, 654, 346)
            ]
        );
        assert_eq!(a.overflow, 0);
    }

    #[test]
    fn wt_2_three_windows_last_row_shares_width() {
        let a = tile(3, WS, &WORKSPACE);
        assert_eq!(
            a.rects,
            [r(8, 8, 654, 346), r(670, 8, 654, 346), r(8, 362, 1316, 346)]
        );
    }

    #[test]
    fn wt_3_thirteen_windows_overflow() {
        let a = tile(13, WS, &WORKSPACE);
        assert_eq!(a.overflow, 1);
        assert_eq!(a.rects.len(), 13);
        assert!(a.rects[..12].iter().all(|x| x.w == 323 && x.h == 228));
        assert_eq!(a.rects[0], r(8, 8, 323, 228));
        assert_eq!(a.rects[11], r(8 + 3 * 331, 8 + 2 * 236, 323, 228));
        assert_eq!(a.rects[12], r(8, 8, 323, 228), "cascaded at (8, 8)");
        // Outer edges line up with the area.
        assert_eq!(a.rects[11].x + a.rects[11].w, 8 + 1316);
        assert_eq!(a.rects[11].y + a.rects[11].h, 8 + 700);
    }

    #[test]
    fn wt_4_one_window() {
        assert_eq!(
            tile(1, r(8, 8, 600, 300), &WORKSPACE).rects,
            [r(8, 8, 600, 300)]
        );
        assert!(tile(0, WS, &WORKSPACE).rects.is_empty());
    }

    #[test]
    fn nt_1_to_3() {
        assert_eq!(
            tile(4, FHD, &NATIVE).rects,
            [
                r(0, 0, 960, 516),
                r(960, 0, 960, 516),
                r(0, 516, 960, 516),
                r(960, 516, 960, 516)
            ]
        );
        let a = tile(9, FHD, &NATIVE);
        assert_eq!(a.overflow, 0);
        assert!(a.rects.iter().all(|x| x.w == 640 && x.h == 344));
        assert_eq!(a.rects[8], r(1280, 688, 640, 344));
        let a = tile(13, FHD, &NATIVE);
        assert_eq!(a.overflow, 1);
        assert!(a.rects[..12].iter().all(|x| x.w == 480 && x.h == 344));
        assert_eq!(a.rects[12], r(0, 0, 480, 344));
    }

    #[test]
    fn remainder_pixels_go_to_last_column_and_row() {
        // 1000 / 3 = 333 rest 1; 700 / 2 = 350.
        let p = Params {
            gap: 0,
            min: (100, 100),
            default: (900, 640),
        };
        let a = tile(6, r(0, 0, 1000, 701), &p);
        assert_eq!(a.overflow, 0);
        assert_eq!(a.rects[2], r(666, 0, 334, 350));
        assert_eq!(a.rects[5], r(666, 350, 334, 351));
    }

    #[test]
    fn side_by_side_and_stacked() {
        let a = side_by_side(3, FHD, &NATIVE);
        assert_eq!(
            a.rects,
            [
                r(0, 0, 640, 1032),
                r(640, 0, 640, 1032),
                r(1280, 0, 640, 1032)
            ]
        );
        // At most 4 columns of 480 on 1920: the 5th is cascaded.
        let a = side_by_side(5, FHD, &NATIVE);
        assert_eq!(a.overflow, 1);
        assert!(a.rects[..4].iter().all(|x| x.w == 480));
        let a = stacked(2, FHD, &NATIVE);
        assert_eq!(a.rects, [r(0, 0, 1920, 516), r(0, 516, 1920, 516)]);
        let a = stacked(4, FHD, &NATIVE);
        assert_eq!(a.overflow, 1, "3 rows of 320 fit in 1032");
    }

    #[test]
    fn cascade_rule() {
        let a = cascade(12, WS, &WORKSPACE);
        assert_eq!(a.overflow, 0);
        assert_eq!(a.rects[0], r(8, 8, 640, 368));
        assert_eq!(a.rects[1], r(32, 32, 640, 368));
        assert_eq!(
            a.rects[10],
            r(8 + 240, 8, 640, 368),
            "window 10 at (A.x + 240, A.y)"
        );
        // A small area shrinks the size, but never below the minimum.
        let a = cascade(10, r(0, 0, 600, 400), &NATIVE);
        assert_eq!((a.rects[0].w, a.rects[0].h), (480, 320));
        let a = cascade(2, FHD, &NATIVE);
        assert_eq!(a.rects[1], r(24, 24, 900, 640));
    }

    #[test]
    fn restore_rule_and_fallback_cascade() {
        let area = FHD;
        assert!(placement_restorable(r(100, 100, 900, 640), Some(area)));
        assert!(
            placement_restorable(r(1820, 972, 900, 640), Some(area)),
            "100 x 60 inside"
        );
        assert!(!placement_restorable(r(1821, 972, 900, 640), Some(area)));
        assert!(
            !placement_restorable(r(100, 100, 900, 640), None),
            "monitor missing"
        );
        assert_eq!(
            cascade_from((100, 100), 0, (900, 640), area),
            r(124, 124, 900, 640)
        );
        // Wraps to the work area's top-left + 24.
        assert_eq!(
            cascade_from((1500, 900), 0, (900, 640), area),
            r(24, 24, 900, 640)
        );
    }

    /// REV-004 m4: extreme values never panic (debug overflow checks) and stay inside.
    #[test]
    fn extreme_values_saturate_instead_of_overflowing() {
        let huge = Rect::from_logical(&LogicalRect::new(1e300, -1e300, 1e300, f64::NAN));
        assert_eq!(huge, r(MAX_COORD, -MAX_COORD, MAX_COORD, 0));
        let max = r(i64::MAX, i64::MAX, i64::MAX, i64::MAX);
        let min = r(i64::MIN, i64::MIN, i64::MAX, i64::MAX);
        for a in [huge, max, min, r(-5, -5, -10, -10)] {
            let _ = a.center();
            let _ = a.contains(0, 0);
            assert!(!placement_restorable(a, Some(FHD)), "{a:?}");
            let _ = a.intersection(&FHD);
            let _ = FHD.intersection(&a);
            let k = keep_inside(a, FHD);
            assert!(k.x >= FHD.x && k.right() <= FHD.right(), "{a:?} -> {k:?}");
            let p = pop_out_rect((a.x, a.y), (a.w, a.h), FHD);
            assert!(p.y >= FHD.y && p.bottom() <= FHD.bottom(), "{a:?} -> {p:?}");
            let c = cascade_from((a.x, a.y), i64::MAX, (900, 640), FHD);
            assert!(c.x >= FHD.x && c.right() <= FHD.right(), "{c:?}");
            assert!(monitor_at((a.x, a.y), &[FHD, a]).is_some());
        }
    }

    #[test]
    fn pop_out_placement_stays_inside_the_work_area() {
        let area = r(1920, 0, 1920, 1040);
        assert_eq!(
            pop_out_rect((2000, 100), (640, 368), area),
            r(2000, 100, 640, 368)
        );
        assert_eq!(
            pop_out_rect((2000, 100), (300, 200), area),
            r(2000, 100, 480, 320),
            "at least the native minimum"
        );
        assert_eq!(
            pop_out_rect((3700, 900), (640, 368), area),
            r(3840 - 640, 1040 - 368, 640, 368)
        );
        assert_eq!(monitor_at((2500, 10), &[FHD, area]), Some(1));
        assert_eq!(monitor_at((-50, 10), &[FHD, area]), Some(0), "nearest");
        assert_eq!(monitor_at((0, 0), &[]), None);
    }
}
