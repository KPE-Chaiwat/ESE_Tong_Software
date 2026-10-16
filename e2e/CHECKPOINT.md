# QA checkpoint (qa-tester), overwritten after each step

## Step 1 CHK-P1 flake: DONE (test timing, not an app defect)
- Failure: `launcher.evaluate` -> "Execution context was destroyed, most likely because of a navigation", 2 of 20 repeats of the P1 test alone.
- Cause: Playwright attaches over CDP while WebView2 still shows `about:blank` and then navigates to `http://tauri.localhost/`. A probe that picks the page immediately and evaluates failed 7 of 40 launches (+3 to +32 ms after the pick). Pages present at attach: `about:blank`.
- Fix (harness): `Desktop.launcherPage()` now waits for a non-blank URL, `load` and the "ESEfact" heading. After the fix: 30/30 repeats of the P1 test pass, plus all later full runs.
- Diagnostics kept: `[qa] framenavigated/domcontentloaded` lines in the app-stdout.log attachment and a p1-timeline attachment (native window list with timestamps).

## Step 2 D12 / E3: DONE (both pass in every full run since)

## Step 3 stability (integration, per run)
- Earlier batch A (before two more test-timing fixes): run1 64 pass / 1 fail / 1 skip, run2 same, run3 same. The one failure each time: CHK-O6/O7/O9 (test race: Esc during the inline-rename commit only cancels the rename; fixed with `closeOpenDialog` + waiting for the file on disk). Alone: 15/15 after the fix (was 2 of 5 failing).
- Batch B (after that fix): run1 64 pass / 1 fail (CHK-F late reply, delay 100 ms sits at the window edge: 1 of 20 alone; fixed with a 95 ms delay, 20/20 and 0 of 20 failures) / 1 skip; run2 65 pass / 0 fail / 1 skip; run3 65 pass / 0 fail / 1 skip.
- ui: 218 pass / 0 fail / 16 skipped (204 earlier + 14 new rev 4 tests). perf: 2 pass.
- STILL TO DO: three consecutive full integration runs with the final test state (files `scratchpad/fin4_int{1,2,3}`), recorded below.

## Step 4 rev 4 items: DONE and passing
- ui (`tests/rev4.spec.ts`, 14 tests): CHK-N7 worked example (15 / 8 / 7 / 3, 12 RX rows, no discarded), CHK-I1 (timeout 3000), CHK-I11 both texts, CHK-J29 (4 values 0,4,13,2; 1234; three rejects; FC06 nibble spaces), CHK-N8 (3 paths + control; toast 3.5-5 s, error tone, circle-x, no "Copied").
- integration (`tests-integration/07-rev4.spec.ts`): N7 worked example on the real backend (15 requests, Requests 15 / Responses 8 / Errors 7 / Timeouts 3, 27 rows, 12 RX, no discarded; needs polling of the settled counters), I11 (3 attempts: always "No answer from 127.0.0.1:<port> within 300 ms."), J29 on the device (holding 10..13 = 0,4,13,2 then 1234), N8 in WebView2.
- Old-wording N7 test: skipped as obsolete in 03-faults.spec.ts; the BE-001-wording test stays.

## Cleanup state
- Machine verified clean before this checkpoint (no esefact-desktop / sim / test WebView2 / playwright run; ports free; no esefact-it-* temp dirs). A VS Code Playwright `test-server` node process (PID 25184, not mine) exists and was left alone.

## Step 3 final (state after the CHK-N2 consistency fix)
- int run 1: 65 pass / 0 fail / 1 skip (12.8 min)
- int run 2: 65 pass / 0 fail / 1 skip (12.8 min)
- int run 3: 64 pass / 1 fail / 1 skip: CHK-H (garbage) read the pill while the first cycle was still "Polling" (test race, fixed by polling for the outcome; 15/15 alone, always "Bad response"). Counting restarts: runs 1-2 above do not count as "three consecutive" with the final test files.
- FINAL series (files unchanged from here): run 1: 65 pass / 0 fail / 1 skip (13.1 min)
- FINAL series run 2: 65 pass / 0 fail / 1 skip (13.1 min)
- FINAL series run 3: 65 pass / 0 fail / 1 skip (12.9 min). Series complete.
- ui final: 218 pass / 0 fail / 16 skipped (1.8 min)
- perf final: 2 pass (29 s)

## Final cleanup verification (after the last run)
- esefact-desktop / esefact-sim-slave: 0; playwright runners (excluding the VS Code test-server): 0; test WebView2 (esefact-it-wv2): 0; ports 1420/5020/5021: free; esefact-it-* temp dirs: 0; %APPDATA%\com.esefact.desktop: absent; the empty %LOCALAPPDATA%\com.esefact.desktop folder created by the app was removed.
