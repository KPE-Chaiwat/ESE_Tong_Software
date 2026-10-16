# BE-001 Modbus Master backend

Source: REQ-001, DES-001 section 2 (state machine, T1-T15), section 9 (backend needs), `docs/questions.md`.
Read DES-001 sections 2 and 9 fully before starting. Names below are the **contract**; the frontend codes against them via ts-rs bindings. Any rename must be written back into this file.

## PM decisions on open questions (override in this file only)
| Q | Decision |
|---|---|
| 01 | No auto-reconnect. After link loss state stays `disconnected` until `mm_connect` again. |
| 02 | TCP timeouts never cause `disconnected`; only socket error/close does. State stays `timeout`. |
| 03 | One `timeoutMs` for both connect and response. |
| 04 | RTU reads with slave 0 rejected before sending. TCP allows unit id 0-247 only. |
| 05 | scanRateMs 20-60000; timeoutMs 50-10000. Reject out-of-range with a typed validation error. |
| 06 | `badResponse` is a distinct state with `BadResponseKind` (crc, wrongSlave, wrongFunction, malformed, transactionMismatch, shortFrame). |
| 07 | Backend owns counters. Emit `TrafficFrames` batched at most every 50 ms; `Counters` at most every 100 ms. |
| 08 | Write to slave 0 transmits and returns `broadcastSent` immediately. |
| 09 | Writes queue after the in-flight request and run before the next poll cycle. |
| 10 | Profiles: per tool, stored as JSON files under the platform data dir `profiles/<toolId>/<name>.json`; name <= 64 chars, none of `\ / : * ? " < > \|`, case-insensitive unique; `schemaVersion: 1`; unknown newer version is rejected with a clear error. |
| 11 | Frontend/owner concern, not backend. |
| 12 | No overlapping requests; next request after previous completes or times out. |
| 13 | After exception/timeout, polling keeps retrying at the normal scan rate. |
| 14 | IPv4 or host name only. |

## Tasks (do in order; each ends with passing tests)

### BE-001-1 `modbus-core` (pure, no I/O, no tokio)
- PDU encode/decode for functions 01, 02, 03, 04, 05, 06, 15, 16 (requests and responses) and exception responses (function | 0x80 + code).
- ADU: TCP/MBAP (transaction id, protocol id 0, length, unit id), RTU (CRC16, little-endian CRC bytes). ASCII is out of scope.
- Limits: read coils/discretes qty 1-2000, read registers 1-125, write multiple coils 1-1968, write multiple registers 1-123; address + qty must stay <= 65536. Return typed errors, never panic.
- Response validation yields `BadResponseKind` (CRC mismatch, wrong slave, wrong function, byte-count mismatch, short/long frame, transaction mismatch).
- Tests: spec test vectors incl. RTU `01 03 00 00 00 02 C4 0B`; a function 16 request vector; exception vectors; round-trip property tests; fuzz-style proptest that arbitrary bytes never panic.

### BE-001-2 `transport`
- Async trait for a byte-stream link with TCP and serial (tokio-serial) implementations: connect (cancellable), send, receive-with-deadline, close; RTU frame boundary handling by expected length / inter-frame silence.
- Serial port listing behind a trait with a `#[cfg(windows)]` implementation now (others return not-supported).
- Tests with an in-process fake slave; timeout, cancellation and socket-close paths.

### BE-001-3 `modbus-master`
- Session state machine implementing exactly the 9 states and transitions T1-T15 of DES-001 (`idle | connecting | connected | polling | paused | timeout | exception | badResponse | disconnected`). Table-driven tests, one case per transition, plus illegal transitions rejected.
- Poll engine (rules Q-09, Q-12, Q-13), write queue, counters, traffic log producing `TrafficFrame` with raw TX/RX bytes and timestamps (the bytes must be exactly what is on the wire). Backend keeps no more than 5,000 frames per session.
- All time via an injectable clock for deterministic tests.
- Input validation of connection/poll/write requests (limits above, slave id 0-247).

