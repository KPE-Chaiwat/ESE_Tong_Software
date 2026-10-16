# FE-001 Modbus Master (MVP) - frontend tasks

Upstream: `docs/design/DES-001-modbus-master.md` (DES), `docs/requirements/REQ-001-modbus-master.md`. QA: `docs/qa/CHK-001-modbus-master.md`.
Prerequisite: the desktop app scaffold (done separately by the PM/scaffold task). Folder names below follow the planned layout in CLAUDE.md (`tools/modbus-master/`, `shared/ui`, `shared/ipc`, `shared/lib`). File names are left to the implementer.

## Ground rules for every task
- Strict TS, Biome clean, and Vitest for every store and util (CLAUDE.md definition of done).
- Stores and components never import `@tauri-apps/api`. They call the `shared/ipc` modbus-master facade (task 05), which tests replace with its fake.
- Each store is built by a factory (`createXStore(deps)`) that takes the IPC facade as a dependency. The tool window uses one instance per window (each Tauri window is its own JS context). Tests create fresh instances.
- UI strings are English and inline, copied **exactly** from DES sections 2-5.
- Until BE-001 generates ts-rs bindings, the facade declares temporary local types that mirror DES section 9 (marked `TEMP until bindings`). Task 05 includes swapping them for the generated types when they land; nothing else changes.
- Each task names the DES states it implements. These are the session states (`idle, connecting, connected, polling, paused, timeout, exception, badResponse, disconnected`) and the view states (`invalid input, empty data, loading, live, stale`).

---

## Revision 2 (2026-10-16): what to re-do or extend
Source: DES-001 revision 2 (after REV-001 and the BE-001 Final contract). The generated bindings are now authoritative: import them from `shared/bindings` and drop all `TEMP until bindings` types. Tasks not listed here are unchanged.
| Task | Change |
|---|---|
| 03 Pure data utils | Add `badResponseText(kind, detail)` (DES 3.4 table and fallbacks, including `shortFrame`) and `writeResultText(result, ctx)` (DES 2.5 including `linkLost`) |
| 04 Validation schemas | Write slave 0: broadcast warning in RTU only (`warnings` needs the mode). RTU baud/data bits/parity/stop bits messages (DES 3.1). Profile name rules and order (DES 3.4) |
| 05 IPC facade and fake | Use generated types. `WriteResult.linkLost`, `SessionReason.phase`, `BadResponseDetail`. The fake can script `linkLost` and answer TCP unit 0 |
| 06 Session store | `dismiss()` calls `ipc.disconnect()` and waits for `idle` (no local reset). Store `reason.phase` and `badResponseDetail`. Banner uses `badResponseText` |
| 09 Connection form | Remove the setup-panel Connect button. `Enter` in a Connection field connects in idle/disconnected. Show the RTU range messages for out-of-list values from a loaded profile |
| 10 Connect / … / Dismiss | Dismiss pending flow (spinner until `idle`). `Enter` path to Connect |
| 13 Data table interaction | Minor: the copy toast for a single row reads "Copied 1 row." (DES 5.2) |
| 14 Traffic store and panel | Single-frame selection only. `Ctrl+C` copies one frame and shows the toast "Copied 1 frame.". `Ctrl+A` is not handled in the traffic list |
| 15 Write dialog | Broadcast warning and `broadcastSent` only in RTU. TCP unit 0 behaves as a normal write. New `linkLost` result and its after-state. badResponse text from `detail` |
| 16 Profiles | New name rules. Save and Save as blocked while the setup form is invalid, with the toast "Fix the highlighted fields before saving.". Re-validate the setup form after `profiles_get`. Unreadable profiles (`readable: false`) cannot be opened |
| 17 Multi-window and close | Save in "Save changes?" with an invalid form is blocked (toast); the window stays open |
| 08 Window shell | Manifest minimum width must be 960 (REV-001 Q5; the current manifest reportedly uses 900) |

---

## Implementation notes (2026-10-16, after REV-002)
What the code does where it differs from the stack list in CLAUDE.md or from the wording of the tasks. These are accepted deviations, recorded here so the documents match the code.

**Accepted deviations**
- **Tables:** the data table and the traffic list are hand-built ARIA grids (`role=grid`, absolutely positioned rows) on `@tanstack/react-virtual`. TanStack Table is not used: the columns are fixed (2 and 6), and the perf test (`DataTable.perf.test.tsx`) shows one formatted row per changed value. The five files that need non-semantic ARIA roles (`DataTable`, `TrafficPanel`, `Splitter`, `ColumnResizeHandle`, `shared/ui/segmented`) are listed in the `biome.json` override for `useSemanticElements` and `useFocusableInteractive`. Nothing else is exempt.
- **Selects:** native `<select>` instead of the shadcn Select. They are controlled by the form (`ControlledSelect`), so a value outside the list stays selected and is shown as "{value} (not supported)".
- **Toasts:** an own store (`shared/lib/toast.store.ts`) and `shared/ui/toaster.tsx` instead of sonner. Default 2 s, error toasts with the `circle-x` icon and 4 s.
- **Tooltips:** the `title` attribute, not the shadcn Tooltip.
- **Setup panel:** no Connect button (DES Rev 2). `Enter` in a Connection field submits a hidden form that calls `controller.connect()`.
- **Where the logic lives:** cross-store flows are in `runtime/controller.ts` (plain TypeScript, tested with the fake), the wiring in `runtime/stores.ts`, one runtime per window in `runtime/window-runtime.ts`.

