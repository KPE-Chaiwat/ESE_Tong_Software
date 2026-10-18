# REPORT-013 — Bulk native-window fault QA

2026-10-18. **Final result: 4 passed, 0 failed, exit0, 27.5s.** Targeted CHK4-B6/C5 real-window recovery checks passed. This is not complete CHK-004 or release sign-off.

## Environment and execution

- Real normal debug Tauri/WebView2 app with the debug-only `dev-hooks` feature, TCP simulator, CDP and native HWND checks; Windows DPI120 / devicePixelRatio1.25. No fake IPC/state.
- Final build after reviewed hook correction: `pnpm.cmd --filter @esefact/desktop tauri build --debug --no-bundle --features dev-hooks`, exit0, Rust12.25s. App22,135,808 bytes, SHA256 `5e18f77fd65918721d3f0832b0c1e5ab700fe84e5722b26403f4038e8bb0f0e5`. Existing simulator SHA256 `8598e1c2d9d2724ce0ccf1b330b410ec0dc80d066ef2c0785ee5bd63b394ae4d`.
- Spec: `e2e/tests-integration/23-report013.spec.ts`. E2E `tsc --noEmit` and Biome check passed. No `pnpm check` repetition by QA; root coordinates that gate.
- From e2e with corepack PATH and `ESEFACT_BINARY_LABEL=report013-hooks-final`: `pnpm.cmd exec playwright test --project=integration tests-integration/23-report013.spec.ts --workers=1`. Approved execution outside sandbox permits WebView2/CDP startup.
- Final JSON start2026-10-18T04:30:58.327Z, expected4/unexpected0/flaky0. Preserved `e2e/test-results/report013-final-results.json`, extracted profiles/screenshots/simulator/app logs in `e2e/test-results/evidence/report013/`. Native recovered screenshot and final W1 cleanup screenshot visually inspected.

## Results

| Fault | Real-window evidence |
|---|---|
| bulkCreate, skip1 | A/B native sources duplicate to exactly A/B/A copy/B copy after double click. First copy is created normally, second has exact injected notice and Show recovery. Both sources remain live; W1 is foreground and Duplicate focused. B copy keeps its id through Show and becomes live. No additional copies appear. |
| bulkPlace | Partial create/placement failure preserves both copy definitions. Exact injected notice, W1 focus, original live sources, no unsuccessful native page, and same-id Show recovery all pass. |
| bulkShow | Failed initial reveal preserves definitions, cleans unsuccessful host, displays exact injected notice and recovers same id with Show. Sources stay live and W1 focus returns. |
| bulkDestroy | Workspace A precedes native B in selected order. Both definitions disappear; C remains polling and its checkbox is focused with W1 foreground. The injected notice belongs to native B, proving the nonexistent workspace host did not consume the hook. Cleanup closes B without restoring removed definitions or creating copies. Notice clears after native close acknowledgement; adding After recovery succeeds and C stays polling. |

Each duplicate case checks exact order/count via read-only profile export, disabled bulk mutation while recovery exists, original source live views, unchanged total definitions after Show, and UI usability after recovery. Delete confirms authoritative remaining ids and exported names before adding another poll. These are behavioral proofs of retained committed state and recovery outcomes; they do not inspect the typed `definitionsCommitted`, issue stage enum, operation token, exact command counts or same-token replay. Those contract assertions remain separate Rust/fake-test evidence. Under the typed contract bulkPlace maps to `create`, bulkShow to `show`, and bulkDestroy to `destroy`; the real UI shows the injected message and recovery action rather than that enum.

## Earlier attempts and oracle corrections

An initial build/run was stopped before any scenario completed when review found the hook could consume bulkDestroy for an absent native host. The reviewed exists guard was included in the final build. Two interrupted startup attempts left fixture directories; those were removed at cleanup.

The first observation approach attempted to wrap `__TAURI_INTERNALS__.invoke`; native Tauri defines this property as nonwritable/nonconfigurable. The observer consequently recorded no calls and caused harness-only timeouts. It was removed completely. The final spec uses UI, native windows and read-only profile export; no debugger instrumentation or direct bulk mutation commands.

An earlier delete oracle assumed one cleanup reply would immediately clear the notice. Real native destruction can return `The poll window is still closing. Retry window cleanup.` before the page finishes closing. The final spec waits for the actual page close, then retries cleanup acknowledgement if the notice remains. This passes without mutation or changed survivor definitions. Simulator stop during failed-test teardown explains the Disconnected state in the earlier failure screenshot; it is not a product link-loss defect.

No confirmed product defect was found in the final run.

## Checklist limits

CHK4-B6/C5 are PARTIAL: the injected postcommit window failure/recovery clauses above pass. Busy double-click has count/order evidence, while precise invocation-count and typed result/idempotency assertions remain unit/fake evidence. Stale validation, precommit rejection, full keyboard/accessibility, performance, monitor/DPI and hardware clauses are not newly signed off here. REPORT-010/011/012 remain separate evidence.

## Cleanup and disk

Disk guard >=3GB held:9,387,925,504 bytes before first build;8,855,732,224 before final build;8,554,815,488 after final cleanup. No per-package Cargo build/test or cache deletion. No owned desktop/simulator process remains. Standard ports1420/5020/5021 have no listeners; fixtures used free loopback ports. Five explicitly identified fixture/helper directories under TEMP were removed after verifying resolved absolute paths remained inside TEMP and were not reparse points. Other processes and binding-generation directories were left alone. No commits, config edits or product changes by QA.
