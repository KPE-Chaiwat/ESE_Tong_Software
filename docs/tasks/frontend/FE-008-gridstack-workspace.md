# FE-008 — GridStack workspace

Upstream: REQ-008 and DES-008.

1. Render every visible W1 Poll as a GridStack widget, preserve PollView runtime, setup drafts, title actions, sidebar focus and native pop-out/dock.
2. Remove legacy freeform pointer handling, overlays and incompatible menu/keyboard affordances from the active Workspace path.
3. Convert existing saved pixel rectangles to initial grid cells; serialize changed cells, restore across reload and responsive resize.
4. Keep only Workspace vertically scrollable. Test collision, overflow, focus, action lifecycle and 16 widgets.
