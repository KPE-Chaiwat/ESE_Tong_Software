# STATUS (ACTIVE 2026-10-18; REQ-008 GridStack workspace complete)

2026-10-18 owner report: `pnpm dev` still colored registers 0 and 1 together after opening **Value color rules…** on register 1. The row menu had opened a Whole poll rule. It now opens a conditional rule scoped to the clicked register; a sole older whole-poll rule is narrowed in the draft. Read-only numeric cells suppress native text selection overlays. `REPORT-029-row-color-scope.md` records `pnpm check` passing (153 frontend files / 3,464 tests), 3/3 real-window TCP simulator tests including narrowing a pre-existing whole-poll rule, and embedded debug executable SHA256 `0c7cd2ae56342eaf26745f3afa52752332fd39e7d7ce508ed3a498fcd8b942c6`. No commit or installer.

2026-10-18 owner correction: REQ-005 now supports **Set colors for register N…** from normal and combined value rows. It creates/reopens a static rule for that register, with no threshold, and places specific colors before broad rules. Limit raised to 256 rules per poll so 125 registers can each have their own color. `REPORT-028-register-colors.md` records frontend 3,462/3,462 tests, full Rust tests, 2/2 real-window TCP simulator QA and final embedded debug executable SHA256 `4fb0073e271c8403ee26ca4720852f0d90ada39a5b4dc3727ea84fe6046fe37f`. No commit or installer.

2026-10-18 owner report: Custom value color pair was blocked by the 4.5:1 contrast rule. REQ-005 now treats low contrast as a visible advisory warning; valid `#RRGGBB` pairs can be applied and loaded. `REPORT-027-low-contrast-colors.md` records checks and 1/1 real-window QA with the previously rejected blue/brown pair. Normal embedded debug executable at `target/debug/esefact-desktop.exe`, SHA256 `aed9d4ebed80df0d6a0ca786e6b100a555370c6caae9a0ef23633fc9b25446d1`. No running ESEfact/simulator process, commit or installer.

2026-10-18 owner correction: REQ-005 Color rule now supports separate user-selected background and text colors in addition to its original presets. `REPORT-026-custom-rule-colors.md` records backend contrast validation, schema 5 migration from schemas 1–4, 3,459 frontend tests, Rust test exit 0 and 1/1 real-window TCP simulator QA. Normal embedded debug executable at `target/debug/esefact-desktop.exe` has SHA256 `1e8dc27179ff42feaee12adc0909f0e768aae00ef645d075f5ac4bdd1a59505e`. No commit or installer. Remaining manual/hardware checks are unchanged.

REQ-008 replaces floating Poll placement in W1 with GridStack, as requested in D-008-01/02. The Workspace scrolls vertically; the document does not. Schema 4 profiles retain grid cells and schemas 1–3 migrate. `docs/qa/REPORT-025-gridstack-workspace.md` records full `pnpm check` passing (447 Rust, 3,457 frontend tests), browser QA with 16 non-overlapping Polls, and 1/1 real Tauri/WebView2 + TCP simulator scenario with eight live Polls, resize/reflow, drag, southeast resize, save/reopen and Pop out/Dock. `docs/reviews/REV-012-gridstack-workspace.md` records the review. Final normal embedded-frontend debug executable: `target/debug/esefact-desktop.exe`, SHA256 `985d9f0ddfba165c89d6dc694733b47f31bb0a0cc9b637c95dc3f267cb8f464d`. No commit or installer. Mixed-DPI monitors, RTU hardware and long-soak tests remain outside this targeted QA.

The owner resumed work and requested four additions to Modbus Master: bulk poll selection/actions, value color rules, combined-register 32/64-bit interpretations with byte/word order, and a visible full-sidebar collapse control. REQ/DES/FE/BE/CHK-004..007 are written and their implementations are integrated. REV-009/010 approved the product scope; REV-011 approved the debug fault hook after one fix. Full `pnpm check` passed again 2026-10-18 (version, 91 bindings, desktop/e2e typecheck, Biome, Rust fmt/clippy/tests, and 154 frontend files / 3,536 tests). Post-test `bindings:check` passed. Targeted real-window Tauri/WebView2 + TCP simulator QA passed 4/4 normal scenarios (`REPORT-011`) and 4/4 injected bulk native-window failures (`REPORT-013`); browser QA passed 24/24 (`REPORT-012`). No confirmed product defect remains. Full checklist sign-off and hardware/manual cases remain open.

