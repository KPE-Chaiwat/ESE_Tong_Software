# REV-005 FE-002 part A (tasks 01-12) frontend review

Scope: `apps/desktop/src`:
- `shared/ipc`: facade v3, fake, `fake-scheduler`, `fake-validation`, `legacy/`, `runtime.ts`, `window.ts`
- `shared/lib/layout-math.ts` and `placement.ts`
- `shared/ui`: `menu`, `status-strip`, `status-pill`, icons
- styles and tokens
- `tools/modbus-master`: `lib/*`, the part A stores, `runtime/poll-view-runtime.ts`, `components/poll-view/`
- `apps/desktop/biome.json`

Out of scope: the old single-poll window (it runs on `shared/ipc/legacy` until task 17) and Rust (it has its own reviewer). Rust was read only to check the command signatures, the event shapes and the behaviour the fake has to mirror.

Inputs: CLAUDE.md, DES-002 rev 6 (1, 2.3-2.5, 2.8, 2.10, 3, 4, 6, 8), DES-003 3.3-3.5, FE-002 (ground rules, state machines, tasks 01-12, part A implementation notes, Q-FE2-01..03), BE-002 Final contract, REV-002 and REV-003.
Reviewer: code-reviewer, 2026-10-16. The tree is uncommitted, so this reviews the files on disk. Nothing in the source was edited.

## Commands run (read-only)
| Command | Result |
|---|---|
| `pnpm typecheck` | clean (desktop + e2e) |
| `pnpm lint:web` (`biome check .`) | clean, 220 files |
| `pnpm test:web` (`vitest run`) | 78 files, 1966 tests, all pass |
| `biome lint` on `DataGrid.tsx`, `ScaledCellView.tsx`, `PollView.tsx` and `menu.tsx`, with a scratch config (in the session scratchpad) that has no a11y override | lists what the override hides (finding m-4) |
| grep and read of `src-tauri/src/commands/*.rs`, `lib.rs` (`generate_handler!`), `crates/modbus-master/src/session.rs` (`attach_view`, `update_poll`, `set_poll_active`, `set_poll_view`, `broadcast_views`), `crates/shared-types/src/view.rs` (`check_alias_text`) | see below |

## What was checked and found correct

### 1. IPC facade vs Rust (the REV-002 bug class): no mismatch
I compared every command in `shared/ipc/modbus-master.ts:128-186` and `window.ts:29,45,48` with its `#[tauri::command]` signature.
- There is no `rename_all` in `commands/`, so Tauri maps the camelCase keys to snake_case parameters.
- All 43 registered commands are in `lib.rs` `generate_handler!`.

