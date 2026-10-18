# STATUS (PAUSED 2026-10-18 at the owner's request; Modbus Master phase 1 CLOSED, waiting for owner decisions)

Paused with nothing running: no agents, no esefact/playwright processes, ports 1420/5020/5021 free, no temp dirs, 5.8 GB free. Nothing is half done; resume with "ลุยต่อ" and the owner answers to NEXT STEPS item 2.

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

## NEXT STEPS (in order)
1. DONE: D11/D12 verified (REPORT-009). Modbus Master phase 1 is closed from the team's side; only owner items remain.
2. Ask the owner: (a) DONE: commit; (b) permission to delete `target\debug\incremental` (~12 GB) or set `incremental=false`; (c) the OWNER MANUAL TESTS (CHK2 section M: two monitors with different DPI, other scale factors, real Win+Left snap, AltGr/Alt codes/IME, NVDA, real Thai keyboard, other layouts, RTU hardware, 10-minute soak).
3. Owner decisions after Modbus Master is closed (each is a large piece of work: estimate cost first): launcher mockup/polish, installer + CI + `cargo-nextest`, Modbus Slave, IP Scanner, phase 2 (pop out by dragging, dock by dragging; Windows only, risks R1-R5 in DES-002 2.10.11).

## Other open owner items (not blocking)
- Final success/error colors (`#22c55e`, `#ef4444` proposed), `--color-surface` value, monospace font (bundled JetBrains Mono kept).
- Disk: free ~5.7 GB. `target` is about 20 GB.

## Cleanup state
QA cleans its own processes at the end of each run (ports 1420, 5020, 5021 free, `%TEMP%\esefact-it-tools` deleted after REPORT-008). Not ours and left alone: VS Code/Codex node runtimes, Teams/SearchHost WebView2, Playwright `test-server` from the VS Code extension.

## Key docs map
`CLAUDE.md` (rules), `docs/SETUP.md` (commands, simulator, dev-hooks build, scan-rate test), `docs/questions.md` (all decisions D-xxx and open questions), `docs/requirements/REQ-001..003`, `docs/design/DES-001..003`, `docs/tasks/{frontend,backend}/`, `docs/qa/CHK-*` and `REPORT-*`, `docs/reviews/REV-*`, `e2e/CHECKPOINT.md`. Agents: `.claude/agents/` (project-manager, designer, frontend, backend, qa-tester, code-reviewer, devops).
