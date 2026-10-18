# REPORT-009: verification of D11 and D12 (real window, integration mode)

Author: qa-tester (text saved by the PM). Date: 2026-10-18.
**Verdict: D11 and D12 are fixed. 9 of 9 items pass, no regression in the sanity checks, no new defects.**

## Environment
- Windows 11 10.0.26200, one 1920x1080 monitor at 125 %, WebView2 over CDP (Playwright `connectOverCDP`).
- Normal debug build (`pnpm --filter @esefact/desktop tauri build --debug --no-bundle`), exe copy labelled `normal3`; plain `esefact-sim-slave.exe`.
- No dev-hooks build, no `cargo clean`, no per-package cargo. Free disk stayed at 5.7 GB (guard 3.0 GB). No product code changed.
- Input languages: only en-US and Thai Kedmanee installed; none added or removed; foreground layout restored to en-US.

## D11: toolbar label-mode flip-flop - PASS
| Item | Result |
|---|---|
| Threshold scan, 1 px steps, narrowing then widening (outer 880 to 800) | Pass. One switch each way: icon at outer 816 (639.2 css), full at outer 817 (640 css). Border-box width 640 css; labels shown across 640-663 css. |
| Resting window 2 s each at outer 840, 846, 848, 850, 852, 854, 856, 858, 860 (657.6-673.6 css) | Pass. 0 mode changes and 0 layout changes at every width (before the fix: 166 mode changes in 2 s, toolbar height 84.8 <-> 40.8). |
| Real slow drag across 640 css (SendInput, 120 steps x 20 ms, narrow and widen, 2 repetitions) | Pass. Exactly 1 mode transition per crossing in all 4 crossings. |
| Height during the drag | Stepwise with width (84.8, 40.8, 76.8 and back), one reversal per crossing, no oscillation. |
| Drag extras | 0 frames with a document scrollbar. 1 frame per crossing shows the old mode for the new width (about 12 ms render lag), not a flip. Idle after drags: 0 layout and mode changes in 2 s. |
| F17 doc checks, real drag to native minimum (outer 600x400, client 582x353 px = 466x283 css) | Pass. No document scrollbar, gutter 0, status bar 28 px, one-line status and version. Toolbar 2 rows (76.8 px), icon-only buttons with exact `aria-label` and `title`, pills keep icon and text. Grid 108.8 px, 2 complete rows; wheel and End reach address 9. Setup popover passes. Focus ring on all 6 toolbar controls; focus order at 466 css identical to 900. |
| F17 sweep, SetWindowPos, 266 steps (outer 900 to 600, heights 640 and 400) | Pass, 0 failures (previous run: 20 failures, all label-mode mismatch at outer 817-840). Toolbar max 2 rows; grid min 2 complete rows (2 at 690x400, 10 at height 640). |

## D12: W1 toolbar clipped "Disconnect" at 960 css - PASS
Setup: W1 real-dragged to minimum (outer 1218x797, client 1200x750 = 960x600 css), connected, Standard 8, P1 maximized, traffic collapsed, profile "Plant".

| Item | Result |
|---|---|
| "Disconnect" inside the window at 960 css | Pass. Right edge 948 css (was 962; window 960; 12 px side padding kept). |
| Toolbar height / rows | Pass. 56 px (`h-14`), one row, horizontal overflow 0. Content 936 px, children sum 898 px (was 948 vs 932). |
| Clipping and overlaps at 960 css | Pass. 0 clipped controls, 0 overlaps. |
| Profile label | Pass. Hidden below 1100 css (absent at 960 and 1099); appears at 1100+ with `title` "Plant". |
| Pill and chip text | Pass. Never cut at any measured width; `title` carries the full text ("Connected · 127.0.0.1:port", "1 exception · 7 live"). |
| Widths 960 to 1200 css (22 outer widths 1218-1518, 1 px steps at 1390-1396) | Pass at every width: always 56 px, one row, no overflow, clipping or overlap. |
| P1 grid at the minimum | Pass. 363 px, 10 of 10 rows complete. |

Notes:
- "Profile label hidden below 1100 with full title tooltip" cannot be observed literally (the label does not exist below 1100). The `title` was checked where it exists and on the pill and chip. Native hover tooltips are not visible through CDP, so attributes only.
- The helper's "rows: 2" from 1100 css up is an artifact (it counts the profile text span `offsetTop`); the one-row check used the vertical-centre spread (0).

## Sanity checks - PASS
- R7a (lone Alt tap in W1, then Ctrl+P): pass.
- Thai Ctrl+\ in W1 (sidebar collapse/expand, P1 grid setup open/close) and Ctrl+Shift+\ (compact on/off): pass; US control passes. Thai Ctrl+\ arrives as key "+" code Backslash, Ctrl+Shift+\ as "ฅ".
- Thai Ctrl+\ in the native window (setup popover opens/closes): pass.

## Files
- New spec `e2e/tests-integration/21-report009.spec.ts`; D11 tests in `e2e/tests-integration/20-report008b.spec.ts`.
- Evidence in `e2e/test-results/evidence/`: `d10-threshold-scan.json`, `d10-band.json`, `d10-drag-640.json`, `d10-native-sweep.json`, `d10-native-min-real-drag.json/.png`, `d12-w1-minimum.json/.png`, `d12-w1-widths.json`.
- `e2e/CHECKPOINT.md` updated (round 3).

## Cleanup
No process of the run left; ports 1420, 5020, 5021 free; `%TEMP%\esefact-it-tools` deleted. Free disk 5.7 GB. A new run needs a rebuild and a copy of the exe and sim.
