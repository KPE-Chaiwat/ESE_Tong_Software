# REV-001 Modbus Master backend review

Scope: Rust side of BE-001: `crates/modbus-core`, `crates/transport`, `crates/modbus-master`, `crates/platform`, `crates/shared-types`, `apps/desktop/src-tauri`. The frontend (`apps/desktop/src`) was not reviewed. The generated bindings were only compared with the Rust types.
Inputs: CLAUDE.md, REQ-001, DES-001 (sections 2, 3.4, 5.4, 9), BE-001 including the Final contract section.
Reviewer: code-reviewer, 2026-10-16. The working tree is uncommitted, so the review is of the files as they are on disk.

## Commands run (read-only)
| Command | Result |
|---|---|
| `cargo test --workspace` | pass. modbus-core 19 + 7 proptest, transport 17, modbus-master 14 + 18 + 3, platform 9, shared-types 35, src-tauri 4. This matches the BE-001 inventory. |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `cargo fmt --all --check` | clean |
| `node scripts/gen-bindings.mjs --check` | "bindings: up to date (29 files)" |
| `cargo nextest` | not installed, so not run (same as BE-001 "Not verified") |
| Scratch programs in the session scratchpad that link the crates by path (no repo files changed) | reproduced F1, F3 and F4 below |

## What was checked and found correct
- **CRC-16/MODBUS:** polynomial 0xA001, initial value 0xFFFF, sent low byte first. Spec vectors `01 03 00 00 00 02 C4 0B` and `11 03 00 6B 00 03 76 87` pass. A proptest shows every single-bit flip is detected.
- **MBAP:** transaction id, protocol id 0, length = unit id + PDU. `decode_tcp` rejects a non-zero protocol id, a length below 2, short frames and trailing bytes. `tcp_frame_length` limits the length to 2..=254, so the ADU is at most 260 bytes.
- **Limits:** FC01/02 1-2000, FC03/04 1-125, FC15 1-1968, FC16 1-123, and `address + qty <= 65536`. They are checked both in `Request::validate` (core) and in `validate.rs` (with the DES messages). Slave 0-247. RTU reads to slave 0 are rejected (Q-04).
- **Response validation:** function echo and the exception bit (`fc & 0x7F`), an exception PDU must be exactly 2 bytes, read byte count == ceil(q/8) or 2q, trailing bytes are malformed. Echo checks: FC05 address + 0xFF00/0x0000 value, FC06 address + value, FC15/16 address + quantity. TCP checks run in the order txn id, then unit id, then PDU. RTU checks run in the order length, then CRC, then slave, then PDU.
- **No panics on malformed input:** every slice index is behind a length check. The proptest `arbitrary_bytes_never_panic` covers all decoders and length probes. Casts are bounded (`len as u32` only after the limit check).
- **State machine:** `state_machine.rs` implements exactly the 9 states and T1-T15, including P*/L* families. Table-driven tests cover every transition and every illegal (state, event) pair. Failure counting follows DES T7-T9 (keyed by state + code/kind). A repeated T6 is not emitted. I traced every `transition()` call site in `session.rs`, and none can produce an illegal pair (the `debug_assert!` is unreachable).
- **Q-12 / Q-09 / Q-13 / Q-01 / Q-02:** the link is moved into the request task, so two requests can never overlap. Writes are dequeued before a due poll. Polling continues after failures. There is no auto-reconnect. TCP timeouts never lead to `disconnected`.
- **Cancellation and teardown:** connect runs in an aborted-on-cancel task. `Actor::drop` aborts connect and in-flight tasks. Dropping the last `Session` handle exits the actor (`Wake::Exit`). `WindowEvent::Destroyed` calls `remove_session` and then `Session::close()` (non-blocking, so it is safe on the main thread). `close_link` aborts the in-flight task (which owns the link) and closes the idle link. Tests `shutdown_closes_the_link` and `dropping_the_handle_stops_the_session` confirm this for in-memory links.
- **Emitter / drop policy:** `StateChanged` is never coalesced and flushes the pending `PollUpdate` first. `PollUpdate` is latest-wins at 50 ms. Traffic is batched at 50 ms and dropped only above 5000 pending frames. Counters go out at 100 ms. `seq` values are strictly increasing in both the traffic log and poll updates. On re-attach, the new emitter replays the log, so frames that were pending in the old emitter are not lost. The policy is documented in `emitter.rs` and `commands/modbus_master.rs` as BE-001 task 6 requires.
- **Tauri boundary:** commands only delegate. Validation runs in `Session::connect/start_poll/write` before anything reaches the actor. Error mapping to `AppErrorCode` is complete and tested. File I/O and port listing run on `spawn_blocking`. No std `Mutex` is held across an `.await`. `#![forbid(unsafe_code)]` applies to the workspace.
- **Profile path safety:** `tool_id` is checked against `TOOLS` and `[a-z0-9-]`. Names exclude `\ / : * ? " < > |`, control characters, leading/trailing spaces, a trailing dot (so `.` and `..` are out) and DOS device names. Writes go to a temp file, then `sync_all`, then a rename in the same directory.