## Current round (REQ-004..007)

- DONE 2026-10-18: owner reported Poll title/data clipped after Apply of combined format. `REPORT-024-format-scroll.md` records a fix to Format / endian reveal and combined-row navigation so only inner panels scroll. Focused 14/14, full `pnpm check` (frontend 155 files / 3,546 tests), browser Playwright 1/1 and real Tauri/WebView2 + simulator 1/1 passed after both Apply buttons. Normal self-contained debug executable SHA256 `298705c565b6e07000942366b0006ee7bd030ac5b7676aed182ce381a883227f`. No commit.

- DONE 2026-10-18: owner corrected the claim that named endian choices were already visible. `InterpretationSection` now offers four explicit Big-endian/Little-endian/byte-swap choices with 32/64-bit byte patterns and names the applied order; existing persisted flags and decoder are unchanged. `REPORT-023-named-endian-orders.md`: full `pnpm check` passed (frontend 154 files / 3,542 tests), web/workspace builds and post-build bindings check passed. Browser CHK6-A2 assertions printed `ok` for both widths, but its runner hung during shutdown and was interrupted. Normal debug executable SHA256 `95415c2def2959a7b2c19c5a0bd4acb00261d8d1bab3a63c62b521c72e6762c1`. No commit.

- DONE 2026-10-18: owner asked for operator symbols in Color rule Comparison and checked Format/Endian availability. The editor now shows `=`, `!=`, `<`, `<=`, `>`, `>=` in parentheses and labels Between inclusive. The format/endian implementation already existed in Poll setup → Interpretation; **Format / endian…** in both row context menus now reveals and focuses those existing controls without applying a draft. `REPORT-022-comparison-format-access.md`: focused 10/10, frontend 154 files / 3,541 tests, desktop/E2E TypeScript, Biome, web build, workspace build, bindings and diff check pass. Independent review found no blocker. New normal debug executable SHA256 `d51b446f6094e9823dd5eff0bbbaa5fd6655c54fbe863676da04fb6b55336b4d`; no commit.

- DONE 2026-10-18: owner noticed the Color rule editor had no entry in the value-row context menu. Added **Value color rules…** to normal and combined grids, using the existing Poll setup editor; updated REQ/DES/CHK-005 and `CHANGELOG.md`. `RuleSection.test.tsx` 6/6 and frontend Vitest 154 files / 3,539 tests pass; independent review found no blocker. `REPORT-021-color-rule-context-menu.md` records evidence. Initial `pnpm check` passed version, bindings, desktop/E2E TypeScript, desktop Biome and Rust fmt/clippy, then Rust tests hit the owner's running `.exe` lock. After the owner closed the app, `pnpm test:rust`, `pnpm build:web`, `cargo build --workspace` and post-build `pnpm bindings:check` all passed. New normal debug executable: `target/debug/esefact-desktop.exe`, SHA256 `494f0f2f3aa200d2bbb1ca9c30ae4a8f6bf724140d09fc7d01846bc9d7d94b6a`. No commit or release package.