### BE-001-4 `platform`
- Data dir resolution, profile storage per Q-10 (atomic write via temp+rename), listing/get/save(overwrite flag)/rename/delete, name validation, schemaVersion handling.
- Optional later: ui settings store (not part of this task).

### BE-001-5 `shared-types` + ts-rs
- DTOs exactly as DES-001 section 9: `ConnectionConfig`, `PollDefinition`, `SessionState`, `SessionReason`, `ExceptionCode`, `BadResponseKind`, `TrafficFrame`, `WriteRequest`, `WriteResult`, `Profile`, `ProfileSummary`, `SerialPortInfo`, `SessionSnapshot`, `SessionEvent` (`StateChanged | PollUpdate | TrafficFrames | Counters`), and `AppError { code, message }` with stable string codes (e.g. `validation`, `notConnected`, `profileExists`, `profileNotFound`, `invalidProfileName`, `unsupportedSchema`, `io`).
- Generate bindings with the repo script; CI check mode must pass.

### BE-001-6 `src-tauri`
- Thin commands exactly named: `mm_open_session(channel)`, `mm_list_serial_ports`, `mm_connect`, `mm_cancel_connect`, `mm_disconnect`, `mm_start_poll`, `mm_stop_poll`, `mm_write`, `mm_reset_counters`, `profiles_list`, `profiles_get`, `profiles_save`, `profiles_rename`, `profiles_delete`, `window_open_tool`.
- One session per window, keyed by window label; created on `mm_open_session`, torn down when the window closes (no leaked tasks or open ports).
- One ordered `Channel<SessionEvent>` per window. State changes are never dropped; poll/traffic may be coalesced but `PollUpdate.seq` and `TrafficFrame.seq` must be monotonic so the UI can detect gaps. Document the drop policy in code comments.
- Commands only validate, delegate and map errors to `AppError`. No protocol logic.
- `window_open_tool("modbus-master")` opens a new window (size per DES-001: 1280x800, min 960x600) loading the app at the tool route.

## Acceptance
- `cargo clippy --all-targets -- -D warnings` and `cargo nextest run` pass.
- Integration test: real TCP loopback fake slave exercising connect, poll 03 with 125 registers, write 06/16, timeout, exception, CRC-bad reply and socket drop, asserting the emitted state sequence.
- Performance: polling 125 registers at 100 ms against the fake slave shows no event backlog growth over 60 s.
- Final report lists exact command/event/DTO/error-code names (and any deviation, which must be written back to this file).

## Not in scope
Frontend code, Playwright, ASCII mode, Modbus Slave, auto-reconnect, IPv6.

---

## Final contract (implemented by backend, 2026-10-16; revised after REV-001)

This section is authoritative for the frontend and QA. Types are generated into `apps/desktop/src/shared/bindings/` (`pnpm bindings`); import them from `@/shared/bindings`. All JSON is camelCase. Timestamps (`at`, `modifiedAt`) are ms since the Unix epoch. `invoke` rejects with `AppError`.

