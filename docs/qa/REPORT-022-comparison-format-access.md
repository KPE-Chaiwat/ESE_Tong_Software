# REPORT-022 — Comparison labels and Format / endian access

2026-10-18. Owner follow-up to REQ-005/006. The Comparison select and rule summary now show the operator in parentheses (`=`, `!=`, `<`, `<=`, `>`, `>=`); Between is explicitly inclusive. Normal and combined-register row menus now offer **Format / endian…**, which reveals and focuses the existing Poll setup Interpretation controls. The menu never applies a draft by itself.

## Verification

- Focused component tests: `RuleSection.test.tsx` and `InterpretationSection.test.tsx`, 10/10 pass. New cases cover symbols in Comparison, both normal/combined grids, workspace/native hosts, opening setup from a row menu, focus on Interpretation, and no implicit format change.
- Full frontend Vitest: 154 files / 3,541 tests pass. Desktop and E2E TypeScript pass; desktop Biome clean (368 files). `pnpm build:web` and `cargo build --workspace` pass.
- Post-build bindings check passes (91 files); `git diff --check` passes. Independent read-only reviewer found no concrete blocker. No Rust code changed in this follow-up; Rust tests and clippy passed in the immediately preceding round (REPORT-021).
- Normal debug executable: `target/debug/esefact-desktop.exe`, SHA256 `d51b446f6094e9823dd5eff0bbbaa5fd6655c54fbe863676da04fb6b55336b4d`. Disk remained above 3 GB. No commit or release package.

Real-window repetition of the new menu entry is still open. The existing combined-register behavior and four byte/word orders were previously covered by REPORT-010..019; this change only adds access to their existing editor.
