# DES-004 Sidebar poll selection and bulk actions

Revision 1, 2026-10-18. Upstream: REQ-004; DES-002 sections 2.2.3, 2.5.1 H3, 2.10.6, 2.11; FE/CHK-002; D-002-11, D-002-31, D-002-34. This document specifies UI behavior; BE-004 owns transaction and window implementation.

## Screens and layout

W1 expanded sidebar retains Connection and the existing Polls heading/count. Add a permanently visible selection checkbox at the left of every poll. Keep the grip, name, host marker, state chip and row actions. Under the Polls heading place a wrapping action area:

```text
POLLS · 4 of 16
2 selected       [Select all] [Clear selection]
[Duplicate selected] [Delete selected…]
[✓] ⋮ Pump A                  [⋯]
       Polling · 1 · FC03 · 0-9
[ ] ⋮ Pump B                  [⋯]
       Paused · 2 · FC03 · 0-9
```

Count is always visible, including "0 selected". Select all is disabled for zero polls or all selected; Clear selection and both bulk actions are disabled for zero selection. At 220 px sidebar width buttons wrap without clipping; the sidebar remains its own scroll region. The collapsed rail keeps existing Show controls; use Show sidebar to reach selection. No extra bulk surface in W2.

Selection checkmarks express bulk membership. The existing dark 3 px active-row bar and explicit accessible "Current poll" description express active/last targeted poll, independently of membership. Opening/activating a view never changes the bulk set.

## Gestures and accessibility

Replace the interactive-controls-inside-listbox pattern for this surface with a labelled Polls list (`ul`/`li` or equivalent list/listitem) containing sibling checkbox, focusable Show row target, and actions button. Do not nest checkbox/menu/rename inputs inside an option or button. Retain poll-row identifiers for drag/focus lookup. Checkbox name: "Select {name}". Show target name includes poll name, state and host; active target uses aria-current=true. Checked membership is conveyed by the native checkbox, never aria-selected on the active row.

- Plain checkbox click toggles only that id and sets range anchor to it. It never Show/raises, starts, pauses or arms drag.
- Shift+checkbox click adds the inclusive anchor-to-target range in current sidebar order. With no surviving anchor it adds only target. It does not remove other members. Shift range ends at target but keeps anchor fixed. This additive rule avoids surprising deselection.
- Space on checkbox toggles; Shift+Space adds the same range. Up/Down move focus to previous/next checkbox without toggling; Home/End move to first/last. Shift+Up/Down moves checkbox focus and adds the anchor-to-destination range. Unmodified checkbox toggle establishes anchor; absent anchor for Shift+arrow uses the starting checkbox.
- Ctrl+A selects all only in a row Show target, checkbox, or list container. Ctrl+Shift+A clears there; visible Clear selection provides the same operation. Match existing layout rules, reject AltGr/IME; do not intercept text editors, menus, grids, traffic, toolbar or W2. Announce "{n} polls selected." politely after a completed gesture.
- Plain row click/Enter retains Show behavior and leaves membership unchanged. Shift+row click also retains Show: range selection is on checkboxes. Row Space may retain existing behavior; it does not bulk-select implicitly. Existing row F2, copy, context menu, Delete and Ctrl+P remain single-poll actions. Bulk Delete is reached through its named button; no new global destructive shortcut.
- Drag starts from the existing non-control row/grip gesture and moves only that poll. A selected row never implies group drag. Checkbox pointer events must be excluded before the drag threshold is armed. Reordering retains selected ids and anchor; the next range uses the new order.
- Tab reaches selection actions and each checkbox/Show/menu in DOM order; focus rings use existing focus-ring. Up/Down on Show targets keeps existing row navigation. Rename/input shortcuts remain native.

Selection is per connection, transient and initially empty. Profile replacement clears it even if ids are reused. List reconciliation removes deleted ids and invalid anchors. Add/duplicate adds no selected ids. Sidebar hide/show, compact transitions, native activation and Keep retain it. Selection never marks Modified.

## Operation state workflow

| State | Event | Next state and visible result |
|---|---|---|
| B0 idle/empty selection | select gesture | B1 ready; updated count/checkmarks, no network effect |
| B1 ready | Clear/profile replacement/all selected ids removed | B0; zero count, bulk actions unavailable |
| B1 ready | Duplicate selected | B3 duplicating after capacity check; snapshot ordered ids, "Duplicating…" |
| B1 ready | insufficient capacity | B5 unchanged definitions; warning text below actions, focus stays on Duplicate |
| B1 ready | Delete selected | B2 confirming; one W1 modal, frozen names/ids in sidebar order |
| B2 confirming | Cancel/Esc | B1; no changes, focus returns to Delete selected |
| B2 confirming | Confirm | B4 deleting; "Deleting…", submit locked |
| B3/B4 busy | repeat activation | same state; no second request; controls aria-disabled/aria-busy remain focusable |
| B3 duplicating | transaction succeeds | B1; sources remain selected, copies unselected, "Duplicated {n} polls." polite announcement |
| B4 deleting | transaction succeeds | B0; removed ids cleared; "Deleted {n} polls."; focus rule below |
| B3/B4 | validation/precondition failure | B5; unchanged definitions; inline error, recover selection from authoritative list |
| B3/B4 | committed definitions with window recovery needed | B6; reconcile authoritative list and hosts; persistent recovery notice/action, no retry of definition mutation |
| B5 error | next selection or retry | B0/B1 or requested operation; remove prior operation error on new attempt |
| B6 recovery | Show affected surviving poll | existing Show/recovery flow; notice clears only after resolution or dismissal |

