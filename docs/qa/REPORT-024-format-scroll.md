# REPORT-024 — Format / endian scroll regression

2026-10-18. The owner reported that after applying a combined value format, the Poll title and top data area moved above the visible workspace. The screenshot showed the setup panel still inside a clipped Poll frame.

## Cause and change

- The new Format / endian row action called `scrollIntoView` and ordinary `focus` on the format select. Those operations can move outer scroll ancestors as well as the setup panel.
- On applying a 32/64-bit format, the newly mounted combined grid called `scrollIntoView` for its focused row. This matched the reported timing after Apply.
- Both paths now adjust only their own setup or grid scroll container. The format select uses `focus({ preventScroll: true })`. Poll frame position and document scrolling are untouched.

## Verification

- Focused Vitest: 3 files / 14 tests passed, including local setup/grid scrolling and existing combined keyboard navigation.
- Desktop and E2E TypeScript passed; focused Biome passed.
- Browser Playwright UI mode with scriptable fake IPC: 1/1 passed after both Apply interpretation and Poll Apply. It opened Format / endian from a live register row, confirmed the grouped data, and asserted the Poll title stayed at the same visible workspace position with workspace/frame `scrollTop` at zero. The final passing run used a controlled temporary Vite server; it was stopped afterward. An earlier run against the owner's non-fake development server could not initialize fake IPC, and the standard Playwright webServer teardown hung once; neither failure was a product assertion.
- Real Tauri/WebView2 + TCP simulator: 1/1 passed after both Apply buttons. The normal self-contained debug executable kept the Poll title at the same visible workspace position, with grouped data shown and workspace/frame scroll offsets at zero. Initial harness failures were corrected by building with Tauri (to embed frontend assets) and using the current semantic Polls list locator.
- Full `pnpm check` passed: version, 91 generated bindings, desktop/E2E TypeScript, Biome, Rust fmt/clippy/tests and frontend 155 files / 3,546 tests. `pnpm build:web`, `cargo build --workspace`, Tauri debug `--no-bundle`, post-build bindings check and diff check passed.
- Final executable SHA256 `298705c565b6e07000942366b0006ee7bd030ac5b7676aed182ce381a883227f`; 6.81 GB free after QA. Test desktop/simulator and temporary Vite server stopped. No commit.

