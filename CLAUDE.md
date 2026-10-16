# ESEfact

ESEfact is a Windows-first desktop launcher that bundles in-house industrial/network tools.
Tools: **Modbus Master** (first), Modbus Slave, IP Scanner (later). Must stay portable to other OSes later.

> Status: the monorepo is scaffolded and Modbus Master (REQ-001) is implemented and under QA. See `docs/STATUS.md`.
> Do not add new crates/apps (e.g. modbus-slave, netscan) until the PM issues a requirement for that tool.
> `dev-sim-slave` is a test-only simulator, not the future Modbus Slave product.

## Stack
- Frontend: React 19 + TypeScript (strict) + Vite, Tailwind + shadcn/ui, Zustand, TanStack Table + Virtual,
  react-router, react-hook-form + zod, Biome, Vitest + Testing Library, pnpm.
- Backend: Rust workspace + Tauri v2 (plugins: dialog, fs, store, window-state), tokio, tokio-serial,
  thiserror/anyhow, tracing, proptest, cargo-nextest.
- Types: Rust -> TypeScript via **ts-rs** (generated into `apps/desktop/src/shared/bindings/`, never edit by hand).
- E2E: Playwright.
- UI language: **English only**. No i18n library. Write UI strings directly in components.

## Layout (planned)
```
crates/  modbus-core (pure protocol, no I/O) <- transport (TCP/serial) <- modbus-master <- src-tauri
         platform (settings, profiles, logging, paths), shared-types (DTOs for ts-rs)
         modbus-slave, netscan: create only when that tool is actually built
apps/desktop/src-tauri/   thin Tauri layer: commands/, state.rs, windows.rs, error.rs
apps/desktop/src/         app/, launcher/, tools/<tool>/, shared/{ui,ipc,bindings,lib}
docs/                     requirements, design, tasks, qa (see Handoffs)
```

## Hard rules
1. Dependency direction is one-way (left to right above). `modbus-core` knows nothing about Tokio/Tauri.
2. A tool never imports from another tool. Shared code goes to `shared/` (frontend) or `platform` (Rust).
3. Only `shared/ipc` calls Tauri `invoke`/channels. Stores and components never import `@tauri-apps/api` directly.
4. OS-specific code (serial port listing, ARP, ICMP) lives behind a trait with `#[cfg(...)]` implementations.
5. Live polling data streams Rust -> UI through a Tauri `Channel`. The frontend never polls on a timer.
6. Connection/session state lives in Rust. React only displays it.
7. Each tool is a folder with a `manifest.ts` (id, display name, icon, route, window size). The launcher only reads manifests.
8. Modbus Master must expose raw TX/RX frame bytes (Communication Traffic view).
9. Do not decompile or copy code from commercial tools (Modbus Poll, Advanced IP Scanner). Implement from public specs.

## Visual identity (proposed, pending final owner sign-off)
- Font: Afacad (bundled via @fontsource, no CDN). Numbers/hex/register values/logs use a monospace font.
- Tokens (define once as CSS variables + Tailwind theme):
  dark `#312f2e`, light `#edeff2`, **primary accent lime `#d7f26c`**, warning orange `#fa8130`,
  success green (clearly greener than lime, proposed `#22c55e`), error red (proposed `#ef4444`).
- Orange is reserved for WARNING only. Never use it as a decorative/brand color.
- Status is never color-only: always pair with an icon or text (check / warning / cross).
- Look: rounded corners, light cards on soft background, dark contrast panels, pill-shaped tags/buttons.
- Check contrast (dark text on lime/orange).

## Handoffs (file-based, agents do not share memory)
| Stage | Owner | Output |
|---|---|---|
| Requirement | project-manager | `docs/requirements/REQ-<nnn>-<slug>.md` |
| Design | designer | `docs/design/DES-<nnn>-<slug>.md` (screens, state workflow, style list) |
| Frontend task | designer | `docs/tasks/frontend/FE-<nnn>-<slug>.md` |
| Backend task | project-manager (from REQ/DES) | `docs/tasks/backend/BE-<nnn>-<slug>.md` |
| QA checklist | designer | `docs/qa/CHK-<nnn>-<slug>.md` |
| QA report | qa-tester | `docs/qa/REPORT-<nnn>.md` |
| Review | code-reviewer | `docs/reviews/REV-<nnn>.md` |
Ids are shared per feature (e.g. REQ-001, DES-001, FE-001, BE-001, CHK-001 belong together).
Always read the upstream document before starting. If it is ambiguous, write the question in
`docs/questions.md` and stop instead of guessing.

## Definition of done
- Frontend: strict TS clean, Biome clean, Vitest passing for every store and util.
- Backend: `cargo clippy -D warnings`, `cargo nextest` passing, protocol code covered by test vectors.
- QA: Playwright run recorded in a REPORT, every checklist item marked pass/fail.
- Reviewer: no unresolved blocker.
