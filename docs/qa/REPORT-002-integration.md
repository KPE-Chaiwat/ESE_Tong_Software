# REPORT-002 Integration mode (real Tauri app on WebView2 + Modbus TCP simulator), final

Author: qa-tester (text saved by the PM because the subagent cannot write files; replaces the earlier partial report). Checklist: `docs/qa/CHK-001-modbus-master.md` (rev 4). Design: DES-001 (rev 4). Contract: BE-001 "Final contract". Date: 2026-10-16.
All numbers are QA's own report; the PM did not re-run the suites.

## 1. Result at a glance
| Project | Tests | Result |
|---|---|---|
| `integration` (real app, WebView2, simulator) | 66 | 3 consecutive full runs on identical test files, each **65 pass / 0 fail / 1 skipped** (13.1, 13.1, 12.9 min) |
| `ui` (browser + fake IPC) | 234 | **218 pass / 0 fail / 16 skipped** (204 earlier + 14 new rev 4 tests), 1.8 min |
| `perf` | 2 | 2 pass (0 long tasks over 50 ms, Pause 10 ms), 29 s |

- The skipped integration test is the old-wording CHK-N7, marked obsolete. No open product defects from this round. The earlier "unexplained flake" of CHK-P1 is explained: test timing (section 4).

## 2. Setup
- App build: `pnpm --filter @esefact/desktop tauri build --debug --no-bundle` (about 53 s incremental) -> `target/debug/esefact-desktop.exe` with the frontend embedded (loaded from `http://tauri.localhost`, as in production; no Vite server; deterministic).
- Simulator: `target/debug/esefact-sim-slave.exe`, one per test, `--listen 127.0.0.1:0 --control 127.0.0.1:0 --no-stdin`; ports from the READY line; loopback only.
- Driver `e2e/integration/`: app started with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<free port>`, temp `WEBVIEW2_USER_DATA_FOLDER` and temp `ESEFACT_DATA_DIR`; Playwright attaches with `connectOverCDP`. `win.ps1` (DPI-aware Win32) lists native windows (title, rectangle), posts WM_CLOSE (a real close request) and moves windows. The simulator is controlled over its control port and its stdout log is parsed (frames, `NO-REPLY`, `CLOSE`). `Get-NetTCPConnection` shows whether the app's socket to the simulator is established.
- Playwright: separate `integration` project (no Vite web server when only it runs); `ui` and `perf` unchanged. Scripts: `pnpm --filter @esefact/e2e test:integration`, `test`, `test:perf`. Specs in `e2e/tests-integration/`: `01-smoke`, `02-poll-write`, `03-faults`, `04-windows`, `05-soak`, `06-states`, `07-rev4`.
- Evidence: each test attaches `simulator.log` and `app-stdout.log` (with `[qa]` navigation lines); S1/S2/S3 numbers go to the console and JSON attachments; checkpoint of every run in `e2e/CHECKPOINT.md`.
- Rules kept: loopback only; no serial hardware, DNS or blackhole address; every process, WebView2 profile and temp dir started by a test is stopped and deleted by the fixtures; no product code or docs edited; no commit.

## 3. Stability series (identical test files)
| Run | Pass | Fail | Skipped | Time |
|---|---|---|---|---|
| 1 | 65 | 0 | 1 | 13.1 min |
| 2 | 65 | 0 | 1 | 13.1 min |
| 3 | 65 | 0 | 1 | 12.9 min |

The series needed several rounds because earlier full runs exposed test races, each fixed in the test files only:
1. CHK-P1 flake: section 4.
2. CHK-O6/O7/O9: failed in every full run and 2 of 5 alone: Esc during the inline-rename commit only cancels the rename; fixed with `closeOpenDialog` and waiting for the profile file on disk (15/15 alone afterwards).
3. CHK-F late reply: with a 100 ms delay the late reply sometimes landed in the idle gap, giving the other note ("Unexpected bytes while no request was pending (discarded)"); 100 ms failed 1 of 20, 95 ms is 0 of 20. Both notes are valid per BE-001.
4. CHK-N2: the last reply of the poll in flight at Pause could move the ring by one frame between two reads (span 4998); the test now reads newest, oldest, newest until consistent.
5. CHK-H (garbage): the test read the pill while the first cycle was still Polling; now waits for the outcome (15/15 "Bad response").
6. CHK-N7 worked example: counters read after they settle (Errors lagged by one counter update).

## 4. CHK-P1 flake diagnosis: test timing, not an app defect
- Symptom: `Execution context was destroyed, most likely because of a navigation` on the launcher page, 2 of 20 repeats of the Open test alone.
- Evidence: when Playwright attaches over CDP the page is still `about:blank`; WebView2 then navigates to `http://tauri.localhost/` 25-110 ms later, destroying the execution context. A probe that picked the page at once and evaluated failed 7 of 40 launches, 3-32 ms after the pick. The app navigates only once at startup; the native window list never changed during the failures (launcher at 96,96, 1393x947).
- Fix: `Desktop.launcherPage()` waits for a non-blank URL, the `load` state and the "ESEfact" heading. After the fix: 30/30 repeats pass, no recurrence in later full runs. The native offset of 24 logical px (30 physical at 125%) is stable.