| Facade (TS line) | Command and keys | Rust (`commands/modbus_master.rs` unless noted) |
|---|---|---|
| openSession :131 | `mm_open_session {channel}` | :65 `channel: Channel<SessionEvent>` |
| connect / cancelConnect / disconnect :134-136 | `{config}` / none / none | :120 / :146 / :152 |
| setAutoStartPoll :137 | `{enabled}` | :157 `enabled: bool` |
| addPoll :139 | `{input, host}` | :197 `input, host` |
| duplicatePoll / removePoll :140-141 | `{pollId}` | :225, :253 `poll_id` |
| updatePoll :142 | `{pollId, definition}` | :269 |
| renamePoll :143 | `{pollId, name}` | :282 |
| reorderPolls :144 | `{order}` | :334 `order: Vec<PollId>` |
| setPollActive / setAllPollsActive :145-146 | `{pollId, active}` / `{active}` | :296 / :309 |
| setPollView :147 | `{pollId, view}` | :321 `view: PollViewSettings` (patch) |
| write :148 | `{request, pollId}` (null allowed) | :343 `poll_id: Option<PollId>` |
| resetCounters :149 | `{pollId}` (null allowed) | :357 `Option<PollId>` |
| attachPollView :154 | `{pollId, host, channel}` | :371 |
| detachPollView :156 | `{pollId, viewToken}` | :407 `view_token: ViewToken` |
| showPoll :157 | `{pollId, placement}` (null allowed) | :422 `Option<ShowPollPlacement>` |
| popOutPoll :159 | `{pollId, anchor, handoff}` | :466 `handoff: Option<String>` |
| dockPoll :161 | `{pollId, handoff, requestHandoff, workspaceRect}` | :528 `request_handoff: bool, workspace_rect: Option<_>` |
| provideHandoff / closePollView :162-163 | `{pollId, handoff}` / `{pollId, keep}` | :552 / :566 |
| showPollWindows / focusConnectionWindow :164-165 | none | :582 / :595 |
| setWorkspaceLayout :167 | `{layout}` | :607 |
| setCompactMode / setAskOnPollClose :168-169 | `{enabled}` | :619 / :628 |
| arrangePollWindows :171 | `{layout, target}` | :641 |
| setProfileName / requestSave / showTraffic :173-175 | `{name}` / `{saveAs}` / `{pollId}` | :662 `Option<String>` / :676 `Option<bool>` / :689 `Option<PollId>` |
| applyProfile / exportProfile :176-178 | `{profile}` / `{name, connection}` (null allowed) | :702 / :741 (both `Option`) |
| profiles_* :179-185 | `{toolId, name / profile, overwrite / oldName, newName}` | `profiles.rs` :36, :64, :76, :97, :108 |
| listMonitors (`window.ts:48`) | `app_list_monitors` (no args) | `window.rs:51` |

`modbus-master.tauri.test.ts:76-222` pins every name and key with `toHaveBeenCalledWith`.

### Event names and payloads
- `poll.store.ts:164-198` and `poll-view-runtime.ts:179-198` together handle all ten `PollViewEvent` variants of the generated binding: `ConnectionStateChanged`, `PollStateChanged`, `PollUpdate`, `PollConfigChanged`, `PollCounters`, `PollRemoved`, `ProfileNameChanged`, `PrefsChanged`, `ViewDetached`, `HandoffRequested`.
- The payloads are read flat. `PollConfigChanged` is rebuilt as `PollConfig` by dropping `type`. `PollCounters` reads `counters`, `effectiveScanMs` and `lastOkAt`.
- Every `type` is checked by TS against the bindings.
- The per-variant aliases in `modbus-master.types.ts:95-110` are derived with `Extract<>`, not hand-written.

### Null and optional handling against the real backend
- Optional arguments are sent as `null` (or left out). Every one of them is `Option<T>` in Rust.
- `setPollView` sends only the keys the caller gave, so the patch semantics hold. `JSON.stringify` drops `undefined`, and `scale: null` reaches Rust as `Some(None)`.
- `ViewToken` and `PollId` are plain numbers.

### Per-view isolation
- Each view has its own channel and its own `poll`, `ui`, `data` and `alias` stores.
- `route` drops every poll-specific event whose `pollId` is not the view's own (`poll.store.ts:168-189`), and `poll-data.store.ts:63,78` checks it again.
- Only the connection store is shared in W1, as FE-002 task 05 asks.

### Attach, hold and replay, detach, dispose
- Events are held until the snapshot, then replayed in order through `route` (`poll.store.ts:219-248`). The wiring subscriptions start inside `onSnapshot`, before the replay, so replayed state changes drive the data store.
- `held` is cleared, which addresses the REV-003 n-1 remark.
- `init` is idempotent: `started ??=` in both the store and the runtime, so StrictMode cannot attach twice.
- A dispose during attaching detaches the late token and never starts the wiring.
- After `ViewDetached` or a dispose, `route` ignores further events, and `dispose` sends no foreign token.
- The `onDetached` causes are distinct (`poppedOut | docked | replaced | closed | removed | attachFailed`).
- `PollRemoved` followed by the host's dispose sends a detach that Rust treats as a no-op (`session.rs` `detach_view`).

