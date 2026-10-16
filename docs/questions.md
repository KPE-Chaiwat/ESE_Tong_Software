# Open questions

**Revision 4 (2026-10-16):** added decisions D-001-12 to D-001-15 from `docs/qa/REPORT-002-integration.md` (finding 1, notes) and the PM. Open question m6 is resolved (D-001-15).

**Revision 3 (2026-10-16):** added decisions D-001-09 to D-001-11 from `docs/qa/REPORT-001-ui-mode.md` (F-3, section 8).

Format: `Q-<feature>-<nn>`, with the asker, who must answer, and the assumption currently used in the design. None of these block FE-001. Each assumption is written into DES-001 and can be changed there.

## Feature 001 Modbus Master (asked by designer, from DES-001)

| Id | Question | For | Assumption in DES-001 |
|---|---|---|---|
| Q-001-01 | After a link loss, should the backend reconnect automatically (and if so, with what back-off)? | PM / backend | No auto-reconnect. The state stays `disconnected` until the user presses Reconnect. |
| Q-001-02 | On TCP, do N consecutive timeouts count as a dropped link (`disconnected`), or does the session stay in `timeout`? | backend | It stays in `timeout`. Only a socket error or close causes `disconnected`. |
| Q-001-03 | Is the TCP connect timeout the same value as the response timeout, or a separate setting? | PM / backend | Same value (the one Timeout field). |
| Q-001-04 | Slave ID 0 for reads: rejected on RTU (broadcast), allowed on TCP? Should TCP also allow Unit ID 255 (outside REQ's 0-247)? | PM | **Resolved 2026-10-16 (REV-001 F1, BE-001):**<br>- On RTU, slave 0 is broadcast: reads with 0 are rejected before sending.<br>- On TCP, unit ID 0 is a normal unit ID, not a broadcast (many TCP devices answer it), for reads and writes alike.<br>- TCP allows 0-247 only. Unit ID 255 is out of scope for the MVP. |
| Q-001-05 | Allowed ranges for scan rate and timeout. | PM / owner | Scan rate 20-60000 ms, timeout 50-10000 ms. |
| Q-001-06 | Should invalid frames (CRC mismatch, wrong slave/function, malformed, transaction mismatch) be a distinct session state `badResponse`, separate from `timeout`? | backend | Yes, a distinct state with a `BadResponseKind`. |
| Q-001-07 | Are traffic counters computed by the backend (authoritative), and are traffic frames sent in batches? What is the maximum batch interval? | backend | Backend owns the counters and sends `Counters` events. Frames are batched; the UI coalesces per animation frame. |
| Q-001-08 | A write to slave ID 0 (broadcast) returns no reply. Should the backend return `broadcastSent` right after transmit? | backend | **Resolved 2026-10-16 (REV-001 F1):**<br>- Yes, but on **RTU only**.<br>- On TCP, a write to unit 0 waits for the reply and returns ok, exception, timeout or badResponse like any other write.<br>- The DES 3.3 broadcast warning is shown in RTU mode only. |
| Q-001-09 | While polling, how are writes ordered: queued between poll cycles, or sent with priority? | backend | Queued after the in-flight request, before the next poll cycle. |
| Q-001-10 | Where are profiles stored? Are they per tool? Which name rules does storage need? Is there a schema version? | backend (platform) | Per tool, file-name-safe names (max 64 chars, none of `\ / : * ? " < > |`), case-insensitive uniqueness, `schemaVersion` field. |
| Q-001-11 | Owner sign-off: success `#22c55e`, error `#ef4444`, the value of the new `--color-surface` card token, and the monospace font (system stack vs bundled). | owner | Proposed values used. Cards use `light` plus a border until surface is set. Mono uses the system stack `"Cascadia Mono", Consolas, ui-monospace, monospace`. |
| Q-001-12 | When the response time is longer than the scan rate, does the backend skip cycles (no overlapping requests) or queue them? | backend | No overlap. The next request is sent after the previous one completes or times out. |
| Q-001-13 | After an exception or timeout, does polling keep retrying at the scan rate? | backend | Yes, at the normal scan rate. |
| Q-001-14 | Should the TCP host accept IPv6 addresses in the MVP? | PM | No. IPv4 or host name only. |

Also confirmed by REV-001 / the BE-001 Final contract:
- Q-001-01, Q-001-02, Q-001-09, Q-001-12 and Q-001-13: implemented as assumed.
- Q-001-06: implemented, using the backend kind names `crc`, `wrongSlave`, `wrongFunction`, `malformed`, `transactionMismatch` and `shortFrame`, plus `BadResponseDetail`.
- Q-001-07: implemented. Traffic batches every 50 ms and counters every 100 ms.
- Q-001-10: implemented, with the extra name rules listed below.

## Decisions recorded 2026-10-16 (PM, after REV-001 and the frontend report)

| Id | Topic | Decision | Where in DES-001 |
|---|---|---|---|
| D-001-01 | In-flight write when the link drops | New `WriteResult` `linkLost`. Message: "Connection lost during the write. The write may or may not have been applied. Reconnect and check the value before sending again." Writes that were queued but never sent stay `notConnected`. | 2.5 |
| D-001-02 | `shortFrame` text | "short frame ({got} of {expected} bytes)". Both numbers are on-wire ADU bytes (depends on REV-001 F4). | 3.4 |
| D-001-03 | Traffic list selection | Single-frame selection. `Ctrl+A` does not apply to the traffic list. | 5.1, 5.2 |
| D-001-04 | Connect button in the setup panel | None. Connect is the toolbar button, `Ctrl+L`, or `Enter` in a Connection field. | 1, 5.1 |
| D-001-05 | Saving while the form is invalid | Blocked, with the toast "Fix the highlighted fields before saving." | 3.5 |
| D-001-06 | Dismiss (T15) | Goes through `mm_disconnect`. The UI waits for the `idle` event. | 2.2 |
| D-001-07 | RTU ranges | Baud is one of the 8 DES values, data bits 7 or 8, stop bits 1 or 2. These are enforced by the backend and mirrored in the UI. | 3.1 |
| D-001-08 | Extra profile name rules | Names cannot start with `.`, contain control characters, have leading or trailing spaces, end with a dot, or be a Windows reserved name (CON, PRN, AUX, NUL, COM1-9, LPT1-9, superscript variants). | 3.4 |
| D-001-09 | Reconnect while the Write dialog is modal (REPORT-001-ui-mode F-3) | Add a [Reconnect] button in the link-lost result area of the Write dialog.<br>- It does the same as the banner Reconnect (`mm_connect` with the window's connection).<br>- The dialog stays open and the draft is kept.<br>- The result clears and Send re-enables once the session is back in L*.<br>- `Ctrl+L` stays disabled in modals. | 2.5, 5.1 (revision 3) |
| D-001-10 | Focus after closing the Write dialog opened from the grid (CHK-M11) | Focus returns to the data grid element, whose `aria-activedescendant` is the row. | 7 (revision 3) |
| D-001-11 | Performance criterion (CHK-S3) | 0 long tasks over 50 ms. Measured in the browser smoke now, and on WebView2 in integration mode with the same criterion. | CHK-S3 (revision 3) |
| D-001-12 | Traffic counter semantics (REPORT-002 finding 1) | The BE-001 contract wins:<br>- Responses = valid replies, including exception replies.<br>- Bad replies (wrong unit, wrong transaction, wrong function, truncated, malformed, garbage) count as Errors, not Responses.<br>- Errors = exception replies + bad replies.<br>- Timeouts = requests without a reply. | 1 Traffic panel, CHK-N7 (revision 4) |
| D-001-13 | Refused loopback connect on Windows (REPORT-002 notes) | With a connect timeout under 1 s, either "No answer from … within {n} ms." or "Connection refused by …" is valid. From 1 s up the refused text is expected, and QA uses 3000 ms to verify it. | 3.4, CHK-I1, CHK-I11, CHK-M17 (revision 4) |
| D-001-14 | Error toasts | "Could not copy to the clipboard.", "Could not open a new window: {message}", "Could not save profile: {message}", "Could not open profile: {message}", and the verbatim message of any rejected command. All are error tone with `circle-x`, shown for 4 s. | 3.5 (revision 4) |
| D-001-15 | Open question m6: binary values with nibble spaces in FC15/16 lists | **Resolved.** Whitespace always separates values, and nibbles are never merged. A pasted `0000 0100 1101 0010` is four values. Invalid items use "Value {i} ("{text}") is not valid: Enter up to 16 binary digits (0 or 1)." | 3.3, CHK-J29 (revision 4) |

Still open for the PM (from REV-001, these affect what QA observes but need no design change):
- F2 (a late TCP reply is discarded rather than reported as `transactionMismatch`).
- F5 (RTU deadline for large reads at low baud; CHK-H6 assumes the frame was really cut).
- F7 (serial open timeout).
