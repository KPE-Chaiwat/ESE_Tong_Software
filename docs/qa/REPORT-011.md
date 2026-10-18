# REPORT-011 — REQ-004..007 targeted real-window QA

2026-10-18. Normal debug Tauri app, real WebView2 windows over CDP and TCP simulator. This report adds real-window evidence to REPORT-010 browser coverage. It is a targeted round, not completion of every clause in CHK-004..007. Untested clauses remain open below.

## Build, environment and execution

- PM authorized this run after `pnpm check` and post-test bindings check passed. QA did not rerun that disk-heavy gate.
- Build: `pnpm.cmd --filter @esefact/desktop tauri build --debug --no-bundle`, exit0; Rust 32.89s. App `target/debug/esefact-desktop.exe`, 22,117,888 bytes, SHA256 `ae0bf4d137a76e0d9ac3131f9925b09828374ab53665f49eeb052f831ae60284`.
- Existing plain simulator `target/debug/esefact-sim-slave.exe`, SHA256 `8598e1c2d9d2724ce0ccf1b330b410ec0dc80d066ef2c0785ee5bd63b394ae4d`. No per-package build or cache deletion.
- Windows, DPI120 / devicePixelRatio1.25. Real W1/W2; fixture-owned temporary profiles and WebView2 data, simulator free loopback ports. W1 minimum probe is 960×600 CSS px.
- Source `e2e/tests-integration/22-report011.spec.ts`, four scenarios, one worker. No fixed sleeps in the new spec; observable condition waits. Existing fixture lifecycle waits are unchanged. The local FeatureMm helper uses the semantic Polls list/listitem introduced in REQ-004; product code is untouched.
- Command from `e2e`, after prepending corepack PATH: `pnpm.cmd exec playwright test --project=integration tests-integration/22-report011.spec.ts --workers=1`. This command requires the approved execution outside the filesystem/process sandbox for WebView2 native startup.
- E2E `tsc --noEmit` passed; Biome check/format passed for the new spec.

## Results

**Final run: 4 passed, 0 failed, exit0, 24.6s.** JSON start `2026-10-18T04:20:07.242Z`, expected4/unexpected0/flaky0. Preserved result copy: `e2e/test-results/report011-final-results.json`; extracted logs/screenshots: `e2e/test-results/evidence/report011/`. Evidence is in `e2e/test-results/results.json` and `e2e/playwright-report/index.html` (generated and overwritten by later runs). Each scenario attaches simulator/app logs; successful scenarios attach exact-native.png, loaded-sidebar.png, bulk-roundtrip.png and sidebar-minimum.png as applicable. No product defect was established in this round.

### Numeric, rules and live states

Every vector below passed exact visible text and OS clipboard (`1<TAB>value`) against simulator words, with four wire registers from start1. The unused second 32-bit group is deliberately present and selection remains the first group.

| Interpretation | Wire words | Exact UI/copy |
|---|---|---|
| Signed32 | FFFF FFFE 0000 0000 | -2 |
| Unsigned32 | FFFF FFFF 0000 0000 | 4294967295 |
| Signed64 | 8000 0000 0000 0000 | -9223372036854775808 |
| Unsigned64 | FFFF FFFF FFFF FFFF | 18446744073709551615 |
| Unsigned64 | 0020 0000 0000 0001 | 9007199254740993 |
| Float32 | 3DCC CCCD 0000 0000 | 0.10000000149011612 |
| Float64 | 3FB9 9999 9999 999A | 0.1 |
| Float32 | 7F80 0000 0000 0000 | +Infinity |
| Float32 | FF80 0000 0000 0000 | -Infinity |
| Float32 | 7FC0 0000 0000 0000 | NaN |

Four unsigned32 order variants on1234 5678 passed 305419896 / 873625686 / 1450709556 / 2018915346; displayed raw words remained `0x1234 0x5678`.

Applied Equals9007199254740993 rule matches that u64, does not match9007199254740992, then matches on recovery. Pause removes marker; two interpretation Apply operations while paused add zero wire requests. Resume restores match. `fault drop` causes Timeout + Stale and removes marker; clear restores it. `fault exception 4` causes Exception and removes marker; clear restores it. Native pop-out retains exact value/rule. Exact decimal threshold survives explicit Save/reopen/reconnect and still matches in restored native host. After the initial default poll definition has been replaced through Apply, every captured FC03 request retains start1/quantity4. No simulator OVERLAP line.

### Bulk actions, hosts and persistence

