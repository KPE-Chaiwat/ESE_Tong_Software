# REPORT-015 — remaining value and numeric browser QA

2026-10-18. Browser-mode Playwright with manual fake IPC. This adds one focused CHK-005 browser case to REPORT-010/012 and the real-window evidence in REPORT-011. It is not full checklist sign-off.

## Run

- Chromium, Vite 8.3.4, viewport 1618×834, one worker; Vite used `VITE_FAKE_IPC=manual` on port 1420.
- `pnpm.cmd exec playwright test --project=ui tests/chk5-6-values-remaining.spec.ts -g "nonfinite and stale" --workers=1 --reporter=list` from `e2e/`.
- Result: **1 passed, 0 failed, exit 0, 4.4 seconds.**
- E2E TypeScript check passed (`pnpm.cmd --filter @esefact/e2e typecheck`). Root later ran the desktop-installed Biome binary from the repository root on all four new E2E specs, including this file: 4 files checked, no fixes, exit 0.
- Cleanup: stopped the Vite process started for this run; port 1420 has no listener. No desktop app, simulator, build, product code or cache was changed.

## Added evidence

**CHK5-A7, partial:** a live Not-equals rule produced no marker for Float32 +Infinity, -Infinity or NaN. After emitting timeout state, no rule marker appeared. Missing, incomplete, `too large`, scaled-source-unavailable and finite-float exactness cases remain open.

Two exploratory cases were not retained as test evidence: adjacent-u64 marker selection and failed rule-Apply IPC/retry. Their browser setup/oracles did not produce reliable results in this run. Neither is counted as a pass or a product defect; both remain open. Existing `lib/color-rules.test.ts` covers exact 64-bit comparison and parser/validation utility vectors, but it does not replace the UI/profile cases in CHK.

## Per-ID disposition for CHK-005 and CHK-006

Status reflects combined evidence in REPORT-010, REPORT-011, REPORT-012, existing unit tests, and this run. **PARTIAL** means some clauses have evidence; **SKIPPED** means no relevant evidence was collected in those reports/tests.