## Findings

### Blocker
None.

### Major

**F1. Modbus TCP writes to unit id 0 are treated as broadcasts. A device that replies makes the next poll fail and hides the write's real result.**
- Where: `crates/modbus-master/src/session.rs:787` (`broadcast = slave == 0 && Write`). Also `session.rs:824-832`: after `Sent`, `quiet_until` is set only for RTU and the next request is dispatched at once.
- Problem: Modbus TCP has no broadcast in practice. Many TCP servers treat unit id 0 (or any unit id) as "this device" and reply. The session returns `broadcastSent` without reading the reply. When a poll is due, it is sent immediately. The write's reply then arrives first and is parsed as the poll's reply.
- Reproduced with a scratch TCP server that answers every unit id after 12 ms. Poll FC03 unit 1 every 20 ms, then 5 writes FC06 to unit 0. Result: every write returns `BroadcastSent`. Every write is followed by `StateChanged badResponse (transactionMismatch, "got 8, expected 9")`, and the valid poll reply is logged as "Unexpected bytes ... (discarded)". The user sees a spurious warning state, loses one poll cycle per write, and never sees the device's actual answer, which may be an exception.
- Fix (also my answer to open question 3): use broadcast semantics only for RTU (`self.framing` is `Rtu` and slave == 0). On TCP, unit 0 is a normal unicast: wait for the reply and return `ok/exception/timeout/badResponse`. DES 3.3 must show the broadcast warning for RTU only (designer change). Add a session test with a fake that answers unit 0.

### Minor

**F2. A late TCP reply is taken as the reply to the next request, so one slow reply costs two cycles.**
- Where: `session.rs:879-885` (one frame per request, no retry), `modbus-core/src/adu.rs:124-129`.
- Problem: after a timeout, the old reply can arrive while the next request is in flight. It is reported as `transactionMismatch`, and the correct reply that follows is drained and discarded as "late bytes". The F1 run shows the same pattern. With a device whose response time sits around the timeout, the state flips between `timeout` and `badResponse`, and good data is thrown away. The Modbus TCP implementation guidance is to ignore responses that do not match the outstanding transaction.
- Fix: in TCP mode, if the txn id differs, log the frame as RX with the note "Late reply to transaction N (discarded)" and call `receive_frame` again with the remaining deadline. Report `transactionMismatch` only when the deadline expires with nothing matching, or keep it for ids that were never sent.

**F3. Profile names that start with `.` are accepted but are then invisible.**
- Where: `crates/platform/src/profiles.rs:165-167` (`files()` skips stems starting with `.` as "temporary files") vs `validate_profile_name` (`profiles.rs:68-101`), which accepts them.
- Reproduced: `save(".hidden")` returns Ok. Then `list()` has 0 entries, `get` gives `NotFound`, `delete` gives `NotFound`, and a second `save(".hidden", overwrite=false)` silently replaces the file.
- Fix: temp files already end in `.part`, so the extension filter excludes them. Remove the dot-prefix skip. Alternatively reject names starting with `.` in `validate_profile_name`, with a DES-style message.

