# ESEfact: instructions for Codex (and any non-Claude agent)

Read these first, in order: `CLAUDE.md` (project rules, stack, layout, handoffs, definition of done), `docs/STATUS.md` (current state and next steps), `docs/SETUP.md` (commands). This file only adds what is easy to miss. If it disagrees with `CLAUDE.md`, `CLAUDE.md` wins.

ESEfact is a Windows-first desktop launcher (Tauri v2 + React/Vite + Rust workspace). Tool 1, Modbus Master, is implemented and QA'd (REQ-001..003). Owner writes in Thai; all UI text is English only.

## Owner rules (must hold)
- Do NOT commit, push or amend unless the owner asks in this session. Never commit `.codex/config.toml` and never edit it.
- Disk is limited: never `cargo clean`, never `cargo test -p <pkg>` or per-package builds (use workspace-wide commands), and ask before deleting any cache (`target\debug\incremental` is about 12 GB).
- Do not create a new tool/crate (modbus-slave, netscan) until a requirement `docs/requirements/REQ-<nnn>-*.md` exists for it. `dev-sim-slave` is a test simulator, not the Modbus Slave product.
- Do not decompile or copy code from commercial tools. Implement from public specs.
- Pause when asked ("pause"): stop what is running, clean up temp files and processes, update `docs/STATUS.md`.
- Update `CHANGELOG.md` under `## [Unreleased]` in the same change as every user-visible change. Change the version only with `pnpm version:set <x.y.z>`.

## Environment (Windows, PowerShell)
- Prepend the corepack shims per shell: `$env:PATH = "$HOME\.corepack-bin;$env:PATH"` (pnpm 10.34.6, Node 22.19, Rust 1.92).
- Verify everything with `pnpm check` (about 2.5 min, about 1.2 GB of disk each run, so once per round). Last result: web 139 files / 3,421 tests, Rust 389 passed / 0 failed / 1 ignored.
- Generated files in `apps/desktop/src/shared/bindings/` come from ts-rs; never edit by hand (`pnpm bindings:check` fails when stale).

## How work is organized
- No role agents exist for you. Do one role at a time and use the file handoffs in `CLAUDE.md` (REQ -> DES -> FE/BE -> CHK -> REPORT -> REV). Read the upstream document first; if it is ambiguous, write the question in `docs/questions.md` and stop.
- Decisions made so far are in `docs/questions.md` (D-xxx). Do not re-litigate them.
- Real-window QA (Playwright over CDP with the simulator) is described in `e2e/CHECKPOINT.md`; it needs a normal debug build and a disk guard of about 3 GB free.

## Style
- Match the surrounding code (comment density, naming). Strict TypeScript, Biome clean, `cargo clippy -D warnings` clean.
- Status is never color-only (icon or text too). Orange is only for warnings.