While confirming/busy, freeze this selection and disable W1 add, reorder and definition bulk actions. Existing modal coordination prevents stacking confirmations. Other hosts can still change; backend revalidates all ids and lifecycle preconditions at commit. A changed/deleted confirmation target invalidates the whole request: close the modal, show "The selected polls changed. Review your selection and try again." and require a new confirmation. Never silently reduce a confirmed deletion set.

Connection states are orthogonal: idle/connecting/disconnected show Offline; connected/paused show Paused; polling without values shows Waiting/loading; timeout/exception/bad response retain existing text/icon and retries. All permit selection and definition operations subject to backend preconditions; no automatic connect or retry. Invalid setup drafts stay uncommitted and are not copied. Empty data is never treated as invalid selection.

## Duplicate and delete details

Duplicate persisted definitions in sidebar order, as one consecutive block immediately after the last selected source. Example [A,B,C,D], selected A,C -> [A,B,C,A copy,C copy,D]. Use existing case-insensitive naming allocator: "{name} copy", "{name} copy 2", etc.; truncate base so total is at most 48 characters. Allocate each name against originals and earlier copies in this transaction. Fresh ids; preserve persisted definition/display/aliases/scaling/interpretation/color settings available in the profile schema. Never clone counters, values, timestamps, failures, selection, modal state or setup drafts.

D-002-11 applies independently to each copy: connected + auto-start on -> Polling/Waiting; off -> Paused; not connected -> Offline. Existing invalid-for-link exception stays Paused (e.g. RTU slave 0). Open source -> same host kind; closed source -> new workspace view. Host opening follows existing single-duplicate placement/activation behavior in source order; bulk membership remains on sources and W1 bulk-action focus is restored when completion reconciles. Do not add a bulk-specific native placement policy.

Check `count + selectedCount <= 16` in UI and backend before creating anything. Exact warning: "Cannot duplicate {n} polls. This connection has room for {available} more (maximum 16)." Keep Duplicate activatable for nonempty selection so users receive the explanation. Empty selection sends no IPC.

Delete modal title: "Delete {n} polls?" (singular "Delete 1 poll?"). Body: "Their windows will close and their settings will be removed from this connection. This cannot be undone." Show every affected full name in an internally scrolling list, with host marker and "Unapplied changes will be lost." for affected dirty views. Never truncate the accessible names. Buttons Cancel (initial focus) and "Delete {n} polls"/"Delete 1 poll". No per-window Keep dialogs. Cancel preserves selection, views, drafts and polling.

**Last poll rule:** current `session.rs::remove_poll` permits removing the final poll; CHK2-A1 already defines zero polls. Deleting all is allowed, leaves connection/session open and shows "No polls yet. Press New poll (Ctrl+Shift+N) to read registers from this connection." plus workspace New poll. Do not create a replacement poll or disconnect.

Success marks profile Modified once. Deleting removes selected views in all hosts, stops their scheduling, clears matching traffic filter via existing All polls behavior and preserves connection totals. Surviving definitions/windows/scheduling are unchanged. After delete, focus the checkbox of the first surviving row following the last removed position; otherwise the previous survivor; with none, New poll. A surviving active poll stays active; otherwise retain existing workspace activation fallback, without raising native survivors merely for focus recovery.

## Errors and backend handoff

Use existing warning token + warning icon for capacity/precondition notices, error token + error icon for operation failures, neutral success announcement for completion. Error below bulk actions is role=alert and stays until next attempt/dismissal; modal failure returns focus to invoking action. Exact generic failure: "Could not duplicate the selected polls. {message}" or "Could not delete the selected polls. {message}". No optimistic definition removal and no loop of single-poll commands.

PM/BE-004 must publish: atomic ordered bulk duplicate/delete input and result types; validation of all ids/capacity/lifecycle preconditions; ordered created-id/source mapping; one authoritative list commit/event; Modified semantics; affected native-modal/host preconditions; and transaction/window failure distinction. Define a recoverable host state and retry Show route for surviving definitions after native create/close failure. UI needs affected ids and whether definitions committed to avoid unsafe mutation retries. This is an explicit backend deliverable, not a designer choice of rollback algorithm. Until BE-004 supplies it, implementation of bulk IPC/error recovery is gated; selection UI can proceed.

## Style

Reuse Afacad, existing light/card/border/muted tokens, 10 px row radius, pill actions and focus-ring; numbers/addresses use existing mono. Selection uses a visible checkmark and existing accent/dark roles; current-row bar remains dark. Warning orange only denotes warnings, red only destructive/error roles. No new colors/tokens. Controls have at least existing 28 px hit areas. Keep narrow per-row store subscriptions; counters must not rerender selection controls every cycle. Copy/paste, column resize and per-view selection are unchanged.
