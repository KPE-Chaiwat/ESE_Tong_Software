# Open questions

## Owner decisions for features 004-007 (2026-10-18)

| Id | Topic | Decision | Where |
|---|---|---|---|
| D-005-01 | Color-rule numeric source | The owner confirmed that rules compare the value displayed in the table by default. PM default: Displayed follows the current numeric column; when both Raw and Scaled are visible, each value column uses its own source. Explicit Raw/Scaled source choices remain available. Comparisons use the numeric value before display rounding. | REQ-005 |
| D-006-01 | Combined-register grouping | The owner confirmed sequential non-overlapping groups from the poll Start address: 2 registers for 32-bit and 4 for 64-bit, with no absolute-address alignment requirement. | REQ-006 |

**Revision 12 (2026-10-17):**
- Recorded the PM decisions after `docs/qa/REPORT-008-targeted-rerun-PARTIAL.md` (Results 1, 2, 3, 5 and "Open items") as D-002-36 to D-002-40 (DES-002 revision 12, CHK-002 revision 12, FE-002 revision 12 task 33).
- Q-002-19 is closed by D-002-38 (the physical Backslash key rule replaces the revision 11 assumption).

**Revision 11 (2026-10-17):**
- Recorded the PM decisions after `docs/qa/REPORT-007-integration-after-fixes.md` (sections 3, 5.1, 5.5, 5.6, 7, 8) as D-002-28 to D-002-35 (DES-002 revision 11, CHK-002 revision 11, FE-002 revision 11 task 32).
- Added Q-002-18 and Q-002-19, both non-blocking, with the assumptions written into DES-002.
- Q-002-14 note: the `dev-hooks` build provides the hook (`docs/SETUP.md`), and REPORT-007 ran CHK2-F16 with it. CHK-002 no longer marks F16 blocked.

**Revision 10 (2026-10-17):**
- Recorded the PM decisions after `docs/qa/REPORT-006-integration-multipoll.md` (sections 3, 4, 7) as D-002-20 to D-002-27 (DES-002 revision 10, CHK-002 revision 10, FE-002 revision 10 task 31).
- Added Q-002-14 to Q-002-17:
  - Q-002-14 blocks CHK2-F16;
  - Q-002-15 and Q-002-16 are non-blocking, with assumptions written into DES-002 / CHK-002;
  - Q-002-17 decides who owns the window-layer part of D-002-25.

**Revision 9 (2026-10-17):**
- Recorded the PM decisions after `docs/qa/REPORT-004-ui-mode-rerun.md` (sections 4, 6, 8) as D-002-16 to D-002-19 (DES-002 revision 9, CHK-002 revision 9, FE-002 revision 9 task 30).
- D-002-16 confirms the D-002-13 designer additions (Show icon step, final-safety ellipsis) and replaces the D-002-13 thresholds.

**Revision 8 (2026-10-17):**
- Recorded the PM answers to the REPORT-003 designer questions (section 8) as D-002-07 to D-002-15 (DES-002 revision 8, CHK-002 revision 8).
- Closed Q-FE2-16 (D-002-08). Q-FE2-04 is now also written into DES-002 2.10.3. Q-BE2-02 is confirmed by D-002-11.
- No other open Q-FE2 question is closed by these answers (see the FE-002 list below).

**Revision 7 (2026-10-16):**
- Recorded the PM decisions on the frontend questions Q-FE3-01 to Q-FE3-06 (FE-003 implementation notes, REV-007).
- Q-003-06 is amended: the 1e-9 tie rule is replaced by the capped rule in DES-003 1.3, revision 7.

**Revision 6 (2026-10-16):** recorded owner decisions D-002-01 to D-002-06 (hybrid model: workspace sub-windows plus pop-out windows, aliases, arrange, compact mode, drag and drop) after the mockups. Q-002-01 is superseded by D-002-01/D-002-02. Added Q-002-08 to Q-002-13 with the assumptions used in DES-002 revision 6.

**Revision 5 (2026-10-16):** added owner/PM questions Q-002-01 to Q-002-07 (DES-002, multi-poll) and Q-003-01 to Q-003-06 (DES-003, value scaling), each with the assumption used.

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

## Feature 002 Multiple polls per connection (asked by designer, from DES-002)

None of these block FE-002. Each assumption is written into DES-002.