## 5. Per-item results (integration)
"UI side only" items are covered in REPORT-001.
- **Smoke and P1: pass.** Launcher shows the Modbus Master card; Open and Ctrl+N create real second windows, idle and Untitled, offset by exactly 24 logical px; native titles are real (`Modbus Master - Untitled * - Connected`).
- **D1-D8, D12, D13, E1-E4, J10: pass.** Real connect and auto start, register map, formats and base, FC01/02/04, Apply, pause/resume, writes while paused, address 65535 sent as `FF FF`.
- **D9: pass.** 900-1150 ms gaps at a 1000 ms scan; each reply has its request's transaction id.
- **D10, M12: pass.** Traffic panel equals the simulator log frame for frame; panel times within 150 ms of the simulator epoch; counters equal frame counts; FC06/FC16 wire bytes match exactly.
- **M1-M5, M13, M15, M16: pass.** Writes FC05/06/15/16 read back with simulator `get`; unit 0 on TCP is a normal unit (no warning, echo with the same transaction id, 5 repeats at 100 ms); unit 0 answered with exception 02 never shows "Broadcast sent".
- **M6, M7, M17, M18: pass.** M17 link lost during a write, [Reconnect] in the dialog, Esc then Ctrl+L, device value applied; M17 path 1b (`Reconnect failed: Connection refused ...`) with Timeout 3000 ms; M18 a queued write at link drop gives "Not connected", no TX, device unchanged.
- **F1-F6, G1-G6, H1-H5, H7, H8: pass.** Drop, delay, exceptions 02 and 0C, wrong unit/function/transaction id, truncate to 20 (`short frame (20 of 29 bytes)`), consistent-length bad byte count (`malformed frame`, not `short frame`), garbage `DE AD BE EF` gives "Bad response" 15/15.
- **I1, I4-I6, I10: pass.** `stop`, `resume`, `refuse on` (established connections keep working), Reconnect, Dismiss, fields editable again; I1 with Timeout 3000 ms: `Connection refused by 127.0.0.1:<port>.`
- **I11 (rev 4): pass.** Timeout 300 ms against a refused loopback port: "No answer from 127.0.0.1:<port> within 300 ms." in all attempts (3 in each of 3 runs, 300-330 ms); "Connection refused" never appeared at 300 ms on this machine; the app does not hang; Reconnect again gives the same text in about 10 ms.
- **C1-C4, E3, K2, N6, L1: pass.** Without auto start: Connected with no request; Disconnect closes the socket (OS TCP table 0, simulator `conn=1 CLOSE`); Apply while paused sends nothing and Resume sends the new address.
- **N7 (rewritten, rev 4): pass.** Worked example on the real backend (5 normal + 3 dropped + 3 exception 02 + 2 wrong unit + 2 truncated = 15 requests, scan 1000 ms, timeout 300 ms): Requests 15, Responses 8, Errors 7, Timeouts 3; 12 RX rows, 15 TX rows, no "(discarded)" rows. The BE-001-wording test also passes; the old-wording test is skipped as obsolete.
- **J29 (rev 4): pass.** On the device `0000 0100 1101 0010` writes four registers 0, 4, 13, 2 (dialog shows `Values (4)` and `Writes addresses 10-13.`); `0000010011010010` writes 1234. Rejects and FC06 nibble spaces are in the ui project (pass).
- **N8 (rev 4): pass.** With the clipboard refused (also in WebView2), the three copy paths show "Could not copy to the clipboard." with error tone and circle-x and never a "Copied ..." toast.
- **P4, J28 (real WM_CLOSE): pass.** Unsaved changes ask `Save changes?`; Cancel keeps the window; Don't save closes; an invalid field blocks Save with the toast and the window stays; a clean polling window closes at once and the simulator logs `conn=1 CLOSE` (OS shows 0 connections).
- **P2, P3: pass.** Two windows with two simulators are independent; stopping one simulator disconnects only its window; two windows to one simulator give 2 connections, Disconnect in one leaves 1.
- **P5: pass.** A natively moved and resized tool window returns at the same rectangle after a graceful exit and restart (plugin file `%APPDATA%\com.esefact.desktop\.window-state.json`, removed by the test, skipped if it already exists).
- **O3, O6-O10: pass.** Profile is a file under `ESEFACT_DATA_DIR`, survives restart; `schemaVersion` 99 flagged "Cannot be opened (newer or damaged file)"; rename, delete, recreate across two windows work.
- **S3 on WebView2 (separate from the browser smoke): pass.** 125 registers at 100 ms, 120 ticks, table and traffic list scrolled: 0 long tasks over 50 ms (observer calibrated with a 90 ms task); Pause 6-7 ms.
- **S2: pass.** Two windows at 100 ms, 300 ticks each, 0 long tasks, Pause 6-12 ms.
- **N2: pass.** After more than 6,400 frames the list holds exactly 5,000 (newest `#` minus oldest = 4999); counters keep counting.
- **S1 soak (2 minutes, not 10): partial.** Responsive, 0 long tasks over 50 ms, Pause 7-9 ms, working set flat (-1.6% to +0.4% between 30 s and 130 s). JS heap +16.8% to +17.8% between 30 s and 130 s while the 5,000-frame ring was still filling (about 660-2,400 frames), so that number is not a leak signal. Beyond the cap (20 ms scan, 6,000-14,000 frames): heap +0.9% to +1.4%, working set +0.2% to +0.8%, within the 10% criterion. The 10-minute run was not done.

