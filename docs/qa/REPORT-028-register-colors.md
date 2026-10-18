# REPORT-028 · Colors for individual registers

Date: 2026-10-18

The owner corrected the color-rule workflow: choosing colors must be possible for each register. Previously the row context menu opened a whole-poll editor, and new rules defaulted to Whole poll with a required numeric threshold.

The normal and combined row menus now offer **Set colors for register N…**. It creates or reopens an **Always (no condition)** rule for that register's protocol address, selects **Single register** scope, and exposes separate background/text pickers. Register-specific rules take precedence over broader rules. The conditional rule editor still supports Whole poll and Range. The per-poll rule limit is 256, so a 125-register read can color every register separately.

Verification: `pnpm bindings`, `pnpm typecheck` and `pnpm lint` passed. Full `pnpm test:rust` passed. The first full `pnpm check` after raising the limit reached one frontend test that still expected rejection at 17 rules; after correcting that assertion, full frontend rerun passed 153/153 files and 3,462/3,462 tests. Post-test `pnpm lint:web`, `pnpm bindings:check` and diff whitespace check passed. `pnpm build:web` and normal embedded `cargo build --workspace` passed. Real Tauri/WebView2 + TCP simulator tests `29-custom-rule-colors.spec.ts` and `30-register-colors.spec.ts` passed 2/2. The latter verified distinct colors on registers 11 and 12, an unaffected next row, profile save, and reopening a register rule without duplication. No ESEfact or simulator process remained after QA.

Final debug executable: `target/debug/esefact-desktop.exe`, SHA256 `4fb0073e271c8403ee26ca4720852f0d90ada39a5b4dc3727ea84fe6046fe37f`. No commit or installer.