| Id | Question | For | Assumption in DES-002 |
|---|---|---|---|
| Q-002-01 | Should poll data also be shown inside the connection window (panes), or only in separate poll windows? | owner | **Superseded 2026-10-16 by D-002-01 and D-002-02** (hybrid model). The earlier assumption "only in separate native windows" no longer applies. |
| Q-002-02 | When a poll window is closed and the poll is kept, should the poll keep polling in the background? | owner | Yes. Closing a view never pauses a poll. The list shows it running with its window "Closed" (DES-002 2.5). |
| Q-002-03 | Should moving or resizing windows, or pausing and resuming polls, mark the profile "Modified"? | owner | No. These values are still saved on the next Save, but they never trigger the "Save changes?" question (DES-002 6.1). |
| Q-002-04 | Poll window positions per monitor: is restoring on the saved monitor (with a fallback cascade when it is missing) enough? | owner | Yes. Positions are in logical pixels plus the monitor name (DES-002 2.6). |
| Q-002-05 | Must poll names be unique within a connection? | PM | Yes, case-insensitive, at most 48 characters. This keeps the traffic filter and window titles unambiguous (DES-002 4). |
| Q-002-06 | Scheduling rule: earliest deadline first with writes ahead of polls and no catch-up bursts. Is this acceptable to the backend? | backend | Yes (DES-002 7). BE-002 documents and tests it. |
| Q-002-07 | Can a poll window disconnect the connection? | owner | No. A poll window can only connect or reconnect. Disconnect lives in the connection window because it stops every poll. |
| Q-002-08 | Drag between the workspace and native windows: is it acceptable that pop out by drag ships only if the WebView2 spike confirms pointer events outside the window (R1), that the new window does not keep following the pointer (R2), and that dock by drag is a Windows-only phase 2 behind a platform trait (R3-R5)? | PM / owner | Yes. Phase 1: Pop out and Dock buttons, shortcuts, and dragging a poll from the sidebar into the workspace (which also docks a popped-out poll). Pop out by drag behind a flag after the spike. Dock by drag in phase 2 on Windows only (DES-002 2.10.7, 2.10.11). |
| Q-002-09 | What does "arrange per monitor" mean for popped-out windows? | owner | Two targets: "Each monitor (in place)" (default; each monitor's windows are arranged on that monitor) and "Display k" (all popped-out windows are gathered on that display and arranged). The choice lasts for the connection window's lifetime (DES-002 2.8.5). |
| Q-002-10 | Minimum sizes: may the native poll window minimum drop from 640 x 420 to 480 x 320, with sub-windows at 320 x 180? | owner | Yes. This lets Tile fit 3 x 3 native windows on a 1080p monitor and 4 x 3 sub-windows in a 1600 x 900 connection window. Below 640 px the native setup panel shows as a rail (DES-002 2.3.1, 2.6, 2.8). **Decision (PM, REV-004 M1, 2026-10-16):** 480 x 320 is the OUTER window size (title bar and borders included, the rectangle arrange uses); the native window's client minimum is 480 x 320 minus its measured frame. DES-002 numbers and NT/WT vectors unchanged. |
| Q-002-11 | Where does a closed (kept) poll reopen, and where does a new poll created from a popped-out window appear? | owner | A closed poll reopens in the host it last had (workspace or own window, at its saved position). A new poll created from a popped-out window opens in its own window next to it; from the connection window it opens in the workspace. Dragging a poll from the list always places it in the workspace (DES-002 2.5.1). |
| Q-002-12 | Aliases: keyed only by protocol address (kept when the function code or range changes, kept outside the range, max 2000 per poll), and "Include alias in copy" off by default with the Alias column shown by default? | owner | Yes to all. Aliases are content, so editing them, the Alias column toggle and the copy option mark the profile Modified (DES-002 2.3.4, 2.3.5, 4; DES-003 3.4). |
| Q-002-13 | Drag details: is tile mode as specified acceptable (Tile turns it on; in tile mode dragging reorders slots and the slot order is the poll list order; Cascade or unchecking ends it), with Ctrl as the swap modifier and Alt to disable snapping? And which drag implementation: plain pointer events or a small library? | owner (behavior), PM (library) | Yes as specified (DES-002 2.10.3-2.10.5). If Alt leaks into the OS system menu on WebView2 (R7), Shift replaces Alt. Library: plain pointer events for sub-windows recommended; pointer events or dnd-kit for the list; trade-offs in FE-002 task 15. |

### Decisions recorded 2026-10-16 (owner, after the mockups; DES-002 revision 6)

| Id | Topic | Decision | Where |
|---|---|---|---|
| D-002-01 | Default poll surface | The connection window's **workspace** (MDI, Modbus Poll style): each poll is a sub-window that can be moved, resized, minimized, maximized, closed, tiled and cascaded. Supersedes Q-002-01 and DES-002 rev 5 section 2.1 ("poll data only in native poll windows"). | DES-002 2.2-2.4 |
| D-002-02 | Pop out and dock | Each poll can be popped out to its own native window (for other monitors) and docked back. A poll is shown in exactly one place at a time. | DES-002 2.5, 2.6 |
| D-002-03 | Alias | Optional text per address in a poll, edited in the table, first column, saved in the profile, optional in Copy, max 32 characters, rules like poll names without uniqueness. Aliases follow the address, not the row. | DES-002 2.3.4, 2.3.5, 4; DES-003 3.3-3.5 |
| D-002-04 | Arrange and Window menus, compact mode | "Arrange" for native windows (Tile 2 x 2, Side by side, Stacked, Cascade, per monitor); "Window" menu for the workspace (Tile, Cascade, Arrange minimized icons); "Collapse setup panels" (compact mode), as in mockups 5 and 6. | DES-002 2.7-2.9 |
| D-002-05 | Earlier confirmations still stand | Closing a poll asks Keep / Delete / Cancel; window placement is saved in the profile and does not mark it Modified; DES-003 scaling decisions unchanged (presets, flag by default, raw-only Write with scaled preview); English UI only. | DES-002 2.11, 6.1; DES-003 |
| D-002-06 | Drag and drop (owner addition after mockup 6) | Drag to move and resize sub-windows; snapping to edges, other sub-windows and snap zones (Alt disables); swap; tile mode with slot reorder; poll list drag reorder (reverses "no reordering in the MVP"; the list order is the tile order and is saved without marking Modified); drag a poll from the list into the workspace; pop out and dock by drag where technically feasible (see Q-002-08); full keyboard equivalents; positions, sizes, z-order, tile order and list order saved without marking Modified; dragging must stay smooth with 8 polls at 100 ms. | DES-002 2.10 |

### Decisions recorded 2026-10-17 (PM answers to REPORT-003 section 8; DES-002 revision 8)

| Id | Topic | Decision | Where |
|---|---|---|---|
| D-002-07 | Setup dock threshold (REPORT-003 finding 2, question 1) | "Sub-window width ≥ 640" is the **frame** width (rectangle width, borders included), not the PollView body. A default new sub-window (640 x 368) shows the 300 px dock. 640 -> dock, 639 and 600 -> popover, 900 -> dock. | DES-002 2.3.3; CHK2-B1, E12 |
| D-002-08 | Tab order of sub-windows (finding 4, question 2, **closes Q-FE2-16**) | Keep the **DOM order by poll id** (stable focus: raising never moves a node). Sub-windows are reached with `Ctrl+F6` / `Ctrl+Shift+F6` (poll list order, wrapping, minimized skipped) and from the sidebar list. Designer clarification from DES-002 2.3.1 ("active" = the one with focus): focus entering a sub-window by Tab activates and raises it, so a focused control is never covered. | DES-002 2.3.1, 2.4, 2.7, 3.1, 9; CHK2-E9, R1, R6 |
| D-002-09 | S6 "A kept poll keeps polling in the background." (O-2, question 3) | Shown only when the poll's **state** is polling (including "Waiting…"), timeout, exception or badResponse. Never when paused or offline, whatever `active` is. | DES-002 2.11; CHK2-G1, G6 |
| D-002-10 | Snap tie (O-3, question 4) | At equal distance, the edge that makes the windows touch (for example B.left) wins over the 8 px gap line (B.left - 8). Full tie order: tile-area edge, then touching edge before gap line, then the window higher in z-order. A nearer candidate always wins. | DES-002 2.10.3; CHK2-I22 |
| D-002-11 | Duplicate state (O-7, question 4; confirms Q-BE2-02) | A duplicate starts by the new-poll rule: polling when "Start polling when connected" is on and the link is up, paused when it is off and the link is up, offline when not connected. It never copies the source's state. | DES-002 2.5.1 H3; CHK2-B5 |
| D-002-12 | Title of a Modified profile (O-1, question 5) | The W1 title carries " *" when the profile is Modified, e.g. "Modbus Master - Untitled * - Connected (1 exception · 7 live)". | DES-002 2.2, 2.12; CHK2-C2 |
| D-002-13 | Status line at narrow widths (finding 3, question 6) | PM order: first the freshness chip shrinks to its icon, then the reason text hides, then `F` and `ID` hide; controls never clip. Designer specification: fixed steps on the status line width L (sub-window: frame - 4 px active): icon-only freshness chip below 700, reason hidden below 620, `F`/`ID` hidden below 580. **Designer additions, for PM confirmation (not blocking):** step 4, below 480 the Show control shows its icon only (`columns-3`, accessible name "Show {Both}"); final safety, if the content still does not fit, the counters text is cut at its end with "…" (full text in the tooltip). Without them the 430 px frame cannot guarantee unclipped controls. | DES-002 2.3.2; CHK2-E13, E16-E19 |
| D-002-14 | Intended behaviors from REPORT-003 O-4, O-5, O-6, O-8 (recorded as clarifications) | O-4: a pointer within 24 px of the tile-area border (zones armed) shows a zone and suspends edge snapping. O-5: a press that only raises a sub-window is reported to Rust with the next layout action; Save flushes the pending layout first. O-6: Write… with the link down does nothing (no dialog, toast or command). O-8: the Disconnected announcement is assertive (DES-001 7). | DES-002 1.5, 2.10.3, 2.10.9, 3.3, 9; CHK2-I7, N9, D9, A5 |
| D-002-15 | Performance measurement (REPORT-003 finding 5) | CHK2-Q1 to Q3 "0 long tasks over 50 ms" is evaluated on a quiet machine. In the browser smoke under shared CPU, one isolated 50-52 ms task in a run is an observation, not a failure (two or more, or any over 52 ms, fail). The WebView2 run (CHK2-Q4) is authoritative and strict. | DES-002 2.10.10; CHK2-Q section |

### Decisions recorded 2026-10-17 (PM, after REPORT-004 measurements; DES-002 revision 9)

| Id | Topic | Decision | Where |
|---|---|---|---|
| D-002-16 | Status line steps (REPORT-004 failures 3, 4 and section 6; **supersedes the D-002-13 thresholds, confirms its designer additions**) | On the measured status line width L, strictly below = on, cumulative, `data-step` 0..5 in this order of hiding: step 1 freshness chip icon only at L < 720 (live text or no chip) / L < 810 (stale, timeout and waiting texts); step 2 reason text hidden at L < 620 (unchanged); step 3 `ID`/`F` hidden at L < 606 (was 580); step 4 Show control icon only at L < 500 (was 480); **new** step 5 `Err {n}` hidden at L < 465 (counters `Tx {n} · SR {ms} ms`, tooltip keeps the complete text). The reason text takes all the leftover space (no spacer element). **PM clarification (2026-10-17):** step 1 applies only to the freshness chip inside the status line; the data card header chip keeps its full text at every width. The wide layout threshold stays 720, so the status line chip is always icon only, and at 720 ≤ L < 810 with a long text `data-step` is 1 with no visible change. **PM accepted:** from step 3 on, the counters tooltip and accessible name always carry the complete text. | DES-002 2.3.2, 2.3.4; CHK2-E16 to E26 |
| D-002-17 | Setup dock threshold (REPORT-004 failure 1; refines D-002-07) | Measured on the frame element's real width (`offsetWidth`), independent of the border style: active or inactive, 640 -> dock, 639 -> popover. No body-plus-border constant. | DES-002 2.3.3; CHK2-E12 |
| D-002-18 | S6 body while open (REPORT-004 failure 2; clarifies D-002-09) | The whole S6 body is computed when the dialog opens and does not change while it is open. The buttons act on the current state. | DES-002 2.11; CHK2-G6 |
| D-002-19 | Status line width estimates (REPORT-004 section 6) | The thresholds of D-002-16 are estimates from the REPORT-004 metrics. QA re-measures with real text metrics at frames 640/600/560/430 (and the boundary frames). Acceptance rule: no control clips and the counters are complete or cut only by the documented last-resort ellipsis (DES-002 2.3.2 list). If a measurement disagrees, the step threshold moves; the rule does not. | DES-002 2.3.2; CHK2-E26 and the CHK-002 revision 9 note |

### Decisions recorded 2026-10-17 (PM, after REPORT-006 integration run; DES-002 revision 10)

| Id | Topic | Decision | Where |
|---|---|---|---|
| D-002-20 | Scan rate accuracy (REPORT-006 defect D1) | On Windows (and every supported OS), a poll with scan S on a link that is not saturated sends requests every S ms with a **mean interval ≤ S + 4 ms** (over ≥ 60 s and ≥ 100 intervals, simulator log as oracle). No interval is shorter than S - 2 ms, and intervals are never quantized to the 15.6 ms timer tick. The measured 109 ms for 100 ms (31 / 62 / 109 / 260 / 509 ms for 20 / 50 / 100 / 250 / 500) is defect D1. **`effective` semantics:** n = the mean interval between the starts of the poll's last 10 requests, rounded to ms. The suffix is shown while n > 1.5 S, with no hysteresis. It reports real slow-down only (saturation, timeouts, slow device), so a lone 20 ms poll on a free link never shows it. | DES-002 2.3.2, 7 item 8; CHK2-D2, D3, D10 |
| D-002-21 | Native window minimum at every scale (defect D3) | 480 x 320 is the **outer** size at every scale factor, rounded **up** in physical px: ceil(480 s) x ceil(320 s), which is 480 x 320 at 100 %, **600 x 400 at 125 %**, 720 x 480 at 150 % and 840 x 560 at 175 %. The client minimum is outer minus the measured frame in physical px, with no truncation. It is recomputed on a scale change. | DES-002 2.6; CHK2-F13, S2, S5 |
| D-002-22 | W1 work-area clamp (defect D5) | W1 is clamped to its monitor's work area at **creation** (launcher, `Ctrl+N`, cascade) and at **restore**. The outer rectangle fits the work area. The size is reduced only as needed, and stays at least 960 x 600 logical when that fits. Vector: a default 1280 x 800 W1 on a 1536 x 816 logical work area fits entirely (outer height 816, inner width 1280). | DES-002 2.2, 2.6, 2.13; CHK2-A7, A8, S7 |
| D-002-23 | Native setup below the threshold (O1) | In a W2 whose PollView width is < 640, the setup rail (click, `Ctrl+\`) opens the setup as a **popover**: 360 px, anchored to the rail, non-modal. `Esc`, [Done], a second rail click or `Ctrl+\` closes it, and focus returns to the rail. At ≥ 640 the panel applies, and compact mode's rail opens the panel. | DES-002 2.3.3, 2.6; CHK2-F13, F14 |
| D-002-24 | Edge snap threshold and guides (O4) | Threshold **8 px inclusive**: a candidate snaps at 8, not at 9. CHK2-I5's "7" is corrected. The candidate lines include the gap offsets in both directions: `left - 8`, `left + 8`, `right - 8`, `right + 8` (and the same for top and bottom) of other windows. The tie order is unchanged. | DES-002 2.10.3; CHK2-I5 |
| D-002-25 | Lone Alt (defect D2, keyboard users) | Pressing and releasing Alt alone (also after an Alt-drag) must never activate the OS window menu or menu mode in any ESEfact window. Focus stays, the page answers, and the next shortcut (`Ctrl+P`) acts. This is verified with hardware input in debug and release builds. `Alt+F4` still closes through the close-confirm flow ("Save changes?" in W1, S6 in W2). `Alt+Space` keeps the OS behavior. Risk R7 is closed by this rule: Alt stays the snap-off modifier. | DES-002 3.1, 2.10.11; CHK2-R7 (and I21) |
| D-002-26 | Accepted behaviors and one text fix (O2, O3, O6, O7) | **O2:** during a pop out the poll is shown nowhere for about 0.5 s with the real backend. The sub-window shows the spinner, disappears when Rust detaches it, then the W2 appears with values. This is accepted up to **1 s** from the click. **O3:** in a real Timeout the counters carry ` (effective N ms)`, so the reason text may get 0 px. The full reason is in the state chip tooltip (and `aria-describedby`), and the counters are cut only by the documented last-resort ellipsis. **O6:** placements are stored in whole logical px, so a drift of at most 1 logical px per axis per restart at fractional scales is accepted (exact at 100 % and 200 %). **O7:** the load flow's "Save changes?" says "before loading" ("Save changes to "{name}" before loading?" / "Save this setup as a profile before loading?"). | DES-002 2.3.2, 2.5.2 step 6, 2.13, 6.3; CHK2-E27, F1, F15, N1, N10 |
| D-002-27 | Integration coverage (REPORT-006 sections 5, 9) | New CHK-002 items cover what was not run against the real backend: B11 (17th poll), D3 (16 polls at 20 ms, saturated with `fault delay 3`), F16 (forced pop out and dock failure, needs Q-002-14), H9 (H7/H8), K8 (K4-K6), P3 (P1/P2). The [DPI] and [MON2] variants are in section S (100 %, 150 %, mixed DPI, second monitor) and in A8 and F13. | CHK-002 revision 10 |

### Open questions after REPORT-006 (asked by designer, 2026-10-17)

| Id | Question | For | Assumption in DES-002 / CHK-002 |
|---|---|---|---|
| Q-002-14 | **Dev-only failure hook for CHK2-F16** (REPORT-006 F8 skipped: a window-creation failure cannot be forced in the real app). May the backend add a minimal hook? **Proposal (one hook, nothing else):** a Tauri command `dev_fail_next_window_op(kind: "popOut" \| "dock", message: String)`, compiled only with `debug_assertions` (or a `dev-hooks` cargo feature that release builds never enable), and registered only in that case. It arms **one** failure. The next `mm_pop_out_poll` (or `mm_dock_poll`) of any connection then returns that message as its error **before** any window is created or destroyed and before any host or routing change, then disarms. It is not exposed through `shared/ipc` product code. QA calls it via CDP. An environment variable read at startup (`ESEFACT_DEV_FAIL_NEXT=popOut:boom`) is an alternative, but it can only fail the first operation of a run. | PM (backend) | **Blocked:** CHK2-F16 stays "blocked (Q-002-14)" until the PM decides. Without a hook, F8 stays covered only in UI mode (fake). |
| Q-002-15 | W1 minimum 960 x 600: is it the inner (client) size, as the 1280 x 800 default is (REPORT-006: 1280 x 800 logical inner), or the outer size like the W2 minimum? When the work area is smaller than the minimum (for example 1280 x 720 at 150 % = 853 x 480 logical), D-002-22 says W1 must still fit. Should the OS minimum then be lowered to the work area for that window? | PM / backend | Inner (client) size, as implemented. When the minimum does not fit, the window's outer size equals the work area in that axis, and its minimum is lowered for that window so that it fits (DES-002 2.13 step 3). |
| Q-002-16 | What exact message does `mm_add_poll` return for a 17th poll? The UI-level limit text is "A connection can have at most 16 polls."; the profile validation says "A connection can have at most 16 polls (found 17)". | backend | The same sentence as the UI: "A connection can have at most 16 polls." with code `validation`. CHK2-B11 records the actual text, and a different wording is reported, not failed. |
| Q-002-17 | Lone Alt (D-002-25): if a `preventDefault` of the lone Alt keyup in the webview does not stop WebView2 from entering menu mode, the fix needs the window layer (`WM_SYSKEYUP` / `SC_KEYMENU` handling behind a `#[cfg(windows)]` platform trait, CLAUDE.md rule 4). Who owns it: FE-002 task 31 b (frontend, first) with a BE follow-up, or BE-002 directly? Also, must the launcher window get the same fix in this round (REPORT-006 did not test it)? | PM | Frontend first (FE-002 task 31 b), then a BE task if CHK2-R7 still fails with hardware input. The launcher is included in CHK2-R7 (e). |

### Decisions recorded 2026-10-17 (PM, after REPORT-007 integration re-run; DES-002 revision 11)

| Id | Topic | Decision | Where |
|---|---|---|---|
| D-002-28 | Native minimum: user resize only (REPORT-007 section 3, CHK remark) | Win32 applies the minimum track size only to resizing by the user. A programmatic `SetWindowPos` to a smaller size (even 1 x 1) is allowed by the OS for every window and is not checked. The CHK2-F13 clause "after SetWindowPos to 1 x 1 the OS keeps the minimum" is removed. Expectation: a real user drag inward stops at 480 x 320 logical, which is 600 x 400 physical at 125 %. The product's own placements never request less than the minimum. | DES-002 2.6; CHK2-F13 |
| D-002-29 | `Alt+Space` then `Esc` (REPORT-007 5.2, 7) | Windows needs two `Esc` presses after `Alt+Space`. The first closes the popup, and the second ends menu mode. The page must answer after the second press. One press leaving menu mode active is OS behavior, not a defect. | DES-002 3.1; CHK2-R7 (f) |
| D-002-30 | CHK2-D3 oracle; dev simulator timer (REPORT-007 5.1, 7) | The simulator's own `fault delay 3` is quantized by its process timer (15.6 ms), so with 16 polls the expected `effective` is about 249 ms, not 50 ms. **Oracle:** `effective` equals the mean of the poll's last 10 request starts in the simulator log, within 0.5 ms. **Criteria:** round robin (every poll in every window of 16 consecutive requests), no `OVERLAP`, longest gap between two requests of one poll ≤ 2 s, and after `clear` the suffix disappears within 1 s and the link load falls below 90 %. **Known limitation:** the dev simulator is a test tool without the Windows timer resolution. It is not a product defect and is not fixed. | DES-002 7 item 9; CHK2-D3, Reference setup |
| D-002-31 | Shortcuts on every keyboard layout (REPORT-007 defect D8) | Shortcuts defined by a Latin letter or a digit work on every keyboard layout. They match the physical key (`code`) when the layout produces a non-Latin character (Thai, Cyrillic, Greek, Arabic, Hebrew), and the layout's Latin letter otherwise (Dvorak, AZERTY). Digit shortcuts (`Ctrl+1..4`) match the digit row by `code` on every layout (AZERTY without Shift), and also the keypad digits. AltGr (Ctrl+Alt) never triggers a Ctrl shortcut. IME composition never triggers one. Text fields keep their native `Ctrl+C/V/X/A/Z` (and `Ctrl+Y`, `Ctrl+Shift+Z`). | DES-002 3.1, 9; CHK2-R8 to R12, M5, M7; FE-002 task 32 a |
| D-002-32 | No document scrollbar (REPORT-007 defect D6) | No native window (W2, W1, launcher) shows a document scrollbar at any size down to its minimum. At 125 % the W2 minimum client is 582 x 353 physical, which is 465.6 x 282.4 css px (466 css px wide after rounding). The bottom status text and the version label never wrap: ellipsis with a tooltip. The toolbar may wrap. Only the inner scroll regions scroll: the data grid, and the setup panel or popover inside itself. | DES-002 2.2.6, 2.6; CHK2-F17; FE-002 task 32 b |
| D-002-33 | "Show traffic for this poll" from a native window (REPORT-007 defect D7) | W1 is restored if minimized and brought to the front. The traffic panel expands, and the filter is set to that poll. The keyboard focus goes to the panel's Filter select. From a sub-window or the sidebar, the focus does not move. Who raises W1 is Q-002-18. | DES-002 2.2.5; CHK2-K5, K8 (b); FE-002 task 32 c |
| D-002-34 | Focus after a failed pop out or dock (REPORT-007 defect D9) | After a failed pop out, the keyboard focus stays on, or returns to, the control that had it. The same applies to a failed dock. A busy control stays focusable (`aria-busy` / `aria-disabled`, not `disabled`), and the error toast never takes the focus. | DES-002 2.5.2 step 5, 2.5.3 step 4, 9; CHK2-F8, F16; FE-002 task 32 d |
| D-002-35 | Owner manual tests (REPORT-007 section 8) | The manual hardware tests QA could not run become CHK-002 section M (tag [OWNER]), each with steps and expected results, for the owner to tick: M1 mixed DPI, M2 other scales, M3 second monitor, M4 real `Win+Left` snap, M5 AltGr / Alt codes / IME, M6 NVDA, M7 a real Thai keyboard, M8 Alt+letter beep (record only), M9 RTU, M10 10-minute soak. | CHK-002 section M |

### Open questions after REPORT-007 (asked by designer, 2026-10-17)

| Id | Question | For | Assumption in DES-002 / CHK-002 |
|---|---|---|---|
| Q-002-18 | D-002-33: who brings W1 to the front for "Show traffic for this poll" from a native window? REPORT-007 found that `mm_show_traffic` only sends the event to the session. Options: (a) the backend restores and focuses W1 inside `mm_show_traffic`, as `mm_dock_poll` already does (DES-002 2.5.3 step 2); (b) the frontend W2 calls the existing "focus the connection window" command used by `Ctrl+Shift+M`, then `mm_show_traffic`. | PM (backend / frontend) | (a), because it matches the dock flow and needs no second call. The user-visible result is the same either way (DES-002 2.2.5). FE-002 task 32 c covers the W1 side (panel, filter, focus) in both cases. |
| Q-002-19 | D-002-31 covers letters and digits. `Ctrl+\` and `Ctrl+Shift+\` (setup and compact mode) use punctuation. With the Thai layout, the `\` key types another character, so these two stay dead. Should they match `code` "Backslash" when `key` is a non-Latin character, by the same rule as the letters? On AZERTY, `\` needs AltGr, which never triggers a Ctrl shortcut, so AZERTY users keep the rail, the `⋯` menu and the Window menu. | PM | Yes for non-Latin layouts (same rule as the letters). No change for Latin layouts. CHK2-R8 does not require `Ctrl+\` until this is decided. **Closed by D-002-38 (revision 12).** |

### Decisions recorded 2026-10-17 (PM, after REPORT-008 partial targeted re-run; DES-002 revision 12)

| Id | Topic | Decision | Where |
|---|---|---|---|
| D-002-36 | Squeeze at the native minimum (REPORT-008 result 1, open item D10) | At the W2 native minimum (outer 600 x 400 physical at 125 %, client 582 x 353 physical = 465.6 x 282.4 css px), the W2 toolbar takes **at most 2 rows**. Below about 640 css px of window width, the toolbar buttons are **icon-only**, with the full name in `title` and `aria-label`. The data grid shows **at least 2 complete data rows** (3 if they fit). The same squeeze check applies to W1 at its minimum. REPORT-008 measured 3 toolbar rows and 1 grid row (grid height 65 px), which fails. Supersedes the D-002-32 sentence "The toolbar may wrap" (it may wrap to 2 rows, not more) and the CHK2-F17 "at least 3 rows". | DES-002 2.6; CHK2-F17; FE-002 task 33 b |
| D-002-37 | CHK2-D3 oracle tolerance and expected values (REPORT-008 result 5) | The oracle is: the absolute difference between `effective` and the mean interval of the poll's last 10 request starts from the simulator log is <= **1.5 ms** (was 0.5 ms; the integer display of `effective` and the lag between the log and the display account for up to about 1.1 ms). Expected `effective` with 16 polls at 20 ms and `fault delay 3`: about **249 ms** with the plain simulator (reply delay quantized to about 15.6 ms), about **66-72 ms** with the `os-timer` simulator (reply delay about 4 ms). REPORT-008 with `os-timer`: 14,080 requests in 60 s, round robin 14,065 windows with 0 missing, 0 `OVERLAP`, longest gap of one poll 83 ms, link load 94-96 %, after `clear` suffix gone in 265-356 ms and load 84 %. The exact value is not a criterion; the oracle is. | DES-002 7 item 9; CHK2-D3, Reference setup |
| D-002-38 | `Ctrl+\` and `Ctrl+Shift+\` on every layout (REPORT-008 result 3, open item D8b; closes Q-002-19) | The backslash shortcuts match the **physical Backslash key** (`code` "Backslash") on every layout, whatever character the layout produces there. Under the Thai layout, hardware `Ctrl+\` arrives as `key` "+" with `code` "Backslash", and `Ctrl+Shift+\` as `key` "ฅ". AltGr (Ctrl+Alt, or the `AltGraph` modifier state) never matches, also on the Backslash key. The layout's own backslash typed without AltGr (for example UK `key` "\" on `code` "IntlBackslash") also still matches. German backslash is AltGr+ß, so it does not match, but a lone `Ctrl` + the physical Backslash key (types "#") does. | DES-002 3.1; CHK2-R8, R12, M11; FE-002 task 33 a |
| D-002-39 | Focus test harness (REPORT-008 result 2) | Focus tests that read `document.hasFocus()` or which window is focused must disable Playwright's focus emulation on every page involved (`Emulation.setFocusEmulationEnabled` with `enabled: false`), because under `connectOverCDP` `document.hasFocus()` is otherwise always true. With the emulation on, CHK2-K5 / K8 (b) gave 0/10; with it off, 10/10. | CHK2-K5, K8 (b) |
| D-002-40 | Layouts not installed on the dev machine (REPORT-008 header) | The QA dev machine has only US English and Thai Kedmanee. Cyrillic (Russian), French AZERTY, US Dvorak and German QWERTZ are **not installed**, so CHK2-R9, R10, the German part of R11, and the German / AZERTY / Cyrillic backslash cases are **owner manual tests** (CHK2-M11). QA marks them "owner manual", not pass or fail. | CHK-002 R9-R11, section M (M11) |

### Frontend questions on FE-002 (asked in the FE-002 implementation notes)

| Id | Status after revision 8 |
|---|---|
| Q-FE2-16 | **Closed by D-002-08.** Tab order stays DOM order by poll id; `Ctrl+F6` (list order) and the sidebar are the routes; DES-002 9 and CHK2-R1 are rewritten. New: Tab into a sub-window activates and raises it (CHK2-R6). |
| Q-FE2-04 | Already resolved in FE-002 part B2a (zones arm after the pointer left the band); now also written into DES-002 2.10.3. |
| Q-FE2-05, Q-FE2-06, Q-FE2-13 | Answered earlier (FE-002 B2a and B2b notes). |
| Q-FE2-01, 02, 03, 07, 08, 09, 10, 11, 12, 14, 15, 17, 18 | **Still open.** Not addressed by the REPORT-003 answers. |

## Feature 003 Value scaling (asked by designer, from DES-003)

| Id | Question | For | Assumption in DES-003 |
|---|---|---|---|
| Q-003-01 | The owner wrote "40-20 mA". Is 4-20 mA meant? | owner | Yes, 4-20 mA (REQ-003). |
| Q-003-02 | What is the default raw range for the 4-20 mA and 0-10 V presets? | owner | 0-65535, plus one-click quick picks "0-4095", "0-27648", "0-32767", "0-65535" and "4000-20000" (DES-003 2). |
| Q-003-03 | By default, should raw values outside the raw range be flagged (extrapolated value shown with a marker) or clamped? | owner | Flagged. A reading below 4 mA usually means a broken wire, and clamping would hide it. Clamp is available per scale (DES-003 1.4). |
| Q-003-04 | Should the Write dialog accept values typed in engineering units in the MVP? | owner | No. Writes stay raw, with a live scaled preview. Engineering-unit entry needs an inverse conversion that is lossy (rounding, clamp, signed) and could send an unexpected raw value to a live device. It can come in a later REQ, with the raw value shown and confirmed before sending (DES-003 3.5). |
| Q-003-05 | How are signed registers scaled? | owner | The scale has its own "Raw is signed" option, independent of the raw display format. It is pre-checked when the poll's format is Signed (DES-003 1.5). |
| Q-003-06 | Rounding: half away from zero, with float ties detected within 1e-9, and no "-0". Is this acceptable? | PM | Yes (DES-003 1.3). **Amended 2026-10-16 (revision 7, Q-FE3-01):**<br>- The tie band is min(1e-9 x max(1, \|s\|), 1e-6).<br>- The whole part and the fraction are rounded separately.<br>- "too large" is judged on the rounded magnitude.<br>See DES-003 1.3 for the steps and the validity range. |

### Frontend questions on FE-003 (asked by frontend, decided by PM 2026-10-16 after REV-007)

| Id | Question | Decision | Where |
|---|---|---|---|
| Q-FE3-01 | The DES-003 1.3 tie band `1e-9 x max(1, \|s\|)` exceeds 0.5 above \|s\| = 5e8, so every value would round up. Cap it at 1e-6? | **Accepted.**<br>- The band is capped at 1e-6, and the whole part and the fraction are rounded separately.<br>- REV-007 checked 7.47M cases: the capped rule equals exact rounding below \|s\| of about 5.8e13, while the literal rule was wrong in about 24%.<br>- A value that rounds up to 1e15 shows "too large" (REV-007 n-1, to be fixed). | DES-003 1.3 |
| Q-FE3-02 | Stacking threshold for the field pairs: 260 px content width, or measure the dock as 300 px of content? | **Accepted:** pairs stack at a content width of 260 px or less. | DES-003 3.1 |
| Q-FE3-03 | Default raw range of a new signed scale: 0-32767? | **Accepted.** | DES-003 2 |
| Q-FE3-04 | Should an override be able to switch scaling off for its rows (a "None" entry in S8)? | **No, not in the MVP. A later REQ may add it.** An override holding None (a hand-edited profile) shows "—" and no marker. | DES-003 3.2 |
| Q-FE3-05 | Show control title and S8 behaviour for FC01/02. | **Accepted as built:**<br>- The scale is kept and ignored, and the table shows Raw only.<br>- The Show control is disabled with the title "Scaling applies to registers (FC03 and FC04) only."<br>- Copy gives raw only.<br>- S8 and [+ Add override] are disabled. | DES-003 1.5 |
| Q-FE3-06 | FC16 preview: flag out-of-range or clamped values among the five? Mixed units? | **Decision:**<br>- The unit follows each value when the units differ, and is printed once at the end when they are all the same.<br>- " (out of range)" or " (clamped)" is appended to the affected values. The warning tint is used when any value is flagged.<br><br>**Also accepted as built:**<br>- The S8 titles "Scale override" / "Edit scale override".<br>- The overlap message when a selection touches an existing override.<br>- The single-address marker "Scale override 5: …".<br>- "Applied:" uses the short summary, and the override list and marker titles use the full one.<br>- Removing the last scale resets the value columns to Raw. | DES-003 3.1, 3.2, 3.5, 1.5 |

## BE-002 (asked by backend, 2026-10-16)

None of these block FE-002; each is implemented with the conservative option shown and can be changed in one place.

| Id | Question | For | What the backend does now |
|---|---|---|---|
| Q-BE2-01 | DES-002 1.3 says C6 (link lost) keeps the last values as stale and C7 (dismiss) clears them, but says nothing for C5 (user Disconnect). | designer | C5 clears the last values too (as BE-001 T12 did): after a user disconnect a view shows no stale values. |
| Q-BE2-02 | Duplicate (H3): should the copy inherit the source's `active`, or follow the new-poll rule (`active = autoStartPoll`)? | PM | New-poll rule: `active = autoStartPoll` (a copy of a running poll starts paused unless "Start polling when connected" is on). **Confirmed 2026-10-17 by D-002-11.** |
| Q-BE2-03 | DES-002 2.8.1 step 9 / 2.8.4: z-order of native windows after an arrange started from the connection window. Raising every popped-out window would take the focus away from W1. | designer | From a poll window: windows are raised in list order and the invoking window keeps the focus. From W1: positions and sizes change, z-order and focus are left alone (use "Bring popped-out windows to front", `mm_show_poll_windows`). |
| Q-BE2-04 | PT0 (a poll added while connected) has no "from" state. Should it emit `PollStateChanged`? | designer | No. The new poll's state arrives in `PollListChanged` (`PollSummary.status`); `PollStateChanged` is only sent for transitions PT1-PT7. |
| Q-BE2-05 | A poll whose definition cannot run on the current link (slave 0 read on RTU, added while the last connection was TCP) when the connection comes up with `autoStartPoll`. | PM | It comes up `paused` (PT1) with `active` unchanged; Resume returns the slave 0 validation error. |
| Q-BE2-06 | `dev-sim-slave` gained `fault ... unit=<id>` and logs `OVERLAP` when a request arrives before the previous reply. `docs/SETUP.md` section 4 is not the backend's to edit. | PM / devops | Documented in BE-002 "Final contract"; please copy the two lines into SETUP.md section 4. |

## Feature 004 bulk operation contract (designer, 2026-10-18)

| Id | Question | For | Design status |
|---|---|---|---|
| Q-004-01 (closed D-004-01) | Publish the BE-004 atomic bulk duplicate/delete contract: all-id/capacity/lifecycle validation, ordered source-to-copy results and one list commit, plus whether definitions committed when native creation/destruction fails, affected ids, recoverable host state and Show/retry route. How are affected native modal/precondition races rejected before commit? | PM / backend | DES-004 defines observable atomic definition UX; it deliberately does not choose a backend rollback algorithm. FE-004 tasks 3-4 wait for this contract; selection UI and REQ-007 can proceed. Window failures must preserve surviving definitions and distinguish recovery from reissuing mutation. No owner product decision is requested. |

## Features 005/006 numeric persistence contracts (designer, 2026-10-18)

| Id | Question | For | Design status |
|---|---|---|---|
| Q-005-01 (closed D-005-02) | Publish the BE-005 ordered max-16 rule DTO, threshold-as-decimal-string serialization, stable palette/source/operator enums, optional inclusive protocol range and atomic validation with interpretation. How are named-rule compatibility errors returned to the editor? | PM / backend | DES-005 defines frontend syntax and comparisons, including exact BigInt for integer64 and validation of disabled rules. FE-005 IPC integration waits for the generated contract; pure utility/editor work can proceed. No JSON Number conversion for 64-bit thresholds. |
| Q-006-01 (closed D-006-02) | Publish BE-006 interpretation/order DTO and supported profile schema version with schema1/2 migration and rejection rules. Confirm view acknowledgment/host transfer preserve saved scales, aliases, rules and both swap flags, and snapshot identity prevents grouping old definitions. | PM / backend | DES-006 defines observable grouping/order/format/copy and atomic rejection on incompatible integer64 rules. PM chooses version and concrete serialization; FE-006 IPC integration waits for this contract. Migration retains existing 16-bit formats and defaults missing rules/order without rewriting a source file until Save. |

### PM backend contract decisions (2026-10-18)

| Id | Topic | Decision | Where |
|---|---|---|---|
| D-004-01 | Atomic bulk lifecycle; closes Q-004-01 | Prepare server snapshot plan for frozen confirmation; execute revalidates revisions and takes affected view readiness leases before one actor definition commit. Postcommit native failures never undo definitions: copies survive native/closed with Show recovery; deleted orphan windows get cleanup-only retry. One final authoritative list, typed committed result with affected ids, idempotent consumed token. No loop over existing single commands. | BE-004-bulk-poll-actions.md |
| D-005-02 | Rule serialization and bounded exact validation | Ordered rules without persisted ids; local draft identities only. Decimal string thresholds max256 ASCII bytes; exact integer64 thresholds bounded to +/-18446744073709551615 validated in i128, frontend BigInt. Complete prospective interpretation+rules validated atomically, including disabled/dormant rules. Palette lime/neutral/warning; no runtime match persistence. | BE-005-value-color-rules.md |
| D-006-02 | Shared new profile schema and interpretation DTO | One schema3 for both rules and interpretation; extend existing ValueFormat with six combined variants, add display.swapBytes/reverseWords booleans, require new fields in v3. Explicit legacy1/2 migration preserves old formats/scales/aliases and adds false swaps/empty rules without rewriting source. Schema>3 rejected; malformed v3 never silently defaults. Raw u16 streams unchanged, decode frontend only. | BE-006-combined-register-values.md |

### Workspace GridStack decisions (owner, 2026-10-18)

| Id | Topic | Decision | Where |
|---|---|---|---|
| D-008-01 | Workspace layout engine | Replace the floating Poll workspace entirely with GridStack. Polls in the workspace occupy non-overlapping grid cells. Native popped-out Poll windows remain separate. | REQ-008, DES-008 |
| D-008-02 | Overflow | The Workspace may scroll vertically when Poll widgets exceed the visible height. No Poll may become unreachable below the fold. | REQ-008, DES-008 |
