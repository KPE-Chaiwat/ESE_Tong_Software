# REV-002 Modbus Master frontend review

Scope: `apps/desktop/src` (app, launcher, `shared/{ipc,ui,lib}`, `tools/modbus-master`) and `apps/desktop/biome.json`. Rust was read only to check the IPC argument keys (`src-tauri/src/commands`), the backend validation limits (`crates/modbus-master/src/validate.rs`), the snapshot/attach order (`session.rs`) and the Tauri capability file. It was not reviewed.
Inputs: CLAUDE.md, REQ-001, DES-001, FE-001, BE-001 (Final contract).
Reviewer: code-reviewer, 2026-10-16. The working tree is uncommitted, so this reviews the files on disk.

Note on DES-001: the file on disk is **Revision 2 (2026-10-16)**, published while this review ran (TCP unit 0 is unicast, `linkLost` write result, single-frame traffic selection, Save blocked while invalid, extra profile-name rules, RTU messages, `shortFrame` text). The frontend was built against Revision 1. Rev 2 items the frontend does not have yet are listed at the end as follow-up work. They are **not** counted as defects. As agreed with the caller, the missing `linkLost` result and the TCP unit-0 broadcast warning are not reported.

## Commands run (read-only)
| Command | Result |
|---|---|
| `pnpm typecheck` | clean (desktop + e2e) |
| `pnpm lint:web` (`biome check .`) | clean, 138 files |
| `pnpm test:web` (`vitest run`) | 43 files, 755 tests, all pass |
| `biome lint src` with a scratch config that has no a11y override | lists exactly what the override hides (see m5) |
| Two scratch Vitest files in the session scratchpad, run with a scratch config that reuses `vite.config.ts` (no repo file changed) | reproduced M3 and M4 |
| Read of `node_modules/@tauri-apps/api/window.js` (2.12.4), `src-tauri/gen/schemas/acl-manifests.json` and `tauri-2.12.4/src/manager/window.rs` | B1 |

## What was checked and found correct
- **IPC boundary:** only `shared/ipc/{index,modbus-master,window}.ts` import `@tauri-apps/api`. Command names and argument keys match the Rust signatures exactly: `mm_connect {config}`, `mm_start_poll {poll}`, `mm_write {request}`, `mm_open_session {channel}`, `profiles_* {toolId, name | profile, overwrite | oldName, newName}`, `window_open_tool {toolId}`. Tauri v2 maps camelCase keys to the snake_case parameters, and no command uses `rename_all`. `modbus-master.tauri.test.ts` pins every name and key. DTOs come from `shared/bindings` and are re-exported, not hand-written.
- **Transition table:** `ALLOWED` in `session.logic.ts:34-44` equals the FE-001 table, which is T1-T15. Unexpected pairs are applied and recorded in `lastUnexpected`. `SessionData` cannot hold an impossible combination: `reason` is nulled outside `disconnected`, `exceptionCode` outside `exception`, `badResponse` outside `badResponse`, and the failure counter outside the three failure states. Dismiss goes through `mm_disconnect` (BE-001 deviation 8). Pending flags are cleared by the next `StateChanged` or by a rejection.
- **Poll data:** `applyUpdate` ignores `seq <= current` and updates for another definition. `begin` drops values on T5/T11, `markStale` keeps values, `clear` on idle/connecting. The reload path rebuilds the view from `SessionSnapshot.lastUpdate` and marks it stale unless the state is `polling`. The backend flushes `PollUpdate` before `StateChanged`, so ordering inside the channel is safe.
- **High-frequency path:** data rows are `memo` components that select only `values[index]`, and their callbacks have stable identities. `DataTable.perf.test.tsx` shows that an identical update formats 0 rows and a single change formats 1 row. Traffic frames go through a mutable `RingBuffer` (5,000) plus a `version` counter, and `createBatcher` coalesces them into one store write per animation frame. Both lists are virtualized. Nothing polls on a timer.
- **Validation parity with backend limits:** slave 0-247, RTU read slave 0 rejected, FC01/02 1-2000, FC03/04 1-125, FC15 1-1968, FC16 1-123, start+qty <= 65536, scan 20-60000, timeout 50-10000, port 1-65535, baud list / data 7|8 / stop 1|2 as selects. One host-name gap is described in M1.
- **Write flow:** values are converted to raw u16 (signed `& 0xFFFF`, hex 1-4 digits, binary up to 16 digits). Coils are sent as 0/1, as the contract requires. Send is a no-op while sending. Closing the dialog bumps a generation counter, so a late result is dropped. `Enter` on a data row opens the dialog with focus on the Function select, so the same key press cannot also send. Send is disabled outside L*. No confirm exists for writes, which matches DES S2.
- **Tokens:** exactly six hex values, all in `styles.css`. Derived tokens are `color-mix` of base tokens. There is no `text-error` / `text-success` / `text-warning` outside `icon.tsx`, and no text on a solid error fill: destructive buttons are outlines and error pills/banners use `error-tint` with dark text. Warning fill always carries dark text. Accent buttons on light surfaces have a border. `tokens.test.ts` enforces most of this.
- **Profiles:** the S5 texts match. Safe-button focus works (`data-default`), and Esc maps to the cancel id. Delete asks first. Unreadable profiles cannot be opened. Rename validates case-insensitive uniqueness.
- **Declared deviations:**
  - The hand-built grid (TanStack Virtual without TanStack Table) is adequate for 2 and 6 fixed columns. It meets DES 8, as the perf test shows.
  - The own toast store is small, tested and polite.
  - Native selects are fine in principle. M4 is caused by uncontrolled use under react-hook-form, not by the native element.
  - None of the three is written back to DES/FE (n1).

