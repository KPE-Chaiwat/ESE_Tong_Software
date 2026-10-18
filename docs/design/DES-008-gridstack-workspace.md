# DES-008 — GridStack workspace

Upstream: REQ-008, decisions D-008-01/02. This replaces the free-floating layout clauses of DES-002 for Polls inside W1. Native popped-out windows keep their existing behavior.

## Screen and behavior

- The Workspace is the only vertical scroll region below the toolbar and above Traffic. Widgets form a non-overlapping GridStack grid with 8 px gutters. At least 320 × 180 px per widget where the Workspace is wide enough; a narrow Workspace uses one column.
- A widget keeps the existing title bar and PollView. Drag starts on the title bar only. GridStack's southeast resize grip changes its size; controls and text inside PollView do not start a drag.
- New/restored/docked Polls take the next open grid position. Existing schema 1–3 pixel rectangles are mapped to cells, and GridStack resolves collisions. A profile records cell coordinates and dimensions for stable reopen. A viewport width change reflows widgets; it never overlaps them.
- Sidebar activation scrolls a widget into view. Minimized Polls remain in the minimized bar and have no grid widget. Pop out removes a grid widget, and dock creates one.
- The Window menu offers Reset grid layout in place of Tile/Tile mode/Cascade. The title menu offers grid actions (minimize, expand/restore, pop out, close); free pixel move, snap and swap affordances disappear. Keyboard focus remains visible and arrow keys can move/resize the selected widget by cells.

## State workflow

GridStack owns the current widget nodes and collision resolution. React owns PollView and adds/removes widgets by Poll ID. The workspace store keeps compatibility with the existing Rust `WorkspaceLayout` while a grid placement in schema 4 holds exact cells. Drag/resize updates are sent at the end of the gesture. Programmatic load and responsive reflow do not issue Modbus requests.

## Style

Use existing card/title/bar tokens. The grid resize handle has a dark visible affordance and a larger focus hit area. Status remains icon/text plus color. Vertical scrollbar is confined to Workspace.
