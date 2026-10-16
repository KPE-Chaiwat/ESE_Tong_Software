# STATUS (2026-10-16)

Product: ESEfact launcher. First tool: **Modbus Master** (REQ-001): implemented, reviewed and QA-verified. Nothing is committed yet (`git init` only, all files untracked).

## Done
| Stage | State | Documents / code |
|---|---|---|
| Scaffold | done | Cargo workspace + `apps/desktop` (Tauri v2, React/Vite), `docs/SETUP.md` |
| Requirement | done | `docs/requirements/REQ-001-modbus-master.md` |
| Design (rev 4) | done | `docs/design/DES-001-...`, `docs/tasks/frontend/FE-001-...`, `docs/qa/CHK-001-...`, `docs/questions.md` (D-001-01..15) |
| Backend | done, reviewed twice, 157 Rust tests | `docs/tasks/backend/BE-001-...` (Final contract), `docs/reviews/REV-001-backend.md` |
| Frontend | done, reviewed (REV-002 changes required -> REV-003 approve), 934 Vitest tests | `docs/reviews/` |
| Dev simulator | done | crate `dev-sim-slave` -> `esefact-sim-slave` (`docs/SETUP.md` section 4); test tool only |
| QA UI mode | 218 pass / 0 fail / 16 skipped; perf 2 pass | `docs/qa/REPORT-001-ui-mode.md` (rev 2; numbers before the 14 rev 4 tests) |
| QA integration (real app, WebView2) | 3 consecutive full runs 65 pass / 0 fail / 1 skipped | `docs/qa/REPORT-002-integration.md` (final) |

All test numbers are the agents' own reports; the PM has not re-run the suites.

## Still open
1. Owner decisions: final success/error hex (`#22c55e`, `#ef4444` proposed), `--color-surface` value, monospace font (bundled JetBrains Mono kept; designer proposed system stack).
2. First git commit (not done: not requested). Suggest splitting by area.
3. Housekeeping: install `cargo-nextest` (CLAUDE.md names it; `cargo test` used so far), CI (GitHub Actions; `pnpm check` is the one-liner), replace placeholder icon, build the installer (`pnpm build`, never run).
4. Not testable on this setup: RTU serial hardware (D11, M8, H6, I7-I9), slow connect and blackhole (B1-B3, I3), DNS (I2), NVDA (R4), 10-minute soak (only 2 minutes done; memory past the 5,000-frame cap was within 10%).
5. Launcher polish and the Artifact mockup requested earlier (not started). The launcher in the app is a minimal page with one card.
6. Next tools (each needs its own REQ): Modbus Slave, IP Scanner.

## How to resume
- Corepack shims live in `$HOME\.corepack-bin`; prepend to PATH per shell (see `docs/SETUP.md`). pnpm is pinned to 10.34.6.
- Agents are defined in `.claude/agents/` (project-manager, designer, frontend, backend, qa-tester, code-reviewer, devops). Start with `claude --agent project-manager`, or dispatch them from a normal session.
- Rules for every agent are in `CLAUDE.md`; handoffs are files under `docs/`.
- Before running integration tests make sure no `esefact-desktop`, `esefact-sim-slave` or test WebView2 processes are left from a previous run. QA's per-step notes are in `e2e/CHECKPOINT.md`.