## Findings

### Blocker

**B1. Modbus Master windows cannot be closed. The capability lacks `core:window:allow-destroy`, and the title never updates without `core:window:allow-set-title`.**
- Where: `apps/desktop/src-tauri/capabilities/default.json:6-12`. Callers: `src/shared/ipc/window.ts:22-28` and `src/tools/modbus-master/components/ModbusMasterWindow.tsx:36-54`.
- Problem: `useCloseRequest` always registers `getCurrentWindow().onCloseRequested(...)`.
  - Tauri 2.12.4 then prevents the native close whenever a JS listener exists (`tauri-2.12.4/src/manager/window.rs:177-179`, `if window.has_js_listener(WINDOW_CLOSE_REQUESTED_EVENT) { api.prevent_close(); }`).
  - The JS wrapper then calls `this.destroy()` itself when the handler does not prevent it (`@tauri-apps/api/window.js:2028-2036`), which invokes `plugin:window|destroy`.
  - `core:default` includes `core:window:default`. Per `gen/schemas/acl-manifests.json`, that set has only getters plus `allow-internal-toggle-maximize`, and neither `allow-destroy` nor `allow-set-title`.
- Failure scenario: the user clicks X on any Modbus Master window, clean or dirty. The close is prevented, `destroy` is rejected by the ACL, and the window stays open. The only way out is to kill the process. This also applies to the `main` window once it shows the tool (see M5). `setTitle` is rejected too, and the rejection is swallowed (`ModbusMasterWindow.tsx:32`), so the native title never shows the DES 2.3 title.
- Permissions the frontend code actually needs (verified call by call):
  | Code | Tauri call | Permission | In `core:default`? |
  |---|---|---|---|
  | `window.ts:22` `setTitle` | `plugin:window\|set_title` | `core:window:allow-set-title` | **no** |
  | `window.ts:24` `onCloseRequested` (destroy after a non-prevented close) and `window.ts:28` `closeWindow` (currently unused) | `plugin:window\|destroy` | `core:window:allow-destroy` | **no** |
  | `window.ts:24` `onCloseRequested` listen / unlisten | `plugin:event\|listen`, `plugin:event\|unlisten` | `core:event:allow-listen`, `core:event:allow-unlisten` | yes (`core:event:default`) |
  | `modbus-master.ts:80` `new Channel()` passed to `mm_open_session` | core channel plumbing | none | n/a |
  | All `mm_*`, `profiles_*`, `window_open_tool`, `app_info` | app commands | none: `build.rs` calls plain `tauri_build::build()` with no app ACL manifest, so app commands are not gated | n/a |
  
  `core:window:allow-close` is **not** needed: `close()` is never called. No frontend code uses `dialog`, `fs` or `store` (no `@tauri-apps/plugin-*` package is installed). `window-state` works from Rust. So `dialog:default`, `fs:default` and `store:default` grant the webview capabilities it does not use.
- Fix: in `capabilities/default.json` use `"core:default", "core:window:allow-set-title", "core:window:allow-destroy"`. Drop the unused plugin sets unless the backend needs them from JS. Add a Playwright/QA check that closing a clean window works. Unit tests cannot see this, because the fake window IPC has no ACL.

### Major

