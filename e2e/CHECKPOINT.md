# QA checkpoint (qa-tester), overwritten after each step

## Round: REPORT-008 TARGETED integration re-run after the REPORT-007 fixes (D6-D9, D3 oracle), started 2026-10-17
Scope: only the six items of the brief (F17/D6, K5+K8b/D7, R8-R11/D8, F8+F16/D9, D3 with os-timer sim, quick regression R7/D4/D10 S=20,100). NOT the whole integration project.
Report text is returned in the final message (to be saved as docs/qa/REPORT-008-targeted-rerun.md). Previous: docs/qa/REPORT-007-integration-after-fixes.md.

### Environment / how to resume
- PATH: `export PATH="$HOME/.corepack-bin:$PATH"`. Run: `cd e2e && ESEFACT_APP_EXE=<exe> ESEFACT_BINARY_LABEL=normal|hooks pnpm exec playwright test --project=integration --workers=1 <file> [-g ...]`
- Binaries (copied out of target/ into `%TEMP%\esefact-it-tools`): `normal\esefact-desktop.exe` (debug, 21,389,312 B, sha256 7cd6ec7d66955ad9), `hooks\esefact-desktop.exe` (debug + dev-hooks), `sim-plain\esefact-sim-slave.exe` (the plain simulator), later `sim-ostimer\...`. The sim path is overridable with ESEFACT_SIM_EXE (added to e2e/integration/sim.ts this round).
- Machine: Windows 11 10.0.26200, one monitor 1920x1080 at 125 %. Input languages installed: ONLY en-US and Thai Kedmanee (0000041E): Cyrillic/AZERTY/Dvorak/German are NOT installed -> R9, R10, R11 German part skipped. Never add or remove languages.
- Disk guard THIS round: STOP and report if free space on C: < 3.5 GB. Free at start 7.2 GB; 7.0 GB after the normal build.
- Not mine: VS Code/codex node runtimes, Teams/SearchHost msedgewebview2, node 6012/14836/33140, node_repl.

### Steps
0 [done] reading, normal debug build (15 s incremental), copied. Hooks build started.
1 [done] new spec `e2e/tests-integration/19-report008.spec.ts` (9 tests: F17 x3, K5/K8b x1, Thai x3, F8/F16 hooks x1, D3 x1); winhelper gained `above` and `backspace`; sim.ts gained ESEFACT_SIM_EXE + framesBetween. Hooks build copied (sha 297cbbaa92222050). Initial foreground input language at the start of the run: 04090409 (en-US), foreground hwnd 66706.
   Run commands: `ESEFACT_APP_EXE=$TEMP/esefact-it-tools/normal/esefact-desktop.exe ESEFACT_BINARY_LABEL=normal pnpm exec playwright test --project=integration --workers=1 tests-integration/19-report008.spec.ts -g "<title part>"`
