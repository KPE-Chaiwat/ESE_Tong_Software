# DES-007 Visible full-sidebar collapse control

Revision 1, 2026-10-18. Upstream: REQ-007, DES/FE/CHK-002, D-002-38. English UI only.

## Screen and behavior

Add a persistent W1 toolbar button immediately before New poll. Expanded: sidebar-collapse icon and "Hide sidebar"; rail: sidebar-expand icon and "Show sidebar". Tooltip is "Hide sidebar (Ctrl+\)" or "Show sidebar (Ctrl+\)". Use the same accessible name as visible action (shortcut may be an accessible description), aria-expanded based on actual visibility and aria-controls pointing to the stable full sidebar element. Do not place it inside the disappearing sidebar or toolbar overflow. Existing rail Show remains available and invokes the same action.

Use existing toolbar size adaptation: icon with full tooltip/aria-label when narrow; always visible at minimum W1 client size, no document scrollbar, no more than existing two toolbar rows. It targets the whole Connection + Polls sidebar even when the last active poll is a sub-window. It calls W1 `actions.toggleSidebar()` directly rather than the keyboard router, which deliberately targets focused sub-window setup. W2 retains its existing setup controls; no W1-sidebar toggle is added there.

## State workflow

| State | Event | Next state / visible result |
|---|---|---|
| S0 noncompact expanded | button/rail route or outside-subwindow Ctrl+Backslash | S1; 44 px rail, workspace gains width, button says Show sidebar |
| S1 noncompact collapsed | same toggle | S0; full sidebar at last width, button says Hide sidebar |
| S0/S1 | enter compact mode | S2; existing compact rail, peek false; preserved noncompact collapse flag |
| S2 compact rail | toggle | S3; full sidebar temporarily shown at last width, peek true |
| S3 compact peek | toggle | S2; peek false; button says Show sidebar |
| S2/S3 | exit compact mode | S0 or S1 from preserved collapse flag; peek ends |
| any | profile layout restored | derive above from compact/collapsed state and existing restore rules; button matches actual visibility |

Actual expanded = `compact ? sidebarPeek : !sidebar.collapsed`. Compact peek must not change stored noncompact collapse choice. Last expanded width stays in workspace.sidebar.width (current clamp 220-400, default 280). Existing persistence is sufficient: WorkspaceLayout carries sidebarWidth/sidebarCollapsed and compact; `mm_set_workspace_layout` already reports layout without Modified. Peek remains transient under existing behavior; do not persist it as a new preference.

Network states idle, connecting, connected, polling, paused, timeout, disconnected and exception response are orthogonal: the toggle is usable in every state and leaves the current status/counters untouched. Invalid input drafts and empty/loading data remain intact. The sidebar stays mounted while hidden, as today, to preserve Connection form drafts and REQ-004 selection. There is no spinner, network request, confirmation or empty-state replacement for this local action. Existing layout persistence failure handling remains in force; no new backend command is needed.

## Focus, keys and style

Enter/Space activate the focused button. Pointer/keyboard activation leaves focus on that same persistent toolbar button. Ctrl+Backslash retains existing routing and D-002-38 physical Backslash/AltGr/IME rules; no remapping. If keyboard/other existing route hides content while focus is inside it, move focus to the persistent toolbar toggle before hiding. Rail Show retains its existing open-focus behavior; never leave focus in a hidden rail. Hidden sidebar controls are excluded from tab order/accessibility tree; the 44 px rail controls remain reachable. F6 region cycling skips hidden full-sidebar contents.

Use existing toolbar neutral button, sidebar icons, focus-ring, Afacad, spacing/radius and border tokens. Show/hide has no warning tint and no color-only state. Preserve selected ids, anchor, form errors/drafts, active view, sub-window/native host state, grid scroll and polling. Copy/paste/column resizing continue in their existing regions. Profile toggling never marks Modified; profile saved/reopened restores durable collapse/width using existing layout behavior.

## Implementation evidence

`components/sidebar/Sidebar.tsx` already uses `compact ? !peek : collapsed`, hides rather than unmounts the full aside and renders the 44 px rail. `runtime/connection-runtime.ts::toggleSidebar` toggles sidebarPeek in compact mode and workspace.toggleSidebar otherwise. `workspace.store.ts`/`workspace.logic.ts` already serialize width/collapsed through layout IPC. No contract gap found for BE-007. Share the actual-visibility selector between rail and new toolbar button to prevent label drift.