## 6. Still skipped, with reasons
- Serial hardware (RTU): D11, M8 (RTU broadcast), H6, I7-I9 real behavior.
- Slow connect (needs a non-loopback host): B1-B3 (cancel during connecting), I3 (connect timeout to a blackhole).
- DNS (would leave loopback): I2. NVDA (manual): R4.
- 10-minute soak: S1 at 10 minutes.
- Obsolete, not a gap: the old-wording CHK-N7 test.

## 7. Notes for the owners (no open defects)
- Windows refused-connect timing: a refused loopback connect is reported by the OS after about 1 s, so with a short timeout the banner says "No answer ..." instead of "Connection refused ..."; DES rev 4 allows either text for CHK-I11.
- Traffic `#` of the oldest of 5,000 frames equals newest minus 4999, as the checklist expects.

## 8. Housekeeping
- The window-state plugin writes outside the temp data dir (`%APPDATA%\com.esefact.desktop`); the P5 test removes it. The app also creates an empty `%LOCALAPPDATA%\com.esefact.desktop`; QA removed it at the end (harmless if it reappears).
- After the last run nothing of QA's was left running: no esefact-desktop, esefact-sim-slave, test WebView2, Playwright run; ports 1420/5020/5021 free; no `esefact-it-*` temp dirs. A VS Code Playwright `test-server` node process (PID 25184) is not QA's and was left alone.
