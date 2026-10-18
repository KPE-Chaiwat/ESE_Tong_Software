# REPORT-029 Row color rule scope

Date: 2026-10-18. Owner reported that using `Value color rules…` from register 1 in `pnpm dev` colored both registers 0 and 1 when their values were 200.

## Finding and fix

The row context action opened a draft whose address range was `Whole poll`. The rule therefore matched both values. It now creates or reopens a conditional rule scoped to the clicked register. When one existing rule covers the whole poll, opening it from a row narrows that rule in the draft while retaining its condition and colors. Poll setup's `Edit rules…` continues to edit the complete list. Read-only numeric cells use `user-select: none` so a mouse selection cannot overlay their rule colors.

## Evidence

- Focused Vitest: 2 files, 12 tests passed. The regression uses equal values (200, 200), applies `>50` from register 1, and checks that only register 1 has a rule marker.
- `pnpm check`: exit 0; version, 93 generated bindings, desktop/e2e typecheck, Rust fmt/clippy, Biome, Rust workspace tests and 153 frontend files / 3,464 tests passed.
- `pnpm build:web` and `cargo build --workspace` with `TAURI_CONFIG={"build":{"devUrl":null}}`: exit 0. Embedded debug executable SHA256 `0c7cd2ae56342eaf26745f3afa52752332fd39e7d7ce508ed3a498fcd8b942c6`.
- Real Tauri/WebView2 and TCP simulator: `tests-integration/30-register-colors.spec.ts`, 3/3 passed. The new-rule case sends 200 to registers 0 and 1, opens `Value color rules…` from register 1, verifies Single register 1, applies `>50` with custom blue/white colors, checks only register 1 is colored and the profile stores `{start:1,end:1}`. Both read-only value cells report `user-select: none`. A separate case starts with a whole-poll `>50` rule coloring both rows, reopens it from register 1, applies the narrowed range, and verifies register 0 loses the rule color while register 1 keeps it.
- E2E fixture left no ESEfact or simulator process running. No commit or installer was made.

Remaining: manual inspection on the owner's `pnpm dev` window. A profile with multiple pre-existing broad rules retains those rules until edited in Poll setup.
