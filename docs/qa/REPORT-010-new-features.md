# REPORT-010 new features — provisional browser QA

2026-10-18. Scope: deterministic Playwright UI mode with manual fake IPC. **This is not real-window QA, simulator integration, or release sign-off.** Product implementation was being integrated concurrently; real-window build/run is awaiting PM authorization after review and the full gate.

Environment: Windows, Chromium from the existing Playwright install, Vite 8.3.4, viewport 1618×834, one worker. No product code was changed. Source: `e2e/tests/chk4-7-new-features.spec.ts` (20 tests; checklist ids in titles). Tests use observable conditions, with no fixed sleeps.

Clean run command (owned Vite server already running with `VITE_FAKE_IPC=manual`):

```powershell
$env:PATH = "$HOME\.corepack-bin;$env:PATH"
$env:E2E_REUSE_SERVER = "1"
pnpm.cmd exec playwright test --project=ui tests/chk4-7-new-features.spec.ts --workers=1
```

Result: **20 passed, 0 failed, 0 skipped; exit 0; 30.2 seconds**. JSON evidence: `e2e/test-results/results.json`, start `2026-10-18T03:56:07.975Z`, expected=20/unexpected=0/flaky=0. HTML: `e2e/playwright-report/index.html`. These generated artifacts are overwritten by later runs. E2E TypeScript check passed. Root-invoked Biome checked/formatted the one new spec successfully.

Earlier attempts printed seven passing tests but hung in Playwright-managed webServer teardown; they were interrupted and are inconclusive completed-run evidence. A first checkbox test used the obsolete listbox helper (the new poll list correctly uses different semantics); a second included the Connection checkbox. The final locator names only Select A/B/C/D. These were harness corrections, not product failures. Old display seeds lacked schema3 swap booleans and caused a React uncontrolled/controlled warning; explicit false/false defaults eliminate it in the clean run.

## Coverage and remaining work

PASS below means the stated subcase passed in browser mode. PARTIAL means that checklist id has untested clauses; no whole checklist is considered passed. SKIPPED means no evidence was collected for that item in this run. Real app, native host, simulator traffic, profile migration, injected lifecycle faults, accessibility tools, timing/performance and hardware are still pending where specified by CHK. Existing unit-test results are not claimed as evidence here.

Verified subcases:

- CHK4-A1/A3/A4: initial empty selection, pointer range, Home focuses without selecting, list Ctrl+A/Ctrl+Shift+A, hide/show retains membership, no Modified from selection. Profile replacement/reorder/deleted-anchor and other keyboard paths remain pending.
- CHK5-A1: 24/25/26 across Equals, Not equals, Less, Less or equal, Greater, Greater or equal. Between remains pending.
- CHK5-B1/B2/B4: empty editor, default new rule, empty/comma threshold exact errors, invalid focus, valid Apply closes and updates summary, Escape discards draft and returns focus. Full validation vectors, limit/reorder and IPC pending/failure paths remain pending.
- CHK6-A1/A3: exact UI and clipboard vectors i32 -2, u32 max, i64 min, u64 max, u64 9007199254740993, f32 0.10000000149011612 and f64 0.1. Remaining numeric/nonfinite vectors pending.
- CHK6-A2: all four 32-bit byte/word orders for 1234 5678, exact decimal, unchanged Raw words. 64-bit order vectors pending.
- CHK6-A4/B4/C2: start1/Q5 -> 32-bit complete groups plus incomplete5; 64-bit group1–4 plus incomplete5. Inspector remainder contains only one actual word; Escape restores opener focus. Draft leaves table unchanged before Apply. Remaining boundaries, aliases/base, IPC acknowledgment delay/failure pending.
- CHK7-A1: full sidebar disappears, 44px rail, workspace gains width, synchronized aria-expanded/name, prior width restores.
- CHK7-A3: compact peek exit restores both expanded and collapsed durable states, without Modified. Explicit peek-hide before compact exit remains pending.
- CHK7-A4: Enter and Space on persistent toggle retain focus. Shortcut/rail/F6/accessibility paths pending.

## Per-item disposition

### CHK-004

| Item | Status |
|---|---|
| CHK4-A1 | PARTIAL — subcases above pass; remainder pending |
| CHK4-A2 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK4-A3 | PARTIAL — subcases above pass; remainder pending |
| CHK4-A4 | PARTIAL — subcases above pass; remainder pending |
| CHK4-A5 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK4-A6 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK4-A7 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK4-B1 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK4-B2 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK4-B3 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK4-B4 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK4-B5 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK4-B6 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK4-C1 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK4-C2 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK4-C3 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK4-C4 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK4-C5 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK4-D1 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK4-D2 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK4-D3 | PARTIAL — subcases above pass; remainder pending |

### CHK-005

| Item | Status |
|---|---|
| CHK5-A1 | PARTIAL — subcases above pass; remainder pending |
| CHK5-A2 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK5-A3 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK5-A4 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK5-A5 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK5-A6 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK5-A7 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK5-A8 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK5-B1 | PARTIAL — subcases above pass; remainder pending |
| CHK5-B2 | PARTIAL — subcases above pass; remainder pending |
| CHK5-B3 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK5-B4 | PARTIAL — subcases above pass; remainder pending |
| CHK5-B5 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK5-C1 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK5-C2 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK5-C3 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK5-C4 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK5-C5 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK5-D1 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK5-D2 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK5-D3 | SKIPPED — pending dedicated browser or required real-window/manual run |

### CHK-006

| Item | Status |
|---|---|
| CHK6-A1 | PARTIAL — subcases above pass; remainder pending |
| CHK6-A2 | PARTIAL — subcases above pass; remainder pending |
| CHK6-A3 | PARTIAL — subcases above pass; remainder pending |
| CHK6-A4 | PARTIAL — subcases above pass; remainder pending |
| CHK6-A5 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK6-B1 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK6-B2 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK6-B3 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK6-B4 | PARTIAL — subcases above pass; remainder pending |
| CHK6-B5 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK6-B6 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK6-C1 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK6-C2 | PARTIAL — subcases above pass; remainder pending |
| CHK6-C3 | PARTIAL — subcases above pass; remainder pending |
| CHK6-C4 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK6-C5 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK6-C6 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK6-D1 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK6-D2 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK6-D3 | SKIPPED — pending dedicated browser or required real-window/manual run |

### CHK-007

| Item | Status |
|---|---|
| CHK7-A1 | PASS — browser only |
| CHK7-A2 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK7-A3 | PARTIAL — subcases above pass; remainder pending |
| CHK7-A4 | PARTIAL — subcases above pass; remainder pending |
| CHK7-A5 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK7-A6 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK7-A7 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK7-A8 | SKIPPED — pending dedicated browser or required real-window/manual run |
| CHK7-A9 | SKIPPED — pending dedicated browser or required real-window/manual run |

## Cleanup

Owned Vite session stopped with Ctrl+C after tests; port1420 has no listener. No desktop app/simulator build or integration process was started. No caches, configuration, STATUS or changelog were changed. No commit was made. Product defects found in this limited browser scope: none. Full checklist coverage remains open as listed above.
