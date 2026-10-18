# REPORT-019 — Combined-group raw writes

2026-10-18. **1 passed, 0 failed, 16 write vectors, exit0, 8.914s**, start `2026-10-18T04:48:50.288Z`. Focused CHK6-C4 real-window evidence; no confirmed product defect.

Existing normal debug Tauri/WebView2 app, SHA256 `8f5ec29fa6a360d4be9aee11b04d60b38cd532077ebd94e40fda72e470dd40f0`, real TCP simulator, CDP and one worker. No build or fake IPC. Production UI loads a schema3 fixture with one FC03 poll, start1, quantity12, scan100ms, no color rules/scales. Windows DPI120. Command from e2e with corepack PATH and `ESEFACT_BINARY_LABEL=report019-normal`: `pnpm.cmd exec playwright test --project=integration tests-integration/26-report019.spec.ts --workers=1`.

## Results

For Float32 (two registers) and Unsigned64 (four registers), every combination of Swap bytes and Reverse register order passes FC06 then FC16. Before each Write, groups0 and1 are selected using click/Shift-click and both selected states are asserted; group2 is right-clicked. The dialog targets group2's first protocol address: **5** for32-bit, **9** for64-bit. Its raw prefill is4660 (`1234`), then4951 (`1357`) after the FC06 write. The explicit raw-register label and individual16-bit write explanation are present.

| Function | Entered decimal values | Captured master request PDU (AA=05 or09) | Captured slave reply PDU |
|---|---|---|---|
| FC06 |4951|`06 00 AA 13 57`|`06 00 AA 13 57`|
| FC16 |4660 22136 39612 57072|`10 00 AA 00 04 08 12 34 56 78 9A BC DE F0`|`10 00 AA 00 04`|

All16 writes produce exactly one matching function request, exact address/PDU and transaction-matched reply. Simulator control readback equals the entered raw words; subsequent grid raw text shows1357 after FC06 and1234 after FC16. Byte/word settings never swap or encode these wire words. Zero simulator OVERLAP lines. All exact frames are retained in `e2e/test-results/evidence/report019/raw-writes.json`, with simulator.log and app-stdout.log. Final result: `e2e/test-results/report019-final-results.json`.

## Limits and cleanup

CHK6-C4 passes for this workspace Float32/Unsigned64 matrix and all four orders. Native host repetition belongs to C6 and remains untested here; other combined interpretations, FC04 restrictions and inspector interactions are not claimed. This closes only the requested write gap, not all CHK-006 or release sign-off.

Two sandbox startup attempts failed before app assertions (no CDP page / ECONNRESET); approved execution outside sandbox resolved native startup. Two fixture setup attempts were correctly rejected by the production loader (schema3 missing required colorRules; legacy schema2 cannot contain unsigned32). The final fixture includes colorRules and schema3; these were test setup errors, not product defects. E2E TypeScript and Biome pass after the final run. Full workspace check is coordinated by the parent and was not repeated.

Disk guard:8,518,389,760 free bytes in the final test,8,528,134,144 after verification, above3GB. Fixtures stop owned desktop/simulator processes; no esefact processes or standard1420/5020/5021 listeners remain. The failed-startup data/WebView2 directories and QA helper directory were removed by checked absolute TEMP paths, rejecting reparse points. No cache deletion, product change, .codex edit or commit.