**Behaviour decided while implementing (not spelled out in the tasks)**
- The banner, the live region and the write dialog describe the **running** connection and poll (`session.connection`, `session.pollDefinition`, from the last command and from the snapshot), never the draft in the setup form. Both are restored when the command is rejected.
- `pending` is cleared by the backend event that answers the command (`answersPending`), or by the next event once the command has returned. A repeated `timeout` does not end a pending Apply. A second Apply while one is pending is sent too.
- `mm_open_session`: events that arrive before the snapshot reply are held and replayed on top of it; state changes older than the snapshot are dropped. Session commands are ignored (and the toolbar buttons disabled) until the snapshot is applied. A reloaded window adopts the backend's connection and poll as its clean baseline (no "Modified").
- Command failures are shown as error toasts. A `validation` error with `AppError.field` also shows its message under that input and focuses it (setup form, write dialog).
- Save as always asks the backend first without overwrite and shows "Replace profile?" on `profileExists`. Profile names are used exactly as typed.
- Loading a profile while `connecting` cancels the attempt (`mm_cancel_connect`) before loading.
- The write dialog keeps its result until the next Send or until it closes, also while the draft is edited. A `linkLost` result is emptied by the runtime when the session is back in L*.
- The traffic queue between the channel and the store is capped at 5,000 frames (animation frames do not run in a hidden window). With Auto-scroll off, the view is kept on the frame that was at the top.
- A binary value prefilled into the values list has its nibble spaces closed up (a list is split at spaces). Open point for the designer: DES 3.3 allows both nibble spaces and spaces as separators, so a pasted `0000 0100 1101 0010` in a list is still read as four values.
- Launcher: the tile opens the tool with `window_open_tool` (a new window); in a plain browser (`pnpm dev:web`) it opens a new tab. The main window keeps showing the launcher. Its minimum size is set in `tauri.conf.json`, not in the frontend.
- `VITE_FAKE_IPC=1` (for example `pnpm dev:web`) runs the window against the simulating fake and exposes it as `window.__ESEFACT_FAKE_IPC__` for Playwright.

**Round 3 (QA findings, REV-003)**
- Single-item write confirmations omit the count: "Write confirmed by slave 1: register at 3." / "... coil at 1.". Several items keep "{n} registers at {a}-{b}.".
- Modals (Write, Open profile, Save as, confirms) give the focus back to the element that had it when they opened (`useReturnFocus` in `shared/ui/dialog.tsx`). Opened from the data grid, that is the grid element, whose `aria-activedescendant` is still the row; opened from the toolbar Write… button, it is that button.
- The Write dialog shows a secondary [Reconnect] button at the end of the result area for link lost and for "Reconnect failed: {reason text}" (never for Not connected). It calls `controller.connect()` like the banner button and the toolbar: `mm_connect` with the connection of the setup form, which is the running one because the modal blocks editing. While pending it is `aria-disabled` with a spinner (so it keeps the focus). When the session is back in L* the result and the button clear and Send gets the focus. `Ctrl+L` stays off in modals. The result area is `min-h-10` (not fixed 40 px) because the link-lost text wraps.
- Test hooks, only with `VITE_FAKE_IPC` set: `window.__ESEFACT_FAKE_IPC__`, `window.__ESEFACT_FAKE_WINDOW_IPC__` (close request, `openedTools`, `titles`). `VITE_FAKE_IPC=1` simulates, `VITE_FAKE_IPC=manual` does nothing by itself, and `setSimulate(on)` switches at run time. Stable hooks for QA: `data-testid="traffic-counter-{requests|responses|errors|timeouts}"`, `data-status="live|stale|loading"` on the data grid, `data-session-state` on the window root, ids `data-row-{n}` and `frame-{seq}`, `data-slot`, `data-icon`, `data-variant`, `data-tone`.
- Blocked saves trigger the Connection and the Poll fields together, so every message shows.
- Loading a profile reads the file before it disconnects; an unreadable file leaves the session alone.
- Clipboard refusal shows the error toast "Could not copy to the clipboard." (4 s). Other error toasts: "Could not open a new window: {message}", "Could not save profile: {message}", "Could not open profile: {message}", and any rejected command's message.

---

