# REV-003 Modbus Master frontend re-check (after REV-002)

Scope: the frontend rework in `apps/desktop/src`, checked against REV-002 findings M1-M6, m1-m9 and n1-n3 (B1 is backend and was fixed there), against the DES-001 Revision 2 notes, and against BE-001 "Contract changes after REV-001". Rust was read only to confirm event ordering (`crates/modbus-master/src/session.rs` attach/start_poll, `state_machine.rs` T11 emission, `clock.rs`, `validate.rs` host rule).
Inputs: CLAUDE.md, REV-002, DES-001 Rev 2, BE-001 (Final contract + contract changes).
Reviewer: code-reviewer, 2026-10-16. The repository has no commits, so this reviews the files on disk. Nothing was edited.
Excluded as agreed: m6 (binary values with nibble spaces pasted into FC15/16 lists) is an open design question.

## Commands run (read-only)
| Command | Result |
|---|---|
| `pnpm typecheck` | clean (desktop + e2e) |
| `pnpm lint:web` (`biome check .`) | clean, 142 files |
| `pnpm test:web` (`vitest run`) | 45 files, 888 tests, all pass |

## REV-002 findings: status
For each item: is it fixed in the code, and would its regression test fail on the old behaviour (judged by reading the test against the REV-002 description of the old code).

| Id | Fixed? | Evidence | Test fails on old code? |
|---|---|---|---|
| M1 | yes | `runtime/index.ts:44-55` turns `commandError` and `traffic.error` into 4 s error toasts and clears them. `schemas.ts:116-127` requires a 4-part IPv4 address for digits-and-dots hosts, which matches `validate.rs:89-106` case by case (`192.168.1`, `1..2`, `192.168.1.`, `1.2.3.4.5`). | yes: `ConnectionFlow.test.tsx:211-262` (no toast before; `192.168.1` was accepted), `schemas.test.ts:110` |
| M2 | yes | `session.store.ts` keeps `connection` and `pollDefinition` (set by connect / startPoll / snapshot, rolled back on rejection). `useRunningSetup` (`context.tsx:66-72`) feeds `SessionBanner`, `LiveRegions` and the write dialog. | yes: `Rev2Regressions.test.tsx:35-87` edits Slave ID / start / quantity / host and asserts the banner and live region text is unchanged |
| M3 | yes | `session.store.ts:135-162` holds channel events until the snapshot is applied, then replays them in arrival order. The backend acks the snapshot before it emits on the new sink (`session.rs:649-655`), and between the invoke resolution and the `holding = false` there are only microtasks, so no event can slip past the hold. | yes: `session.store.test.ts:451-523`. The fake now registers the handler before the held reply (`modbus-master.fake.ts:276-281`), so the old unconditional `set` would end in `timeout` / `connecting` |
| M4 | yes | `ControlledSelect.tsx` is controlled through `useController`, and the current value is always an option. While loading, the serial select shows the current port (disabled). `useController` registers a ref object without `.disabled`, so disabling the select does not blank the RHF value. | yes: `Rev2Regressions.test.tsx:89-163` checks the DOM value during and after Refresh and the `connect` payload |
| M5 | yes | `LauncherPage.tsx` calls `openTool` -> `window_open_tool` (new tab in a plain browser), and shows an inline error on failure. | yes: `LauncherPage.test.tsx` "REV-002 M5" (the old `<Link>` had no button) and `open-tool.test.ts` |
| M6 | yes | `traffic.logic.ts:57-101` caps the queue (drops the oldest), and `runtime/stores.ts:69-73` passes `TRAFFIC_CAPACITY`. | yes for the batcher (`traffic.store.test.ts:287-304`). The wiring in `stores.ts` is not tested (n4) |
| m1 | yes | `controller.ts:360-362` cancels in `connecting`, disconnects otherwise. | yes: `Rev2Regressions.test.tsx:232-269` |
| m2 | yes | `controller.ts:314-328` saves with `overwrite: false` and asks only on `profileExists`. | yes: `controller.test.ts:642-662` |
| m3 | yes | `layout.store.ts:79-87` uses one token per modal. | yes: `Rev2Regressions.test.tsx:271-307` |
| m4 | yes | `TrafficPanel.tsx:148-186` anchors the top frame by `seq` while Auto-scroll is off. | yes: `Rev2Regressions.test.tsx:309-354` |
| m5 | yes | `biome.json` override lists exactly the five files. FE-001 records it. | n/a (config; lint clean) |
| m7 | yes | `config.store.ts:56-66` makes the backend setup the clean baseline of an untitled window, and the toolbar buttons and store commands wait for `ready`. The profile name is still lost on reload, because the snapshot does not carry it. That is a contract limit, not a defect. | yes: `Rev2Regressions.test.tsx:356-387` |
| m8 | mostly | `newWindow` reports failures (`controller.ts:421-427`). The clipboard calls can still reject unhandled (n3 below). | yes for Ctrl+N (`Rev2Regressions.test.tsx:389-398`) |
| m9 | yes | `answersPending` (`session.logic.ts:79-103`) plus `pendingResolved`. A second Apply is sent, not dropped. The backend emits T11 `polling -> polling` (`state_machine.rs:154, 203-207`), so Apply in `polling` is always answered. | yes: `session.store.test.ts:556-625` (the old code cleared `pending` on the repeated `timeout`) |
| n1 | yes | The deviations are recorded in FE-001 lines 36-41. | n/a |
| n2 | yes | `tokens.test.ts:68-84` greps `(bg\|border\|text\|ring\|fill\|stroke)-warning` outside the allowed primitives. | guard test, no offender to fail on |
| n3 | yes | `OpenProfileDialog.tsx:72` compares ignoring case. | yes: `Rev2Regressions.test.tsx:563-586` |