2 [done] (1) F17/D6 normal exe: native sweep 242 steps (121 widths x heights 640 and 400): 0 failures (gutter 0, scroll==client, PollView==client, status 18.8 / version 16 one line, footer 28, title only when cut: first cut at outer 720, inner 562). FAIL: at 600x400 grid shows 1 complete row (gridH 65 px, toolbar 3 rows), requirement >= 3. Wheel/End reach row 9; popover scrolls to Done; doc checks pass with popover. W1 minimum (outer 1218x797, client 1200x750): pass. Launcher minimum (outer 1018x747, client 1000x700): pass. Evidence: e2e/test-results/evidence/f17-*.png/json.
3 [done] (2) K5/K8b normal exe: with Playwright's focus emulation ON the Filter select focus was 0/10 (artifact: document.hasFocus() is always true under connectOverCDP). With Emulation.setFocusEmulationEnabled(false) on both pages (probe: W1 hasFocus false while W2 is foreground): minimized 5/5 and behind 5/5 for restored, foreground (<= 83 ms), above W2 in z-order, panel, filter "Poll 2", Filter select focused (event arrives 6-13 ms after the click with hasFocus=false; W1 window-focus 7-21 ms later). Native window stays open and live.
4 [done] (3) Thai (041E041E) hardware input, normal exe: W1 (18 checks) and native (14 checks) and text fields (7 checks): all pass EXCEPT Ctrl+\ (key "+" code Backslash under Thai+Ctrl; punctuationKey() returns "+" for an ASCII mark, shortcut-key.ts:62) in W1 and native: D8b. Ctrl+Shift+\ works (key ฅ). Ctrl+P receives key ย code KeyP. Layout restored: foreground hwnd 66706 back to 04090409 after each test. Cyrillic/AZERTY/Dvorak/German not installed -> skipped.
5 [done] (4) F8/F16/D9 hooks exe: 11/11 pass (pop out: button, Ctrl+Shift+O hw with row 3, sidebar menu, title bar menu, status line menu; dock: button, Ctrl+Shift+D hw, status line menu). Button: aria-busy true + aria-disabled true while pending, disabled never set. US control of Ctrl+\ (08 table test) passes.
6 [done] (5) D3 with os-timer sim (sim-ostimer, sha 870e50e49591d626; reply delay median 4.00 ms, min 3.26, max 5.08): 14,080 requests / 60 s; effective 66-72 ms (all 16 lines 70 at the end); mean interval of all requests 4.26 ms; round robin 14,065 windows, 0 missing; max gap of one poll 83 ms; 0 OVERLAP; load 94-96 %; oracle: 16 of 20 reads within 0.5 ms, 4 over (1.11, 1.00, 0.89, 0.56): FAIL as written (integer display + lag); clear: suffix gone 356 ms, load 84 % then, below 90 % and text gone 265 ms.
7 [in progress] regression: R7 (14 spec) then D4 (17 spec) then D10 S=20/100 (13 spec); sim rebuilt without os-timer (plain median 15.65 ms verified).
7a [done] R7 a-g + control + F10/Alt+letter/Alt+Tab + old INT-EXTRA Thai: 11/11 pass (normal exe).

