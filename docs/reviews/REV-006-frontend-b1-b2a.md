# REV-006 FE-002 parts B1 and B2a (tasks 13-21) frontend review

Scope: `apps/desktop/src`:
- `tools/modbus-master`: the stores `workspace`, `drag`, `poll-host`, `window-close`, `arrange`, `prefs`, `poll-list` (reorder) and their logic files; `runtime/connection-runtime.ts`, `native-poll-runtime.ts`, `native-window-runtime.ts`, `poll-view-runtime.ts` (host seams)
- components: `workspace/`, `sidebar/`, `native/`, `shell/`, `dialogs/`, `ConnectionWindow.tsx`, `NativePollPage.tsx`, `ModbusMasterPage.tsx`
- `shared/ui/menu.tsx`, `shared/ui/dialog.tsx`, `lib/drag-math.ts`, `shared/lib/layout-math.ts`
- `apps/desktop/biome.json`

Out of scope, as agreed with the caller: tasks 22-25 and 28 (Write dialog, profiles, `use-shortcuts.ts`, `use-native-shortcuts.ts`, traffic filter finish, perf runs). Incomplete pieces there are not reported.

Inputs:
- CLAUDE.md
- DES-002 rev 6 (1, 2.2-2.13, 3, 4, 8, 9)
- FE-002 (ground rules, tasks 13-21, implementation notes A, B1, B2a)
- BE-002 Final contract, including the REV-004 changes
- CHK-002
- REV-002, REV-003, REV-005

Rust was read only to check command signatures and event order: `commands/modbus_master.rs`, `commands/poll_windows.rs`, `commands/window.rs`, and `crates/modbus-master/src/session.rs` (`show_poll`, `dock`, `begin_native_open`).

Reviewer: code-reviewer, 2026-10-16. The tree is uncommitted, so this reviews the files on disk. No source file was edited.

## Commands run (read-only)
| Command | Result |
|---|---|
| `pnpm typecheck` | clean (desktop + e2e) |
| `pnpm lint:web` (`biome check .`) | clean, 254 files |
| `pnpm test:web` (`vitest run`) | 89 files, 2186 tests, all pass |
| grep/read of `src-tauri/src/commands/*.rs` and `session.rs` | see IPC table and findings |

## What was checked and found correct

### IPC: every command the new code calls matches Rust
Command names and argument keys were checked one by one. Tauri maps camelCase keys to snake_case parameters, and no command uses `rename_all`.

| Caller | Facade (`shared/ipc/modbus-master.ts`) | Rust |
|---|---|---|
| `poll-host.store` show | :157 `mm_show_poll {pollId, placement}` | `modbus_master.rs:366-371` `poll_id, placement: Option<ShowPollPlacement>` |
| `poll-host.store` popOut | :158-159 `mm_pop_out_poll {pollId, anchor, handoff}` | :381-387 `anchor: PopOutAnchor, handoff: Option<String>` |
| `poll-host.store` dock | :160-161 `mm_dock_poll {pollId, handoff, requestHandoff, workspaceRect}` | :404-411 `request_handoff: bool, workspace_rect: Option<WorkspaceRect>` |
| `poll-host.store` answerHandoffRequest | :162 `mm_provide_handoff {pollId, handoff}` | :428-432 |
| `poll-host.store` S6 | :163 `mm_close_poll_view {pollId, keep}` | :442-447 |
| `poll-host.store` S7 | :141 `mm_remove_poll {pollId}` | :200-203 |
| `connection-runtime` showPollWindows | :164 `mm_show_poll_windows` (no args) | :455 |
| `native-poll-runtime` focusConnectionWindow | :165 `mm_focus_connection_window` | :469 |
| `workspace.store` flush | :167 `mm_set_workspace_layout {layout}` | :481-485 |
| `prefs.store` | :168-169 `mm_set_compact_mode` / `mm_set_ask_on_poll_close` `{enabled}` | :492-511 `enabled: bool` |
| `arrange.store` | :170-171 `mm_arrange_poll_windows {layout, target}` | :515-521 |
| `poll-list.store` setOrder | :144 `mm_reorder_polls {order}` | :278-281 `order: Vec<PollId>` |
| `native-poll-runtime` showTraffic / duplicate | :175 `{pollId}` / :140 `{pollId}` | `Option<PollId>` / `PollId` |
| `arrange.store` loadMonitors | `window.ts:52` `app_list_monitors` (no args) | `window.rs:50-51` |
| `connection-runtime` newWindow | `window.ts:31` `window_open_tool {toolId}` | `window.rs:17-21` `tool_id: String` |
| W1 / W2 close | `window.ts:42-49` `onCloseRequested`, `destroy` | capability `core:window:allow-destroy` (BE-002 Final contract) |