## The session state machine (explicit finite set, used by tasks 06, 10, 11, 12)

```
SessionState = 'idle' | 'connecting' | 'connected' | 'polling' | 'paused'
             | 'timeout' | 'exception' | 'badResponse' | 'disconnected'
P*  = polling | timeout | exception | badResponse   (poll running)
L*  = connected | paused | P*                       (link up)
```
Allowed transitions are exactly T1-T15 in DES 2.2, written as a constant table `ALLOWED: Record<SessionState, SessionState[]>`:
| From | Allowed next |
|---|---|
| idle | connecting |
| connecting | connected, disconnected, idle |
| connected | polling, idle, disconnected |
| polling | polling, timeout, exception, badResponse, paused, idle, disconnected |
| timeout | polling, timeout, exception, badResponse, paused, idle, disconnected |
| exception | polling, timeout, exception, badResponse, paused, idle, disconnected |
| badResponse | polling, timeout, exception, badResponse, paused, idle, disconnected |
| paused | polling, idle, disconnected |
| disconnected | connecting, idle |

---

## Task list (ordered)

### 01 Design tokens and fonts
- **Goal:** Define the DES 6.1 tokens once, as CSS variables and in the Tailwind theme: `dark`, `light`, `accent`, `warning`, `success`, `error`, plus the derived `text-muted`, `border`, `neutral-tint`, `error-tint`, `selected`, the `--font-mono` proposal, and focus ring utilities (dark ring on light, accent ring on dark). Bundle Afacad via @fontsource.
- **Components:** none (theme only).
- **States:** none directly. Prerequisite for all.
- **Store:** none.
- **Acceptance:**
  - A Vitest test asserts that the exported token map has exactly the six hex values from DES 6.1 and no other hex literals.
  - The derived tokens are defined as mixes of base tokens.
  - Orange is used by no class other than the warning variants (checked by a grep test over the token map).
  - `--color-surface` is not defined (pending Q-001-11).

### 02 Status primitives in `shared/ui`
- **Goal:** Build `StatusPill` (one variant per SessionState with the icon, label and style from DES 2.3), `StateBanner` (neutral / warning / error variants, icon, text, up to 2 actions), `FieldMessage` (error/warning, icon + text, `id` for `aria-describedby`), and `FreshnessChip` (live / loading / stale + text).
- **States:** visual for all 9 session states, plus loading / live / stale.
- **Store:** none (props only).
- **Acceptance:**
  - A Testing Library test per variant asserts that the icon (by `data-icon` name) and the text label are both present (never color only).
  - Error variants never put text on a solid `error` fill.
  - Under reduced motion the loader does not animate (test via a matchMedia mock).

### 03 Pure data utils (`tools/modbus-master`, pure modules)
- **Goal:** Write these functions, with no React and no store:
  - `formatValue(raw: number, fmt: 'unsigned'|'signed'|'hex'|'binary'): string`
  - `formatBit(v: boolean): '0'|'1'`
  - `parseValue(text, fmt): {ok:true, raw:number} | {ok:false, message:string}`
  - `toDisplayAddress(protocol, base: 0|1)`
  - `toProtocolAddress(display, base)`
  - `QUANTITY_LIMITS` (FC01/02: 2000, FC03/04: 125, FC15: 1968, FC16: 123)
  - `exceptionName(code)`
  - `formatHexBytes(bytes: number[]): string`
  - `formatTime(ms): 'HH:MM:SS.mmm'`
  - `splitValues(text): string[]` (separators: space, comma, tab, newline)
  - `badResponseText(kind: BadResponseKind, detail: BadResponseDetail | null): string` (DES 3.4 `{kindText}` table plus fallbacks)
  - `writeResultText(result: WriteResult, ctx: { slaveId; function; address; count; timeoutMs }): string` (DES 2.5)
- **States:** used by live/stale rendering, invalid input, badResponse, and the write results.
- **Store:** none.
- **Acceptance:** Table-driven Vitest cases:
  - Formatting: 0, 1, 32767, 32768, 65535 in every format, for example `65535 -> '-1'` signed, `'0xFFFF'` hex, `'1111 1111 1111 1111'` binary.
  - Parsing: hex with and without `0x`, lower and upper case, `0x10000` rejected, binary with nibble spaces, 17 binary digits rejected, signed -32769 rejected.
  - Address conversion at 0, 65535 and 1-based 1, 65536.
  - Every exception code from DES 3.4 plus an unknown code (for example 0x0C gives "Unknown exception").
  - `splitValues(' 1,,2\t3\n4 ')` gives 4 items.
  - `badResponseText`:
    - `shortFrame` `{expected: 29, got: 20}` gives "short frame (20 of 29 bytes)"
    - `wrongSlave` `{expected: 1, got: 2}` gives "reply from slave 2, expected 1"
    - `wrongFunction` `{expected: 3, got: 4}` gives "reply for FC04, expected FC03"
    - `crc` gives "CRC mismatch"
    - `malformed` with an empty message gives "malformed frame"
    - `shortFrame` with a null detail gives "short frame"
  - `writeResultText`: `linkLost` gives exactly "Connection lost during the write. The write may or may not have been applied. Reconnect and check the value before sending again."

