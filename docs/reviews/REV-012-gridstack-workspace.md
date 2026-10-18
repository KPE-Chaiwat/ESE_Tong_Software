# REV-012 — GridStack workspace review

Date: 2026-10-18. Scope: REQ/DES/FE/BE/CHK-008, implementation and REPORT-025.

- GridStack is the active W1 Poll layout engine. Old `SubWindowFrame`/`TitleBar` modules remain in source but have no runtime imports. Native popped-out windows retain the existing OS path. The sidebar's row-drag preview still uses the prior drop gesture, then GridStack owns the resulting widget placement.
- Schema 4 stores bounded cell geometry. Legacy schema 1–3 decode and migrate; future/invalid schema tests and exact profile reopen pass. Grid updates do not edit Poll definitions or trigger Modbus commands.
- Review found and fixed an orphaned GridStack element after minimize, a double-backslash setup label, a stale legacy tile-mode restore, and new Polls stacking into one column. Full validation and real-window checks in REPORT-025 pass.

Disposition: implementation accepted for REQ-008. Manual mixed-DPI, RTU hardware and long-soak coverage remains in the wider project matrix.