A/B/C/D are created through UI; A has Unsigned32 byte swap and C is native. Check A,C; hide/show retains membership. Duplicate yields `[A,B,C,A copy,C copy,D]`; copied A display equals source, copied C is a live native host, new copies unchecked. Delete modal identifies native host and initially focuses Cancel. Cancel keeps six definitions and native source live. Confirm deletes sources A/C; native source closes, native copy and unselected B remain live. Order becomes `[B,A copy,C copy,D]`, focus is A copy checkbox (first survivor after last removed position).

Hide sidebar and Save as writes schema3 with collapsed=true. Reopen completes Disconnect and load confirmation; frontend poll ids change, profile is not Modified, toolbar shows Show sidebar/expanded=false, and full sidebar remains hidden. Show then reveals four unchecked rows; all persisted definitions/display/rules/scales/overrides/value columns/aliases equal the saved profile. Selection/live sample fields are absent from serialized profile.

Schema2 Hex/base1/Pressure alias loads with byte/word swaps false and empty rules; no Modified, source file unchanged. Schema1 Signed loads Signed/off/off/empty rules without Modified. Schema3 malformed boolean (`swapBytes:"false"`) and schema4 are listed Cannot be opened, Open disabled; current workspace remains unchanged.

### Sidebar at W1 minimum

At960×600 CSS px, both directions work in normal and compact peek modes. Toggle has left201.03/right233.03 px, height32 px, fully inside client. Document scrollWidth=clientWidth=960 and scrollHeight=clientHeight=600 throughout. Name/expanded state and actual full-sidebar visibility agree. Layout-only actions do not add Modified (`*` absent from native W1 title); responsive profile label is intentionally hidden at this width.

## Earlier attempts and harness corrections

Sandboxed startup attempts failed before feature actions: no CDP page targets; `connectOverCDP ECONNRESET`; CDP endpoint not available. Approved unsandboxed execution immediately resolved startup. These are execution/harness restrictions, not product failures.

Test development corrected semantic or workflow oracles without removing requirements: nonfinite cell accessible names include Nonfinite value info text, so exact numeric text is checked separately; wire assertion begins after applied definition rather than counting the initial default definition; a covered poll is raised via its sidebar Show button; delete focus accounts for inserted copies; narrow profile label is replaced by native title Modified evidence. The apparent collapsed-profile failure was an incomplete test workflow: File Open closed the picker but a Disconnect and load confirmation remained. After completing it and asserting frontend ids changed, the original collapse assertion passed. The extended exact-threshold reload test also waits for the stable Connect action and uses the saved file connection: the existing export helper supplies a dummy port502 when observing an idle connection. No product fix was needed. Prior failed expectations are not product defects or final passing-run evidence.

## Checklist disposition and gaps

All IDs below are PARTIAL: only the real-window subcases described above pass; remaining clauses stay open. All other CHK-004..007 IDs are SKIPPED in this targeted round. REPORT-010 remains separate browser evidence; no entire checklist is signed off.

| Checklist | IDs with verified real-window subcases |
|---|---|
| CHK4 | A1, A2, B1, B3, B5, C1, C2, C4, D1, D2, D3 |
| CHK5 | A5, B1, B4, C2, C3, D1 |
| CHK6 | A1, A2, A3, B2, B3, B4, B6, C3, C5, C6 |
| CHK7 | A1, A3, A5, A6, A7, A8 |

Priority gaps: bulk native create/destroy/focus failure recovery (CHK4-B6/C5; existing dev-hooks only arm single popOut/dock before mutation, so no approved bulk hook exists); complete numeric/boundary/64-bit order vectors; scaled/range/precedence/validation matrices; invalid editor/host handoff; raw FC06/16 wire writes; bulk capacity/stale-operation rejection; pending-definition/link-loss transitions; 125-register/16-rule performance/cadence; keyboard/accessibility/monitor/DPI matrix and RTU hardware. Rust/fake tests are not substituted for this missing real-window evidence. No claim of full QA or release readiness.

## Cleanup and disk

Disk guard >=3GB was maintained: 10,768,117,760 bytes before build; 10,597,748,736 after build; approximately10.59GB after cleanup. All fixture-owned desktop/simulator processes exited; no listeners on1420/5020/5021. Four explicitly identified directories left by sandbox startup failures and this round's winhelper directory were removed after verifying each resolved path remains under TEMP and is not a reparse point. No caches or target build artifacts were removed; no configuration/STATUS/changelog edits or commits by QA. Generated evidence remains under e2e/test-results.