### 04 Validation schemas (zod)
- **Goal:** Write the `connectionSchema` (TCP/RTU discriminated union), `pollSchema(mode, base)`, `writeSchema(base)` and `profileNameSchema(existingNames)` schemas, with the exact messages in DES 3.1-3.4. Include the cross-field rules: range end <= 65535, RTU + slave 0 on reads, quantity per FC, and the RTU-only baud/data bits/parity/stop bits ranges (DES 3.1). Warnings go in a separate `warnings(form, mode)` function, not in the schemas: 7 data bits, parity None + 1 stop bit, and the broadcast write (**RTU mode with slave 0 only**; never in TCP). `profileNameSchema` applies the DES 3.4 rules in the listed order and returns only the first message.
- **States:** invalid input.
- **Store:** none.
- **Acceptance:** Vitest edge cases, each asserting the exact message string:
  - Port 0/1/65535/65536.
  - Host empty, `256.1.1.1`, `plc-7`.
  - Timeout 49/50/10000/10001.
  - Slave 0 (TCP ok, RTU read error), 247, 248.
  - Start 0/65535 (0-based) and 0/1/65536 (1-based).
  - Quantity: FC03 125/126, FC01 2000/2001.
  - Start 65530 + quantity 10 gives the range message with max 6.
  - Scan 19/20/60000/60001.
  - FC16 with 123/124 values, FC15 with 1968/1969 values and the item "2".
  - Profile name:
    - empty, `"   "`, 65 chars, `a/b`, a duplicate in different case
    - `" a"` and `"a "` (space message)
    - `.hidden` (dot start), `name.` (dot end)
    - a name containing U+0007 (control characters)
    - `CON`, `nul`, `com1`, `COM¹`, `con.backup` (reserved message with the name)
    - `COM10` and `CONSOLE` are accepted
  - RTU: baud 250000 gives "Choose a baud rate from the list.", data bits 6 gives "Data bits must be 7 or 8.", stop bits 3 gives "Stop bits must be 1 or 2.". The same values in TCP mode are ignored.
  - `warnings`: write slave 0 in RTU includes the broadcast warning, and in TCP it does not.

### 05 IPC facade and fake (`shared/ipc`)
- **Goal:** Write a typed facade with one function per command in DES section 9 (`openSession(onEvent)`, `listSerialPorts`, `connect`, `cancelConnect`, `disconnect`, `startPoll`, `stopPoll`, `write`, `resetCounters`, the profiles functions, and `openToolWindow`). The facade is the only place that touches Tauri `invoke`/`Channel`.
  - Also write a **fake** with the same interface. The fake keeps a scriptable session: tests and the dev mode (env flag) can push `StateChanged`, `PollUpdate`, `TrafficFrames` and `Counters` events, and set command results and errors.
  - When BE-001 bindings exist, replace the temporary types with the generated ones. They exist now (BE-001 Final contract), so use them.
  - The fake must be able to script `WriteResult` `linkLost` together with a `StateChanged` to `disconnected` (phase `linkLost`), a TCP write to unit 0 that returns `ok`, and `badResponse` with a `BadResponseDetail`.
- **States:** transport for all.
- **Store:** none.
- **Acceptance:**
  - A Vitest test proves that the fake delivers events in order to the `openSession` callback.
  - The fake rejects `connect` when scripted to.
  - A Biome/grep check confirms that no module outside `shared/ipc` imports `@tauri-apps/api`.

### 06 Session store and transition table
- **Goal:** Mirror the Rust session state, track pending commands, and expose the DES 2.3 derived UI (pill, banner text, which actions are enabled).
- **Components:** none yet (consumed by 08, 10, 11).
- **States:** all 9 session states, T1-T15.
- **Store unit:** `sessionStore`
  ```
  state: {
    state: SessionState                      // default 'idle'
    reason: { kind: ReasonKind; phase: 'connectFailed' | 'linkLost'; message: string } | null
    exceptionCode: number | null
    badResponseKind: BadResponseKind | null
    badResponseDetail: BadResponseDetail | null
    consecutiveFailures: number              // 0 outside timeout/exception/badResponse
    since: number                            // ms timestamp of last state change (backend 'at')
    pending: null | 'connect' | 'cancel' | 'disconnect' | 'dismiss' | 'startPoll' | 'stopPoll'
    commandError: string | null              // IPC rejection text, shown as toast
    lastUnexpected: { from: SessionState; to: SessionState } | null   // dev warning
  }
  actions:
    init(): Promise<void>                    // ipc.openSession, apply snapshot, route events
    applyStateChanged(evt): void             // authoritative; records lastUnexpected if not in ALLOWED
    connect(config): Promise<void>           // pending='connect'
    cancelConnect(): Promise<void>
    disconnect(): Promise<void>
    startPoll(def): Promise<void>            // start, resume and apply all use this
    stopPoll(): Promise<void>
    dismiss(): Promise<void>                 // T15: pending='dismiss', calls ipc.disconnect(); state changes only on the 'idle' event
  pure helpers (exported, tested): isAllowed(from,to), isPollRunning(s), isLinkUp(s),
    bannerFor(snapshot, config): {variant, icon, text, actions} | null,
    pillFor(s, exceptionCode): {variant, icon, label}
  ```
  T15 note (PM decision): Dismiss goes through `mm_disconnect` while `disconnected`. The UI never resets to idle locally.