- DONE: requirements, design, FE/BE handoffs, checklists, implementation and independent code reviews (`REV-009`, `REV-010`). Owner decisions D-005-01 and D-006-01 are recorded in `docs/questions.md`.
- DONE: full `pnpm check`, 2026-10-18, exit 0. Browser-mode Playwright checks: `docs/qa/REPORT-010-new-features.md` (20/20 pass; provisional scope).
- DONE: targeted QA against a normal debug Tauri window and TCP simulator, including native poll windows and schema1/2/3 profile cases: `docs/qa/REPORT-011.md` (4/4 pass). Extended browser vectors: `REPORT-012-browser-extended.md` (24/24 pass). Debug-hook real native failure/recovery: `REPORT-013.md` (4/4 pass). Review: `REV-011-bulk-fault-hook.md`. No owned app/simulator process or standard port listener remains after QA.
- OPEN: full CHK-004..007 sign-off. REPORT-011 lists partial/skipped clauses, notably injected bulk native-window failures, full accessibility/keyboard/layout and performance matrices, mixed-DPI monitors and RTU hardware. Existing unit/fake/browser coverage is separate evidence. No confirmed product defect is pending.
- DONE: final normal debug executable rebuilt without `dev-hooks` at `target/debug/esefact-desktop.exe` (SHA256 `8f5ec29fa6a360d4be9aee11b04d60b38cd532077ebd94e40fda72e470dd40f0`). Disk guard >=3GB held; no cache removed.
- DONE: additional targeted QA: bulk boundaries `REPORT-014` (2/2 real-window, 28/28 component), color/nonfinite browser `REPORT-015`, sidebar focus/shortcut component `REPORT-016` (10/10 focused, 125/125 related), and 125-register/16-rule/24-order real-window performance `REPORT-017` (1/1; zero steady long tasks >50ms). E2E typecheck and Biome of the new specs passed after these runs. No confirmed product defect.
- DONE: `REPORT-019` verified 16/16 real FC06/FC16 raw writes across Float32/Unsigned64 and all four byte/word orders. The clicked group's first register, exact TX/RX frames and simulator readback matched; CHK6-C4 is PASS. `REPORT-020-sidebar-scope.md` adds browser W1/W2 isolation, compact peek and non-default-width profile evidence; CHK7-A3 is PASS. Its final A8 Playwright runner hung after the passing test line and was stopped; the report records that limit. `REPORT-018-checklist-status.md` records all 71 checklist IDs (3 PASS, 58 PARTIAL, 10 OPEN after REPORT-022). Manual hardware, accessibility and mixed-DPI cases cannot be closed in this environment. Disk guard >=3GB held; avoid redundant full workspace builds.
- DONE: final QA-spec `e2e` TypeScript check, Biome for eight new browser/integration specs, `git diff --check`, and checklist row-count audit passed. QA temp helper absent, no owned desktop/Playwright process found. Normal debug executable remains available with the verified SHA256 above; no commit or package release was made.
- NEXT: owner review and remaining manual/hardware checks before release sign-off. Do not commit without the owner's explicit request. `.codex/config.toml` was already modified outside this work; never edit it.

## Previous pause checkpoint (Modbus Master phase 1 CLOSED)

At the previous pause: no agents, no esefact/playwright processes, ports 1420/5020/5021 free, no temp dirs, 5.8 GB free. Phase 1 had nothing half done; the owner has since said "ลุยต่อ" and specified the new work above.

Product: ESEfact launcher. Tool 1: **Modbus Master** v0.1.0 shipped in docs (REQ-001) and the big extension REQ-002 (several polls per connection: workspace sub-windows, pop out/dock, drag and drop, Alias) + REQ-003 (value scaling) is implemented, reviewed and tested. All known defects (D1-D12) are fixed and verified in a real window.

## How to resume (read this first)
1. Say "ลุยต่อ" (continue). The PM reads this file and `e2e/CHECKPOINT.md`, then does the "NEXT STEPS" list below in order. Do NOT redo anything marked DONE.
2. Environment: corepack shims in `$HOME\.corepack-bin` must be prepended to PATH per shell (pnpm 10.34.6, Node 22.19, Rust 1.92). Verify with `pnpm check` (about 2.5 min; it costs about 1.2 GB of disk each time, so run it once per round).
3. Rules that must hold: never `cargo clean`, never `cargo test -p <pkg>` or per-package builds (disk), ask before deleting caches (`target\debug\incremental` ~12 GB), do not commit unless the owner says so, usage budget: see "Owner rules".

## Owner rules (also in the PM memory)
- Pause when about 15 % of the weekly usage is used and the work is unfinished (the PM cannot see usage: the owner says "pause" or checks `/usage`).
- Commit only on the owner's request. English UI only. Windows first.
- The owner's pause/resume style: stop all agents, clean up, keep status files so work can continue without restarting.

## Git state
`main`: all REQ-002/003 work committed on 2026-10-18 at the owner's request, in four commits by area (`cfba581` backend, `efd215d` frontend, `fd4da25` e2e, `c632259` docs), plus the `AGENTS.md` commit for Codex hand-over. Only `.codex/config.toml` remains modified (IDE-owned: never commit or edit it). The intermediate commits do not build on their own; the tip does (`pnpm check` green before committing).

