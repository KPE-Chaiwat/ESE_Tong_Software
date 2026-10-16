# REPORT-001 UI mode (browser + Vite + fake IPC), revision 2

Author: qa-tester (text saved by the PM because the subagent cannot write files). Checklist: `docs/qa/CHK-001-modbus-master.md` (rev 3). Design: `docs/design/DES-001-modbus-master.md` (rev 3). Date: 2026-10-16.
**Scope: UI mode only.** Integration mode (real Tauri app on WebView2, simulated slave, fault proxy, wire capture) is not attempted; section 6 lists what still needs it.

History: revision 1 had 8 failing tests (F-1 single-item write text, F-2 modal focus return, F-3 Reconnect behind the modal). The frontend fixed them in round 3 and added the test hooks. Revision 2 re-ran everything against the revised CHK-M11, M17 and S3 using the new hooks.

## 1. Result at a glance
| | Revision 1 | Revision 2 |
|---|---|---|
| `ui` tests | 209: 184 pass, 8 fail, 17 skipped | **220: 204 pass, 0 fail, 16 skipped** |
| `perf` tests | 2 pass | 2 pass |
| Checklist items (156) | 54 P, 81 U, 5 partial, 4 fail, 12 skipped | **55 P, 85 U, 5 partial, 0 fail, 11 skipped** |

Stability: 3 consecutive full `ui` runs identical (204/0/16); `perf` 3 of 3. No retries, no fixed sleeps, no console warnings/errors or uncaught page exceptions.
"U / pass (UI side)" means the fake IPC emitted the backend events the checklist describes and the test verified what the UI shows and which commands it sends. It does not prove the Rust backend produces them.

## 2. Environment
- Windows 11 Home 10.0.26200; Node v22.19.0; pnpm 10.34.6 (Corepack shims from `$HOME\.corepack-bin`).
- `@playwright/test` 1.64.1, headless Chromium (Chrome Headless Shell 156.0.8078.4). **A desktop browser, not WebView2.**
- App: `pnpm --filter @esefact/desktop dev:web` (Vite, port 1420) started by Playwright with `VITE_FAKE_IPC=manual` (fake without simulation); the dev server is never reused.
- Hooks used: `window.__ESEFACT_FAKE_IPC__` (`emit*`, `hold`, `failNext`, `setResult`, `seedProfiles`, `setSimulate`), `window.__ESEFACT_FAKE_WINDOW_IPC__` (`requestClose`, `openedTools`, `titles`, `openError`), `data-testid="traffic-counter-{requests|responses|errors|timeouts}"`, `data-status="live|stale|loading"` on the data grid, `data-session-state` on the window root, ids `data-row-{n}` and `frame-{seq}`, `data-slot`, `data-icon`, `data-variant`, `data-tone`.
- Viewport 1280x800 (960x600 for CHK-Q7), clipboard permissions granted, 4 workers (`perf`: 1 worker, run separately). Texts are asserted from DES-001/CHK-001 rev 3, not from the code.
- Fixtures (`e2e/support/app.ts`): `app` = manual mode (test emits backend events along valid DES 2.2 transitions; Connect press and form are real); `simApp` = `setSimulate(true)` (CHK-D1, CHK-M13, perf smoke). The close request is started without awaiting (a `Save changes?` confirm waits for an answer) and the outcome is read as pending/closed/kept.

Run (repo root, Corepack shims on PATH):
```
pnpm --filter @esefact/e2e install:browsers      # once
pnpm e2e                                          # ui project, about 2.4 min
pnpm --filter @esefact/e2e test:perf              # perf project, one worker
```
HTML report `e2e/playwright-report/index.html`; failure artifacts `e2e/test-results/ui/<test>/`. Specs in `e2e/tests/*.spec.ts`; titles start with the checklist id; extra prefixes `CHK-STATE`, `CHK-R (DES 7)`, `CHK-L (DES 2.4)`, `CHK-I (ioError)`.

## 3. State-by-state coverage (all 9 session states pass)
`states-matrix.spec.ts`: one test per state checking pill (icon+label), `data-session-state`, banner, toolbar actions, setup panel, data view and grid `data-status`, with a grayscale screenshot. CHK-R2 walks all nine states: 9 distinct icons, 9 distinct labels, document title and native title equal `Modbus Master - Untitled[ *] - {pill label}`.

| State | Pill | Banner | Toolbar actions | Grid status |
|---|---|---|---|---|
| idle | plug "Not connected" | none | Connect | (no grid) |
| connecting | loader "Connecting…" | neutral, Cancel | Cancel | (no grid) |
| connected | link "Connected" | none | Disconnect, Start polling, Write… | (no grid) |
| polling | activity "Polling" | none | Disconnect, Pause, Write… | loading, then live |
| paused | pause "Paused" | none | Disconnect, Resume, Write… | stale |
| timeout | timer-off "Timeout" | warning | Disconnect, Pause, Write… | stale |
| exception | octagon-x "Exception 02" | error, no Reconnect | Disconnect, Pause, Write… | stale |
| badResponse | triangle-alert "Bad response" | warning | Disconnect, Pause, Write… | stale |
| disconnected | unplug "Disconnected" | error, Reconnect + Dismiss | Reconnect | stale |

