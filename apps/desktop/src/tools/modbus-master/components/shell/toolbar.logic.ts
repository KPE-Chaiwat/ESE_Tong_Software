// How the W1 toolbar gives way when its controls do not fit (DES-002 2.2.1, REPORT-008 D12). Pure, so
// the order of squeezing is unit-tested without layout (jsdom has none). Only a real window shows the
// pixels: QA measures `scrollWidth <= clientWidth` and every control's right edge at 960 css px.
//
// The toolbar is ONE row of fixed height 56 px (`h-14`): it never wraps. When the row is too long the
// parts give way in this order and the action buttons never do:
//   1. the profile label (hidden below `NARROW_WIDTH`; above it cut with an ellipsis, full name in `title`),
//   2. the summary chip text (ellipsis; the full text is in its `title` and its accessible name),
//   3. the connection pill text, the target host:port at the end (ellipsis; full text in `title`),
//   4. the gaps and the side padding (narrow: 6 px gaps, 12 px padding; wide: 8 px and 14 px).
// The menus, New poll and the action buttons are `shrink-0`.
// Flex shrinks in proportion to `flex-shrink * base width`, so the weights below make the order strict
// in practice: a 100:10:1 weight takes the first part's share down to its minimum before the next one
// notices (a part reaches its minimum of 0 px, or the pill its icon plus padding, before the next
// one loses more than a fraction of a pixel).

/** Below this width the profile label is hidden, the summary chip is short and the gaps are tight (DES-002 2.2.1). */
export const NARROW_WIDTH = 1100;

/**
 * Flex-shrink weight of each squeezable part: the larger, the earlier and the more it gives way. The
 * class strings below spell the same numbers literally (Tailwind reads classes from the source text).
 */
export const SQUEEZE_WEIGHT = { profile: 100, chip: 10, pill: 1 } as const;

export interface ToolbarSqueeze {
  narrow: boolean;
  /** The profile label is drawn (it is hidden below `NARROW_WIDTH`). */
  showProfile: boolean;
  /** The chip shows the short text ("1 exception +7"). */
  shortChip: boolean;
  /** Classes of the toolbar row: fixed 56 px, one row, gap and padding by width. */
  root: string;
  /** Classes of the profile label (first to give way). */
  profile: string;
  /** Classes of the summary chip wrapper (second). */
  chip: string;
  /** Classes of the connection pill (third; its text is cut at the end). */
  pill: string;
  /** Classes of the right-hand action group (never shrinks). */
  actions: string;
}

/** The squeeze rule for a window of `widthCss` css px. */
export function toolbarSqueezeFor(widthCss: number): ToolbarSqueeze {
  const narrow = widthCss < NARROW_WIDTH;
  return {
    narrow,
    showProfile: !narrow,
    shortChip: narrow,
    root: narrow
      ? "flex h-14 shrink-0 items-center gap-1.5 border-b bg-card px-3"
      : "flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3.5",
    profile: "ml-1 flex min-w-0 shrink-[100] items-center gap-1.5 text-sm",
    chip: "inline-flex min-w-0 shrink-[10]",
    pill: "min-w-0 shrink",
    actions: narrow
      ? "ml-auto flex shrink-0 items-center gap-1.5"
      : "ml-auto flex shrink-0 items-center gap-2",
  };
}