## Rev 2 items
- **linkLost in the write dialog:** correct.
  - The `LINK_LOST_VIEW` text matches DES 2.5. It outranks "Not connected" (`WriteDialog.tsx:103-113`) and stays while the draft is edited.
  - The runtime empties the result on the next transition into L* (`runtime/index.ts:57-65`).
  - Arrival order does not matter. If the `disconnected` event lands first, the dialog shows "Not connected" until the write promise resolves, and then link lost. A user Disconnect during a write also gives link lost (`session.rs:707-721`), which is correct.
  - Tests: `WriteDialog.test.tsx:309-360`.
- **TCP unit 0 vs RTU broadcast:** correct.
  - `writeWarnings` warns only for RTU (`schemas.ts:381-386`).
  - The mode comes from the session's connection, not the draft. A test pins this (`WriteDialog.test.tsx:290-307`).
  - RTU read slave 0 is still rejected.
- **AppError.field:** correct.
  - `IpcError.field` is parsed in `toIpcError`.
  - The setup form maps every field the backend can send. `port` maps to the serial port select in RTU (`use-setup-form.ts:155-174`).
  - The write dialog focuses `slaveId`, `function`, value or values, and falls back to address.
  - An unknown field gives a toast only.
  - The panel stays mounted while hidden, so focus works after it is revealed.
- **badResponseText:** `lib/exceptions.ts:36-61` matches DES 3.4 word for word, including the two-digit FC, the got/expected texts, the "leading words" fallbacks and `malformed` without a message.
- **Enter to connect:**
  - A hidden submit button in the Connection form triggers `controller.connect`, which acts only in idle/disconnected.
  - Read-only fields in other states make Enter a no-op.
  - There is no Connect button in the setup panel.
- **Dismiss:** `dismiss()` sends `mm_disconnect` with `pending: "dismiss"`, which only an `idle` event answers. The banner button shows the spinner. There is no local reset.
- **Profile names:**
  - `profileNameError` applies the DES 3.4 rules in order and never trims.
  - Reserved names cover both the whole name and the part before the first dot, including the superscript forms.
  - A backend `invalidProfileName` shows under the field.
  - Save, Save as and Save in "Save changes?" are blocked while the form is invalid. The toast is the 4 s error tone with `circle-x`. See m-2 for one gap in "all messages shown".
- **Unreadable profiles:** shown with the exact text and `triangle-alert`. Open is disabled, and double-click/Enter are guarded.

## New code checked and found correct
- **Init hold/replay ordering:**
  - Events are replayed in arrival order after `onSnapshot`.
  - The snapshot's counters are replaced by the held `Counters`, and the replayed traffic log goes through the batcher.
  - `ready` is set before the replay, but nothing can run between the two because the replay loop is synchronous.
  - StrictMode cannot open two channels (`runtime/index.ts:70-81`).
  - The T2 auto-start subscriber firing during replay (snapshot `connecting`, held `connected`) sends one Start. That is what T2 asks for, because the pre-reload context is gone.
- **useRunningSetup:** every place that describes a *running* state reads the session copy (banner, live region, write dialog mode and timeout). Two places still read the draft, both correctly:
  - `StatusBar` shows the target only in `connecting`/L*. In those states the Connection fields are read-only, and the draft is exactly what `connect` sent (`controller.ts:152-153`).
  - `DataCard` uses the draft only for the not-yet-running texts (idle/connecting/connected "would poll") and `definition ?? poll` for the header.
- **Batcher cap and seq gaps:**
  - Dropping the oldest keeps `seq` ascending, so the binary search in `indexOfSeq` stays valid.
  - The `#` column shows absolute seqs, as DES 8 asks.
  - A selection that was dropped resets to null, and the m4 anchor falls back to the top.