### Handoff
- `PollViewHandoffV1` is a strict zod schema. `parseHandoff` never throws.
- `applyHandoff` runs after `applyCompact`, so the compact rules apply on arrival. It is followed by `syncRange`, so the selection is clamped to the current range.
- Apply-once and the 10 s expiry are Rust's job, and the fake mirrors them (`modbus-master.fake.ts:1339-1341`).

### State tables
- `CONNECTION_ALLOWED` (`connection.logic.ts:19-24`) and `POLL_ALLOWED` (`poll.logic.ts:38-45`) equal the FE-002 tables.
- Unexpected pairs are applied and recorded.
- `reason`, `exceptionCode` and `badResponse` are nulled outside their states.
- The native window's connection store has `role: "poll"` and cannot cancel, disconnect or dismiss.

### Data view
- `pollDataActionFor`, `definitionChangeAction` (PT6 gives begin, PT6b gives clear with `settingsChanged`) and `connectionClearsData` (idle clears) match DES-001 2.4 and DES-002 1.4.
- `seed` from `lastUpdate` gives a live view with no loading flash.
- `seq <=` and `matchesDefinition` drop stale updates.

### Layout math: DES-002 2.8 vectors re-derived by hand
- **WT-1:** maxCols = floor(1324/328) = 4 and maxRows = floor(708/188) = 3. cols = 2, rows = 2, cell 654 x 346, no remainder, which gives (8,8), (670,8), (8,362), (670,362).
- **WT-2:** the last row has k = 1, so its width is 1316, at (8,362).
- **WT-3:** cols = 4 and rows = 4 > 3, so rows becomes 3 and 12 windows are tiled. Cell (1316-24)/4 = 323 and (700-16)/3 = 228, with zero remainder. One window overflows to (8,8).
- **WT-4:** (8,8,600,300).
- **NT-1 to NT-3:** 960 x 516, then 640 x 344, then 480 x 344 with 12 tiled and 1 overflowing.
- Cascade window i = 10 is at (A.x + 240, A.y).
- `clampRect` of a 640-wide rectangle at x = -600 gives -560.
- `zoneRect('right', (8,8,1316,700))` gives (670, 8, 654, 700).
- `popOutModeFor` uses `> 48`, so 47 px is false and 49 px is true.
- `snapRect` ties go to the workspace line first, then to the higher z (2.10.3).

### Alias rules
- `aliasError` checks length 32 (code points), then leading or trailing space, then control characters. The first failing rule wins.
- This matches `shared-types/src/view.rs:133-147` rule for rule. JS `\s` additionally treats U+FEFF as a space, so the frontend is stricter there, which is harmless.
- `parseAliasPaste` uses addresses, not row positions. Invalid lines keep their address. The FE acceptance vector (8 A, 9 B, beyond 2) holds.
- The paste toast texts and the 2000 cap match DES-002 section 4.
- Aliases follow the address, because the alias store mirrors `config.aliases` by address.

### Texts
- `statusLineText` / `statusLineParts`, `statusLineReason`, `compactChip`, `hostMarker`, `pollSummary`, the titles and `describeException` match DES-002 2.3.2, 2.2.3, 1.5 and 2.12.
- Q-FE2-02 (1.5 x rule vs the FE example) is correctly raised as a question. The code follows the DES.

### Copy
- `copyRowsText` and `copyHeader` produce exactly the DES-003 3.4 example: `PT-201\t0\t0\t4.00\n\t1\t65535\t20.00` and `Alias\tAddress (0-based)\tRaw (Hex)\tScaled`.
- A refused clipboard shows "Could not copy to the clipboard." This closes REV-003 n-3 for the new view.

### Tokens
- No hex outside `styles.css`.
- The new tokens `--color-warning-tint`, `--color-workspace` and `--shadow-subwindow` are `color-mix` of base tokens, and `tokens.test.ts:36-49` checks them.
- `text-error`, `text-success`, `text-warning` and `bg-error` are absent from the new files.
- The warning classes appear only in the allowed primitives and in `ScaledCellView.tsx` (`tokens.test.ts:76-95`).
- The warning strip always carries dark text.

