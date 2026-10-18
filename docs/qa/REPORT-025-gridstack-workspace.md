# REPORT-025 — GridStack Poll workspace (REQ-008)

Date: 2026-10-18. Scope: REQ/DES/FE/BE/CHK-008. Owner decisions D-008-01/02 replace the floating Poll workspace with GridStack and allow vertical Workspace scrolling.

## Implementation

- Workspace Polls are GridStack widgets. Title drag, southeast resize and keyboard cell steps use the grid engine; PollView and its runtime remain mounted in each widget. Window/toolbar commands offer Reset grid layout instead of workspace Tile/Cascade. Native popped-out windows keep their OS arrangement.
- A schema 4 profile carries optional bounded grid cells on each workspace placement. Schemas 1–3 migrate on load; Rust rejects invalid/future schemas. Grid changes are batched after completed gestures. Existing Poll definitions and Modbus settings are unchanged.
- Minimize removes its widget element as well as the PollView portal; restoring creates the widget again. The Workspace scroll container grows for additional rows while the document stays fixed.

## Verification

- Browser fake-IPC visual/DOM QA: 16 widgets, 8 rows, no cell overlaps; Workspace scrollHeight 3136 versus clientHeight 566 at the tested viewport, document scrollHeight equals clientHeight. Sidebar activation scrolled to the chosen offscreen Poll. Two-widget drag, resize, collision displacement, Reset grid layout and minimize/restore were checked interactively.
- Focused frontend tests cover widget lifecycle, layout serialization, menus, accessibility, sidebar handoff and profile migration. Real Tauri/WebView2 plus TCP simulator Playwright spec: `e2e/tests-integration/28-gridstack.spec.ts`.
- Full validation: see final run result below. A debug executable is built at `target/debug/esefact-desktop.exe` with the frontend embedded. No commit, release package or cache deletion.

## Final run result

- `pnpm check` exit 0: version and bindings checks; desktop and E2E TypeScript; Rust fmt/clippy and frontend Biome; 447 Rust tests passed, 1 ignored; 153 frontend files and 3,457 tests passed.
- Normal embedded-frontend debug build exit 0 after `pnpm check`; SHA256 `985d9f0ddfba165c89d6dc694733b47f31bb0a0cc9b637c95dc3f267cb8f464d` (22,321,152 bytes). The check's Rust compilation temporarily replaced the exe with a dev-server build, so this final normal build was done last.
- Real Tauri/WebView2 + TCP simulator spec 28: 1/1 passed, exit 0. Eight live Polls had no overlap; resizing the OS window changed grid column count and kept all widgets non-overlapping; title drag and southeast resize changed grid cells while polling continued; only Workspace scrolled; backend export contained the changed grid height; schema 4 disk save and reopen restored x and h; Pop out removed its widget and Dock restored it. The fixture stopped its app and simulator after the run.
- Disk guard held: 6.29 GiB available after the final build and QA, above the 3 GiB minimum. The owned fake-IPC Vite server was stopped. No cache was removed.

The targeted real-window run covers eight Polls; the 16-Poll overflow case was checked in browser mode. Mixed-DPI monitors, RTU hardware and long soak remain under the project's broader manual QA matrix.
