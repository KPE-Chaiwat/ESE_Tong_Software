# REPORT-014 — Bulk selection boundaries

2026-10-18. Targeted normal real-window QA: **2 passed, 0 failed, 12.6s**. No confirmed product defect; no product change. This report does not sign off the whole checklist.

## Execution and evidence

- Existing normal debug `target/debug/esefact-desktop.exe`, SHA256 `8f5ec29fa6a360d4be9aee11b04d60b38cd532077ebd94e40fda72e470dd40f0`, no build or dev-hooks. Windows/WebView2, DPI120. UI mutations only; read-only profile export observes backend definitions.
- Spec `e2e/tests-integration/24-report014.spec.ts`; command from e2e with corepack PATH and `ESEFACT_BINARY_LABEL=report014-normal`: `pnpm.cmd exec playwright test --project=integration tests-integration/24-report014.spec.ts --workers=1`.
- Approved execution outside sandbox was required: the first sandbox attempt had no CDP page targets before either scenario. This is the established harness limitation from REPORT-011/013.
- Final JSON: `e2e/test-results/report014-final-results.json`, start `2026-10-18T04:39:15.370Z`, expected2/unexpected0/flaky0. Capacity profile attached to the passing scenario. Default report/evidence paths may be overwritten by later QA runs.
- Existing component suite independently rerun: `pnpm.cmd exec vitest run src/tools/modbus-master/components/sidebar/PollBulk.test.tsx src/tools/modbus-master/components/sidebar/PollList.test.tsx` from apps/desktop: **2 files / 28 tests passed**, 51.93s. E2E typecheck and Biome check passed. Full workspace gate remains the root agent's responsibility.

## Exact disposition

| ID | Disposition in this round |
|---|---|
| CHK4-A1 | SKIPPED; earlier REPORT-011 evidence retained. |
| CHK4-A2 | SKIPPED; earlier REPORT-011 evidence retained. |
| CHK4-A3 | PARTIAL — real checkbox Shift range accumulates, including reverse extension to A; reordered/deleted-anchor matrix remains component evidence only. The initial D checkbox makes D the most recent anchor, so this does not claim the checklist's exact B-retained-anchor example. |
| CHK4-A4 | PARTIAL — real Space, Shift+Down, Home/End/Down focus without selection, Ctrl+Shift+A clear pass. Full Tab/Shift+Space/Up/Ctrl+A and polite-announcement inspection remain open in real-window QA. |
| CHK4-A5 | PARTIAL — Ctrl+A in Host leaves poll membership unchanged. Rename/setup/grid/traffic/menu/toolbar/W2, native clipboard/IME/AltGr and row Delete matrix not newly exercised. |
| CHK4-A6 | SKIPPED. |
| CHK4-A7 | SKIPPED; screen-reader/manual inspection remains open. |
| CHK4-B1 | SKIPPED; earlier REPORT-011 evidence retained. |
| CHK4-B2 | PARTIAL — real `A` with existing `a COPY` produces `A copy 2`; a 48-character source copies with every name <=48 characters and all names case-insensitively unique. Earlier-copy-in-same-transaction collision vector remains open. |
| CHK4-B3 | SKIPPED; earlier REPORT-011 evidence retained. |
| CHK4-B4 | PARTIAL — real 15-poll/two-selected exact room-for-1 error leaves 15; one-selected succeeds at16; next attempt gives room-for-0 and leaves16. Direct backend overflow rejection is not newly driven here. |
| CHK4-B5 | SKIPPED; earlier REPORT-011 evidence retained. |
| CHK4-B6 | PARTIAL — existing component suite covers precommit refusal, busy/idempotency/recovery cases separately from the new normal-window tests; REPORT-013 remains native fault evidence. |
| CHK4-C1 | PARTIAL — every new deletion confirmation initially focuses Cancel; other clauses remain earlier evidence/open. |
| CHK4-C2 | SKIPPED; earlier REPORT-011 evidence retained. |
| CHK4-C3 | PARTIAL — rerun component test target rename invalidates modal, gives exact selected-polls-changed error and sends no remove request; precommit refusal preserves definitions/releases locks. No real-window concurrent-native-edit invalidation or backend stale-id/lifecycle injection newly performed. |
| CHK4-C4 | PARTIAL — real idle `[A,B,C,D]` delete A,C -> `[B,D]`, D checkbox focus; delete D -> B checkbox focus; delete B -> zero definitions, existing empty message, New poll focus, connection window remains open, no replacement. Connected survival/scheduling and surviving-active clause remain earlier evidence/open. |
| CHK4-C5 | SKIPPED; REPORT-013 remains native fault evidence. |
| CHK4-D1 | PARTIAL — selection/duplicate/delete operate while idle and do not connect; all connection-state vectors not newly covered. |
| CHK4-D2 | SKIPPED; earlier REPORT-011 evidence retained. |
| CHK4-D3 | SKIPPED — no 16-poll minimum-rate React render/cadence measurement in this round. |

Earlier failed test expectations were corrected: the empty message includes its instructional sentence; the idle Host must contain a valid host before expecting Connect enabled; export must wait until bulk lifecycle completion. These were harness/oracle corrections, with no product fix.

## Cleanup

No owned desktop/simulator process remained after fixtures. No fixture data/WebView2 directory remained. Verified owned TEMP `esefact-it-tools` helper directory removed after checking its absolute path stays within TEMP and is not a reparse point; binding-generation temp directories left alone. No cache deletion, per-package Cargo command, commit, `.codex` edit or build. Free disk observed **8,554,061,824 bytes**, above3GB guard. Other agents' processes were left alone.