- **ControlledSelect:** the unlisted value is shown as "{value} (not supported)" for baud, data bits, parity and stop bits, and as the plain name for a port that vanished. The value always comes from the form.
- **answersPending:** walked through every command, including commands that race a link loss:
  - A Disconnect sent while the backend is already `disconnected` becomes a T15 to `idle`, and `disconnected`/`idle` answer it.
  - A Cancel that loses to T2 is answered by `connected`.
  - No command can resolve without a later `StateChanged`, so `pending` cannot stick.

## Findings

### Blocker
None.

### Major
None.

### Minor

**m-1. A rejected older Apply rolls `pollDefinition` back over a newer accepted one.**
- Where: `store/session.store.ts:203-213` together with `send` at `:111-118`.
- Problem: `onRejected` runs even when the command was superseded (`mine !== latestCommand`), and it restores the `before` captured by *that* call.
- Scenario:
  1. Polling D0.
  2. The user presses Apply with D1, and then Apply with D2 while D1 is pending.
  3. The backend rejects D1 (`validation`, for example from a rule the frontend does not check) and accepts D2.
  4. `pollDefinition` ends as D0 while the backend polls D2, so the timeout or exception banner names the wrong slave or range: a narrow M2 regression.
  5. If both are rejected, it ends as D1, which never ran.
- Reachability is low, because the frontend validates the same ranges as the backend.
- Fix: roll back only when `mine === latestCommand`, or keep the last *accepted* definition separately and restore that.

**m-2. When the Connection section is invalid, Save does not show the Poll errors.**
- Where: `runtime/controller.ts:269-282`. `const poll = connection ? await gateway.current.validatePoll() : null;`
- Problem: DES 3.5 says that a blocked save shows *all* field messages. With an empty host and Quantity 126 (not yet touched), Save as / Ctrl+S / Save in "Save changes?" shows only the host message. The user fixes the host, presses Save again, and only then learns about Quantity.
- Fix: trigger connection and poll fields in one `form.trigger([...], { shouldFocus: true })`, so focus still goes to the first invalid field. Add a test with both sections invalid.

**m-3. Loading a profile disconnects before the profile is read.**
- Where: `runtime/controller.ts:344-377`.
- Problem: `profiles_get` runs only after "Disconnect and load" has already stopped the session.
- Scenario:
  1. S3 lists "Pump".
  2. Another window deletes or overwrites it with an unreadable file.
  3. The user opens it while polling and confirms.
  4. The session goes idle, then `profiles_get` fails ("Could not open profile: …").
  5. The engineer has lost the running session and has nothing loaded.
- This was not introduced by the rework, but it is reachable now that unreadable files are a first-class case.
- Fix: `load(name)` first (after the unsaved-changes question), then confirm and disconnect, then `applyProfile`.

### Nit
- **n-1.** `session.store.ts:138-161` has two small issues:
  - The `held` array stays referenced by the channel callback for the lifetime of the window, and on a reload it can contain the whole replayed traffic log (up to 5,000 frames). Clear it after the replay (`held.length = 0`).
  - The `event.at < snapshot.at` filter is not needed, because the backend emits on the new sink only after the snapshot (`session.rs:649-655`). It also depends on `SystemClock` wall time (`clock.rs:19-23`), so a backwards clock step during the hold would drop a real transition. Consider removing it.
- **n-2.** While Dismiss is pending, the toolbar shows Reconnect enabled (`Toolbar.tsx:95-104` checks only `pending === "connect"`). `session.connect` returns silently because `pending !== null` (`session.store.ts:183`), so the click does nothing. Disable session buttons while any command is pending, or queue the connect.
- **n-3.** `controller.copyRows/copyFrames/copyFrameBytes` (`controller.ts:219-250`) await `clipboard.writeText` without a catch, and the callers use `void`. A clipboard rejection becomes an unhandled rejection with no message. This is the remainder of m8.
- **n-4.** Some tests are missing:
  - No test checks that `createStores` passes `TRAFFIC_CAPACITY` to the batcher. The M6 test calls `createBatcher` with an explicit cap.
  - Enter-to-connect is tested only for the TCP text fields and Timeout. In RTU the other fields are selects, and jsdom does not model implicit submission from a `<select>`. Add a Playwright check in CHK-001.

## Verdict
**Approve.** B1 (backend), M1-M6, m1-m5 and m7-m9, and n1-n3 are fixed. m8 is fixed except for the clipboard case (n-3). Each fix has a regression test that would fail on the old code, except the guard-only n2 and the config-only m5, which `pnpm lint:web` covers. The Rev 2 items match DES-001 and the BE-001 contract changes. No blocker or major issue was found in the new hold/replay, pending, batcher or controlled-select code. m-1 to m-3 should be fixed before QA sign-off, but they do not block QA.