- **Acceptance:**
  - Vitest drives the fake through every transition T1-T15 and checks `state`, `pending` cleared, and `consecutiveFailures`: 3 timeouts in a row give 3, and switching to exception resets it to 1.
  - Banner text matches DES 2.3 for timeout, exception 02, badResponse `crc` and `shortFrame` (20 of 29 bytes), and each disconnected reason kind, for both phases.
  - `dismiss()` calls `disconnect` on the fake, the state stays `disconnected` with `pending='dismiss'` until the fake emits `idle`, and then it is `idle` with `pending` null.
  - An unexpected pair (idle -> polling) is applied and recorded in `lastUnexpected`.

### 07 Window config store
- **Goal:** Hold the window's current connection, poll and display settings and the profile identity, and track unsaved changes.
- **States:** invalid input (holds the drafts the forms validate), plus the profile modified marker.
- **Store unit:** `configStore`
  ```
  state: {
    connection: ConnectionConfig             // defaults DES 1: TCP '' : 502, timeout 1000; RTU 9600 8 Even 1
    poll: PollDefinition                     // slave 1, FC03, start 0 (protocol), qty 10, scan 1000
    autoStartPoll: boolean                   // true
    display: { format: 'unsigned'|'signed'|'hex'|'binary'; addressBase: 0 | 1 }   // unsigned, 0
    profileName: string | null               // null = Untitled
    savedSnapshot: string | null             // serialized profile at last load/save
  }
  derived: isDirty (current serialized != savedSnapshot; Untitled is dirty only after any change)
  actions:
    setConnection(c), setPoll(p), setAutoStart(b), setFormat(f), toggleBase(), setBase(b),
    applyProfile(profile), markSaved(name), toProfile(): Profile, reset()
  ```
- **Acceptance:**
  - Vitest: defaults equal DES values.
  - `toggleBase` changes only `display.addressBase` (protocol addresses unchanged).
  - `applyProfile` then `toProfile` round-trips.
  - `isDirty` toggles on change and clears on `markSaved`.

