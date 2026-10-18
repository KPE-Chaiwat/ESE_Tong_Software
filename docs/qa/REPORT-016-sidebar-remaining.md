# REPORT-016 — sidebar toggle remaining automatable QA

2026-10-18. Scope: close automatable CHK-007 A2/A4/A9 gaps with component/Vitest evidence and document remaining manual-only checks. No browser server, port1420, Tauri app, simulator, build or product code was used or changed.

## Run and evidence

- `SidebarToggle.test.tsx`: 10 passed, including the new two-subwindow setup-independence case and hidden-sidebar accessibility/F6 case.
- `ShortcutMaps.test.tsx`, `ThaiLayout.test.tsx`, `shortcuts.test.ts`: 125 passed. Coverage includes physical `code=Backslash` handling, Thai-produced characters, Ctrl+Alt/AltGraph rejection, composing/IME rejection, and the W1/subwindow shortcut targets.
- Desktop `tsc --noEmit`: passed.
- Biome check on `SidebarToggle.test.tsx`: passed after formatting.
- No port1420 or real-window QA was used.

## CHK-007 dispositions

| ID | Disposition | Evidence and remaining scope |
|---|---|---|
| CHK7-A2 | PARTIAL | Component harness verifies toolbar toggle hides W1 after opening a subwindow setup, and setup state stays local to each of two subwindows. The physical Backslash shortcut tests retain the focused setup target. A real-application multi-window rerun of this clause remains outstanding. |
| CHK7-A4 | PARTIAL | Component tests verify Enter/Space and pointer toggle activation, shortcut focus transfer, rail restore focus, hidden controls excluded from Testing Library's accessibility role queries, and F6 visiting the visible rail then workspace. Existing full accessibility tests cover F6 region cycling. Native browser Tab traversal and assistive-technology output are not proven by jsdom. |
| CHK7-A9 | PARTIAL | Automated shortcut tests cover physical Backslash, AltGr/AltGraph suppression and composing events; the Thai layout fixture covers its generated key values. REPORT-008 records real Thai keyboard hardware checks. Screen-reader naming/controlled-state announcements and other physical layouts remain manual. Existing contrast/focus styling checks remain separate evidence. |
| CHK7-A8 (related persistence) | PARTIAL | REPORT-011 real-window run confirms `sidebarCollapsed=true`, `compact=false`, and `sidebarWidth=280` survive save/reopen and toolbar visibility matches; this focused run did not repeat persistence with a non-default width. |

## Manual-only gaps

- NVDA or another screen reader: verify the persistent toggle announces the current Show/Hide name, controlled sidebar and expanded state; verify rail buttons have useful spoken names.
- Mixed-DPI multi-monitor movement, alternate scaling factors, and minimum-size/layout behavior on the owner's monitor setup. Existing QA machine evidence is one 1920×1080 monitor at 125% (REPORT-011); it cannot establish cross-monitor DPI transitions.
- Physical keyboard layouts unavailable on the QA machine (Cyrillic, AZERTY, Dvorak and German QWERTZ) remain owner manual cases per D-002-40. Real Thai keyboard evidence is recorded in REPORT-008; it does not replace those other layouts.
- Browser/WebView2 native keyboard traversal and actual focus-ring rendering across compact/full modes should be checked in the real window. Component assertions do not prove OS-level focus rendering.

No product defect was found. These results add focused component evidence and do not sign off CHK-007 as a whole.