### Host lifecycle vs the backend contract
- **Pop out.** It reads the handoff after blurring the editor and after reporting the layout (`poll-host.store.ts:186-189`). The anchor is the sub-window rectangle plus the workspace origin, in client coordinates. A maximized window uses its normal rectangle (`connection-runtime.ts:686-703`). It does nothing while a modal is open (`:184`).
- **Rust order on pop out.** Rust first sends `ViewDetached(poppedOut)` and `PollListChanged(host: native)`, then creates the window (`poll_windows.rs:240-249`). `onDetached` unmounts the sub-window (`connection-runtime.ts:321-325`) and the registry disposes its view. The late detach that follows is a no-op in Rust.
- **Pop out failure.** The rollback `PollListChanged` remounts the sub-window through `syncFromList`. A new view runtime attaches and gets the handoff back. An old runtime cannot unmount the new frame, because `dispose` removes its subscriptions.
- **Dock.**
  - From W2 it sends its own handoff with `requestHandoff: false`.
  - From W1 (row menu or list drag) it sends `requestHandoff: true` and the drop rectangle.
  - The refusal toast appears only for `field: "handoff"` (`poll-host.store.ts:219-223`), as the contract says.
  - Rust emits `PollListChanged` before `RevealPoll` (`session.rs:2420-2429`). The frame is therefore mounted first and then revealed.
- **Handoff answer in W2.** W2 refuses with `null` while a modal is open, or while S6 or S7 is open (`poll-host.store.ts:231-243`). All dialogs take a modal lock on their window's layout store (`PollDialogViews.tsx:32-34`).
- **Detach causes.** `poppedOut`, `docked`, `closed` and `removed` unmount the frame. `attachFailed` unmounts it, and a click on the row remounts it (`connection-runtime.ts:619-632`). `replaced` keeps it.
- **Snapshot hold.** W1 holds session events until the snapshot is applied, then replays them in order (`connection-runtime.ts:395-398, 818-826`).
- **Idempotent init.** `views.get` is memoized and `init` uses `??=`, so StrictMode cannot attach twice.
- **W1 close question.**
  - The OS close, Alt+F4 and File > Close window all reach the same `windowClose.request()`.
  - The handler waits for the answer, and `onCloseRequested` destroys the window only after the handler resolves.
  - The text, including "This also closes {k} poll windows." and "Unapplied edits in: …" in list order, matches DES-002 2.11.
- **REV-005 follow-ups are in.**
  - m-1: W1 ignores the connection events of the view channels (`poll-view-runtime.ts:195`).
  - m-2: the unapplied flag is reconciled after the snapshot (`:294-300`).
  - m-3: memoized cards and stable menu refs.
  - m-4: narrow Biome override.

### Drag
- **No React render while a sub-window is dragged.**
  - `FrameBody` does not subscribe to the drag store. A plain `drag.subscribe` writes the live rectangle into the element style (`SubWindowFrame.tsx:63-74`).
  - The title bars select only booleans (`selectIsSwapTarget`, `selectSnapEnabled`).
  - `WorkspacePerf.test.tsx` counts the renders of the (mocked) PollView, which is a child of `FrameBody`, so it measures what it claims.