### Contract changes after REV-001 (tell the frontend)
1. **`WriteResult` has a new variant `{ status: "linkLost" }`** (F9). It is returned for the write that was in flight when the link dropped or the user disconnected. That write was transmitted, so it may or may not have been applied. Proposed text: "Connection lost during the write. The write may or may not have been applied." Writes that were only queued still return `notConnected`.
2. **`AppError` has a new field `field: string | null`** (N8). It is set for `validation` errors to the offending DTO field (`host`, `port`, `timeoutMs`, `baud`, `dataBits`, `stopBits`, `slaveId`, `function`, `quantity`, `scanRateMs`, `values`), and is null otherwise.
3. **Modbus TCP unit id 0 is not a broadcast** (F1). `mm_write` with `slaveId: 0` on TCP waits for the reply and returns `ok/exception/timeout/badResponse` like any unit id. `broadcastSent` is returned only on RTU. **DES-001 section 3.3 (and S2/2.5) must change: the broadcast warning applies to RTU only.** This is a designer change; the DES was not edited here.
4. **`shortFrame`** (F4): `BadResponseDetail.got`/`expected` are now on-wire ADU bytes (they match the traffic panel). A frame that is complete per its header but internally inconsistent (for example MBAP length vs byte count) is `malformed`. PM text: "short frame ({got} of {expected} bytes)".
5. **`mm_connect` with RTU** rejects a port name that is neither in the last `mm_list_serial_ports` result nor of the form `COM<n>` (Windows) with `validation`, `field: "port"`, message "Select a serial port from the list." (F8).
6. **Profiles**: `profiles_save` rejects `display.addressBase` other than 0/1 and `poll.function` other than 1-4 (`validation`). `profiles_get` of such a file gives `invalidProfile`, and `profiles_list` shows it with `readable: false`. Names starting with `.` are rejected with "Profile name cannot start with a dot." (F3). Superscript device names (`COM¹`...) are rejected (N1).
7. **Timing semantics (no type change)**:
   - RTU `timeoutMs` starts once the request has been transmitted at the configured baud. Once a reply has started, the deadline is extended to cover the transmission of the remaining bytes (F5). This means 125 registers at 2400 baud work with the default 1000 ms timeout.
   - RTU keeps at least `max(t3.5, 5 ms)` of silence before every request, the frame silence `max(t3.5, 50 ms)` after a timeout, and 100 ms after a broadcast (F6).
   - A TCP reply with an earlier transaction id is logged as RX "Late reply to transaction N (discarded)" and the wait continues; an id that was never sent is still `transactionMismatch` (F2).
   - A serial open runs off the async workers and is bounded by `timeoutMs` (`connectTimeout`) (F7).
8. **Capabilities**: `capabilities/default.json` (windows `main` and `modbus-master-*`) now grants only `core:default`, `core:window:allow-set-title` and `core:window:allow-destroy`. These are exactly the window APIs the frontend calls: `getCurrentWindow().setTitle`, `onCloseRequested` (listen, which is in `core:default`, then `destroy`) and `destroy()`. `allow-close` is not needed because `close()` is never called. App commands (`mm_*`, `profiles_*`, `window_open_tool`) need no capability entry. The unused `fs:default`, `dialog:default`, `store:default` and `window-state:default` JS permissions were removed (REV-001 N6); the plugins still run on the Rust side. The capability is validated at build time: `cargo check -p esefact-desktop` passes, and a deliberately unknown permission makes it fail. Add a permission here if the frontend starts using another window or plugin JS API.

### Commands (exact `invoke` argument keys)
| Command | Args | Returns | Notes |
|---|---|---|---|
| `mm_open_session` | `{ channel: Channel<SessionEvent> }` | `SessionSnapshot` | Creates the window's session (keyed by window label). On a webview reload it re-attaches the new channel, replays the traffic log as `TrafficFrames`, then sends `Counters`. |
| `mm_list_serial_ports` | none | `SerialPortInfo[]` | Windows only; elsewhere `notSupported`. Sorted naturally (COM2 < COM10). The names are remembered for `mm_connect`. |
| `mm_connect` | `{ config: ConnectionConfig }` | `null` | T1/T14. Resolves once `connecting` was emitted; the outcome comes as `StateChanged`. `invalidState` unless idle/disconnected. RTU port name check (change 5). |
| `mm_cancel_connect` | none | `null` | T4. No-op outside `connecting`. |
| `mm_disconnect` | none | `null` | T12 from L*. Also T4 in `connecting` and **T15 (Dismiss) in `disconnected`**. No-op in `idle`. |
| `mm_start_poll` | `{ poll: PollDefinition }` | `null` | Start, Resume (T5) and Apply (T11). `notConnected` outside L*; `validation` for bad input. A changed definition drops `lastUpdate`. |
| `mm_stop_poll` | none | `null` | Pause (T10). No-op outside P*. |
| `mm_write` | `{ request: WriteRequest }` | `WriteResult` | Waits for the result. Outside L*: `{status:"notConnected"}` (not an error). Never changes the session state, except a link loss (T13). |
| `mm_reset_counters` | none | `null` | Sends `Counters` (all 0) immediately. |
| `profiles_list` | `{ toolId }` | `ProfileSummary[]` | Sorted by name, case-insensitive. Unreadable files are listed with `readable: false`. |
| `profiles_get` | `{ toolId, name }` | `Profile` | Name matched ignoring case. |
| `profiles_save` | `{ toolId, profile: Profile, overwrite: boolean }` | `null` | Saves under `profile.name`; `schemaVersion` is set to 1 by the backend. Creating a new name never replaces a file created meanwhile by another window (`profileExists`). |
| `profiles_rename` | `{ toolId, oldName, newName }` | `null` | Case-only renames allowed. |
| `profiles_delete` | `{ toolId, name }` | `null` | |
| `window_open_tool` | `{ toolId }` | `string` (new window label) | `"modbus-master"` opens label `modbus-master-<n>` at route `/tools/modbus-master`, 1280x800, min 960x600, offset 24 px from the calling window. Unknown id: `unknownTool`. |

