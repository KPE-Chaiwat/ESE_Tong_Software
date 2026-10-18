# REPORT-020 — sidebar scope and compact persistence QA

2026-10-18. Browser-mode Playwright with the existing manual fake IPC harness; no Tauri/WebView2 app or simulator. Port 1420 was checked free before each run and is free after cleanup. No product code was changed.

## Evidence

- [CHK7-A2] `e2e/tests/chk7-sidebar-scope.spec.ts`: two W1 subwindows each had setup open. The W1 toolbar toggle hid/restored the full W1 sidebar while both subwindows and their setup state remained. Ctrl+Backslash with focus in the second subwindow toggled only that setup. A separate native W2 page retained its visible setup panel and `compact=false` throughout W1 toggles. PASS for these browser-harness subcases.
- [CHK7-A3] The same spec covers both durable starting states (`collapsed=false` and `true`): enter compact, open peek, hide peek, reopen peek, then exit compact while peek is open. Visibility, Show/Hide name, `aria-expanded`, and the durable expanded/collapsed outcome matched in both cases. PASS for these browser-harness subcases.
- [CHK7-A8] Sidebar resized from 280 to 328 px using the separator keyboard control, then hidden. Layout-only actions left Modified false. Save as serialized `sidebarWidth=328`, `sidebarCollapsed=true`, `compact=false`; after changing the in-memory layout to 280 and reopening the saved profile, Show restored a 328 px sidebar and the profile stayed unmodified. PASS for this fake-profile round trip.

The focused Playwright runs reported the A2 and both A3 cases passed together; the corrected A8 case passed in a dedicated rerun. The final A8 test line was `ok`, but the Playwright process did not emit its summary or exit after the completed test, so it was stopped. E2E `tsc --noEmit` passed. Biome check passed for `e2e/tests/chk7-sidebar-scope.spec.ts`.

## Limits

This is browser/fake-IPC evidence. It does not prove native WebView2 behavior, actual OS-level focus or assistive-technology announcements, or the remaining CHK-007 keyboard, DPI, layout, and hardware clauses. CHK-007 remains partial; no whole-checklist sign-off is claimed. Earlier failed A2/A8 attempts were test-harness setup issues (overlapping windows, required valid connection fields, and keyboard focus on the resize separator); the corrected test oracles passed without product changes.
