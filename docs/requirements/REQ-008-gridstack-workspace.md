# REQ-008 — GridStack Poll workspace

Owner decisions D-008-01/02, 2026-10-18. This requirement supersedes the floating sub-window layout portions of REQ-002/DES-002 for Polls inside the Modbus Master workspace. It does not change Modbus traffic, Poll definitions, the sidebar selection model or native popped-out windows.

## Goal

Use GridStack as the sole drag, resize and collision layout engine for Polls inside the connection window. Every visible workspace Poll is a widget on a non-overlapping grid. A Poll can be moved and resized from its title/handles; displaced widgets reflow. The Workspace scrolls vertically when needed.

## Acceptance

1. GridStack owns widget placement and pointer drag/resize. Existing custom pointer move/resize, edge snap, swap targets and tile-slot overlays are not active in the workspace. Controls inside a Poll remain clickable, selectable and keyboard accessible without initiating a drag.
2. Creating, showing, minimizing, restoring, closing, deleting, duplicating, popping out and docking Polls update grid widgets without losing their Poll data, setup draft or focus route. Sidebar click scrolls the chosen widget into view. A native popped-out Poll stays governed by the native window layout.
3. Widgets never overlap and remain at least 320 × 180 logical px where the available width permits. If they cannot all fit, the Workspace scrolls vertically. W1/document chrome does not scroll.
4. Window commands and keyboard equivalents make sense for a grid. No visible command advertises Cascade, free pixel Move, edge Snap or arbitrary z-order for workspace Polls. Tile/Reset layout produces a predictable packed grid. Minimize, restore, maximize/full-size and native Arrange remain available where applicable.
5. Profiles save widget positions/sizes and restore them across restart and window resize. Schema 1–3 profiles load and migrate to the grid without deleting Poll definitions or changing Modbus settings; future/invalid schema remains rejected atomically. Layout changes do not mark a profile Modified, following existing behavior.
6. No Modbus wire request is sent for widget layout changes. Grid changes are reported to Rust only after a completed action, not on every pointer move. Existing Poll rendering remains responsive at 16 Polls.
7. Browser and real Tauri/WebView2 QA cover drag, resize, collision, overflow scroll, persistence/migration, keyboard focus, pop-out/dock and live polling.

## Boundaries

- The commercial Modbus Poll application is only a behavior reference; no code or proprietary asset is copied.
- GridStack is a frontend dependency; no new product tool or Rust crate is introduced.