### Architecture
- Only `shared/ipc` imports `@tauri-apps/api` (one pre-existing `vi.mock` in `launcher/open-tool.test.ts`).
- `shared/` never imports `tools/`.
- No session state is kept in React: the view's stores mirror Rust, and only drafts, selection, scroll and widths are local.

### Tests
- `PollView.test.tsx:38` runs the PollView cases in both hosts (`describe.each(["workspace","native"])`).
- The FE-002 acceptance items of tasks 01-12 are covered.
- Negative paths exist: rejected attach, rejected alias rollback, backend field messages, clipboard failures, non-permutation reorder.

## Findings

### Blocker
None.

### Major
None.

### Minor

**m-1. A held `ConnectionStateChanged` replayed after a view's snapshot can move the shared W1 connection store back to an older state.**
- Where:
  - `store/connection.logic.ts:212-217`: `isDuplicateConnectionEvent` only compares the event with the *current* state and `at`.
  - `runtime/poll-view-runtime.ts:184-187` forwards every view copy to the shared store.
  - `store/poll.store.ts:226-238` replays the held copies after the snapshot.
- Rust sends each transition to the session sink and then to every view (`session.rs:1233-1234`). The session copy reaches the W1 store at once, but a view that is still attaching holds its copy.
- Scenario: a sub-window mounts (dock, Show or profile load) while the user connects to a fast local device.
  1. Within the hold, the session channel applies `connecting` (t1) and then `connected` (t2).
  2. The view's snapshot arrives and its held `connecting` (t1) is replayed. It is not a duplicate of `connected`/t2, so the store goes back to `connecting`. The replayed `connected` (t2) then goes forward again.
  3. Effects: two extra `revision` bumps (W1's live region will announce "Connecting…" and "Connected" twice in part B), a development warning `connected -> connecting`, and a visible flicker.
  4. Disconnect followed quickly by Reconnect replays `idle`. Every view's `connectionClearsData` then fires again.
- Fix (either):
  - ignore an event whose `at` is older than `since` (both come from the same Rust session clock);
  - or, when the connection store is shared (W1, `getOtherNames` present / role `window`), do not apply view-channel `ConnectionStateChanged` at all, because the session channel is ordered and complete. W2 keeps applying them.
- Add a test: hold an attach, emit `connecting` and then `connected`, release, and assert one transition each.

**m-2. `hasUnappliedEdits` stays true in Rust when a view re-attaches without its handoff.**
- Where: `runtime/poll-view-runtime.ts:252-259` reports the flag only when a draft *changes*. `applySnapshot` (`:262-285`) never reconciles `snapshot.poll.hasUnappliedEdits` with the local drafts. The test `poll-view-runtime.test.ts:457` pins that no report is sent after a handoff, but no test covers re-attaching without one.
- Scenario: a poll has an unapplied Quantity draft (flag true in Rust).
  1. Its native window reloads (F5, or the webview restarts), or a pop out's handoff is older than 10 s.
  2. The new view attaches with `handoff: null`, so it has no draft, but the flag stays true.
  3. W1's close confirm then says "Unapplied edits in: Pump 2." although no edit exists in any host.
  4. The `⚙` dot (part B) shows unapplied edits, and only typing and undoing a change clears it.
- Fix: after `applyHandoff` in `applySnapshot`, compute `local = draftHasEdits(pollDraft) || scaleDraft?.dirty`. If `snapshot.poll.hasUnappliedEdits !== local`, call `reportUnappliedEdits(local)`. Add a test that attaches with the flag true and no handoff.

**m-3. The PollView shell, DataCard and DataGrid re-render on every `PollUpdate`, and nothing guards the new grid's render cost.**
- Where:
  - `PollView.tsx:60` subscribes to the data store's `lastOkAt`, which changes on every update.
  - `DataCard` and `DataGrid` are not memoized.
  - `DataGrid` rebuilds `entries` (`:468-553`) and passes an inline `onClose` to `ContextMenu` (`:649`).
  - `MenuButton` passes a new `insideRefs` array on each render (`menu.tsx:282`), and `MenuList` re-subscribes its document listener on that dependency (`menu.tsx:100-110`).
- The rows are memoized and their props are stable, so values are not re-formatted. That part is fine.
- Cost at 8 views and 100 ms: about 80 renders/s of the view shell, the status line and the virtualizer. While a menu is open, the listener is removed and added again on each update.
- The FE-001 `DataTable.perf.test.tsx` guard has no equivalent for `DataGrid`, so a later prop change that breaks the row memo (for example an inline `columns` array) would go unnoticed. That matters for task 28 (8 sub-windows plus drag).
- Fix:
  - move the freshness chip and its `lastOkAt` subscription into a small component, so Body subscribes only to `status` and `hasValues`;
  - wrap `DataCard` and `DataGrid` in `memo`;
  - make `ContextMenu`'s `onClose` a `useCallback`, and memoize `insideRefs`;
  - port the perf test: an identical update formats 0 rows, and one changed value formats 1 row.

**m-4. The Biome a11y override is wider than needed and hides one real defect.**
- Where: `biome.json:19-35`.
- Problem: three rules (`useSemanticElements`, `useFocusableInteractive`, and the new `useAriaPropsSupportedByRole`) are turned off for four new whole files. Without the override, the scratch run shows:
  - `DataGrid.tsx`, `ScaledCellView.tsx`: `gridcell`/`row` roles (legitimate, the same as the FE-001 grid);
  - `PollView.tsx`: a single `useSemanticElements` hit for `role="group"` (`:104`). It never needed `useFocusableInteractive` or `useAriaPropsSupportedByRole`;
  - `menu.tsx:183`: `aria-checked` flagged only because `role` is a variable (a false positive), plus `role="separator"` on a `div` (`:162`);
  - **`DataGrid.tsx:211`: `aria-label` on a plain `<span>`** (the override marker). ARIA prohibits naming the generic role, so screen readers drop it. The override marker would then have no accessible name, against DES-003 section 6 (an override uses an icon with a name).
- Fix:
  - keep the two grid rules for `DataGrid.tsx` and `ScaledCellView.tsx`;
  - drop `useAriaPropsSupportedByRole` from the override;
  - give the marker `role="img"`;
  - use per-line `biome-ignore` comments with a reason for `PollView.tsx:104` and the two `menu.tsx` lines (REV-002 m5 asked for the same).

**m-5. The fake emits config events the backend does not, and skips checks the backend makes.**
- Neither difference breaks a current test, but both can hide part B bugs.

| Fake | Backend | Risk |
|---|---|---|
| `setPollView` always emits `PollConfigChanged` (`modbus-master.fake.ts:1285`), including for a `hasUnappliedEdits`-only patch | Emits only when the config changed (`session.rs:2072-2077`) | Code that waits for a `PollConfigChanged` to confirm a view change (for example a pending spinner in FE-003) passes against the fake and hangs against Rust |
| `updatePoll` with an identical definition emits config and list (`:1200-1218`) | No-op, no events (`session.rs:1962-1964`) | Same |
| `updatePoll`, `addPoll` and `setPollActive` do not run `validate_poll` (RTU slave 0 read, quantity and range limits) | `session.rs:1961`, `:2016` | Tests that rely on the fake accepting such a definition pass here and fail against Rust |
| `effectiveScanMs` is already filtered by the 1.5 x rule (`:245-249`) | Raw mean, null with fewer than 2 cycles | Harmless today (the UI filters again). The poll list stores the raw value, so a part B sidebar showing it would differ |
| Monitor `id` ("monitor-1") differs from `name` (`:193-203`, `window.ts:83-92`) | `id` = `name` | `restorePlacement` matches either, but a test that persists `name` and looks up by `id` would pass in only one of the two |

- Fix: emit only on a real change, apply `validate_poll`-equivalent checks (`fake-validation.ts` can reuse `pollSchema`), report the raw mean, and set `id = name`. Add the two "no event" cases to `modbus-master.fake.contract.test.ts`.

**m-6. "Edit alias" in the row context menu edits the focused row, not the right-clicked row, when the click lands inside a multi-row selection.**
- Where: `DataGrid.tsx:363-372` keeps the focus when the row is already selected. `:469-477` edits `focusAddress`.
- Scenario:
  1. Shift-click rows 2-6 (focus 6).
  2. Right-click row 3 and choose "Edit alias".
  3. The editor opens on row 6.
- DES-002 2.3.5 starts editing from "the row context menu". Clear alias and Copy act on the selection, which is correct.
- Fix: remember the right-clicked address in the menu state and use it for "Edit alias". Alternatively, move the focus to the right-clicked row without changing the selection.

### Nit
- **n-1.** `poll.store.ts:284` `lastOkAt: evt.lastOkAt ?? get().lastOkAt` discards a meaningful `null`: Rust clears it after Apply, Disconnect and Dismiss (BE-002 "Counters"). Nothing reads `pollStore.lastOkAt` yet. The W2 status bar "Last OK …" (task 19) will show the old time after an Apply. Assign the value directly.
- **n-2.** `DataGrid.tsx:78-99`: the editor's blur guard reads `alias.editing` from the state captured at render (`stores.alias.getState()` at `:78`), not the current state. If the webview fires `blur` when the old row's input is removed after `Enter`, the guard passes and `commit("blur")` closes the *next* row's editor. Read `stores.alias.getState().editing` inside the handler.
- **n-3.** `menu.tsx:261` sets `aria-controls={menuId}`, but the `role="menu"` element (`:151-158`) never gets `id={menuId}`, so the reference points nowhere.
- **n-4.** `PollSetup.tsx:9` imports `Field` and `describedBy` from `components/setup/field`, which belongs to the old shell. Moving or deleting that folder in task 17 would break the new view. Move `field.tsx` next to the shared tool components, or list it in the task 17 notes.
- **n-5.** `shared/ipc/legacy/v1-bindings.ts` is a hand-maintained copy of generated DTOs. It is acceptable as a frozen, temporary copy, but CLAUDE.md says bindings are never edited by hand. Keep it read-only and delete it with the legacy facade in task 17, as the notes say.
- **n-6.** `poll-list.logic.ts:41-43` `sameSummary` uses `JSON.stringify` on both summaries for every poll on every `PollListChanged`. With 16 polls and 2000 aliases each, that is about 64k alias entries per event. `PollListChanged` is not high-rate, but compare `config` by reference or by a revision instead. Also, `applyCounters` puts per-poll counters into `polls[id]`, so every sidebar row whose poll is running will re-render 10 times a second in part B. Consider a separate counters map.
- **n-7.** `applyHandoff` (`poll-view-ui.store.ts:346`) does not clamp `columnWidths` to `POLL_COLUMN_MIN_WIDTHS`. A malformed but schema-valid handoff can give a 0 px column.

## Notes (not findings)
- **The app does not work end to end against the real backend after part A.** `ModbusMasterPage` still runs the legacy facade, whose `mm_start_poll` and `mm_stop_poll` no longer exist in Rust (BE-002 "Removed commands"). FE-002 says so plainly. QA on the real backend has to wait for part B (tasks 17 and 19).
- Q-FE2-01 (four texts the design does not give) and Q-FE2-03 (popover anchor) are open questions for the designer. The code's choices are reasonable placeholders.

## Verdict
**Approve** for part A. There is no blocker or major issue:
- the facade's command names and argument keys match Rust one for one;
- the event names and payloads match the generated bindings;
- the hold-and-replay, token, detach and dispose logic is correct;
- the layout math reproduces every DES-002 2.8 vector.

Fix in part B, before the first QA run on the real backend:
- m-1 and m-2 (wrong connection announcements, and a false "Unapplied edits in: …" in the W1 close dialog);
- m-3, before task 28's performance run;
- m-4, which hides a real a11y defect.

m-5 and m-6 and the nits can go with the related tasks.