**M1. IPC command failures are never shown to the user, and one validation gap makes this reachable.**
- Where: `store/session.store.ts:80-87` sets `commandError`, but nothing renders it (grep: it is read only in `controller.ts:340`). `store/traffic.store.ts:96-103` sets `error` for Reset counters, and `TrafficPanel.tsx` never reads it. FE-001 task 06 says `commandError` is "shown as toast".
- Problem: every rejection of `mm_connect`, `mm_start_poll`, `mm_stop_poll`, `mm_disconnect` and `mm_cancel_connect` (`validation`, `invalidState`, `notConnected`, `noSession`, `io`) only stops the button spinner.
- Concrete trigger: `schemas.ts:110-118` `isValidHost` treats `192.168.1` (three numeric labels) or `1.2.3.4.5` as a valid host name. The backend's `validate.rs:93-103` rejects any all-numeric host that is not a 4-part IPv4 address. A user who mistypes an IP presses Connect, sees a spinner flash and nothing else. The same happens for Connect pressed before the snapshot arrives after a reload (m7), and for a backend-side `validation` on Start.
- Fix: subscribe to `commandError` (and `traffic.error`) in the runtime and show it through the toast store, then clear it. Align `isValidHost` with the backend: an all-digits-and-dots string must be a 4-part IPv4 address. Add a test for `192.168.1`.

**M2. The banner, the live region and the stale explanation describe the *draft* poll and connection, not the running one.**
- Where: `components/shell/SessionBanner.tsx:13-20`, `components/shell/LiveRegions.tsx:16-33` and `store/session.logic.ts:195-244`. All three read `config.poll` / `config.connection`. `components/setup/use-setup-form.ts:77-91` pushes every *valid draft* into the config store on each keystroke.
- Problem: in P* the Poll fields are editable (DES 2.3). As soon as the user types a valid new Slave ID, start address or scan rate, without pressing Apply, the banner text changes, but the backend still polls the old definition.
- Failure scenario: polling slave 1 times out. The engineer types `7` into Slave ID to prepare the next poll. The banner now says "Timeout: slave 7 did not respond within 1000 ms. Retrying every 1000 ms (12 in a row)." The exception banner's "for FC{fc} at {start}-{end}" has the same problem. In `disconnected` the connection fields are editable, so "Connection refused by {host}:{port}" follows the edited host. The wrong device or address is reported as failing.
- Fix: build the banner from the running definition (`session.pollDefinition`, which `startPoll` and the snapshot set) and from the connection that was actually connected (store it in the session store on `connect` and from `snapshot.config`). Add a test that edits the slave field while in `timeout` and asserts that the banner is unchanged.

**M3. A `StateChanged` that arrives before the `mm_open_session` reply is overwritten by the older snapshot (window reload).**
- Where: `store/session.store.ts:92-108`. The channel callback is live as soon as `invoke` is called (`shared/ipc/modbus-master.ts:79-83`), but `init` unconditionally `set`s the snapshot fields after the promise resolves. Backend order: `session.rs:591-597` acks the snapshot first, then keeps emitting on the new sink. Channel messages and the invoke reply travel on different paths, so their order in JS is not guaranteed.
- Reproduced (scratch test): snapshot `timeout` (3 in a row, `at` 1000) is resolved after the event `polling` (`at` 1100) was delivered. The store ends in `timeout`. The backend does not re-emit `polling -> polling` (T6), so the UI shows the orange Timeout banner and pill indefinitely while the device answers. With a snapshot of `connecting` and an early `connected`, the UI stays in "Connecting…" with a Cancel that is a backend no-op.
- Fix: buffer channel events until the snapshot is applied, then replay them on top of it. Alternatively, ignore the snapshot's state fields when a `StateChanged` with `at >= snapshot.at` was already applied. Add the scratch test as a regression test. The fake's `openSession` registers the handler only after resolving, so it cannot express this ordering today. Give it a mode that delivers events first.

**M4. After Refresh, the serial-port select shows a different port from the one Connect opens.**
- Where: `components/setup/ConnectionSection.tsx:138-160`. The select is uncontrolled (`register("serialPort")`). While loading, its options are replaced by a single "Loading ports…" option, so the DOM value becomes "". When the list returns, the browser selects the first option. React-hook-form never sees a change event and keeps the old value.
- Reproduced (scratch test): ports COM1 and COM3, select COM3, press Refresh. The DOM shows **COM1** and `connect` is called with **`port: "COM3"`**. The same happens when a profile with an RTU port is loaded while the list is idle: the mode switch triggers a refresh.
- Failure scenario: the engineer believes they are on COM1 (device A), but the session opens COM3 (device B), and later writes go to device B. The "Connecting to COM3…" banner is the only hint.
- Fix: make the select controlled (`Controller` / `value={field.value}`), or keep the current value's `<option>` rendered (and selected) while loading. Add a test that selects a non-first port, refreshes, and asserts DOM value == form value.

