// How the toolbar of a native poll window adapts to its width (DES-002 2.6 "Squeeze at the minimum",
// D-002-36, REPORT-008 D10). Pure, so the threshold and the classes are unit-tested without layout
// (jsdom has none); the real row count and the grid rows at the window minimum can only be measured
// in a real window.
//
// The window minimum at 125 % is 600 x 400 physical = client 465.6 x 282.4 css px. There the full
// toolbar wrapped to three rows and the grid showed one complete row. The rule: below
// `TOOLBAR_ICON_ONLY_BELOW` the Pause or Resume, Write, Connection window and Dock to workspace
// buttons show only their icon (the full name stays in `aria-label` and `title`), the pills keep
// icon and text, and the toolbar is two groups that can never need more than two rows.

/** Below this window width (css px, exact) the toolbar buttons are icon-only. One place, so QA can move it. */
export const TOOLBAR_ICON_ONLY_BELOW = 640;

export type ToolbarLabelMode = "full" | "icon";

/**
 * `full` at `clientWidthCss >= 640` (icon and text, as today), `icon` below. The width is the window
 * width: the toolbar is a full-width block in the window root, so its width is the document
 * `clientWidth` (the source of the setup rail threshold, which is the same width).
 */
export function toolbarLabelMode(clientWidthCss: number): ToolbarLabelMode {
  return clientWidthCss >= TOOLBAR_ICON_ONLY_BELOW ? "full" : "icon";
}

/**
 * The exact width reduced to what `toolbarLabelMode` can tell apart (`TOOLBAR_ICON_ONLY_BELOW` or 0),
 * so the toolbar re-renders only when the threshold is crossed, not on every sub-pixel of a resize.
 * `toolbarLabelMode(snapToolbarWidth(w)) === toolbarLabelMode(w)` for every w (639.9 -> 0, 640 -> 640).
 */
export function snapToolbarWidth(clientWidthCss: number): number {
  return clientWidthCss >= TOOLBAR_ICON_ONLY_BELOW ? TOOLBAR_ICON_ONLY_BELOW : 0;
}

export interface ToolbarLayout {
  mode: ToolbarLabelMode;
  /** Classes of the toolbar element. */
  root: string;
  /** Classes of the two groups (the main one and the connection controls). */
  group: string;
  /** Extra classes of the poll name (it is cut first, never below 80 px). */
  name: string;
  /** Width of the inline rename field. */
  renameWidth: string;
}

/**
 * The side padding of the toolbar: ONE value for both modes (REPORT-008 D11). The width the toolbar
 * decides on is its border box (the window width), which does not depend on its own padding; the same
 * padding in both modes also keeps the content box, the wrap point of the two groups and any
 * content-box reading equal whichever mode is chosen, so the decision can never depend on the mode it
 * controls.
 */
export const TOOLBAR_PADDING_X = "px-3";

const ROOT = `flex shrink-0 flex-wrap items-center border-b bg-card ${TOOLBAR_PADDING_X}`;

/**
 * - `full`: 60 px minimum height, 12 px gaps, 8 px vertical padding; the name is cut at 16 rem.
 * - `icon`: no minimum height (one row is 40 px, two rows 76 px: every pixel goes to the data grid),
 *   8 px gaps, 4 px vertical padding; the name is cut at 12 rem and never below 80 px.
 * In both modes the side padding is `TOOLBAR_PADDING_X` (12 px; it was 16 px in `full`, D11) and the
 * toolbar holds two groups as direct children, each one row that does not wrap:
 * the main group (name, rename pencil, poll state pill, Pause or Resume, Write...) and the connection
 * group (connection pill, Connection window, Dock to workspace, the menu). When both do not fit on
 * one row the second group goes to a second row, so the rows are 1 or 2 at every width.
 */
export function toolbarLayoutFor(mode: ToolbarLabelMode): ToolbarLayout {
  if (mode === "full") {
    return {
      mode,
      root: `${ROOT} min-h-[60px] gap-x-3 gap-y-1 py-2`,
      group: "flex items-center gap-x-3",
      name: "max-w-64",
      renameWidth: "w-64",
    };
  }
  return {
    mode,
    root: `${ROOT} gap-x-2 gap-y-1 py-1`,
    group: "flex items-center gap-x-2",
    name: "max-w-48",
    renameWidth: "w-48",
  };
}