Only `toolId = "modbus-master"` is known to the backend.

### Channel events: `SessionEvent` (discriminant `type`)
- `{ type: "StateChanged", state, reason, consecutiveFailures, exceptionCode, badResponseKind, badResponseDetail, at }`: never dropped or coalesced. It is emitted on every transition; a repeated ok cycle (polling -> polling, T6) is not re-emitted. Repeated failures (timeout -> timeout) are emitted with the incremented count.
- `{ type: "PollUpdate", seq, at, slaveId, function, startAddress, values, roundTripMs }`: `values` are raw u16 (FC03/04) or 0/1 (FC01/02). At most one per 50 ms, latest wins (seq gaps mean coalesced updates). A pending update is always flushed **before** the next `StateChanged`.
- `{ type: "TrafficFrames", frames: TrafficFrame[] }`: at most one batch per 50 ms. Frames are not dropped unless more than 5000 pile up within one 50 ms window; the seq gap shows it.
- `{ type: "Counters", requests, responses, errors, timeouts }`: at most one per 100 ms, latest wins.

Counters:
- `requests`: requests written (polls and writes, including RTU broadcasts).
- `responses`: valid replies, including exception replies.
- `errors`: exception replies plus bad responses.
- `timeouts`: no byte within the timeout.

A partial frame at the deadline counts as a bad response (`shortFrame`), not a timeout. Discarded late replies are not counted.

Traffic frames: `bytes` are exactly the ADU on the wire (MBAP header, or slave id + CRC, included). `function` has the exception bit removed, and `exceptionCode` is set on exception replies. `note` is set on:
- bad responses ("Bad response: ...")
- late TCP replies ("Late reply to transaction N (discarded)")
- bytes discarded before a request or received while idle
- incomplete frames before a link failure

The backend keeps the last 5000 frames per session.

### DTOs (ts-rs names)
- `ConnectionConfig`: `{mode:"tcp", host, port, timeoutMs} | {mode:"rtu", port, baud, dataBits: 7|8, parity, stopBits: 1|2, timeoutMs}`
- `Parity`: `none|even|odd`
- `PollDefinition`: `slaveId, function: 1|2|3|4, startAddress, quantity, scanRateMs`
- `SessionState`: the 9 values
- `SessionReason`: `kind: ReasonKind, phase: ReasonPhase, message`
- `ReasonKind`: `refused|connectTimeout|hostNotFound|portBusy|portNotFound|closedByPeer|portRemoved|ioError`
- `ReasonPhase`: `connectFailed|linkLost`
- `ExceptionCode`: a number
- `BadResponseKind`: `crc|wrongSlave|wrongFunction|malformed|transactionMismatch|shortFrame`
- `BadResponseDetail`: `expected, got, message`
- `TrafficDirection`: `tx|rx`
- `TrafficFrame`, `TrafficFrames`
- `WriteRequest`: `slaveId, function: 5|6|15|16, address, values: number[]`. Coils are 0/1; FC05/06 take exactly one value.
- `WriteResult` (discriminant `status`): `ok | broadcastSent | exception{code} | timeout | badResponse{kind, detail} | notConnected | linkLost`
- `Counters`, `StateChanged`, `PollUpdate`, `SessionEvent`
- `SessionSnapshot`: the `StateChanged` fields flattened, plus `config, poll, counters, lastUpdate`
- `SerialPortInfo`: `name, description`
- `Profile`: `schemaVersion, name, connection, poll, display, autoStartPoll`
- `DisplaySettings`: `format: ValueFormat, addressBase: 0|1`
- `ValueFormat`: `unsigned|signed|hex|binary`
- `ProfileSummary`: `name, modifiedAt, connectionSummary, readable`
- `AppError`: `code, message, field`
- `AppErrorCode`, `AppInfo`