## Board
| Area | State | Evidence / where |
|---|---|---|
| Modbus Master MVP (REQ-001) | DONE, QA'd (UI + real app) | `docs/qa/REPORT-001`, `REPORT-002` |
| Version + changelog | DONE, committed | `f75f3f4`, `CHANGELOG.md`, `scripts/version.mjs` |
| Design REQ-002/003 | DONE | `docs/design/DES-002`, `DES-003`, `docs/qa/CHK-002`, `CHK-003`, `docs/questions.md`, mockups: https://claude.ai/artifact/65BXwiBFpmemEDiN1vHTEm |
| Backend BE-002 phase 1 + fixes | DONE, reviewed 3x | `docs/tasks/backend/BE-002`, `docs/reviews/REV-004`, `REV-008`; Rust: 389 passed, 0 failed, 1 ignored (`scan_rate`, run with `cargo test --workspace --test scan_rate -- --ignored --nocapture`) |
| Frontend FE-002 + FE-003 + fixes | DONE, reviewed | `docs/reviews/REV-005..007`; web: 139 files / 3,421 tests passed (verified by PM `pnpm check` 2026-10-18, exit 0) |
| QA UI mode (Playwright, fake IPC) | DONE | `docs/qa/REPORT-003..005` |
| QA integration (real app, simulator) | DONE three times | `REPORT-006` (86/90), `REPORT-007` (139/144), `REPORT-008-targeted-rerun` (D10, D8b, D4, scan rate, R7, K5 pass) |
| Defects D1-D10, D8b | FIXED and verified in a real window | REPORT-007, REPORT-008 |
| D11 toolbar flip-flop at client 664-672 css, D12 W1 toolbar "Disconnect" clipped 2 px | FIXED and verified in a real window (9/9 pass, no regression) | `docs/qa/REPORT-009-d11-d12.md`; notes in `docs/tasks/frontend/FE-002` "REPORT-008 final fixes" |

## Open items
- Designer decision (minor): DES-002 2.6 says full mode `px-4`, the D11 fix uses `px-3` in both modes (4 px loss). Accept or amend the design.
- CHK2-D3 oracle tolerance is too tight (0.5 ms vs an integer display); suggest 1.5 ms (designer edit).
- Cyrillic / AZERTY / Dvorak / German layouts are not installed on the QA machine: those keyboard cases are owner manual tests.

## Previous phase-1 next steps (historical)
1. DONE: D11/D12 verified (REPORT-009). Modbus Master phase 1 is closed from the team's side; only owner items remain.
2. Ask the owner: (a) DONE: commit; (b) DONE 2026-10-18: owner allowed deleting `target\debug\incremental`; 11.5 GB freed (now ~14 GB free). It regrows with builds; `incremental=false` is still an option; (c) the OWNER MANUAL TESTS (CHK2 section M: two monitors with different DPI, other scale factors, real Win+Left snap, AltGr/Alt codes/IME, NVDA, real Thai keyboard, other layouts, RTU hardware, 10-minute soak).
3. Owner decisions after Modbus Master is closed (each is a large piece of work: estimate cost first): launcher mockup/polish, installer + CI + `cargo-nextest`, Modbus Slave, IP Scanner, phase 2 (pop out by dragging, dock by dragging; Windows only, risks R1-R5 in DES-002 2.10.11).

## Other open owner items (not blocking)
- Final success/error colors (`#22c55e`, `#ef4444` proposed), `--color-surface` value, monospace font (bundled JetBrains Mono kept).
- Disk: free ~5.7 GB. `target` is about 20 GB.

## Cleanup state
QA cleans its own processes at the end of each run (ports 1420, 5020, 5021 free, `%TEMP%\esefact-it-tools` deleted after REPORT-008). Not ours and left alone: VS Code/Codex node runtimes, Teams/SearchHost WebView2, Playwright `test-server` from the VS Code extension.

## Key docs map
`CLAUDE.md` (rules), `docs/SETUP.md` (commands, simulator, dev-hooks build, scan-rate test), `docs/questions.md` (all decisions D-xxx and open questions), `docs/requirements/REQ-001..003`, `docs/design/DES-001..003`, `docs/tasks/{frontend,backend}/`, `docs/qa/CHK-*` and `REPORT-*`, `docs/reviews/REV-*`, `e2e/CHECKPOINT.md`. Agents: `.claude/agents/` (project-manager, designer, frontend, backend, qa-tester, code-reviewer, devops).