**F4. `ShortFrame` mixes PDU and ADU byte counts, and it misclassifies an MBAP/byte-count mismatch.**
- Where: `modbus-core/src/response.rs:182` and `247-256` (PDU lengths) vs `adu.rs:96-101` and `213-219` (ADU lengths).
- Reproduced: TCP reply `00 01 00 00 00 04 01 03 04 00` (MBAP says 3 PDU bytes, byte count says 4) gives `ShortFrame { len: 3, expected: 6 }`. The frame is complete per MBAP, so this is a malformed frame. The numbers are PDU-relative, but the traffic panel shows 10 bytes.
- Fix: when the ADU is complete per its header (MBAP length, or RTU length from the header), report inconsistencies inside the PDU as `malformed`. Report `ShortFrame` only from the ADU layer and always in on-wire bytes. Needed before the frontend adopts the open-question-1 text "({got} of {expected} bytes)".

**F5. The RTU response deadline covers the whole frame, so large reads at low baud always fail.**
- Where: `crates/transport/src/link.rs:163-201`. The `deadline` is fixed at send time, and a partial frame at the deadline becomes `shortFrame` (`session.rs:837-844`).
- Scenario: FC03 with 125 registers = 255-byte reply. At 2400 baud 8E1 (11 bits per char) that takes about 1.17 s, and at 1200 baud about 2.3 s. With the default timeout of 1000 ms, every cycle ends in `badResponse (shortFrame)` although the device is healthy.
- Fix: once the first byte has arrived and the expected length is known, extend the deadline to at least `now + remaining_bytes * char_time + silence`. Alternatively, define `timeoutMs` as time-to-first-byte (common in masters) and end the frame by length/silence. Document the choice in the contract.

**F6. RTU sends the next request with no t3.5 gap. After a timeout it may also transmit while a slow slave is still replying.**
- Where: `session.rs:720-742` and `826-828`. `quiet_until` is set only after a broadcast.
- Scenario: when a write is queued, or the scan rate is shorter than the round trip, the next RTU request is written right after the last reply byte. The serial-line spec requires at least 3.5 character times of silence (1.75 ms above 19200 baud). After a timeout with `timeoutMs >= scanRateMs`, the next poll is sent at once. A slave that is merely slow then collides with it on half-duplex RS-485.
- Fix: in RTU mode set `quiet_until = now + max(t3.5, a small turnaround such as 5-10 ms)` after every exchange, and a longer guard after a timeout. A test with a paused clock can assert the gap.

**F7. Serial open is synchronous inside the async connect task and has no timeout.**
- Where: `crates/transport/src/connect.rs:100-125` (`open_native_async` is a sync fn: mio-serial 5.0.7 calls `CreateFileW` twice plus `SetCommState`), called from `modbus-master/src/connector.rs:45-55` on a Tokio worker.
- Scenario: Bluetooth SPP COM ports can block in `CreateFileW` for many seconds. This blocks one runtime worker, and `timeoutMs` is not applied. Cancel (T4) returns to `idle` at once while the open continues. A quick reconnect to the same port can then report `portBusy`.
- Fix: run `open_serial` in `spawn_blocking`, wrap it in `timeout(timeoutMs)`, and map the timeout to `ConnectError::Timeout` (UI kind `connectTimeout`).