### 08 Window shell, manifest, layout, shortcuts
- **Goal:** Build the tool `manifest.ts` (DES 1 values, minimum width **960**) and the S1 regions:
  - toolbar with pill
  - banner slot
  - collapsible setup panel (`Ctrl+\`)
  - data card slot
  - resizable traffic panel (`Ctrl+J`, separator keyboard support, 120px to 70%, double-click 35%)
  - dark status bar
  - window title format from DES 2.3

  Also build a window-scoped shortcut registry that suppresses the browser defaults listed in DES 5.1 and turns off while a modal is open.
- **States:** shows the pill and banner for all session states (from `sessionStore`).
- **Store unit:** `layoutStore`
  ```
  state: { setupOpen: boolean; trafficCollapsed: boolean; trafficHeightPct: number /*35*/;
           columnWidths: Record<string, number>; modalOpen: boolean }
  actions: toggleSetup(), toggleTraffic(), setTrafficHeight(pct) /*clamped*/, resetTrafficHeight(),
           setColumnWidth(id, px) /*clamped to DES 5.3 minimums*/, setModalOpen(b)
  ```
- **Acceptance:**
  - Vitest: clamping (119px gives the minimum, 71% gives 70%), reset gives 35, column minimums apply.
  - Testing Library: `Ctrl+\` hides the setup panel, `Ctrl+J` leaves the traffic header and counters visible, and `Ctrl+P` does not trigger print (default prevented).
  - The title reads "Modbus Master - Untitled - Not connected" at start.

### 09 Connection form and serial ports
- **Goal:** Build the TCP/RTU setup section (DES 1 field layout, defaults and warnings) on react-hook-form with `connectionSchema`. The form is read-only in connecting and L*, with the hint "Disconnect to change connection settings."
  - There is **no Connect button in the panel** (PM decision). `Enter` in any Connection field triggers the same Connect action as the toolbar, in idle/disconnected only.
  - An RTU select holding a value outside its list (from a loaded profile) shows "{value} (not supported)" and the DES 3.1 message.
- **States:** invalid input, loading / empty / error for the port list, idle and disconnected (editable), connecting and L* (read-only).
- **Store unit:** `serialPortsStore`
  ```
  state: { status: 'idle'|'loading'|'ready'|'error'; ports: SerialPortInfo[]; error: string | null }
  actions: refresh(): Promise<void>     // called on first switch to RTU and by Refresh button
  ```
- **Acceptance:**
  - Vitest store test: loading -> ready, loading -> error, and an empty list.
  - Component tests:
    - the exact messages for invalid host and port
    - the 7 data bits warning text
    - "No serial ports found. Connect a device and press Refresh."
    - inputs `readOnly` with the hint when the session state is polling
    - no button named "Connect" inside the setup panel
    - `Enter` in Host calls `connect` in idle, and does nothing in polling
    - a config with baud 250000 shows "250000 (not supported)" and "Choose a baud rate from the list."

### 10 Connect / Disconnect / Cancel / Reconnect / Dismiss
- **Goal:** Wire the toolbar actions and `Ctrl+L` to `sessionStore`.
  - Connect validates the connection form first. When it is invalid, nothing is sent, focus goes to the first invalid field, and "1 field needs attention" or "{n} fields need attention" appears.
  - On `connected` with `autoStartPoll` on and a valid poll, call `startPoll`.
  - Buttons show a spinner while `pending`.
  - The banner actions Reconnect and Dismiss work.
- **States:** idle, connecting, connected, disconnected (all reason kinds), invalid input.
- **Store:** uses `sessionStore`, `configStore`, `layoutStore`.
- **Acceptance:** Testing Library with the fake:
  - An invalid host sends no `connect` call.
  - Valid -> connecting banner "Connecting to 192.168.1.10:502…" with Cancel.
  - Fake `connected` -> pill "Connected", or "Polling" when autoStart is on.
  - Scripted refused -> pill "Disconnected" and banner "Connection refused by 192.168.1.10:502." with Reconnect.
  - Reconnect calls connect again.
  - Dismiss calls `disconnect` and shows its spinner. After the fake emits `idle`, the banner is gone and the idle empty text shows.
  - The live region receives the disconnected text once.

### 11 Poll data store and data table (view states)
- **Goal:** Build the data card: header summary, FreshnessChip, Format and Base controls (`Ctrl+1..4`, `Ctrl+B`), and a virtualized two-column table with every empty text from DES 2.4. Rows select only their own value.
- **States:** empty data (every variant in DES 2.4), loading, live, stale (paused / timeout / exception / badResponse / disconnected), exception-before-data.
- **Store unit:** `pollDataStore`
  ```
  state: {
    status: 'none' | 'loading' | 'live' | 'stale'
    definition: PollDefinition | null        // the definition the values belong to
    kind: 'bits' | 'registers'               // FC01/02 vs FC03/04
    values: number[] | null                  // raw u16 or 0/1, length = quantity
    seq: number                              // last applied PollUpdate.seq
    lastOkAt: number | null                  // backend timestamp
    roundTripMs: number | null
  }
  actions:
    begin(def): void                         // status 'loading', values null
    applyUpdate(u: PollUpdate): void         // ignores seq <= current, or mismatch with definition; status 'live'
    markStale(): void                        // only if values != null
    clear(): void                            // status 'none'
  wiring rule (tested): sessionStore state -> P* entry from connected/paused => begin;
    polling => live via updates; paused/timeout/exception/badResponse/disconnected => markStale;
    idle => clear
  ```
- **Acceptance:**
  - Vitest: out-of-order seq ignored, an update for an old definition ignored after Apply, `markStale` with no values keeps 'none'.
  - Testing Library:
    - each empty text exactly as in DES 2.4
    - loading rows show "—"
    - stale chip "No response - values from 14:02:11.540" in timeout
    - FC01 disables Format with the tooltip text
    - `Ctrl+3` shows `0x04D2` for 1234
    - header "Address (1-based)" after `Ctrl+B`

### 12 Poll form and Start / Pause / Resume / Apply
- **Goal:** Build the Poll section on `pollSchema`:
  - protocol address helper ("Protocol address {n}")
  - quantity helper "1-{max}"
  - base conversion when the base toggles
  - the "Start polling when connected" checkbox
  - the Apply rules from DES 2.2: in P* it restarts the poll; elsewhere it stores the definition; in paused it also clears the stale data (`pollDataStore.clear`)

  Wire `Ctrl+P` (Start / Pause / Resume by state).
- **States:** connected, polling, paused, P* (T5, T10, T11), invalid input.
- **Store:** uses `sessionStore`, `configStore`, `pollDataStore` (task 11).
- **Acceptance:** Testing Library with the fake:
  - FC03 quantity 126 shows "Quantity for FC03 must be from 1 to 125." and `startPoll` is not called.
  - In 1-based mode, start 1 shows "Protocol address 0" and sends protocol 0.
  - `Ctrl+P` in polling calls `stopPoll`, and in paused calls `startPoll`.
  - Apply in polling calls `startPoll` with the new definition and the data view shows loading.
  - Apply in paused calls nothing and shows "Poll settings changed. Press Resume (Ctrl+P) to read with the new settings."

### 13 Data table interaction
- **Goal:** Build:
  - row selection (click, Shift/Ctrl, arrows, PageUp/PageDown, Home/End, `Ctrl+A`)
  - selected styling (`selected` tint plus a 3px dark left bar)
  - `Ctrl+C` TSV copy plus toast "Copied {n} rows."
  - column resize with double-click auto-fit (widths in `layoutStore`)
  - `Enter`/double-click to open Write, or the read-only toast for FC02/04
  - `role=grid`, `aria-rowcount`, `aria-rowindex`, `aria-selected`
- **States:** live, stale (interaction works in both).
- **Store unit:** `tableSelectionStore`
  ```
  state: { anchor: number | null; selected: Set<number> /*row indexes*/ ; focused: number | null }
  actions: click(i, {shift, ctrl}), move(delta, {shift}), selectAll(count), clear(),
           selectedRows(): number[]  // sorted
  ```
- **Acceptance:**
  - Vitest: shift-range from anchor, ctrl-toggle, move clamps at 0 and count-1.
  - Testing Library: copying rows 0-1 in Hex format gives "0\t0x04D2\n1\t0xFFFF".
  - Double-click on an FC04 row shows "Discrete inputs and input registers are read-only."

### 14 Traffic store and panel
- **Goal:** Build the dark traffic panel:
  - counters header
  - Auto-scroll (turns off on manual scroll up)
  - Copy, Clear (`Ctrl+Shift+K`), Reset counters (calls `resetCounters`)
  - **single-frame selection** (PM decision): click and arrow keys select one frame, Shift/Ctrl-click select that one frame only, `Ctrl+A` is ignored, and `Ctrl+C` copies the selected frame with the toast "Copied 1 frame."
  - virtualized frame list (#, Time, Dir with arrow + "TX"/"RX", Len, Bytes truncated, Info including the exception name or error note)
  - detail strip (16 bytes per line with 4-digit hex offsets, "Copy bytes")
  - empty texts

  Updates within one animation frame are coalesced into one store write.
- **States:** empty data (traffic, after Clear), live traffic during P*, and the timeout / exception / badResponse info rows.
- **Store unit:** `trafficStore`
  ```
  state: {
    frames: RingBuffer<TrafficFrame>         // capacity 5000 (REQ); pure RingBuffer util with its own tests
    version: number                          // increments per append batch (for selectors)
    counters: { requests: number; responses: number; errors: number; timeouts: number }
    autoScroll: boolean                      // true
    selectedSeq: number | null
    clearedAt: number | null
  }
  actions: appendFrames(frames[]), setCounters(c), clear() /* frames only, counters unchanged */,
           resetCounters(): Promise<void>, setAutoScroll(b), select(seq | null)
  ```
- **Acceptance:**
  - Vitest: appending 5,001 frames keeps 5,000 with the oldest seq dropped. Clear keeps the counters. Selecting a dropped seq resets it to null.
  - Testing Library:
    - an RX exception frame shows the Info "Exception 02 Illegal data address"
    - Copy gives the TSV format from DES 5.2 as exactly one line. With nothing selected, Copy does nothing and shows no toast.
    - Shift-click after a selection leaves exactly one frame selected
    - an RX bad-response frame shows its backend `note` in Info
    - the empty texts exactly as written
    - the detail strip offsets `0000`, `0010`

### 15 Write dialog
- **Goal:** Build S2:
  - function-specific fields (05 ON/OFF, 06 single, 15 bits list, 16 values list)
  - prefill rules (DES 1 S2)
  - value format control
  - live count "Values ({n})" and "Writes addresses {a}-{b}."
  - broadcast warning, **in RTU mode only** (TCP unit 0 is a normal write that waits for a reply)
  - the fixed-height polite result area with every result from DES 2.5, including `linkLost`. After `linkLost` the draft is kept, Send is disabled until the session is back in L*, and the result area is then emptied
  - `Enter` / `Ctrl+Enter` / `Esc`; the dialog stays open after a send
- **States:** invalid input (write), loading (sending), plus the write results success, broadcast sent (RTU), exception, timeout, badResponse, link lost and not connected.
- **Store unit:** `writeStore`
  ```
  state: {
    open: boolean
    draft: { function: 5 | 6 | 15 | 16; slaveId: string; address: string; valueFormat: Format;
             coil: boolean; valueText: string; valuesText: string }
    lastFunction: 5 | 6 | 15 | 16            // remembered for prefill
    status: 'idle' | 'sending' | 'done'
    result: WriteResult | null
  }
  actions: openFor(prefill?: { address: number; pollFunction: 1|2|3|4; slaveId: number; raw?: number }),
           close(), updateDraft(patch), send(): Promise<void> /* validates with writeSchema; ignores while sending */
  ```
- **Acceptance:**
  - Vitest: prefill from an FC01 row gives function 5, and from FC03 gives 6 with the raw value formatted. Send while sending is a no-op. Close during sending drops the late result.
  - Testing Library with the fake: each result text exactly as in DES 2.5. 124 values gives "Enter from 1 to 123 values (you entered 124)." When the session leaves L* while the dialog is open, Send is disabled and the result area shows "Not connected. Connect before writing."
  - TCP mode with slave 0 shows no broadcast warning, and an `ok` result shows "Write confirmed by slave 0: register at 3.". RTU mode with slave 0 shows the warning.
  - A scripted `linkLost` shows the DES 2.5 link-lost text with the `unplug` icon, keeps the draft, and keeps Send disabled while `disconnected`. After the fake returns to `polling`, Send is enabled and the result area is empty.
  - `badResponse` `{kind: 'shortFrame', detail: {expected: 8, got: 5}}` shows "Bad response: short frame (5 of 8 bytes). The write may or may not have been applied."

### 16 Profiles
- **Goal:** Build S3 (filter, list, Open, inline Rename, Delete with confirm), S4 (Save as with the Replace confirm), `Ctrl+S` / `Ctrl+Shift+S` / `Ctrl+O`, the modified marker, "Disconnect and load?" when not idle/disconnected, and "Save changes?" before loading over unsaved changes. Loading never auto-connects.
  - Save and Save as are **blocked while the setup form is invalid** (DES 3.5): nothing is saved, no dialog opens, all field errors are shown, focus moves to the first invalid field, and the toast "Fix the highlighted fields before saving." appears.
  - After `profiles_get`, apply the profile and re-validate the whole setup form, so out-of-range values show as invalid input.
  - Items with `readable: false` show `triangle-alert` "Cannot be opened (newer or damaged file)", and Open is disabled for them.
  - A backend `invalidProfileName` message is shown under the name field.
- **States:** loading / empty / error (profiles), invalid input (name), and the session interaction (load while L* gives disconnect then idle).
- **Store unit:** `profilesStore`
  ```
  state: { status: 'idle'|'loading'|'ready'|'error'; items: ProfileSummary[]; error: string | null;
           filter: string }
  derived: visibleItems (case-insensitive filter on name)
  actions: refresh(), save(profile, overwrite: boolean), load(name): Promise<Profile>,
           rename(old, next), remove(name), setFilter(text)
  ```
- **Acceptance:**
  - Vitest: refresh status flow, rename to a case-insensitive duplicate rejected with the DES message, filter.
  - Testing Library: Save as with an existing name shows the "Replace profile?" text. Load while polling shows "Disconnect and load?" and calls `disconnect` then applies the profile. Loading gives the "Loading profiles…" text. Empty gives the DES text.
  - `Ctrl+S` with quantity 126 calls neither `profiles_save` nor opens S4, and shows the toast "Fix the highlighted fields before saving.". The same applies to `Ctrl+Shift+S`.
  - The name `.hidden` gives "Profile name cannot start with a dot." and `CON` gives ""CON" is reserved by Windows and cannot be used as a profile name."
  - A loaded profile with baud 250000 shows the Baud error and stays idle.

### 17 Multi-window and close behavior
- **Goal:** `Ctrl+N` and launcher open via `openToolWindow('modbus-master')`. Closing with `isDirty` shows "Save changes?" with Save / Don't save / Cancel (Cancel keeps the window). Each window initializes its own stores and `openSession`.
- **States:** all states, independent per window.
- **Store:** uses `configStore` (isDirty), `sessionStore`.
- **Acceptance:**
  - Testing Library: the close request with dirty config shows the dialog, and Cancel prevents closing. Choosing Save with an invalid setup form shows the toast "Fix the highlighted fields before saving." and keeps the window open.
  - Playwright (with the backend or the fake in dev mode): two windows hold different states at the same time (one polling, one idle).

### 18 Performance and accessibility verification
- **Goal:** Prove REQ's "125 registers at 100 ms does not freeze the UI" and the DES 7 rules.
- **States:** polling (sustained), all (focus order).
- **Store:** none new.
- **Acceptance:**
  - A Playwright run with the fake streaming 125 registers plus 2 frames every 100 ms for 60 s: no long task over 50 ms (PerformanceObserver `longtask` count = 0 after warm-up), and a click on Pause responds within 100 ms.
  - Tab order matches DES 7.
  - Every pill, banner and chip has visible text.
  - Focus ring visible on light and dark panels.
