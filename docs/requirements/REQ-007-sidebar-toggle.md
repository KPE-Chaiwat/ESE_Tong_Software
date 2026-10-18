# REQ-007 Visible full-sidebar collapse control

Source: owner request, 2026-10-18. Extends REQ-002; Ctrl+Backslash already exists.

## Goal and user story
An engineer clicks an obvious control to collapse the entire left sidebar, including Connection and Polls, and clicks again to restore it.

## Scope and PM defaults
- Add a persistent, discoverable click target in the connection window for Hide sidebar / Show sidebar. It toggles the same sidebar state as Ctrl+Backslash when focus is outside a sub-window, preserving the existing collapsed rail and its restore route.
- This control targets the full connection-window sidebar even if a sub-window was last active. Its label, tooltip and accessible expanded state reflect the actual sidebar state. It remains reachable in compact mode and at the supported minimum window size.
- Restore the last expanded width; preserve sidebar field drafts, poll selection and current connection/poll state. Collapsing causes no network, polling or window-host changes.
- Reuse existing sidebar layout persistence and Modified rules: save the collapsed state/width as layout without marking the profile Modified. Preserve existing compact-mode behavior rather than adding a second collapse setting.
- Keyboard users can focus and activate the button with Enter/Space. Focus stays on the toggle when activated; collapsed contents are not in the tab order. A tooltip documents Ctrl+Backslash; D-002-38 layout/AltGr rules remain intact.

## Acceptance criteria
1. Click hides both Connection and Polls and expands usable workspace; Show restores both at the former width. There is always a visible way to restore.
2. Button and existing shortcut remain synchronized across expanded/collapsed and compact-mode transitions. Existing setup-panel shortcuts still target their respective sub-window/native panel.
3. Connection settings drafts and bulk selection survive a hide/show cycle; network requests/counters and poll definitions are unaffected.
4. Minimum-size layout has no document scrollbar, clipped toggle or inaccessible restore path. Keyboard/screen-reader name, focus and expanded state match the visible result.
5. Profile layout round-trip restores collapse state without making the profile Modified merely by toggling.

## Out of scope
New sidebar layout, removal of the collapsed rail, changing compact mode semantics, or changing shortcuts.

## Handoff and open questions
Designer produces DES/FE/CHK-007 and verifies whether existing layout IPC covers the change; no backend change is expected unless design identifies a specific contract gap. No owner decision blocks design.
