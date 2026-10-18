# REPORT-026: Custom value rule colors

Date: 2026-10-18. Scope: owner correction to REQ-005. The old Highlight control offered only Lime, Neutral and Warning presets; it had no separate background or text color picker.

## Result

- Added Custom colors with native Background color and Text color inputs. Preview changes before Apply; current raw, scaled and combined value cells use the selected pair after Apply. The existing rule marker and warning precedence remain.
- Frontend and backend reject malformed RGB and pairs with text contrast below 4.5:1. The original presets and old rules remain supported.
- Profiles now save schema 5 and read/migrate schemas 1–4. Rule color pairs persist through save and poll duplication. The migration notice now describes all old schemas accurately.
- `pnpm test:web`: 153 files, 3,459 tests passed. `pnpm test:rust`: exit 0. `pnpm typecheck`, `pnpm lint:rust`, `pnpm lint:web`, `pnpm build:web` and final `pnpm bindings:check` passed. `git diff --check` returned 0 (CRLF conversion warnings only).
- `e2e/tests-integration/29-custom-rule-colors.spec.ts`: 1/1 passed in real Tauri/WebView2 against the TCP simulator. Verified native pickers, live Preview color, raw register cell foreground/background computed CSS, backend export, schema 5 profile file and saved color pair. The fixture stopped its desktop and simulator.

Normal embedded-frontend debug executable: `target/debug/esefact-desktop.exe`, SHA256 `1e8dc27179ff42feaee12adc0909f0e768aae00ef645d075f5ac4bdd1a59505e`, 20,920,320 bytes. It was built with workspace-wide Cargo and `TAURI_CONFIG={"build":{"devUrl":null}}` so it opens its bundled frontend without the Vite server. No installer or commit was made. Free C: space after QA exceeded 6 GB; no cache was deleted.

## Limits

The focused real-window scenario covers one custom pair in one live raw cell and profile save. Scaled/combined cells use the same style helper, but separate custom-color vectors for those formats were not run. Mixed-DPI, RTU hardware and long-soak checks remain outside this round.