**F8. The RTU port name is not validated at the Tauri boundary.**
- Where: `crates/modbus-master/src/validate.rs:59-61` (only checks that the name is non-empty), `transport/src/connect.rs:137-146` (`format!(r"\\.\{port}")` and an open with read+write access).
- Scenario: `config.port = "C:\\Users\\x\\file.txt"` or `"..\\.."` reaches `CreateFileW("\\.\...")` twice (serialport, then the probe). `\\.\` paths are still normalised, so arbitrary files and devices are opened read/write and then dropped. Nothing is written, but this is input the boundary should refuse.
- Fix: on Windows accept only `^COM[1-9][0-9]{0,2}$` (case-insensitive) or a name from the last `mm_list_serial_ports` result. On other operating systems, use the platform pattern.

**F9. A write that loses the link mid-request is reported as "Not connected. Connect before writing."**
- Where: `session.rs:637-644`, called from `link_lost` (`660-667`) for the in-flight write.
- Problem: the request may already have been transmitted, and possibly applied. The DES text implies nothing was sent. Modbus writes are idempotent, so the risk is low, but the message is wrong. See open question 2.
- Fix: add `WriteResult::LinkLost` (text proposal: "Connection lost during the write. The write may or may not have been applied.") for the in-flight write. Keep `notConnected` for queued writes that never left. Add a test (there is none for a write in flight when the link drops).

### Nit
- **N1** `platform/src/profiles.rs:88-94`: superscript device names (`COM¹`, `COM²`, `COM³`, `LPT¹`-`LPT³`) are reserved on Windows but pass validation (reproduced: `validate_profile_name("COM¹")` returns Ok). The byte-length check `upper.len() == 4` misses them.
- **N2** `profiles.rs:268-286`, `294-325`: there is a check-then-act race between windows. Two windows that save the same new name with `overwrite=false` can both succeed. `fs::rename` in `rename` replaces a target created in between. This is acceptable for the MVP but should be documented. Creating the target with `create_new` (or taking an exclusive lock file) would close the race.
- **N3** `modbus-master/src/state_machine.rs:173-183`: `consecutive_failures + 1` overflows (panics in debug) after 2^32 cycles, about 2.7 years at 20 ms. Use `saturating_add`.
- **N4** `modbus-master/src/emitter.rs:100-102`: `Vec::remove(0)` is O(n) per frame once 5000 are pending. Use a `VecDeque`.
- **N5** `session.rs:648-650`: `close_link` aborts the in-flight task without awaiting it, so the serial handle is released a moment later than the `StateChanged(idle)`. Awaiting the aborted `JoinHandle` (it is already in an async fn) makes "port closed before idle" deterministic for an immediate reconnect.
- **N6** `apps/desktop/src-tauri/capabilities/default.json`: tool windows get `fs:default` and `dialog:default`, but profiles go through commands. Drop permissions that are not used (least privilege).
- **N7** `src-tauri/src/state.rs:53-65` with `lib.rs:21-28`: an `mm_open_session` that is still in flight when its window is destroyed can recreate a session after `remove_session`. That leaks one idle actor. Low impact.
- **N8** `error.rs:34-44`: `ValidationError.field` is lost at the boundary (`AppError` has only code and message). Consider adding `field` so the UI can focus the right input.

### Test gaps
- The fake slave never answers unit 0 (`transport/src/fake.rs:198`), so F1 is invisible to the suite.
- There is no test for a late TCP reply after a timeout (F2), for an RTU low-baud large read (F5), for the RTU inter-frame gap or the broadcast turnaround (`RTU_BROADCAST_TURNAROUND` is untested), or for a write in flight when the link drops (F9).
- The window-destroy teardown, `Channel` delivery and the re-attach replay run only on in-memory sinks. The src-tauri layer has 4 tests and none cover commands. This is acknowledged in BE-001 "Not verified" and should be covered by Playwright/QA.
- The performance test runs on virtual time with an in-memory link. It does not measure Tauri channel serialisation or webview backlog.

## Open questions from BE-001 (reviewer view)
1. **`shortFrame` text:** "short frame ({got} of {expected} bytes)" is fine once F4 is fixed, so that both numbers are on-wire ADU bytes that match the traffic panel.
2. **Write that loses the link:** do not keep `notConnected` for the in-flight write. Add a `linkLost` result (F9). Writes that were only queued can stay `notConnected`.
3. **TCP unit 0 = broadcast:** no. Use broadcast semantics on RTU only and treat TCP unit 0 as unicast (F1, reproduced). DES 3.3 needs the matching change.
4. **Validate on `profiles_save`:** keep save permissive. Shape is checked by serde, and range checks would block the S5 "Save changes?" path when a field is half-typed. Two additions are cheap: reject what serde cannot express but the UI assumes (`display.addressBase` must be 0 or 1, poll `function` must be 1-4), and have the frontend re-validate after `profiles_get`. Connect and poll still validate when used.
5. **minWidth 900 vs 960:** DES-001 and BE-001 both say 960, and the backend uses 960. The FE manifest should change to 960 (frontend fix, no backend change).

## Verdict
**Changes required.** There is no blocker. Fix F1 (TCP unit-0 writes corrupt the next poll and hide the result) before QA, and add a test with a TCP fake that answers unit 0. F2-F9 should be scheduled. F3, F4 and F8 are small and worth fixing in the same pass.