### Error codes (`AppErrorCode`)
`validation`, `notConnected`, `invalidState`, `noSession`, `profileExists`, `profileNotFound`, `invalidProfileName`, `unsupportedSchema`, `invalidProfile`, `unknownTool`, `notSupported`, `io`, `internal`. Messages for `validation` and `invalidProfileName` are user-facing and reuse the DES section 3 texts where DES has one. Addresses in backend messages are protocol addresses.

### Deviations from the original BE-001 / DES-001 section 9
1. `BadResponseKind` uses the BE-001 Q-06 names. The DES 3.4 text keys map as:
   - `crc` = crcMismatch
   - `wrongSlave` = unexpectedSlave
   - `wrongFunction` = unexpectedFunction
   - `transactionMismatch`
   - `malformed` (also covers any length inconsistency inside a complete frame)
   - `shortFrame` (new, with the PM text above)

   The `{got}`/`{expected}`/`{detail}` values come from `BadResponseDetail`, which appears as `StateChanged.badResponseDetail` and `WriteResult.badResponse.detail`.
2. `SessionReason` = `{ kind, phase, message }`. `kind` is the DES 3.4 reason list; `phase` distinguishes T3 (`connectFailed`) from T13 (`linkLost`).
3. `SessionSnapshot` also carries `consecutiveFailures`, `exceptionCode`, `badResponseKind`, `badResponseDetail`, `at` and `lastUpdate`.
4. `ProfileSummary.readable`, `AppError.field` and `WriteResult.linkLost` were added.
5. Extra error codes: `invalidState`, `noSession`, `invalidProfile`, `unknownTool`, `notSupported`, `internal`.
6. Profile names: besides Q-10, the backend also rejects control characters, leading or trailing spaces, a leading or trailing dot, and Windows device names (CON, NUL, COM1-9, LPT1-9, including superscript ¹²³).
7. RTU `baud` must be one of the 8 DES values; `dataBits` 7|8; `stopBits` 1|2. Character time follows the real format (start + data + parity + stop bits).
8. T15 (Dismiss) is done by the backend through `mm_disconnect` while `disconnected`.
9. Q-08 is narrowed to RTU (change 3 above).
10. `modbus-master` depends on `shared-types`; `transport` has a `test-support` feature with an in-process fake slave. The fake answers TCP unit id 0 (echoing it) and stays silent on RTU broadcasts.
11. The "CRC-bad reply" integration case runs RTU framing over a real loopback socket (`rtu_over_tcp_crc_bad_reply`), because Modbus TCP has no CRC.
12. Scheduling uses `tokio::time`, which is paused in tests, and wall-clock `at` stamps use the injectable `Clock`. The F6 gap is measured with a paused clock.

### Test inventory
`cargo test --workspace`, 145 tests:

| Crate | Tests | Covers |
|---|---|---|
| modbus-core | 19 unit + 8 proptest | spec vectors; round trips; arbitrary bytes never panic; CRC detects single-bit flips; a truncated reply is `shortFrame` with `got` = received bytes |
| transport | 21 | fake slave over memory and TCP loopback; timeout, partial frame, RTU silence, peer close, refused, cancel, drain/watch; RTU timing per baud/format; 255-byte reply at 2400 baud with a 1000 ms timeout; port-name pattern; serial open off the runtime |
| modbus-master | 15 unit + 25 session + 3 real-socket | T1-T15, illegal pairs, failure counting and saturation, emitter policy, validation |
| platform | 12 | |
| shared-types | 36 | |
| src-tauri | 6 | error codes incl. `field`, serial port boundary check |

The session tests include these REV-001 cases:
- `tcp_unit_zero_write_while_polling_is_unicast` (F1)
- `rtu_broadcast_returns_at_once_then_waits_turnaround`
- `tcp_late_reply_is_discarded_and_wait_continues` (F2)
- `rtu_125_registers_at_2400_baud_with_default_timeout` (F5)
- `rtu_inter_frame_gap_before_each_request` (F6)
- `write_in_flight_when_link_drops_is_link_lost` and `disconnect_during_write_answers_link_lost` (F9)

Performance: `sixty_seconds_at_100ms_without_backlog`.

### Not verified
- Real serial hardware:
  - opening a COM port
  - `portBusy` / `portNotFound` / `portRemoved` classification
  - parity and 7-bit settings
  - the inter-frame gap and timeout extension against a real USB adapter's latency
  - a Bluetooth port that blocks in `CreateFileW`. The F7 timeout returns to the UI, but the stuck OS call finishes on a blocking thread. Until it does, a quick reconnect to the same port can still report `portBusy`.
- The running app: `Channel` delivery, `window_open_tool`, window-destroy teardown, the re-attach replay, and the new capability set at runtime (only build-time validation was done).
- `cargo nextest` (not installed).

### Dev/test tool: Modbus TCP slave simulator (`crates/dev-sim-slave`, binary `esefact-sim-slave`)
**This is a test tool for QA, not the future Modbus Slave product.** It is `publish = false`, not bundled with the app, and no product crate depends on it (it depends on `modbus-core` and `transport` only; `modbus-master` and `shared-types` are dev-dependencies for its end-to-end test). Usage, options, control commands and log format are in `docs/SETUP.md` section 4. In short:
- Modbus TCP on `127.0.0.1:5020` (`--listen`). Every unit id is answered, including 0. One shared register map with deterministic defaults (`holding[n] = n`), plus `--preload` JSON and `--set`.
- Functions 01-06, 15, 16, with exceptions 01/02/03 produced by the simulator itself; any code via `fault exception <code>`.
- Faults for the next N requests (`times=N`) or until `clear`: `delay`, `drop`, `exception`, `wrong-unit`, `wrong-txn`, `wrong-function`, `truncate`, `garbage`, `close`. Also `refuse on|off`, `stop`/`resume`.
- Control: stdin and a loopback-only TCP control port (`127.0.0.1:5021`), one command per line, answered `ok ...` / `error ...`.
- stdout logs every RX/TX frame as hex with ISO UTC time and epoch ms.

Tests: `crates/dev-sim-slave/tests/simulator.rs` covers normal answers, unit ids, exceptions, every fault, refuse/stop/resume, the control port and the log. `tests/session_e2e.rs` runs the real `modbus-master` session against it over loopback and asserts this state sequence:
- `timeout`
- `exception 02`
- `badResponse` with `wrongSlave`, `transactionMismatch`, `wrongFunction`, `shortFrame` (9 of 259 bytes) and `malformed`
- `timeout` on a delay
- `disconnected` with `closedByPeer`
- a refused reconnect while stopped
- a successful reconnect after `resume`

It also checks a TCP unit-0 write that returns `ok`.
### Open questions (backend)
None. The five questions from the first report were answered by the PM in REV-001 (1: shortFrame text; 2: `linkLost`; 3: TCP unit 0 is not a broadcast; 4: permissive save plus two shape checks; 5: 960 is correct).