- **Coalescing and frozen context.**
  - Pointer moves are coalesced to one computation per animation frame (`drag.store.ts:331-340`), and `end()` flushes the pending one.
  - The drag context (other windows' rectangles, slots, area) is frozen at the press. The only layout read during a drag is the workspace origin, taken at the press.
- **Gesture rules.**
  - The drag starts after 4 px.
  - Esc and `lostpointercapture` cancel it, and the Esc key is not passed on.
  - Alt keydown and keyup are prevented during the drag (R7).
  - A press on a title bar button or inside the portal menu is not a grip.
- **Q-FE2-04.** Snap zones arm only after the pointer has left the 24 px band (`drag.logic.ts:112-114`, `drag.store.ts:423`).
- **Drag math.**
  - `restoreFromMaximizedForDrag` keeps the pointer at the same relative x.
  - `tileSlotAt` falls back to the nearest slot.
  - `zoneRect` and the clamping match DES-002 2.10.1 and 2.10.3.
- **Snapping with maximized and minimized windows.** Minimized windows are excluded from the snap candidates and the slots (`visibleIds`, `tiledIds`). A maximized window only adds the tile-area lines again.
- **List reorder.**
  - The reorder is optimistic. Its rollback applies only when no list event replaced the order (`poll-list.store.ts:339-348`).
  - The click after a drag is swallowed. Auto-scroll moves 8 px per frame and its scheduled frame is cancelled in `cleanup`.
- **Keyboard equivalents.**
  - `Alt+Arrow`, `Ctrl+Alt+Arrow` and `Ctrl+Shift+Arrow` are handled in the frame, and inside text fields they are left to the field.
  - The Move and Size modes, "Move to", and "Slot n" in tile mode work.

### Shells, menus, dialogs
- **Banner precedence in W2.** The connection banner wins and the poll banner shows only while connected. There is no Disconnect or Cancel (`native-poll.logic.ts:46-79`).
- **W2 title.** It shows "Offline" while the link is not up.
- **Status bars.** The W2 status bar has no `Tx`, and the W1 status bar shows "{k} in their own windows".
- **Shared menu.**
  - Arrow keys, Home and End move; Esc closes the menu, or goes back one level in a submenu.
  - Tab closes the menu.
  - Focus returns to the trigger.
  - A submenu stops its keys from reaching the parent list. A press in the second list does not count as an outside click.
- **Dialogs.** They return the focus to the invoker (`dialog.tsx:26-41`).
- **Arrange.**
  - `arranged: 0` shows "No poll is open in its own window.".
  - An overflow shows the overflow toast.
  - `field: "monitor"` resets the target to each monitor and reloads the monitors (`arrange.store.ts:64-87`).
- **Compact mode.** It is set optimistically and rolled back on error. `PrefsChanged` reaches the prefs store of W1 and every view; toggling compact mode ends the sidebar peek.

### Tokens and lint
- **Biome override.** It covers only six files and two a11y rules. The other cases use per-line ignores with a reason.
- **Colours.** No hex is used outside `styles.css`. No `text-error`, `text-success` or `text-warning` is used outside `icon.tsx`. `border-warning` in `MinimizedBar.tsx` is on the guard test's allow list and is paired with an icon and text.

## Findings

### Blocker
None.

### Major

**M-1. Against the real backend a pop out removes the sub-window at once, not "when the command resolves". The tests that say otherwise only pass because the fake's `hold` skips the command.**

Where:
- `runtime/connection-runtime.ts:321-325`: `onDetached` unmounts for every cause except `replaced`.
- `store/poll-host.store.ts:190-202`.
- Tests: `runtime/host-lifecycle.test.ts:106-120` and `components/workspace/PopOutButtons.test.tsx:32-46`.
- Fake: `shared/ipc/modbus-master.fake.ts:1710-1715`. A held command returns the release value and never runs `impl`.

Problem:
- REV-004 m6 fixed the Rust order (`poll_windows.rs:240-249`): `ViewDetached(poppedOut)` and `PollListChanged(native)` are sent before the native window is created.
- W1 therefore unmounts the sub-window as soon as those events arrive. The spinner the B2a notes describe ("the sub-window stays until the command resolves; spinner") is never visible.
- The two tests hold `popOutPoll`. With the fake's `hold`, Rust's effects never happen at all: no detach, no host change. So the tests assert a state the backend cannot produce.

Failure scenario (WebView2):
1. The user presses "Open in its own window".
2. The sub-window disappears at once.
3. For the 100-500 ms that the new WebView2 window needs, the poll is shown nowhere.
4. If the window cannot be created, the sub-window first vanishes, then remounts and re-attaches (a flash). DES-002 2.5.2 step 5 and CHK2-F8 say "the sub-window stays".
5. QA on the fake passes both checks, so this only shows on the integration build.

Suggested fix:
- While `host.pending[id] === "popOut"`, keep the frame:
  - In `onDetached`, defer the unmount for the cause `poppedOut`.
  - In `syncFromList`, skip the unmount of that id.
- Show the frame with its last values and the spinner, then unmount when `popOut` resolves. On rejection, re-attach the view to the existing frame.
- Give the fake a hold that runs the effects and holds only the reply, for example `holdReply`. Rewrite the two tests with it, so they model Rust's order.
- If the designer prefers the gap, record that in DES-002 2.5.2 and FE-002 instead.

### Minor

**m-1. Pop out and Keep-without-asking await the layout report before they set `pending`, so a second trigger can send the command twice.**
- Where: `poll-host.store.ts:182-191`. `await deps.flushLayout?.()` comes before `setPending(id, "popOut")` and before the busy state. The same applies to `keep()` at `:115-118` (`requestClose` with "Don't ask again").
- When `flush` is not a no-op, it awaits `mm_set_workspace_layout`. A press on an inactive sub-window's pop out button raises it (`SubWindowFrame.tsx:120-123`), which changes the z-order and makes the flush real. Any of these lands in that window and passes the `pending` check:
  - a double click;
  - `Ctrl+Shift+O` auto-repeat;
  - menu plus shortcut.
- Effect: two `mm_pop_out_poll` calls. The second one in Rust either reveals the window, or races the first between `begin_native_open` and `create`. That race was not verified, but it can create a second window with the same label and then undo.
- Fix: set `pending` (and the view's busy state) synchronously before the first `await`, and clear it in `finally`. The same applies to `keep()`.

**m-2. A drag whose frame or row unmounts mid-gesture leaves window listeners behind and a stuck drag state.**
- Where:
  - `components/workspace/pointer-gesture.ts:49-61, 110-115`;
  - `components/sidebar/list-gesture.ts:101-115, 163-168`.
- Problem:
  - `cleanup` runs only from the element's own `pointerup`, `pointercancel` and `lostpointercapture`.
  - When the captured element is removed, the browser fires `lostpointercapture` at the document, not at the element.
  - So the capture-phase `keydown` and `keyup` listeners on `window` stay. `drag.store` stays in `move` or `listReorder`, and the ghost or overlay stays on screen.
- Scenario:
  1. The user drags the row of "Pump 2".
  2. "Pump 2" is deleted from its own window (S7 in W2), or a profile is applied.
  3. The ghost stays.
  4. The next Esc anywhere in W1 is swallowed (`preventDefault` and `stopPropagation` in the capture phase), for example the Esc that should close a dialog. That Esc only cancels the stale drag and announces "Move cancelled.".
- Fix: listen for `lostpointercapture` and `pointerup` on `document` as well. Alternatively, return the cleanup from the gesture and call it when the row or frame unmounts, or when the drag store is reset by `begin`.

**m-3. A list reorder uses the row index from the start of the drag, so a list change during the drag moves the wrong poll.**
- Where: `store/drag.store.ts:450-456` (`listFromIndex` at begin) and `:353-357` (`reorder(order, s.listFromIndex, to)` on the order at release).
- Scenario:
  1. The user drags row 3 (C) of [A, B, C, D].
  2. A is deleted, or duplicated from a W2, while the button is held.
  3. On release, index 2 is now D. D is moved, and the announcement says "C moved to position …".
- Fix: at release, compute `from = order.indexOf(pollId)`, and drop the gesture when it is -1.

**m-4. Drops are announced before their outcome is known.**
- Where: `store/drag.store.ts:357` (list reorder) and `:363-370` (list drop).
- Problem: the announcement fires synchronously, while the IPC (`setOrder`, `placeFromList` with dock or show) runs afterwards.
- Scenarios:
  - A native poll dropped on the left half is refused because a dialog is open in its window. The screen reader hears "Pump 2 moved to the left half." and then the toast "Close the dialog in the "Pump 2" window first.".
  - A rejected reorder is announced as done.
  - A successful native drop is announced twice: the zone text, then "docked in the workspace." from the host change.
- In tile mode, `placePollFromList` also changes the list order before the dock (`connection-runtime.ts:717-723`). A refused dock still leaves the poll reordered.
- Fix:
  - Announce after `placeFromList` or `setOrder` resolves.
  - For native drops, rely on the dock announcement.
  - In tile mode, reorder only after a successful dock or show.

**m-5. A native window whose attach failed cannot be closed by the user.**
- Where: `runtime/native-poll-runtime.ts:131-136, 247-251` and `store/poll-host.store.ts:127-128`.
- Problem:
  - The close handler always returns `"cancel"` and calls `requestClose`.
  - `requestClose` returns early when `describe` is null.
  - `describe` is null while `config` is null, which is the state after a failed attach (`DetachedNotice`: "Could not open this poll: …").
- Effect: the OS close and Alt+F4 do nothing, and the window stays until W1 closes.
- Reachability is low. Rust destroys W2 in its normal error paths, so this needs a transient `internal` on attach, or the backend race in m-1.
- Fix: when the view is detached, has no config or is removed, return `"close"` from the handler.

**m-6. In tile mode the title bar menu offers slots for minimized windows.**
- Where: `TitleBar.tsx:91` (`slotCount = Object.keys(s.items).length`) vs `tiledIds` (`workspace.logic.ts:106-108`, non-minimized only).
- Problem: with 4 sub-windows, one of them minimized, the menu lists "Slot 1" to "Slot 4". "Slot 4" calls `commitSlot(id, 3)`, which returns `unchanged` (`drag.store.ts:380`). The entry silently does nothing.
- Also, `slotIndexOf` is read with `getState()` during render (`:105`, `:226-230`), so it can be stale.
- Fix: derive `slotCount` and `slotIndex` from `tiledIds` in one selector.

**m-7. After a dock or Show the focus lands on the title bar, not the data grid. After a Keep it falls to `body`.**
- **Dock and Show.**
  - Where: `SubWindowFrame.tsx:77-84` runs once per `focusRequest`. `workspace.store.ts:382-394` (`reveal`) asks for focus right after the frame mounts. Rust sends `PollListChanged` then `RevealPoll` (`session.rs:2420-2429`).
  - At that moment the view has not attached, and `DataCard` renders "Loading poll…" without a grid (`DataCard.tsx:31-41`). So the fallback, the title bar, gets the focus.
  - CHK2-F2 asks for the focus in the grid.
  - When `RevealPoll` arrives before the mount (`pendingReveal`, `:384-386`), no focus request is made at all.
- **Close with Keep, Delete or pop out.** The invoking control is gone, so `useReturnFocus` has nothing to return to and the focus ends on `body`. DES-002 9 asks for the focus to return to a control.
- Fix:
  - Keep the focus request pending until the grid exists, for example by re-running the effect on `attach === "attached"`.
  - After an unmount, focus the new active sub-window, or else the poll's sidebar row.

**m-8. A pop out failure can be announced as "docked" when the command's rejection arrives before the channel events.**
- Where: `connection-runtime.ts:527-535`. The B2a notes list this as known.
- Problem: the dock announcement is suppressed only while `pending[id] === "popOut"`. The order between Channel messages and the invoke reply is not guaranteed. If the rejection arrives first, the late native-to-workspace rollback reads "{name} docked in the workspace.".
- Fix: remember `{ id, until: now + 2 s }` for a failed pop out and suppress the dock announcement for that id. Alternatively, announce a dock from `RevealPoll`, which a pop out rollback never sends (the undo emits only `PollListChanged`).

**m-9. Every sidebar row, rail icon and minimized pill of a running poll re-renders on every `Counters` event.**
- Where: `PollList.tsx:50`, `Sidebar.tsx:13` and `MinimizedBar.tsx:23` select `s.polls[id]`. `poll-list.store.ts:204-221` replaces the entry whenever counters or `lastOkAt` change, which is every cycle.
- Cost: with 16 running polls that is up to 160 row renders a second. Each render builds the 12 menu entries and the tooltip, and re-subscribes the open context menu's document listener (inline `onClose`, `PollList.tsx:210-213`).
- The B2a note "the list rows select only their own slice" is true, but the slice changes at 10 Hz. This is REV-005 n-6, still open.
- Fix:
  - Keep counters in a separate map.
  - Let rows select `config`, `status`, `host`, `open` and `hasData` separately.
  - Read the tooltip's counters lazily (on `pointerenter`).

**m-10. Regression coverage for some REV-002 and REV-003 bug classes was deleted with the legacy window and not ported.**

Ported and still covered:
- hold and replay (`connection-runtime.test.ts:133`);
- serial select DOM vs form (`ConnectionSection.test.tsx:156`);
- the 4-part IPv4 host rule (`schemas.test.ts:110`, `ConnectionSection.test.tsx:65`);
- the modal lock counter (`layout.store.test.ts:22`);
- command error toasts.

Not covered any more:

| REV-002 / REV-003 item | Old test | Code that still needs it |
|---|---|---|
| m4: traffic rows anchored by `seq` while Auto-scroll is off | `Rev2Regressions.test.tsx` "keeps the frame at the top of the view" | `TrafficPanel.tsx:183-217` |
| m7: session buttons disabled until the snapshot | `Rev2Regressions.test.tsx` "disables the session buttons until the snapshot is applied" | `Toolbar.tsx:123` (`busy = !ready`) |
| M2: banner and live region describe the running connection, not the draft | "editing the host after a refused connection does not change the banner" | `ConnectionBanner.tsx:13` reads the connection store, correct today, but nothing pins it |
| n-4 (REV-003): the batcher cap is wired with `TRAFFIC_CAPACITY` | none (still) | `connection-runtime.ts:288-292` |

Fix: port these four as small tests on the new runtime and components. The first may land with task 25.

**m-11. The host transition table (`HOST_ALLOWED`, `lastUnexpected`) of the FE-002 ground rules is not implemented.**
- Where: `hostStateOf` (`lib/status-line.ts:175`) only derives the state; nothing checks or records transitions. Grep finds no `HOST_ALLOWED`.
- Problem: FE-002 "The two state machines" asks for unexpected host pairs to be applied and recorded, as for the connection and the poll. This is a development aid only.
- Fix: add it to `poll-list.store.applyList` (compare the previous and next `hostStateOf`), or record the deviation in FE-002.

### Nit
- **n-1. Keyboard Size ignores snapping and the workspace constraint.**
  - Where: `drag.logic.ts:271-290` (`keyboardSize` neither snaps nor constrains).
  - DES-002 2.10.8 says "Snapping applies to keyboard moves and resizes (edge snap only)". The live keyboard outline can therefore leave the workspace until the commit clamps it.
- **n-2. The title bar menu has no top-level "Pop out to own window" entry.** DES-002 2.3.1 lists it between "Move to ▸" and the separator. Only "Own window (pop out)" under the "Move to" heading exists (`title-bar-menu.logic.ts:105-113`).
- **n-3. Layout not reported after a pop out or close in tile mode.** When the view event (`ViewDetached`) arrives before `PollListChanged`, `unmount` (`workspace.store.ts:370-380`) re-tiles without a `flush`. The following `syncFromList` sees no change (`:323-329`), so Rust keeps the old rectangles of the remaining tiles until the next action. Flush in `unmount` when tile mode changed any rectangle.
- **n-4. Two rapid reorders can roll back to an order Rust never accepted.** If the second rejects, its rollback restores the first's optimistic order, even when the first was rejected too (`poll-list.store.ts:345-348`). Roll back to the last order confirmed by Rust.
- **n-5. Next and Previous sub-window count minimized windows.** They are enabled from 2 workspace sub-windows including minimized ones (`window-menu.ts:141, 149`). `cycle` only visits non-minimized ones (`workspace.store.ts:509-517`), so with 1 visible and 1 minimized the entries do nothing.
- **n-6. z values grow without bound.** `raise` sets `z = topZ` (`workspace.logic.ts:137-141`) and only `toLayout` renumbers. The overlay layers use fixed z 100000-100003 (`DragOverlay.tsx:58, 65, 86`, `ListDragLayer.tsx:22`). After about 100k activations the frames cover the guides and the ghost. Renumber in `raise` when `topZ` exceeds, say, 10000.
- **n-7. Esc during a list drag can leave a listener.** The `pointerup` listener it adds (`list-gesture.ts:152`) stays when the button is released outside the window, and then swallows the next click on that row.
- **n-8. Two OS close requests while "Save changes?" is open.** Both handlers resolve "close" and both call `destroy`, and the second one rejects (`window-close.store.ts:59-61`). Harmless, but return `"cancel"` to the second caller.
- **n-9. Interactive content inside list options.** The `⋯` `MenuButton` inside a `role="option"` row (`PollList.tsx:185-193`) puts interactive content inside an option; screen readers flatten option children. The context menu (Shift+F10) is the accessible route, so consider `aria-hidden` plus `tabIndex=-1` on the button. Separately, the title bar has `role="toolbar"` but no arrow-key navigation between its buttons.
- **n-10. Disabled entries cannot be reached by keyboard.** They are skipped by the arrow keys (`menu.tsx:108-113`), so the "No poll is open in its own window." title cannot be found with the keyboard. Consider making disabled entries focusable with `aria-disabled`, as WAI-ARIA menus allow.

## Questions for the designer (not findings)
- M-1: should the sub-window really stay (spinner) until the native window exists, given the backend order, or is the gap acceptable?
- Q-FE2-05 and Q-FE2-07 to Q-FE2-13 from the B1 and B2a notes are still open. The code's choices are reasonable placeholders.

## Verdict
**Changes required.** There is no blocker. Fix M-1 before the first integration QA run of section F of CHK-002: as built, the pop out UX and its tests do not match the backend's event order, and QA on the fake would pass where WebView2 fails.

Before task 28's performance run and QA:
- m-1 to m-4 (drag and pop out correctness);
- m-7 (focus after a dock or close);
- m-9 (row re-renders);
- m-10 (the lost regression tests).

The rest can go with tasks 24, 25 and 28.