**M5. The launcher turns the main window into the tool instead of opening a tool window.**
- Where: `launcher/LauncherPage.tsx:23-27` (`<Link to={manifest.route}>`).
- Problem: DES S1 / 5.4 and FE-001 task 17 say that the launcher tile opens a new window through `openToolWindow` / `window_open_tool`. Instead, the `main` window (1100x720, min 800x560, below the DES minimum of 960x600) navigates to `/tools/modbus-master`.
  - There is no route back to the launcher, so a second tool cannot be started from the launcher.
  - The window-state plugin keys on `main` rather than `modbus-master-<n>`.
  - With B1, the main window can no longer be closed either.
- Fix: the tile calls `ipc.window.openToolWindow(manifest.id)` (via a launcher-level facade function in `shared/ipc`) and shows a toast on failure.

**M6. While animation frames do not run, the traffic batcher queue grows without bound.**
- Where: `store/traffic.logic.ts:57-96` (`queue` has no cap) and `runtime/stores.ts:69-72` (the default scheduler is `requestAnimationFrame`).
- Problem: browsers do not run rAF callbacks for a hidden document (minimized or background window). Every `TrafficFrames` batch is still pushed into `queue`, and nothing is dropped until the next frame callback. At 100 ms polling (about 20 frames/s), an 8-hour minimized session queues about 576,000 frames before `appendFrames` keeps only the last 5,000. Memory grows for hours, and the first frame after restore does one large push. Users run this for hours (DES intro). Whether WebView2 marks a minimized Tauri window hidden was not verified at runtime. The unbounded queue is verified in the code.
- Fix: cap the queue at `TRAFFIC_CAPACITY` (drop from the front in `push`), or fall back to a `setTimeout` flush when `document.hidden`.

### Minor

- **m1. Loading a profile while `connecting` always fails after 5 s.** `controller.ts:325-344` asks "Disconnect and load?" for any non-idle state. `session.disconnect()` (`session.store.ts:132-136`) returns early because `actionsFor("connecting").disconnect` is false, and the wait then times out with "The device did not disconnect". The backend handles `mm_disconnect` in `connecting` (T4). Fix: call `cancelConnect` in `connecting`, or allow disconnect there.
- **m2. Save as always writes with `overwrite: true` and relies on a fresh list for the Replace confirm.** `controller.ts:294-309` decides about Replace from `profiles.refresh()`, then saves with `true`. If the refresh fails (`status: "error"`, stale items) or another window saves the same name in between, an existing profile is replaced without asking. Fix: save with `overwrite: false` first and show "Replace profile?" on `profileExists`.
- **m3. The modal lock is a boolean, so nested modals re-enable the window shortcuts.** `components/context.tsx:63-70`. S4 is open, the Replace confirm opens, and the user cancels it. The confirm's cleanup sets `modalOpen=false` while S4 is still open. `Ctrl+L` (connect/disconnect), `Ctrl+O`, `Ctrl+B` and the others then act behind S4. Fix: use a counter.
- **m4. With a full ring buffer and Auto-scroll off, the traffic list moves under the reader.** `TrafficPanel.tsx:128-146`. Rows are addressed by ring index. Once 5,000 frames are held, every batch shifts all indexes by the batch size, so at the same scrollTop the frames move up by about 20 rows/s at 100 ms polling. Inspecting a frame needs Pause. Fix: when Auto-scroll is off, compensate `scrollTop` by the number of dropped rows × 22 px.
- **m5. The Biome a11y override is justified per rule, but scoped too wide.**
  - `biome.json:17-29` turns off `useSemanticElements` and `useFocusableInteractive` for all of `components/**`.
  - Without it, Biome flags only the ARIA grid parts of `DataTable.tsx` / `TrafficPanel.tsx` (absolute-positioned virtual rows using `aria-activedescendant` cannot be `<tr>`/`<td>`), the focusable `role=separator` in `Splitter.tsx` / `ColumnResizeHandle.tsx` (an `<hr>` cannot take focus), and `role=radio` buttons in `segmented.tsx` (roving tabindex). All are legitimate patterns.
  - The folder-wide override also silences these rules for every future dialog and form.
  - Fix: limit `includes` to those five files, or use per-element `biome-ignore` with a reason, as the `useKeyWithClickEvents` cases already do.
