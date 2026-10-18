# FE-007 Visible full-sidebar collapse control

Revision 1, 2026-10-18. Read REQ-007 and DES-007 first; reuse FE-002 shell/runtime/layout state.

| Task | Goal / components | Workflow | Store unit and acceptance |
|---|---|---|---|
| 1 | Derive actual sidebar visibility in one shared selector | S0-S3 | Existing workspace.sidebar:{width,collapsed}, prefs.compact, layout.sidebarPeek; derive `compact ? peek : !collapsed`. No new persistent store. Unit-test all four states, compact enter/exit and profile layout restore; toggle uses existing action and does not modify definitions/profile Modified. |
| 2 | Persistent toolbar toggle, synchronized rail names/expanded state | S0-S3 | Toolbar + Sidebar; call W1 actions.toggleSidebar directly. Expanded Hide sidebar, collapsed Show sidebar, exact shortcut tooltip, aria-expanded/controls. Button stays visible outside overflow and remains focused on Enter/Space/click. Test last-active sub-window still changes entire sidebar; Ctrl+Backslash in that sub-window continues to target its setup. |
| 3 | Focus and compact/minimum layout regression | all S states; all link/data states | Existing shell focus helpers: route focus from disappearing sidebar/rail to persistent toolbar toggle. Preserve hidden mounted content and checkbox selection store. Check draft errors, widths 220/280/400, compact peek reset, F6/Tab, minimum W1 and narrow toolbars. No document scrollbar/toggle clipping. Existing layout IPC round-trip sufficient; no backend task. Add implementation changelog entry, run pnpm check once per round, then CHK-007. |
