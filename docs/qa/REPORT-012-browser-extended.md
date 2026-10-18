# REPORT-012 — extended browser QA for REQ-004..007

2026-10-18. Scope: Playwright UI mode with manual fake IPC, extending the browser subcases from REPORT-010. This is not real-window QA, simulator integration, or release sign-off. No product code changed.

## Run and result

- Environment: Windows, Chromium, Vite 8.3.4, 1618×834 viewport, one worker. Vite ran with `VITE_FAKE_IPC=manual`; Playwright reused that server.
- Command: `pnpm.cmd exec playwright test --project=ui tests/chk4-7-new-features.spec.ts --workers=1 --reporter=list` from `e2e/`.
- Result: **24 passed, 0 failed, 0 skipped; exit 0; 35.7 seconds.** This is the full 20-test REPORT-010 spec plus four added cases.
- `pnpm.cmd exec tsc --noEmit` from `e2e/`: exit 0. Biome check for `e2e/tests/chk4-7-new-features.spec.ts`: exit 0.
- Cleanup: stopped the Vite session started for this run; port 1420 has no listener. No desktop app, simulator, build, cache or product state was changed.

## Added browser evidence

- **CHK6-A2:** all four byte/word orders for unsigned 64-bit `0123 4567 89AB CDEF` display exact values and clipboard text. Raw words stay in address order.
- **CHK5-A1/A8:** Between includes both endpoints for 24–26; 23 and 27 do not match. With overlapping rules, the first rule wins; moving the second rule above it changes the marker to the second rule.
- **CHK5-B2:** a Between upper threshold below the lower threshold shows the specified inline validation error, focuses Upper, and does not apply the draft.
- **CHK4-A4:** checkbox arrows move focus without changing membership; Shift+ArrowDown extends the existing B anchor through D. Ctrl+A in the Host field selects its text and leaves poll selection intact.

The final test also reran the 20 existing REPORT-010 browser cases; all passed. The initial exploratory run exposed two test-harness mistakes (unsupported detached-element matcher and an incomplete expected Shift+ArrowDown range); both oracles were corrected. The clean final run passed and did not establish a product defect.

## Remaining gaps

This report adds browser-mode subcases only; checklist items remain partial and none is signed off here. CHK-005 still needs the broader source, scaling, nonfinite, range, precedence, validation and persistence matrices. CHK-006 still needs the full numeric vector and boundary set, additional copy/grouping cases, IPC failure and accessibility/performance checks. CHK-004 still needs the full keyboard focus/exclusion matrix, bulk capacity/stale-operation cases and lifecycle/failure paths. Real Tauri host behavior, native-window fault injection, simulator traffic, hardware, screen-reader, DPI and performance checks remain in the integration/manual scope described by REPORT-011.