- **m6. In the write values box, binary values are split at their nibble spaces.** `lib/parse.ts:47-49` splits on any whitespace. Binary values in table format (`0000 0100 1101 0010`, which `buildDraft` prefills at `store/write.logic.ts:79-82` and Ctrl+C copies) become 4 values when the user switches to FC16 or pastes a copied column. The count and "Writes addresses …" make it visible, but it is easy to send 4 registers instead of 1. This is a DES ambiguity (3.3 allows both nibble spaces and space separators). Ask the designer. Options: disallow spaces inside binary items in lists, or prefill lists without nibble spaces.
- **m7. On reload, the window is "Modified" and Untitled, and commands can run before the snapshot.**
  - `runtime/stores.ts:95-107` copies `snapshot.config` and `snapshot.poll` into the config store, whose baseline is the defaults, so an untitled window shows "Modified". The profile name is lost.
  - `session.store.ts:27/105` sets `ready`, but nothing reads it. Until `openSession` resolves, the toolbar shows Connect (default `idle`). Connect pressed in that window, while the backend polls, ends in a silent `invalidState` (M1).
  - Fix: disable session actions until `ready`, and keep the snapshot's setup as the saved baseline.
- **m8. Rejected promises are dropped.** `use-shortcuts.ts:27` `void controller.newWindow()` and `Toolbar`/`SessionBanner` `void controller.*` leave `window_open_tool` failures (for example `unknownTool`) as unhandled rejections with no message. `WindowIpc.closeWindow` is unused.
- **m9. `pending` is cleared by any `StateChanged`, not by the matching one.** `session.store.ts:117`. If the user presses Apply in `timeout`, a repeated `timeout` event arrives first and clears `pending="startPoll"`. That makes `stores.ts:127` run `begin` early, and the real T11 event then does nothing. The effect is benign today, but the spinner stops before the command completes. Also, a second Apply while the first is pending is dropped (`session.store.ts:140`) after `config.setPoll(def)` was already applied, so the form shows a definition that is not running. Fix: clear only on an event that answers the pending command (or on the next event after the command resolved), and queue or replace the pending Apply.

### Nit
- **n1.** The three declared deviations (no TanStack Table, native `<select>` instead of shadcn Select, own toast store instead of sonner) contradict CLAUDE.md stack / DES 6.3. They are acceptable, but they should be written back into FE-001 or DES-001 (as BE-001 does for its deviations).
- **n2.** `tokens.test.ts:58-66` checks "orange only for warning" by grepping for `ese-warning|#fa8130`. A decorative `bg-warning` class would pass. Grep for `(bg|border|text)-warning` outside the status primitives instead.
- **n3.** `OpenProfileDialog.tsx:71` compares the renamed name with the loaded profile name case-sensitively. The backend matches names ignoring case.

## Rev 2 deltas not yet implemented (follow-up, not graded)
- 2.5 / 3.3: `linkLost` write result. The broadcast warning should show for RTU only (`schemas.ts:366-368` shows it in TCP too). The backend change is in progress.
- 3.4 kind texts (`lib/exceptions.ts:44-53`):
  - `shortFrame` should read "short frame ({got} of {expected} bytes)" (it is "malformed frame (frame too short)").
  - `transactionMismatch` should include got/expected.
  - `wrongFunction` should use two-digit FC.
  - The fallbacks are "reply from unexpected slave" / "reply for unexpected function".
- 3.4 profile name rules: leading/trailing space, leading/trailing dot, control characters, Windows reserved names. Also, names are not trimmed silently (`schemas.ts:382-396` trims).
- 3.1 RTU messages: "Choose a baud rate from the list.", "Data bits must be 7 or 8.", "Choose a parity from the list.", "Stop bits must be 1 or 2.". Also the "{value} (not supported)" option.
- 5.2: traffic `Ctrl+C` / Copy with no selection must do nothing (`controller.ts:221-231` copies the whole log). The toasts should be "Copied 1 row." / "Copied 1 frame.".
- 3.5: the save-blocked toast needs the `circle-x` icon and 4 s duration (`toast.store.ts` is text-only with 2 s).
- 1: `Enter` in a Connection field connects only in idle/disconnected. This is already true, because `controller.connect` guards it.

## Verdict
**Changes required.** B1 must be fixed before QA, because no Modbus Master window can be closed. M1-M6 should be fixed in the same pass:
- M2 and M4 can make the engineer act on the wrong device.
- M3 can leave the UI stuck in a state the backend has left.
- M1 hides every command failure.