| Checklist | Status | Evidence or remaining gap |
|---|---|---|
| CHK5-A1 | PARTIAL | Browser comparison boundaries and inclusive Between/overlap reorder in REPORT-010/012; remaining source/range cases open. |
| CHK5-A2 | PARTIAL | Source math covered by `color-rules.test.ts`; full displayed/raw/scaled column browser matrix open. |
| CHK5-A3 | PARTIAL | Parser/matcher utility coverage exists; rounding, clamp, extrapolation and too-large UI cases open. |
| CHK5-A4 | PARTIAL | Utility tests cover signed/raw source behavior; bit-function and hex/binary UI vectors open. |
| CHK5-A5 | PARTIAL | REPORT-011 verifies exact 9007199254740993 UI/copy/save/reload; adjacent comparison/reload matrix open. |
| CHK5-A6 | PARTIAL | Utility vectors cover u64 max and signed64 minimum; signed64 maximum and profile/editor exact text open. |
| CHK5-A7 | PARTIAL | This report verifies nonfinite plus timeout; other no-match inputs and finite f32 exactness open. |
| CHK5-A8 | PARTIAL | REPORT-012 verifies inclusive Between and first-match reorder; range/group mapping, disable/remove, draft and re-expansion open. |
| CHK5-B1 | PARTIAL | REPORT-010 verifies empty/default/add/cancel; capacity, reorder focus and all editor states open. |
| CHK5-B2 | PARTIAL | Browser checks blank/comma/reversed Between; unit validation covers parser/range/count subsets; full exact message/placement matrix open. |
| CHK5-B3 | PARTIAL | `color-rules.test.ts` covers general/exact parser examples; complete UI grammar and address endpoint matrix open. |
| CHK5-B4 | PARTIAL | Successful browser Apply and utility/store failure tests exist; rule-specific browser IPC rejection/retry is unverified. |
| CHK5-B5 | PARTIAL | Combined/profile rejection evidence exists in reports/unit suites; full incompatible-rule editor recovery matrix open. |
| CHK5-C1 | SKIPPED | No targeted browser state matrix for empty/loading/first-data. |
| CHK5-C2 | PARTIAL | REPORT-011 covers pause, timeout, exception and recovery with live values; link-loss/disconnect combinations open. |
| CHK5-C3 | SKIPPED | No measured palette/accessibility contrast evidence. |
| CHK5-C4 | SKIPPED | No scale-marker interaction/high-contrast evidence. |
| CHK5-C5 | SKIPPED | No focused host-minimum editor handoff/focus-trap matrix. |
| CHK5-D1 | PARTIAL | REPORT-011 verifies rule persistence and migration subsets; mixed rule duplicate/profile roundtrip remains open. |
| CHK5-D2 | SKIPPED | No 125-register/16-rule performance capture in this QA run. |
| CHK5-D3 | SKIPPED | No row-level render/copy/write regression matrix in this run. |
| CHK6-A1 | PARTIAL | REPORT-010/011 exact UI/copy vectors include signed32, unsigned32, signed64 min, unsigned64 max/2^53+1 and float examples; complete vector table open. |
| CHK6-A2 | PARTIAL | REPORT-010/011/012 verify all 32-bit and 64-bit byte/word order examples; full transformed hex matrix remains open. |
| CHK6-A3 | PARTIAL | REPORT-011 verifies f32/f64 finite values and infinities/NaN; subnormals, signed zero and narrow-cell reachability open. |
| CHK6-A4 | PARTIAL | REPORT-010 verifies start1/Q5 incomplete grouping and inspector remainder; Q1/Q3/Q125, start0 and 65535 boundaries open. |
| CHK6-A5 | PARTIAL | REPORT-011 verifies live pause/fault recovery and atomic visible values in covered cases; delayed definition-change/truncated reply cases open. |
| CHK6-B1 | SKIPPED | No dedicated idle/loading/first-success placeholder matrix. |
| CHK6-B2 | PARTIAL | REPORT-011 verifies pause/resume retention and marker behavior. |
| CHK6-B3 | PARTIAL | REPORT-011 verifies timeout and exception stale/recovery; link loss and disconnect matrix open. |
| CHK6-B4 | PARTIAL | Successful Apply is covered; browser IPC rejection and retry remain unverified. |
| CHK6-B5 | SKIPPED | No focused integer64 incompatibility/fix/retry browser case. |
| CHK6-B6 | PARTIAL | REPORT-011 covers invalid profile values/rejection; complete current-workspace preservation assertions open. |
| CHK6-C1 | SKIPPED | No saved scaling/columns/function roundtrip matrix. |
| CHK6-C2 | SKIPPED | No focused group-alias/base-address/selection mapping matrix. |
| CHK6-C3 | PARTIAL | REPORT-010/011 verify exact selected numeric UI/copy vectors; header/alias/raw/incomplete/missing/clipboard-denial variants open. |
| CHK6-C4 | SKIPPED | No clicked-row write targeting or FC06/FC16 raw TX verification. |
| CHK6-C5 | PARTIAL | REPORT-011 covers schema2/3 settings roundtrip and old-schema migration; all interpretation/order and schema rejection variants open. |
| CHK6-C6 | PARTIAL | REPORT-011 covers native host attachment and minimum-size sidebar geometry; editor focus/scroll/handoff requirements open. |
| CHK6-D1 | PARTIAL | No capture in this browser round; subsequent real-window `REPORT-017` covers 125-register cadence and steady responsiveness across all 24 combined/order variants. |
| CHK6-D2 | SKIPPED | No screen-reader/high-contrast/grayscale evidence. |
| CHK6-D3 | PARTIAL | Existing regression suites and REPORT-011 cover selected 16-bit/raw behavior; full scale/copy/write/shortcut regression matrix open. |

No confirmed product defect was found. Full checklist sign-off remains open.
