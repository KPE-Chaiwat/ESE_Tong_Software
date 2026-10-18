# CHK-008 — GridStack workspace

Upstream: REQ-008 and DES-008.

- [x] G1: New Polls become non-overlapping widgets; title drag and corner resize move/reflow widgets with no Modbus requests.
- [x] G2: 16 Polls remain usable; Workspace alone scrolls vertically to the last widget.
- [x] G3: Sidebar Show scrolls to and focuses a widget. Minimize/restore, close, duplicate, pop out and dock preserve data and controls.
- [x] G4: Keyboard and Window/title menus expose grid actions with no freeform commands; controls never trigger drag.
- [x] G5: Save/reopen and window width changes preserve a valid grid. Schema 1–3 profiles migrate without Poll loss; invalid/future schema is rejected.
- [x] G6: Browser and real WebView2/simulator checks verify live polling, drag, resize and reload.

Evidence and scope limits: `docs/qa/REPORT-025-gridstack-workspace.md`.