## Round 2 (REPORT-008 targeted re-run, completion) started 2026-10-17
- New build: debug normal, copied to `%TEMP%\esefact-it-tools\normal2\esefact-desktop.exe` (label `normal2`). Disk guard THIS round: STOP < 3.0 GB; free after build 5.3 GB.
- Plan: (1) F17/D10 native min + W1 min toolbar; (2) R8 Thai Ctrl+\ etc; (3) D4 first click; (4) D10 S=20,S=100; (5) R7a + K5/K8b sanity. New spec file e2e/tests-integration/20-report008b.spec.ts.
- Steps done: 0 (build+copy).
- Run env: `export ESEFACT_APP_EXE=$TEMP/esefact-it-tools/normal2/esefact-desktop.exe ESEFACT_BINARY_LABEL=normal2 ESEFACT_SIM_EXE=$TEMP/esefact-it-tools/sim-plain/esefact-sim-slave.exe`; spec tests-integration/20-report008b.spec.ts (helpers integration/f17b.ts); logs in $TEMP/run-*.log. NEVER run python3 heredocs (hang).
- 1a [done] real drag to native min: outer 600x400, client 582x353 px (466x283 css), toolbar 2 rows 76.8 px (offsetTops 4/40, groups 4-36, 40-72), icon-only OK (aria/title exact), pills icon+text, grid 108.8 px, header 24, hscroll 15, clientH 92 -> 2 complete rows (3rd partly under scrollbar; needs 111 px, short 2.2), wheel/End reach row 9, popover doc checks ok, focus order same, ring ok. PASS (>=2). Evidence test-results/evidence/d10-native-min-real-drag.*
- 1b [done] sweep SetWindowPos 266 steps (21 failures, ALL the label-mode mismatch): doc checks all pass; toolbar rows max 2; grid complete rows min 2 at H=400 (690x400 -> 2; 900x400 -> 3), 10 at H=640.
- 1c/1d [done] DEFECT D11 (frontend): toolbar label mode flip-flops EVERY FRAME (166 mode changes in 2 s; toolbar height 84.8 <-> 40.8) when the window rests at a client width of 664-671.9 css px (outer 848-856 physical at 125%). Cause (read in code): useElementWidth ResizeObserver uses entry.contentRect.width (content box, excludes padding) but the padding differs per mode (full px-4=32, icon px-3=24), so in the band 664..672 full says "icon" and icon says "full" forever. Evidence d10-threshold-scan.json, d10-band.json. Threshold otherwise is content width, not 640 clientWidth.
- Next: 1e drag across 640 test (expected to hit the band), 1f W1 minimum, then Thai, D4, D10 S=20/100, R7a, K5.
- 1e [done] real drag across 640: 11 mode flips per crossing in the 664-672 css band, height 84.8<->40.8 each frame; idle after drag: 0 events (no loop outside the band). FAIL (same defect D11).
- 1f [done] W1 min real drag (outer 1218x797, client 1200x750 = 960x600 css): Standard 8, connected, P1 maximized, traffic collapsed: toolbar 1 row 56 px (fixed h-14); FAIL: "Disconnect" right edge 962 > window 960 (2 px cut, toolbar scrollOver 2); children sum 900 + 6x8 gaps 948 vs content 932 (padding 14) -> 16 px over; no overlaps; no clipping from outer 1230 (970 css). P1 grid 363 px, all 10 rows complete. Evidence d10-w1-minimum.png/json, d10-w1-widths.json. NOTE profile label appears >=1100 css; my "rows 2" at >=1410 outer is an artifact of the profile text span offsetTop (toolbar is fixed h-14, no wrap).
- Next: Thai (new sidebar test + 19 (3) tests), D4, D10 S=20/100, R7a, K5.
- 2 [done] R8 Thai on normal2: sidebar test (US control + Thai: Ctrl+\ collapse/expand, Ctrl+Shift+\ compact on/off, grid Ctrl+\ setup) 12/12 pass; Thai Ctrl+\ = key "+" code Backslash, Ctrl+Shift+\ = "ฅ"/Backslash (US: "\" and "|"/Backslash); 19 (3) tests W1 18/18, native 14/14, text 7/7 pass. Foreground layout restored to 04090409.
- Next: D4 (17 spec), D10 S=20/100 (13 spec), R7a/d + control (14), K5 (19 (2), K5_RUNS=3), cleanup.
- 3 [done] D4 normal2: 5/5 pass, exactly 1 click event each (Apply scale, Apply poll, Save as, override Save, Write Send)
- 4 [done] D10 S=20: mean 20.09 min 18 max 23 (2998 intervals, SR 20 ms no suffix); S=100: mean 100.18 min 98 max 103 (599). pass
- 5a [done] R7 a, d, control pass on normal2.
- 5b [done] K5/K8b 3 runs minimized 3/3 + behind 3/3 (focus emulation off, hasFocus probe ok).
- 1b' sweep re-run: 266 steps, 20 failures, ALL label-mode mismatch at 817-840 outer (the 21st failure of run 1 was a band-flicker artifact at 850). All doc checks 0 failures. ALL STEPS DONE; remaining: cleanup + final report.
- CLEANUP done: nothing of mine running; ports 1420/5020/5021 free; %TEMP%\esefact-it-tools deleted (rebuild needed for any new run: tauri build --debug --no-bundle, plain sim from target/debug or cargo build -p dev-sim-slave). Free disk 5.2 GB.

## Round 3 (REPORT-009 micro-run: verify D11 + D12), 2026-10-18
- Build: normal debug (20 s), copied to `%TEMP%\esefact-it-tools\normal3` (label normal3) + plain sim. Disk free 5.7 GB throughout (guard 3.0).
- New spec `tests-integration/21-report009.spec.ts` (D12 W1 min + widths 1218..1518 outer). D11 reused 20-report008b.spec.ts (threshold scan, band, drag across 640, real drag to native min, sweep).
- Results: D11 PASS (band 0 mode changes at outer 840-860, drag 1 transition per crossing, idle 0, threshold 816/817 = 639.2/640 css, sweep 266 steps 0 failures, native min 2 complete rows, rows 2). D12 PASS (Disconnect right 948 <= 960, h 56, no clipping 960..1200 css, profile label from 1100 css). R7a pass, Thai Ctrl+\ (W1 sidebar/grid + native) pass.
- Run commands: same as round 2 with ESEFACT_APP_EXE=...normal3...; logs $TEMP/run-d11.log, run-f17.log, run-d12.log.
- CLEANUP done: no esefact processes, ports 1420/5020/5021 free, %TEMP%\esefact-it-tools deleted. ALL DONE.