## 4. Failures
None. Revision 1 findings, all verified fixed by tests that failed before: F-1 (CHK-M1, M3, M15), F-2 (CHK-M11 and `CHK-R (DES 7)` for Write, Open profile, Save as), F-3 (resolved by design rev 3: [Reconnect] in the Write dialog result area; CHK-M17 paths 1, 1b, 2 pass).

## 5. Per-item results
Legend: P pass, U pass (UI side), PART partial, SKIP skipped (section 6). "rev 1" = change vs the previous report.
- **A:** A1-A4 P (A1 also checks the native title); A5 U. **B:** B1-B3 U; B4 P. **C:** C1-C4 U.
- **D:** D1-D8, D12, D13 U; D9 SKIP (backend scan scheduling); D10 SKIP (capture); D11 SKIP (serial device + sniffer).
- **E:** E1-E4 U (E1/E2 use `data-status`). **F:** F1-F6 U. **G:** G1-G5 U; G6 P. **H:** H1-H3 U; H4 P; H5-H8 U.
- **I:** I1, I3-I6 U; I2 P; I7-I9 U (banner text only); I10 P.
- **J:** J1-J9, J11-J16, J21-J27 P; J10, J17-J20 U; **J28 P** (rev 1: partial; close path via `requestClose`: `Save changes?` -> Save blocked -> toast, first invalid field focused, window kept, nothing saved).
- **K:** K1, K3, K4, K5 P; K2 U. **L:** L1, L4 U; L2, L3, L5 P.
- **M:** **M1, M3 U** (rev 1: fail); M2, M4-M7, M9, M10, M13, M14, M16, M18 U (M8 PART: wire bytes SKIP; M18 also asserts `Not connected` has no [Reconnect]); **M11 U** (rev 1: fail; Enter on row 3 -> Esc returns focus to the grid with `aria-activedescendant="data-row-3"`; from toolbar Write… focus returns to that button); M12 SKIP; **M15 PART** (rev 1: fail; UI side passes, wire bytes SKIP); **M17 U** (rev 1: partial; four tests: link-lost text/icon/[Reconnect], Ctrl+L sends no `mm_connect`; path 1 reconnect with aria-disabled spinner, then Send enabled and focused; path 1b `Reconnect failed: Connection refused by 127.0.0.1:5020.`; path 2 Esc then Ctrl+L).
- **N:** N1-N6 U; N7 SKIP. **O:** O1-O4 U; O5-O7, O9, O10 P; O8 SKIP.
- **P:** **P1 PART** (rev 1: skipped; Ctrl+N pushes `modbus-master` to `openedTools`, nothing while a modal is open, failing open shows `Could not open a new window: {message}`; 24 px offset and new-window idle/Untitled SKIP); P2, P3, P5 SKIP; **P4 PART** (close path now covered: `Save changes?` with Save focused, Cancel keeps window, Don't save closes, Save on named profile saves and closes, clean window closes at once; socket close at the simulator SKIP).
- **Q:** Q1, Q3, Q8, Q9 U; Q2, Q4-Q7 P. **R:** R1, R2, R3, R5, R6 P; R4 SKIP (NVDA manual).
- **S:** S1 PART (12 s smoke passes; 10-minute run and memory SKIP); S2 SKIP; **S3 P** (0 long tasks over 50 ms, observer calibrated with a 90 ms task, 125 registers at 100 ms with table and traffic list scrolled; browser smoke only, WebView2 pending).

## 6. Still needing integration mode
- Wire bytes: D10, D11, M12, byte parts of M8 and M15, `FF FF` of J10.
- Backend scheduling and counters: D9, N7.
- Real windows and sockets: P1 (offset, new window state), P2, P3, P5, S2, P4 (socket close at the simulator).
- Persistence O8; soak and memory S1; screen reader R4 (manual NVDA); the CHK-S3 WebView2 run.
- Verified on the UI side only (backend behavior behind them needs a real run): every [SIM]/[FAULT]/[RTU] item marked U: connect-failure reasons, all poll results and every bad-response kind, write results (RTU-only `broadcastSent`, TCP unit 0, `linkLost`, `notConnected`), counter semantics, the 5,000-frame ring as the backend feeds it, the real device effect of writes, and for CHK-M17 the real reconnect (`mm_connect` success/failure, T2 auto start).
- The fake window IPC models only the close decision, the open-tool call and the titles sent; it cannot show that a native window really closes, appears at an offset or shows the title, or that the socket closes.
- Performance smoke: 120 ticks, 0 long tasks over 50 ms in 3 of 3 runs; Pause reached the Paused pill in 13-36 ms. Says nothing about WebView2 or a real Rust channel. `performance.memory` is quantized in this Chromium, so no memory claim.

## 7. Requests for the frontend
None open. Please keep hook names and the ids `data-row-{n}` and `frame-{seq}` stable.

## 8. Questions for the designer
Resolved by design rev 3. One remains: the CHK-S3 WebView2 result needs integration mode.

## 9. Test engineering notes
- Rev 1 flakiness fixed in tests only (outline color mid-transition, Windows CRLF in clipboard, role locators blind behind a modal, traffic rows one animation frame late, toast expiry in save-path tests, Tab start point). Rev 2: no new flakiness.
- `ModbusApp.script()` runs test code inside the page with `eval`; works because the dev server sends no CSP.
- `reuseExistingServer: false`: a server started without `VITE_FAKE_IPC=manual` would run the app against Tauri, one started with `1` would simulate.
