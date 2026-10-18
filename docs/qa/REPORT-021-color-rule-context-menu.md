# REPORT-021 — Value color rules row-menu access

2026-10-18. The owner showed a normal register row context menu without a Color rule entry. The existing per-poll rule editor was reachable through Poll setup. Normal and combined-register row menus now offer **Value color rules…**, opening the same editor and revealing setup when hidden.

## Automated evidence

- `RuleSection.test.tsx`: 6/6 passed, including two new cases that open the editor from normal and combined grids with setup initially closed, then Cancel and confirm the applied rules are unchanged. Existing editor validation/failure tests also pass.
- Full frontend Vitest: 154 files / 3,539 tests passed. Desktop/E2E TypeScript, desktop Biome and Rust fmt/clippy passed in the `pnpm check` run; version and 91 generated bindings passed.
- Independent read-only review found no blocker in menu-to-setup/modal mounting, focus restoration, selection handling, or draft persistence. Native-host real-window repetition remains unverified.

The first full `pnpm check` run could not finish Rust tests because Windows denied replacement of the running `target/debug/esefact-desktop.exe`. The owner then closed that process. `pnpm test:rust` passed (exit 0), completing the gate stages that had already passed in the first run. `pnpm build:web` and `cargo build --workspace` passed, producing a new normal debug executable containing this menu change. Post-build `pnpm bindings:check` passed (91 files). SHA256: `494f0f2f3aa200d2bbb1ca9c30ae4a8f6bf724140d09fc7d01846bc9d7d94b6a`.
