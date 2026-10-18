# CHK-002 Multiple polls per connection - QA checklist

**Revision 12 (2026-10-17): PM decisions after REPORT-008 (partial targeted re-run)** (DES-002 revision 12, D-002-36 to D-002-40).
- **Changed:**
  - F17: at the native minimum the toolbar takes at most 2 rows (icon-only buttons below about 640 css px) and the grid shows at least 2 complete rows (3 if they fit), was "at least 3 rows"; the same squeeze check for W1 at its minimum (D-002-36).
  - D3: oracle tolerance 1.5 ms (was 0.5 ms); expected `effective` about 249 ms (plain simulator) and about 66-72 ms (`os-timer` simulator) (D-002-37). Reference setup note updated.
  - R8: `Ctrl+\` and `Ctrl+Shift+\` are now required on the Thai layout (D-002-38).
  - R12: backslash vectors for Thai, US, UK, German, AZERTY and Cyrillic (D-002-38).
  - K5 and K8 (b): harness rule, Playwright focus emulation off (D-002-39).
  - R9, R10, R11 (German part): owner manual on the QA dev machine (D-002-40).
- **Added:** M11, owner manual test for the layouts not installed on the QA dev machine (Cyrillic, AZERTY, Dvorak, German) (D-002-40).

**Revision 11 (2026-10-17): PM decisions after REPORT-007 (integration re-run)** (DES-002 revision 11, D-002-28 to D-002-35).
- **Changed:**
  - D3: the `effective` oracle (log mean within 0.5 ms), the expected value of about 249 ms with the dev simulator, and the criteria (clear within 1 s, load below 90 %) (D-002-30).
  - F8: focus after a failed pop out or dock (UI mode) (D-002-34).
  - F13: the `SetWindowPos` 1 x 1 clause is removed. The expectation is the real user drag minimum (D-002-28).
  - F16: "focus kept" made explicit (REPORT-007 defect D9, D-002-34). It is no longer marked blocked: the `dev-hooks` build provides the hook (`docs/SETUP.md`, REPORT-007 5.5).
  - K5 and K8 (b): from a native window, W1 is restored if minimized, brought to the front, and the Filter select has the focus (REPORT-007 defect D7, D-002-33).
  - R7 (f): two `Esc` presses after `Alt+Space` (D-002-29).
  - Reference setup: the dev simulator's timer limitation (D-002-30).
  - The State coverage index.
- **Added:**
  - F17: no document scrollbar in a native window, width sweep down to the minimum (REPORT-007 defect D6, D-002-32).
  - R8 to R12: shortcuts on the Thai, Cyrillic, AZERTY and Dvorak layouts; AltGr and native text-field keys; matching vectors in UI mode (REPORT-007 defect D8, D-002-31).
  - Section M: owner manual tests M1 to M10, from REPORT-007 section 8 (D-002-35).
- **New tags:**
  - [OWNER] is a manual test run by the owner on his own hardware. The owner ticks the box and writes the date, the machine, the scale and monitor layout, and pass or fail with a note.
  - [LAYOUT] needs a given Windows input language (see Tags).

**Revision 10 (2026-10-17): PM decisions after REPORT-006 (integration mode)** (DES-002 revision 10, D-002-20 to D-002-27).
- **Changed:**
  - D2: per-poll mean interval ≤ S + 4 ms.
  - D3: deterministic saturation with `fault delay 3`, and the meaning of `effective` made explicit.
  - F1: the 1 s gap limit.
  - F13: the minimum outer size at 100 / 125 / 150 / 175 % in physical px, and the native rail popover.
  - I5: threshold 8 px inclusive, exact vectors, and the inner gap offsets.
  - I21: now points to R7.
  - N1: placement precision at fractional scales.
  - The State coverage index.
- **Added:**
  - A7, A8: W1 work-area clamp at creation and restore.
  - B11: 17th poll rejected by the real backend.
  - D10: scan rate accuracy at 20 / 50 / 100 / 250 / 500 ms, with the simulator log as oracle.
  - E27: real Timeout status line, accepted behavior O3.
  - F14: native setup popover below the threshold at native widths 466, 626, 639, 640 and 900.
  - F15: pop out timeline ≤ 1 s, O2.
  - F16: forced pop out and dock failure in the real app. It needs the dev-only hook of Q-002-14 and is blocked until the PM decides.
  - H9: H7 and H8 against the real backend.
  - K8: K4 to K6 against the real backend.
  - N10: the load flow's "Save changes?" wording, O7.
  - P3: P1 and P2 against the real backend.
  - R7: lone Alt, hardware input.
  - Section S: scale factors and second monitor ([DPI], [MON2]).
- **New tags:** [HW] hardware input; [DPI] needs a given scale factor.
- **Integration rule:** items tagged [WIN] run in the integration project (real `esefact-desktop.exe`, real backend). Items that say "real backend" must not use the fake.

**Revision 9 (2026-10-17): PM decisions after REPORT-004** (DES-002 revision 9, D-002-16 to D-002-19).
- Changed: E12 (threshold on the frame's `offsetWidth`; inactive 639 and 640 cases explicit), E16-E19 (new steps: `data-step` 0..5, exact visible elements per step, reference content with frozen counters, counters-complete check), G6 (S6 body is a snapshot: explicit expectations while open).
- Step 1 (freshness chip icon only) applies only to the chip **inside the status line**; the data card header chip keeps its full text at every width (PM clarification of D-002-16). From step 3 on, the counters tooltip and accessible name always carry the complete text (PM accepted).
- Added: E20-E25 (step boundaries L 720/719, 810/809, 620/619, 606/605, 500/499, 465/464 at active frames 724/723, 814/813, 624/623, 610/609, 504/503, 469/468), E26 (width sweep and re-measurement at frames 640/600/560/430 with the acceptance rule).
- **Acceptance rule for every status line item (D-002-19):** the step widths are estimates. QA re-measures with real text metrics. An item passes when no control clips and the counters are complete, or cut only by the documented last-resort ellipsis (DES-002 2.3.2). If a measurement shows a clip or an undocumented cut at a width where the current step should fit, report the measured widths: the **step threshold moves** (designer + PM update DES-002 and this checklist); the rule is not relaxed.

**Revision 8 (2026-10-17): PM answers after REPORT-003** (DES-002 revision 8, D-002-07 to D-002-15).
- Changed: B1 and E12 (dock threshold on the frame width), E9 (`Ctrl+F6` in list order), E13 (width wording), R1 (Tab order by poll id, rewritten), G1 (keeps-polling sentence by state), B5 (duplicate state), C2 (title with " *"), I7 (zones suspend edge snapping), A5 (assertive Disconnected announcement), Q1-Q4 (measurement note).
- Added: E16-E19 (status line at 640, 600, 560 and 430 px), G6 (keeps-polling sentence per state), I22 (snap tie, exact pixels), D9 (Write… with the link down), N9 (z-order reported at the next layout action, Save flushes), R6 (Tab into a sub-window activates and raises it).
- Widths in this checklist are **frame** widths (the sub-window rectangle width, borders included) unless an item says "status line width". Items that need an exact width set it with the fake layout or `Alt+Shift+Arrow`/`Ctrl+Alt+Arrow` steps and read it back from the frame's `width` style.

**Revision 6 (2026-10-16): hybrid model.** Rewritten for DES-002 revision 6: workspace sub-windows (default), pop out and dock, aliases, Window and Arrange menus, compact mode, drag and drop, and the new profile fields. Item ids changed; the old E-section (native windows only) is replaced by sections E-K. "Add poll" is now "New poll".

Upstream: `docs/design/DES-002-multi-poll.md` revision 6 with the revision 8 changes (DES-002), DES-003 revision 6, DES-001 rev 4, CHK-001 (tags and reference simulator). Report in `docs/qa/REPORT-<nnn>.md`, with every item marked pass or fail.

## Tags
Same as CHK-001: **[NONE]** fake or no device, **[SIM]** simulated TCP slave, **[FAULT]** fault injection, **[WIRE]** capture or simulator log compare, **[RTU]** serial device. New: **[MON2]** needs a second monitor, **[WIN]** Windows/WebView2 integration build only, **[P2]** phase 2 feature (dock by drag), skipped and marked "n/a (phase 2)" until the PM enables it.
Revision 10:
- **[HW]** needs hardware input: a real keyboard and mouse, or Win32 `SendInput` (the REPORT-006 `winhelper`). CDP/Playwright synthetic input does not count, because it never reaches the OS.
- **[DPI]** needs a monitor at the scale factor named in the item (100 %, 125 %, 150 % or 175 %), or two monitors at different scales ("mixed DPI"). QA records the scale, the work area in physical and logical px, and the measured window frame. An item that cannot be run on the available hardware is marked "not run [DPI]", not pass.
Revision 11:
- **[OWNER]** is a manual test by the owner (section M). QA marks it "owner manual" in a REPORT and does not mark it pass or fail.
- **[LAYOUT]** needs a given Windows input language installed and active in the tested window (Thai Kedmanee, Russian, French AZERTY, US Dvorak or German). QA records the layout's name and KLID (for example `0000041E` Thai Kedmanee). The harness switches the layout only for the window under test and switches it back at the end.

## Reference setup
- The CHK-001 simulator map at `127.0.0.1:5020` (HR0=1234, HR1=65535, HR2=32768, HR3=0, HR4=32767; IR0=4321; coils 0-2 = 1,0,1; DI0=1; outside 0-99 gives exception 02). Unit IDs 1 and 2 both answered with the same map.
- **"Standard 8 polls" (P1-P8)**, all scan 100 ms unless stated, slave 1:

  | Poll | Name | FC | Start | Qty | Notes |
  |---|---|---|---|---|---|
  | P1 | "Poll 1" | 03 | 0 | 10 | |
  | P2 | "Poll 2" | 03 | 10 | 10 | |
  | P3 | "Poll 3" | 04 | 0 | 10 | |
  | P4 | "Poll 4" | 01 | 0 | 32 | |
  | P5 | "Poll 5" | 02 | 0 | 8 | |
  | P6 | "Poll 6" | 03 | 20 | 125 | always exception 02 |
  | P7 | "Poll 7" | 03 | 50 | 10 | slave 2 |
  | P8 | "Poll 8" | 03 | 0 | 2 | scan 1000 ms |
- **Reference W1 size** 1600 x 900 with the sidebar at 280 px and the traffic bar collapsed. QA records the workspace tile-area size shown in the dev overlay (or computed) for the tile items.
- **Known limitation of the dev simulator (revision 11, D-002-30).** `dev-sim-slave` is a test tool. It does not hold the Windows high-resolution timer, so its own waits (`fault delay {ms}`) are quantized to the 15.6 ms OS tick (`fault delay 3` delays a reply by about 15.6 ms). This is not a product defect, and nobody fixes it in the simulator. Items that measure the product's timing (D2, D10) use the no-fault path, which answers at once. Items that use `fault delay` (D3) compare against the simulator log, not against a computed value. Revision 12 (D-002-37): the opt-in `os-timer` simulator build (`docs/SETUP.md`) answers `fault delay 3` in about 4 ms. QA records which simulator build ran (plain or `os-timer`) in the REPORT.

---

## A. Connection window states
- [ ] **CHK2-A1** [NONE] Given a new connection window, then: the pill reads "Not connected" (plug icon), no summary chip; the sidebar shows "POLLS · 0 of 16" and "No polls yet. Press New poll (Ctrl+Shift+N) to read registers from this connection."; the workspace shows the same text with a [+ New poll] button; the title is "Modbus Master - Untitled - Not connected"; the traffic bar is collapsed.
- [ ] **CHK2-A2** [SIM] Given 2 polls added while idle, then both sidebar rows and both sub-window status lines show "Offline" and "No connection" (neutral tint). Connect with "Start polling when connected" on: pill "Connected · 127.0.0.1:5020", both Polling. With it off: both Paused.
- [ ] **CHK2-A3** [SIM] On Connect the sidebar CONNECTION section collapses to "TCP 127.0.0.1:5020 · timeout 1000 ms" with [Edit]; the fields are read-only with "Disconnect to change connection settings.". After a refused connect (simulator stopped, 3000 ms timeout) the section is expanded.
- [ ] **CHK2-A4** [FAULT] Connecting delayed: banner "Connecting to {target}…" with [Cancel]; every status line reads "Connecting…". Cancel returns to idle; polls stay Offline.
- [ ] **CHK2-A5** [SIM] Polling P1-P3 in the workspace and P2 popped out; stop the simulator. Then: pill "Disconnected", banner with reason, [Reconnect], [Dismiss]; workspace status lines "No connection: link lost" on error tint with chip "Offline"; the P2 window shows the connection banner with [Reconnect] and [Connection window]. W1 announces the loss exactly once in its **assertive** live region ("Disconnected. {banner text}"); the per-poll "Offline" changes are not announced (revision 8, O-8). Restart and Reconnect: polls with Resume intent poll again.
- [ ] **CHK2-A6** [SIM] Disconnected, Dismiss: idle, Offline, stale values cleared in sub-windows and the native window.
- [ ] **CHK2-A7** [NONE][WIN][DPI] (revision 10, D-002-22) **W1 clamped at creation.**
  - Given one monitor at 125 % with a work area of 1920 x 1020 physical (1536 x 816 logical, taskbar at the bottom), no saved W1 window state (delete `%APPDATA%\com.esefact.desktop\.window-state.json` first), and the launcher placed so that the 24 px cascade would push a 1280 x 800 W1 below the work area (REPORT-006 case: the W1 was cascaded to physical (254, 163), 30 physical px = 24 logical from the launcher),
  - when Modbus Master is opened from the launcher tile, and a second W1 is opened with `Ctrl+N` from the first,
  - then each W1's **outer** rectangle (Win32 window rect with the DWM frame) lies entirely inside (0, 0)-(1920, 1020) physical, so its bottom edge is ≤ 1020 and its right edge ≤ 1920.
  - The default 1280 x 800 inner size gives an inner width of 1280 logical (±1 px rounding) and an outer height of exactly the work-area height (816 logical, 1020 physical) or less.
  - The window can still be resized by the OS, and the content (toolbar, sidebar, workspace, traffic bar, status bar) is fully visible with no part under the taskbar.
  - At 100 % on a 1920 x 1080 monitor (work area 1920 x 1032), a default W1 (outer about 1296 x 839) is **not** shrunk: inner 1280 x 800 exactly; only its position is clamped if needed.
- [ ] **CHK2-A8** [NONE][WIN] (revision 10, D-002-22) **W1 clamped at restore.**
  - Given a W1 whose outer rectangle is set with `SetWindowPos` to (100, 300) physical with a size of 1900 x 1000 physical (its bottom is below the work area), when the app is closed gracefully and restarted and the same W1 is restored from its saved window state, then the restored outer rectangle fits the work area entirely: bottom ≤ 1020 physical at 125 % (≤ 1032 at 100 %), left ≥ 0, right ≤ 1920.
  - Its size is the saved size reduced only as much as needed. It is not reduced below 960 x 600 logical, because that fits.
  - A maximized W1 restores maximized.
  - [MON2] variant: save a W1 on a larger monitor 2, unplug monitor 2, restart. W1 opens on the remaining monitor (2.13 restore rule) and fits its work area entirely.

## B. Poll lifecycle
- [ ] **CHK2-B1** [SIM] Connected, press + New poll (or `Ctrl+Shift+N`): "Poll 1" appears in the sidebar and as an active sub-window at (8, 8, 640, 368) of the workspace, with the 300 px setup **dock** open (not the popover: 640 is the frame width, revision 8) and focus in Name with the text selected; Paused with auto-start off, Polling with it on.
- [ ] **CHK2-B2** [NONE] Polls "Poll 1" and "Poll 3", New poll gives "Poll 2".
- [ ] **CHK2-B3** [NONE] 16 polls: header "POLLS · 16 of 16"; New poll disabled with title "A connection can have at most 16 polls."; `Ctrl+Shift+N` shows that toast; no poll created.
- [ ] **CHK2-B4** [NONE] Rename with `F2` on a sidebar row and on a sub-window title bar: "tank" while "Tank" exists gives "A poll named "tank" already exists on this connection."; empty gives "Enter a poll name."; 49 characters gives "Poll name must be at most 48 characters."; " a" gives "Poll name cannot start or end with a space."; a valid name updates the sidebar, the sub-window title, the Window menu entry, a native window title, and the traffic filter entry.
- [ ] **CHK2-B5** [NONE] (revision 8) Duplicate "Tank" (with "Tank copy" existing) gives "Tank copy 2", inserted right after "Tank" in the list, in the same host kind as the source. Its state does not copy the source's state (new-poll rule, DES-002 2.5.1 H3); with "Tank" Polling in the first two cases:
  - connected, "Start polling when connected" **off**: the copy is Paused (chip "Paused");
  - connected, "Start polling when connected" **on**: the copy polls (chip "Waiting…" until its first reply, then "Polling");
  - not connected (idle, "Tank" Offline): the copy is Offline (chip "Offline"), whatever the checkbox.
  - Also with "Tank" Paused and the checkbox on (connected): the copy polls.
- [ ] **CHK2-B6** [SIM] Delete (sidebar `Delete` or `⋯`): "Delete poll?" / "Delete "{name}"? Its window closes and its settings are removed from this connection.", default focus Cancel. Delete removes the row and its sub-window (or native window). Other polls keep polling with no gap longer than 2 scan periods.
- [ ] **CHK2-B7** [SIM] `Ctrl+P` with focus in P1's sub-window pauses only P1 (chip "Paused"); others keep updating. Again resumes.
- [ ] **CHK2-B8** [SIM] `Ctrl+Shift+P` pauses all; again resumes all. Toolbar shows [Pause all] / [Resume all] accordingly.
- [ ] **CHK2-B9** [SIM] In a sub-window setup dock, Quantity 10 -> 20 and Apply: only that poll restarts ("Waiting for first response…", then 20 rows); other sub-windows do not flicker.
- [ ] **CHK2-B10** [SIM] Paused poll, Apply with a changed Start: no request; text "Poll settings changed. Press Resume (Ctrl+P) to read with the new settings."
- [ ] **CHK2-B11** [SIM][WIN] (revision 10; REPORT-006 B3 not run, real backend) **The 17th poll, real backend.** Given a connected W1 with 16 polls (P1-P16, all Polling) and one of them popped out:
  - The UI path: + New poll is disabled with the title "A connection can have at most 16 polls."; `Ctrl+Shift+N` in W1 and in the native window shows the neutral toast "A connection can have at most 16 polls." (2 s); the sidebar still reads "POLLS · 16 of 16"; no native window opens.
  - The backend path: call the IPC facade's add-poll function directly from the W1 page through CDP `evaluate` (the same call the New poll button makes, host `workspace`, a valid definition named "Poll 17"). The call is **rejected** with error code `validation`. QA records the exact message (Q-002-16). No poll is created: `mm_export_profile` lists 16 polls, the sidebar is unchanged, and the simulator log shows no request for "Poll 17"'s range.
  - Race: with 15 polls, press `Ctrl+Shift+N` in W1 and in the native window within 50 ms (hardware input [HW] or two CDP calls). Exactly one new poll is created (16 in total). The other window shows the rejected command's message as an error toast (`circle-x`, 4 s, D-001-14), or the neutral limit toast when its button was already disabled. No 17th poll exists in the export, and the other 15 polls keep polling (no gap longer than 2 scan periods in the simulator log).

## C. Independent poll states
- [ ] **CHK2-C1** [SIM] Standard 8 polls tiled in the workspace: P6 status line shows chip "Exception 02" and "Exception 02 (Illegal data address)" on error tint, tooltip "Exception 02 (Illegal data address) from slave 1 for FC03 at 20-144. …"; others Polling; pill stays "Connected · …"; no connection banner.
- [ ] **CHK2-C2** [SIM] (revision 8) Given C1 in an untitled window (typing the connection and adding the polls made the profile Modified): summary chip "1 exception · 7 live" (octagon-x); title exactly "Modbus Master - Untitled * - Connected (1 exception · 7 live)". After Save as "Plant": the title is exactly "Modbus Master - Plant - Connected (1 exception · 7 live)" (no " *"); renaming a poll then gives "Modbus Master - Plant * - Connected (1 exception · 7 live)".
- [ ] **CHK2-C3** [FAULT] Drop replies for slave 2: P7 status line turns to the warning fill with chip "Timeout", text "No response within 1000 ms", `Err` rising; sidebar chip "Timeout {n}"; chip "1 exception · 1 timeout · 6 live". When drops stop, P7 returns to Polling and the line loses the warning fill.
- [ ] **CHK2-C4** [FAULT] Bad responses for P2 only: P2 status line "Bad response: short frame ({got} of {expected} bytes)" on the warning fill; others unaffected.
- [ ] **CHK2-C5** [NONE] 4 polls time out within 1 s (fake): W1 announces exactly one "4 polls are failing."; no sub-window announces on its own; a single later failure announces "{name}: Timeout." once.
- [ ] **CHK2-C6** [SIM] P6 closed (kept): sidebar still shows "Exc 02" with marker "closed"; the summary still counts it.
- [ ] **CHK2-C7** [SIM] Status line format: P1 shows exactly `Tx {n} · Err 0 · ID 1 · F 03 · SR 100 ms`; P7 shows `ID 2`; P4 shows `F 01`; `Tx` equals P1's Requests in the traffic filter "Poll 1".

## D. Scheduling and wire
- [ ] **CHK2-D1** [SIM][WIRE] Standard 8 polls, 60 s: no request starts before the previous reply or timeout; never more than one outstanding transaction ID; traffic bytes match the log.
- [ ] **CHK2-D2** [SIM][WIRE] Standard 8 polls, 60 s: each poll ≥ 80% of 60 s / scan, or every running poll served at least once per 16 requests when saturated; P8 about 60 requests. **Revision 10 (D-002-20):** the link is not saturated here (7 requests per 100 ms on loopback), so the accuracy rule also applies to each poll. From the simulator log, the mean interval of each of P1-P7 is ≤ 104 ms and P8's is ≤ 1004 ms. No status line shows `(effective …)`. REPORT-006 measured a mean of 109 ms (556 of 605 requests), which fails this check (defect D1).
- [ ] **CHK2-D3** [SIM][WIN] (revision 10: made deterministic and real-backend; revision 11: oracle and expected value, D-002-30) **Saturated link: 16 polls at 20 ms.**
  - Given the simulator with `fault delay 3` and `master-timeout 1000`, and 16 FC03 polls "Poll 1" to "Poll 16" (slave 1, Poll i at start 5(i - 1), qty 5, so each poll's requests can be told apart in the simulator log by their start address) at scan 20 ms, all Polling, for 60 s.
  - **Simulator limitation (Reference setup):** the simulator quantizes its 3 ms delay to its 15.6 ms timer tick, so each reply comes about 15.6 ms late and the link serves one request about every 15.6 ms. With 16 polls, each poll's `effective` is therefore about 16 x 15.6 = **249 ms** on Windows, not about 50 ms. REPORT-007 measured 249.0-249.1. The exact value is not a criterion; the oracle below is.
  - **Expected values by simulator build (revision 12, D-002-37):**

    | Simulator build | Reply delay for `fault delay 3` | Expected `effective` | Reference measurement |
    |---|---|---|---|
    | plain (default) | about 15.6 ms | about **249 ms** | REPORT-007: 249.0-249.1; gap 253 ms; after `clear` 341 ms, load 88 % |
    | `os-timer` | about 4 ms (median 4.00, 3.26-5.08) | about **66-72 ms** | REPORT-008: 14,080 requests in 60 s; round robin 14,065 windows, 0 missing; 0 `OVERLAP`; longest gap 83 ms; load 94-96 %; after `clear` 265-356 ms, load 84 % |

    Record the build used. A value outside the expected range is reported, not failed, when the oracle and the criteria below pass.
  - Then the traffic bar reads "link load {p}% - polls are slowed down" with the `gauge` icon, p ≥ 90.
  - Every status line shows `SR 20 ms (effective {n} ms)` with n > 30.
  - **Oracle:** for at least 3 polls, read n. From the simulator log, take that poll's last 10 request starts logged before the read and compute their mean interval. `|n - mean| ≤ 1.5 ms` (revision 12, D-002-37; was 0.5 ms, too tight against the integer display of n and the log-to-display lag: REPORT-008 had 4 of 20 reads at 0.56-1.11 ms). Record every read (n, mean, difference).
  - **Round robin:** in the simulator log, every poll appears at least once in every window of 16 consecutive poll requests (no starvation, DES-002 section 7 rule 5). Record the number of windows checked and the number that miss a poll (must be 0).
  - No `OVERLAP` line appears in the simulator log.
  - **Longest gap:** the longest interval between two consecutive requests of one poll is ≤ 2 s (REPORT-007: 253 ms).
  - Then send `clear`. Within **1 s** the ` (effective …)` suffix disappears from every status line, and the traffic bar's link load falls **below 90 %**: the "polls are slowed down" text and the `gauge` icon are gone. Record the time to the last suffix removal and the load after it (REPORT-007: 341 ms, 88 %).
  - **Fails if:** the oracle differs by more than 1.5 ms, a poll is starved, an `OVERLAP` line appears, a gap exceeds 2 s, a suffix remains after 1 s, or the load stays at 90 % or more after `clear`.
- [ ] **CHK2-D4** [SIM][WIRE] FC06 write (address 40, value 7) from P1's sub-window: the write follows the in-flight request and precedes the next poll request; result "Write confirmed by slave 1: register at 40."; traffic Poll column "Write: Poll 1".
- [ ] **CHK2-D5** [SIM] Writes from a sub-window and from a native window within 50 ms: both succeed in FIFO order; polling continues.
- [ ] **CHK2-D6** [FAULT] Write in flight from P2 when the link drops: link-lost text with [Reconnect]; another view's queued write shows "Not connected. Connect before writing.".
- [ ] **CHK2-D7** [RTU][WIRE] 3 polls on RTU 9600 8E1: at least `max(t3.5, 5 ms)` silence before every request.
- [ ] **CHK2-D8** [SIM][WIRE] Reordering the list, popping out, docking and dragging sub-windows during 60 s of the Standard 8 polls changes neither request order rules nor counts beyond D2 tolerances (scheduler unaffected).
- [ ] **CHK2-D9** [NONE] (revision 8, O-6) Given a poll with values kept, in a sub-window and in a native window, with the connection **idle** and then **disconnected** (fake), when Write… is chosen in the `⋯` menu, `Ctrl+E` is pressed with focus in the grid, and `Enter` and a double-click are used on a data row: then no Write dialog opens, no toast and no announcement appear, and the fake records no write command. The same steps while connected open "Write · {poll name}".
- [ ] **CHK2-D10** [SIM][WIRE][WIN] (revision 10, D-002-20; REPORT-006 defect D1) **Scan rate accuracy, simulator log as oracle.**
  - **Setup:** the real backend on Windows, the simulator with no fault, and one poll alone (FC03, slave 1, start 0, qty 10), Polling. QA states that the machine was quiet. For each scan rate S in **20, 50, 100, 250 and 500 ms**, run for 60 s (and at least 100 intervals: 60 s gives 120 intervals at 500 ms). From the simulator log's `RX` request lines, compute every interval between consecutive request starts (epoch ms column).
  - **Expected:**

    | S (ms) | Mean interval (pass) | Shortest interval | Status line | REPORT-006 measured (fails) |
    |---|---|---|---|---|
    | 20 | ≤ 24.0 | ≥ 18 | `SR 20 ms`, **no** `(effective …)` | 31.2 (`effective 31 ms` shown) |
    | 50 | ≤ 54.0 | ≥ 48 | `SR 50 ms`, no suffix | 62.4 |
    | 100 | ≤ 104.0 | ≥ 98 | `SR 100 ms`, no suffix | 109.1 |
    | 250 | ≤ 254.0 | ≥ 248 | `SR 250 ms`, no suffix | 260.4 |
    | 500 | ≤ 504.0 | ≥ 498 | `SR 500 ms`, no suffix | 508.6 |

  - **Count check:** the request count over 60 s is at least 60000 / (S + 4). For example, ≥ 576 at S = 100 (REPORT-006 had 556 with 7 other polls running).
  - **Quantization check:** the histogram of intervals must not cluster on multiples of 15.6 ms. For S = 100, fewer than 10 % of the intervals may lie in 107-112 ms.
  - **Number of polls:** repeat S = 100 with 2, 4 and 7 polls running (distinct start addresses, all at 100 ms). Poll 1's mean stays ≤ 104.0.
  - Record per S: mean, min, max, standard deviation, count. The REPORT gives the table.

## E. Workspace sub-windows
- [ ] **CHK2-E1** [NONE] Sub-window frame: title bar shows the name and buttons with tooltips "Poll setup (Ctrl+\)", "Open in its own window (Ctrl+Shift+O)", "Minimize", "Maximize", "Close (Ctrl+F4)". The active frame has the dark title bar and 2 px border; inactive frames a light title bar.
- [ ] **CHK2-E2** [NONE] Press anywhere in an inactive sub-window raises and activates it; the sidebar selection follows (3 px bar).
- [ ] **CHK2-E3** [NONE] Minimize: frame hidden; minimized bar appears with "Minimized" and the pill "{name} · {chip}" with the state icon; sidebar marker "minimized"; next by z-order becomes active. Click the pill restores it.
- [ ] **CHK2-E4** [NONE] Maximize fills the tile area (above the minimized bar when shown); double-click on the title bar restores the previous rectangle. With A maximized, clicking B in the sidebar shows B maximized and A at its normal rectangle.
- [ ] **CHK2-E5** [NONE] Window > Tile with 4 sub-windows and a tile area of 1316 x 700: rectangles (8,8,654,346), (670,8,654,346), (8,362,654,346), (670,362,654,346); "Tile mode" check mark and corner indicator appear. With 3: (8,8,654,346), (670,8,654,346), (8,362,1316,346).
- [ ] **CHK2-E6** [NONE] Tile with 13 sub-windows in 1316 x 700: 12 tiled at 323 x 228, one cascaded at (8, 8); toast "1 window did not fit and was cascaded.".
- [ ] **CHK2-E7** [NONE] Window > Cascade with 3: positions (8,8), (32,32), (56,56) at 640 x 368; tile mode turns off; the last in list order is on top.
- [ ] **CHK2-E8** [NONE] Window > Arrange minimized sorts the minimized pills into list order; Minimize all and Restore all work; disabled entries match DES-002 2.7.
- [ ] **CHK2-E9** [NONE] (revision 8) `Ctrl+F6` / `Ctrl+Shift+F6` cycle in **poll list order**, not z-order. Given P1-P4 as sub-windows, the list reordered to [P3, P1, P4, P2], P4 minimized, P1 active and P2 at the back of the z-order:
  - `Ctrl+F6` activates P2 (P4 is skipped), brings it to the front, and its data grid has the focus;
  - `Ctrl+F6` again activates P3 (wraps from the last to the first);
  - `Ctrl+Shift+F6` from P3 activates P2.
  - With only one visible sub-window, Window > Next sub-window and Previous sub-window are disabled.
  - The Window menu lists "1 Poll 3", "2 Poll 1", "3 Poll 4", "4 Poll 2" (list order) with a check on the active one and the marker texts ("minimized" on Poll 4).
- [ ] **CHK2-E10** [NONE] Resizing W1 smaller clamps every sub-window so at least 80 x 30 px of its title bar is visible; in tile mode the tiles are recomputed.
- [ ] **CHK2-E11** [NONE] Empty workspace with polls that are all closed shows "No poll is shown in the workspace. Click a poll in the list, or drag it here."; with 2 popped out it adds "2 polls are open in their own windows.".
- [ ] **CHK2-E12** [NONE] (revision 9, D-002-17) Setup presentation, threshold on the **frame element's real width** (`offsetWidth` of the sub-window frame, borders included; record it next to each case), the same for an active and an inactive frame:
  - a new poll at the default size (frame 640 x 368; its PollView body measures 636 px) opens with the 300 px **dock**, not the popover;
  - frame 640 **active**: `⚙` toggles the 300 px dock (boundary);
  - frame 639 **active**: `⚙` opens the 360 px popover with [Done] (boundary);
  - frame 639 **inactive**: given two sub-windows A (frame `offsetWidth` 639, setup open as the popover) and B, when B is activated (A becomes inactive, its border renders 1.5 px or 1 px), then A still shows the popover, no dock appears in A, and A's `offsetWidth` is still 639; when A is activated again, still the popover;
  - frame 640 **inactive**: same steps with A at 640 and the dock open: A keeps the 300 px dock while inactive and after re-activation;
  - frame 600: popover; frame 900: dock (active and inactive);
  - resizing a sub-window from 640 to 639 with an unapplied Quantity edit switches the dock to the popover and keeps the edit and its dot on `⚙`;
  - clicking outside the popover does not close it; `Esc` closes it; an unapplied edit shows the dot on `⚙` and "Unapplied changes".
- [ ] **CHK2-E13** [NONE] When the PollView is narrower than 720 px (active frame narrower than 724 px), the segmented controls are replaced by "Show Both ▾" with Show, Raw format, Address base, "Alias column" and "Include alias in copy". What the status line shows at narrow widths is in E16-E26.
- [ ] **CHK2-E15** [NONE] Fake delays the attach snapshot by 1 s: the new sub-window shows "Loading poll…" in the data card and "Loading…" in the status line, then the poll's real state.
- [ ] **CHK2-E14** [SIM] Reloading the W1 webview (dev) re-attaches every sub-window at the same rectangles, states and z-order with values restored, without "Modified".

**Status line at narrow widths (revision 9, DES-002 2.3.2, D-002-16 and D-002-19).** Setup for E16-E26: one **active** sub-window (focus in its grid, 2 px border, so the status line width L = frame width - 4 px; read L from the status line element and record it), setup closed, poll FC03, slave 1, start 0, quantity 10, scan 100 ms, no scale (Show reads "Show Raw"), connection connected, timeout 1000 ms, 100% scale. **Reference content, counters frozen by the fake:** "Polling case": state Polling with live values, `Tx 1234`, `Err 0` (freshness text "Updated {HH:MM:SS.mmm}", live kind). "Timeout case": the same poll in Timeout, 3 in a row, `Tx 1234`, `Err 3`, stale values (freshness text "No response - values from {time}", long kind). Steps (strictly below = on): 1 at L < 720 (live) / L < 810 (long), 2 at L < 620, 3 at L < 606, 4 at L < 500, 5 at L < 465.
- **Fit check** (every item, both cases): the status line has no horizontal overflow (`scrollWidth` = `clientWidth`); the state chip, the freshness chip, the Show control and `⋯` each have their full natural width (0 px clipped) and lie inside the line; the `⋯` button's right edge is at most at the frame's right edge - 14 px (2 px border + 12 px padding); `⋯` opens the "Poll actions" menu with a click.
- **Counters check** (every item unless it says otherwise): the counters element shows its visible text completely (no "…", element `scrollWidth` ≤ `clientWidth`). From step 3 on, its tooltip and accessible name are the complete text `Tx 1234 · Err {0|3} · ID 1 · F 03 · SR 100 ms`.
- **Step check:** the status line's `data-step` equals the value given in the item.
- [ ] **CHK2-E16** [NONE] Frame **640** (L 636), `data-step` = **1** in both cases.
  - Polling, left to right exactly: chip "Polling" (`activity` icon + text); counters `Tx 1234 · Err 0 · ID 1 · F 03 · SR 100 ms`; freshness chip **icon only** (`circle-check`, no text; tooltip and accessible name begin with "Updated {HH:MM:SS.mmm}"); "Show Raw ▾" with its text; `⋯`. No reason text. The right group (freshness, Show, `⋯`) is right-aligned.
  - Timeout: warning fill; chip "Timeout"; counters `Tx 1234 · Err 3 · ID 1 · F 03 · SR 100 ms`; reason "No response within 1000 ms" right after the counters, taking **all the leftover space**: its right edge is within 8 px of the freshness chip's left edge (no empty spacer between them); it may end with "…" if cut, and its tooltip has the full banner text; freshness chip icon only (stale icon; tooltip and accessible name "No response - values from {time}"); "Show Raw ▾"; `⋯`.
  - Fit check and counters check pass.
- [ ] **CHK2-E17** [NONE] Frame **600** (L 596), `data-step` = **3** in both cases.
  - Polling: chip "Polling"; counters exactly `Tx 1234 · Err 0 · SR 100 ms` (no `ID`, no `F`); freshness icon; "Show Raw ▾" with its text; `⋯`.
  - Timeout: chip "Timeout"; counters exactly `Tx 1234 · Err 3 · SR 100 ms`; **no reason text** visible; the line keeps the warning fill; the chip's tooltip is "Timeout: slave 1 did not respond within 1000 ms. Retrying every 100 ms (3 in a row)."; freshness icon; "Show Raw ▾"; `⋯`.
  - Both: the counters tooltip and accessible name are the complete text (with `ID 1 · F 03`). Fit check and counters check pass (REPORT-004 failure 3 must be gone: the Timeout counters are not cut).
- [ ] **CHK2-E18** [NONE] Frame **560** (L 556), `data-step` = **3** in both cases: the same visible elements as E17 for each case (counters `Tx 1234 · Err {0|3} · SR 100 ms`, no reason, freshness icon, "Show Raw ▾" with its text, `⋯`). Fit check and counters check pass.
- [ ] **CHK2-E19** [NONE] Frame **430** (L 426), `data-step` = **5** in both cases.
  - Both cases, left to right exactly: chip ("Polling" or "Timeout"); counters exactly `Tx 1234 · SR 100 ms` (no `Err`, no `ID`, no `F`; no "…"); freshness icon; Show control **icon only** (`columns-3` + `chevron-down`, no text) with accessible name and tooltip "Show Raw", opening the same Show menu; `⋯`. Timeout: no reason, warning fill kept.
  - The counters tooltip and accessible name are `Tx 1234 · Err 0 · ID 1 · F 03 · SR 100 ms` (Polling) and `Tx 1234 · Err 3 · ID 1 · F 03 · SR 100 ms` (Timeout). Fit check and counters check pass (REPORT-004 failure 4 must be gone).
  - Documented last resort: with `Tx 1000000` and the effective rate shown, the visible counters `Tx 1000000 · SR 100 ms (effective 180 ms)` are cut at the end with "…"; the tooltip and accessible name are `Tx 1000000 · Err 0 · ID 1 · F 03 · SR 100 ms (effective 180 ms)`; the fit check still passes (controls never clip). The counters check is not applied to this sub-case.
- [ ] **CHK2-E20** [NONE] Boundary step 1, live kind (L 720/719), Polling case. Frame **724** (L 720): `data-step` = 0; wide layout: the data card header shows the segmented controls and the freshness chip **with** its text "Updated {HH:MM:SS.mmm}"; the status line has chip, counters `Tx 1234 · Err 0 · ID 1 · F 03 · SR 100 ms`, `⋯`, and no freshness chip or Show menu. Frame **723** (L 719): `data-step` = 1; no header row; the status line has chip, the same counters, the status line freshness chip **icon only** (tooltip and accessible name "Updated {HH:MM:SS.mmm}"), "Show Raw ▾" with text, `⋯`. Fit and counters checks pass at both.
- [ ] **CHK2-E21** [NONE] Boundary step 1, long kind (L 810/809), Timeout case. Frame **814** (L 810): `data-step` = 0; the header freshness chip shows its text "No response - values from {time}"; the status line has chip "Timeout", the full counters, the reason "No response within 1000 ms" (complete, no "…"), `⋯`. Frame **813** (L 809): `data-step` = 1 and **nothing visible changes**: the header freshness chip still shows its full text "No response - values from {time}" (the header chip is never icon only), and the status line is unchanged (chip, full counters, complete reason, `⋯`, no freshness chip in the line). Same frame 813 in the Polling case: `data-step` = 0 and the header chip shows "Updated {HH:MM:SS.mmm}" (live kind, T1 = 720). Also check the header chip keeps its full text at frames 724 and 900 in both cases. Fit and counters checks pass.
- [ ] **CHK2-E22** [NONE] Boundary step 2 (L 620/619), Timeout case. Frame **624** (L 620): `data-step` = 1, the reason element is visible (it may be cut with "…"). Frame **623** (L 619): `data-step` = 2, no reason visible, warning fill kept, counters still `Tx 1234 · Err 3 · ID 1 · F 03 · SR 100 ms`. Polling case at 624 and 623: the same visible elements (no reason in either), `data-step` 1 and 2. Fit and counters checks pass.
- [ ] **CHK2-E23** [NONE] Boundary step 3 (L 606/605), both cases. Frame **610** (L 606): `data-step` = 2, counters complete with `ID 1 · F 03` (`Tx 1234 · Err {0|3} · ID 1 · F 03 · SR 100 ms`), no "…". Frame **609** (L 605): `data-step` = 3, counters `Tx 1234 · Err {0|3} · SR 100 ms`. Fit and counters checks pass at both (the full counters are not cut at 610: this is the REPORT-004 "ID/F at about L < 606" estimate).
- [ ] **CHK2-E24** [NONE] Boundary step 4 (L 500/499), both cases. Frame **504** (L 500): `data-step` = 3, "Show Raw ▾" with its text, counters `Tx 1234 · Err {0|3} · SR 100 ms` complete. Frame **503** (L 499): `data-step` = 4, Show icon only (accessible name and tooltip "Show Raw"), same counters complete. Fit and counters checks pass at both.
- [ ] **CHK2-E25** [NONE] Boundary step 5 (L 465/464), both cases. Frame **469** (L 465): `data-step` = 4, counters `Tx 1234 · Err {0|3} · SR 100 ms` complete. Frame **468** (L 464): `data-step` = 5, counters `Tx 1234 · SR 100 ms` complete; tooltip and accessible name keep the complete text with `Err`, `ID` and `F`. Fit and counters checks pass at both.
- [ ] **CHK2-E26** [NONE] Re-measurement and sweep (D-002-19; the widths in E16-E25 are estimates).
  - At frames **640, 600, 560 and 430**, both cases, record: L, `data-step`, the counters' needed width (`scrollWidth`) and given width (`clientWidth`), the reason's given width (Timeout), and the widths of the chip, freshness chip, Show control and `⋯`.
  - Sweep the right-edge resize handle from frame 900 down to 320 and back in 4 px steps, plus every boundary frame of E20-E25 (each side), both cases. At every width: the fit check passes; `data-step` follows the thresholds of DES-002 2.3.2 for the measured L; the counters check passes at every frame ≥ 393 (Polling) / ≥ 400 (Timeout) (estimated step-5 fit width). Below those frames the counters may only be cut at the end with "…" with the complete text in the tooltip (documented last resort).
  - Repeat the boundary frames with the sub-window **inactive**: `data-step` follows the measured L (inactive L = frame - 2 or - 3 px depending on the rendered border), never a border constant.
  - Pass rule: no control clips and the counters are complete or cut only by the documented last-resort ellipsis. If a measurement disagrees (a clip, or a cut at a width where the step should fit), the item **fails** and the report gives the measured widths; the PM and designer then move the step threshold (the rule is not relaxed). Repeat the four reference frames at 125% and 150% scale and report them.
- [ ] **CHK2-E27** [SIM][FAULT][WIN] (revision 10, D-002-26, REPORT-006 O3) **Real Timeout status line (accepted behavior).**
  - **Setup:** the real backend, one active sub-window, FC03, slave 1, scan 100 ms, timeout 1000 ms, and `fault drop unit=1` until the poll is in Timeout with `Err` ≥ 3. With the real backend the counters read `Tx {n} · Err {n} · ID 1 · F 03 · SR 100 ms (effective {n} ms)` with n ≥ 1000.
  - At active frames **900, 724, 723, 640, 600 and 430**, check and record L, `data-step`, the counters' `scrollWidth`/`clientWidth`, and the reason's given width:
    - the fit check of E16-E26 passes: no control clips, and `⋯` opens "Poll actions";
    - the counters are complete at frame ≥ 724. Below that they are complete or cut **only at their end** with "…", and their tooltip and accessible name are the complete text including ` (effective {n} ms)`;
    - the reason "No response within 1000 ms" may be cut or get **0 px** at frames 624-813. This is not a failure. When it is cut or hidden, the state chip's tooltip reads "Timeout: slave 1 did not respond within 1000 ms. Retrying every 100 ms ({k} in a row).", and the status line's `aria-describedby` still resolves to the reason text;
    - the warning fill stays at every frame;
    - `data-step` follows the measured L with the long kind (T1 = 810).
  - **Fails if:** any control clips; the counters are cut anywhere but at their end; a cut has no complete tooltip; or the warning fill or chip tooltip is missing.

## F. Host model: show, pop out, dock
- [ ] **CHK2-F1** [SIM] Pop out (button, `⋯` menu, and `Ctrl+Shift+O`) a polling poll with rows 3-5 selected, scrolled so address 2 is on top, and an invalid Quantity "200" in the setup: the sub-window disappears; a native window opens at the sub-window's screen position and size; it shows live values immediately (no "Waiting for first response…"), rows 3-5 selected, address 2 on top, Quantity "200" with its message; the sidebar marker reads "own window"; the status bar reads "… · 1 in its own window". Revision 10 (D-002-26): the time during which the poll is shown in no window, measured from the click to the native window being visible with values, is ≤ 1 s. The measured timeline is in F15.
- [ ] **CHK2-F2** [SIM] Dock back (button and `Ctrl+Shift+D`): the native window closes without S6; W1 comes to the front (also when it was minimized); the sub-window returns at its previous workspace rectangle with selection, scroll and draft kept, active, focus in its grid.
- [ ] **CHK2-F3** [SIM] Counters, state, `Tx` and the Pause state are unchanged across 5 pop out / dock cycles; traffic shows no gap longer than 2 scan periods for that poll.
- [ ] **CHK2-F4** [MON2] Pop out, move the window to monitor 2, dock, pop out again: it reopens on monitor 2 at the saved placement. With monitor 2 unplugged, it opens on W1's monitor (restore rule).
- [ ] **CHK2-F5** [NONE] A poll is never shown twice: while popped out, clicking it in the sidebar focuses the native window (restoring it if minimized) and no sub-window appears.
- [ ] **CHK2-F6** [NONE] Show of a closed poll reopens it in its last host kind (closed from a native window -> native window; closed from the workspace -> sub-window at its previous rectangle).
- [ ] **CHK2-F7** [NONE] `Ctrl+Shift+N` in a native window creates the poll in a new native window cascaded 24 px from it.
- [ ] **CHK2-F8** [NONE] Pop out failure (fake scripted error "boom"): the sub-window stays and the toast "Could not open the poll window: boom" shows. Dock failure: toast "Could not dock the poll: boom" in the native window.
  - **Focus after the failure (revision 11, D-002-34).** After each failure, `document.activeElement` is never `BODY`. Run each start path:
    - the pop out button, clicked: focus is on that button. It has `aria-busy="true"` while pending and never the `disabled` attribute;
    - `Ctrl+Shift+O` with focus on the grid's row 3: focus is on the grid with row 3 focused;
    - the sub-window `⋯` menu: focus is on the `⋯` button;
    - the sidebar context menu: focus is on that sidebar row;
    - in the W2, [Dock to workspace]: focus is on that button;
    - in the W2, `Ctrl+Shift+D` from the grid: focus is on the grid.
  - The toast never takes the focus.
- [ ] **CHK2-F9** [NONE] With the Write dialog open in a sub-window, Pop out is unavailable (modal blocks the buttons; `Ctrl+Shift+O` does nothing).
- [ ] **CHK2-F10** [NONE] An alias editor open when Pop out is pressed: a valid text is committed and appears in the native window; an invalid text is reverted.
- [ ] **CHK2-F11** [SIM] Native window title "{poll name} - {profile or Untitled} - {pill label}", "… - Offline" while disconnected; renaming the profile updates it. Its status bar reads "Last OK … · Round trip … · Resp … · Timeouts …" and has no "Tx".
- [ ] **CHK2-F12** [SIM] W1 minimized: native poll windows stay visible, keep updating, and have their own taskbar entries.
- [ ] **CHK2-F13** [NONE] Native window: no Disconnect action; `Ctrl+L` does nothing while connected and connects/reconnects when idle/disconnected; `Ctrl+Shift+M` focuses W1; minimum size 480 x 320; below 640 px wide the setup is a rail (which opens the popover, F14).
  - **Minimum outer size (revision 10, D-002-21) [WIN][HW][DPI].** Drag the W2's right edge and bottom edge inward with a real OS drag, past the minimum. Then read the Win32 window rect (DWM frame included) and the monitor scale. The outer size is exactly the physical minimum ceil(480 s) x ceil(320 s):

    | Scale | Expected outer minimum (physical px) | Logical |
    |---|---|---|
    | 100 % | **480 x 320** | 480 x 320 |
    | 125 % | **600 x 400** | 480 x 320 |
    | 150 % | **720 x 480** | 480 x 320 |
    | 175 % | **840 x 560** | 480 x 320 |

    Revision 11 (D-002-28): the expectation is for a **real user drag** only. A real user drag inward stops at 480 x 320 logical, which is 600 x 400 physical at 125 %. Win32 applies the minimum track size only when the user resizes. A programmatic `SetWindowPos` to a smaller size is not checked: the OS allows it, for any window. The revision 10 clause "after `SetWindowPos` to 1 x 1 the OS keeps the minimum" is removed. Also record the client size and the frame (REPORT-007 at 125 %: outer 600 x 400, client 582 x 353, frame 18 x 47). The client minimum is outer minus frame, with no 1 px loss (REPORT-006 measured 599 x 400 at 125 %, which is defect D3 and fails). Each scale other than the one on QA's machine is a [DPI] run. Mark it "not run [DPI]" when unavailable, never pass.
  - At the minimum width the status line has no clipped control. The REPORT-006 case was client width 466 at 125 %, step 4.
- [ ] **CHK2-F14** [SIM][WIN] (revision 10, D-002-23; REPORT-006 O1) **Native setup below the threshold: rail plus popover.**
  - **Setup:** pop out a polling poll whose setup has an unapplied invalid Quantity "200" (message "Quantity for FC03 must be from 1 to 125.", DES-001 3.2), compact mode off. Set the W2 **PollView width** (the PollView root's `offsetWidth`, equal to the client width in logical px) to each target with `SetWindowPos`. At a fractional scale, adjust by 1 physical px until `offsetWidth` reads the target. If no physical width gives it, record the nearest value on each side and say so.
  - **Widths 466** (the minimum client width at 125 %; at another scale use that scale's minimum and record it), **626** (the default pop out, outer 640 x 368) **and 639:**
    - `data-presentation` = `rail`; the 30 px rail shows the vertical "Setup" label, `chevron-right`, and the unapplied-edits dot;
    - a **rail click** opens the popover: `data-presentation` = `popover`, 360 px wide, left edge at x = 30, top under the status line, no horizontal clipping (its right edge ≤ the client width), scrollable when taller than the window;
    - the popover shows Quantity "200" with its message and `aria-invalid="true"`, and focus is in Quantity (the first invalid field);
    - the rail button has `aria-expanded="true"`;
    - clicking the data card does **not** close it;
    - `Esc` closes it, and focus returns to the rail button (`aria-expanded="false"`); the draft is still there on reopen;
    - [Done] closes it the same way;
    - a second rail click and `Ctrl+\` each toggle it.
  - **Widths 640 and 900:** `data-presentation` = `panel` (340 px). The rail click is not applicable, and `Ctrl+\` toggles the panel. With compact mode on: the rail shows, and a rail click opens the **panel**, not the popover.
  - **Live change:** with the popover open at 639, widen to 640: the panel opens with the same draft and message. Narrow back to 639: the popover is open again. Nothing is lost at any point.
  - **Pop out with the setup open:** dock open in the sub-window, pop out to a W2 of client width 626: the popover is open on arrival.
- [ ] **CHK2-F15** [SIM][WIN] (revision 10, D-002-26; REPORT-006 O2) **Pop out timeline with the real backend (accepted behavior).**
  - Given a polling poll in a sub-window, when the pop out button is clicked with hardware input [HW], measure:
    - (a) the time the button shows its spinner state (`aria-busy="true"` or the spinner icon);
    - (b) the time the sub-window is removed from the W1 DOM;
    - (c) the time the native window is listed by the OS as visible;
    - (d) the time the W2 PollView is ready (`data-ready`) with values.
  - **Expected:**
    - (a) is shown from the click until (b);
    - (d) - click ≤ **1000 ms**;
    - the gap (d) - (b), during which the poll is shown nowhere, is ≤ 1000 ms;
    - the W2 shows live values at once, with no "Waiting for first response…";
    - the sub-window does not reappear in between, and there is no second native window.
  - Repeat 5 times and report all four times for each run. REPORT-006 measured b = 204 ms, c = 679, d = 705.
- [ ] **CHK2-F16** [SIM][WIN] (revision 10, D-002-27; REPORT-006 F8 skipped) **Forced pop out and dock failure, real app.** Runs with the hooks build (`--features dev-hooks`), as in REPORT-007.
  - **Pop out failure:** arm the hook for the next pop out with the message "boom", then click pop out:
    - the sub-window stays where it was, with values, selection, scroll and draft kept;
    - **focus kept (revision 11, D-002-34; REPORT-007 defect D9):** after the toast, `document.activeElement` is the sub-window's pop out button (clicked with the real mouse) and not `BODY`. Repeat with `Ctrl+Shift+O` [HW] and focus on the grid's row 3: focus is on the grid with row 3 focused. A following `Tab` moves to the next control of that sub-window;
    - the pop out button leaves its spinner state;
    - the toast "Could not open the poll window: boom" shows (error, `circle-x`, 4 s);
    - no native window exists (OS window list), even for an instant;
    - the sidebar marker still reads "in workspace"; `mm_export_profile` shows host `workspace`;
    - the poll keeps polling with no gap longer than 2 scan periods (simulator log);
    - the next pop out (hook disarmed) succeeds normally.
  - **Dock failure:** arm the hook for the next dock with "boom", then press [Dock to workspace] in a W2:
    - the W2 stays, with its values and draft;
    - the toast "Could not dock the poll: boom" shows in the W2 (error, 4 s);
    - no sub-window appears in W1, and W1 is not brought to the front;
    - host stays `native`; polling continues;
    - focus kept (revision 11): `document.activeElement` in the W2 is the [Dock to workspace] button, not `BODY`. With `Ctrl+Shift+D` [HW] from the grid, the focus is on the grid.
  - The hook must not exist in a release build: in the release exe, the hook call is rejected or absent, and no pop out or dock fails.
- [ ] **CHK2-F17** [SIM][WIN] (revision 11, D-002-32; REPORT-007 defect D6) **No document scrollbar in a native window, down to the minimum.**
  - **Setup:** one monitor at 125 % (record the scale; at another scale, convert the widths with that scale and record them). Pop out a polling poll (FC03, qty 10, scan 100 ms, setup closed). Its W2 status bar shows the full "Last OK {time} · Round trip {n} ms · Resp {n} · Timeouts {n}" and "ESEfact v{version}". Measure at the W2's default width of 900 the status text's height and the version label's height: each is one line (REPORT-007: 18.8 px and 16 px).
  - **Sweep:** set the W2's **outer** width with `SetWindowPos` (programmatic sizes are fine for this item) from **900 down to 600 physical**: in 10 px steps from 900 to 700, then in 1 px steps from 700 to 600. Run it at outer height **400** (the minimum) and at **640** (the default). At every step, read through CDP:
    - `document.documentElement.scrollHeight == clientHeight` and `scrollWidth == clientWidth`;
    - `window.innerWidth - document.documentElement.clientWidth == 0`, so no classic scrollbar gutter (REPORT-007: 15 px from inner 546 css px down);
    - the PollView root's `offsetWidth` equals `document.documentElement.clientWidth` (REPORT-007: 451 against 466 at the minimum);
    - the status text's and the version label's heights equal their one-line heights from the setup (no wrap);
    - the status bar's height is 28 px.
  - **Cut text:** at every step where the status text is cut (`scrollWidth > clientWidth`), it ends with "…", and its `title` is the complete text. The version label shows "ESEfact v{version}" complete at every step down to 600.
  - **Toolbar and grid (revision 12, D-002-36; DES-002 2.6 "Squeeze at the minimum"; replaces "at least 3 rows").** Condition: connected, polling, no banner, setup closed. REPORT-008 measured 3 toolbar rows and 1 grid row (grid height 65 px) at 600 x 400: that fails.
    - At every sweep step, the W2 toolbar has **at most 2 rows** (count the distinct `offsetTop` values of its direct children, tolerance 4 px).
    - Below about 640 css px of document `clientWidth`, the toolbar buttons are **icon-only**: Pause (or Resume), Write…, Connection window and Dock to workspace show no visible text, and each has `aria-label` and `title` equal to "Pause" (or "Resume"), "Write…", "Connection window" and "Dock to workspace". At 640 css px and wider, they show icon + text. Record the first width where the text goes.
    - The poll state pill and the connection mini-pill keep icon + text at every step. When the poll name is cut, it ends with "…" and its `title` is the complete name.
    - At 600 x 400 the data grid shows **at least 2 complete data rows** (header not counted; a row is complete when its whole box is inside the grid's visible area); 3 if they fit. Record the toolbar height, the grid height and the number of complete rows. The grid scrolls internally to the last address (the mouse wheel and `End` in the grid reach address 9).
    - Hover an icon-only button: the tooltip shows its full name. Tab through the toolbar: the focus order is the same as with labels, and each button has a visible focus ring.
    - If 2 toolbar rows or 2 grid rows are not reached, report the measured heights (acceptance rule as D-002-19: the layout or threshold moves, the rule is not relaxed).
  - **Setup popover at the minimum:** at 600 x 400, open the setup popover with a rail click. The document checks above still pass. The popover scrolls inside itself to its last field.
  - **Other windows:** W1 at its minimum outer size and the launcher at its minimum size pass the same document checks (no scrollbar, one-line status bar in W1).
  - **W1 squeeze check (revision 12, D-002-36):** W1 at its minimum (960 x 600 css inner; at 125 % outer 1218 x 797, client 1200 x 750 physical), connected, Standard 8 polls polling, traffic bar collapsed, P1 maximized in the workspace: the W1 toolbar has at most 2 rows (same counting), its buttons keep their text labels, and P1's grid shows at least 2 complete data rows (3 if they fit). Record the toolbar height, the grid height and the row count.
  - Record a table of outer width, inner css width, client width, PollView `offsetWidth`, `scrollHeight` / `clientHeight`, and the status text height. Attach a screenshot at 600 x 400.
  - **Fails if** any step shows a document scrollbar, a gutter, a wrapped status text or version label, or a cut status text with no complete tooltip; or (revision 12) a toolbar with 3 or more rows, an icon-only button without its full name in `aria-label` and `title`, or fewer than 2 complete grid rows at the W2 or W1 minimum.

## G. Closing
- [ ] **CHK2-G1** [SIM] Close a sub-window (`✕`, `Ctrl+F4`) and a native window (OS close): S6 "Close poll window?" with "Keep "{name}" on this connection, or delete it?", plus "A kept poll keeps polling in the background." when the poll's state is Polling, Timeout, Exception or Bad response (revision 8: by state, not by `active`; G6), plus "Unapplied changes in the poll setup will be lost." with unapplied edits; default focus Keep poll; the dialog is modal in that host.
- [ ] **CHK2-G2** [SIM] Keep poll: the view closes, the marker reads "closed", Last update keeps advancing in the tooltip; Show brings it back with the same display settings and aliases. Delete poll removes it. Cancel keeps it.
- [ ] **CHK2-G3** [NONE] "Don't ask again for this connection window": later closes in both hosts keep without asking; after W1 is closed and reopened, S6 appears again.
- [ ] **CHK2-G4** [SIM] Closing W1 with no unsaved changes, 4 sub-windows and 2 native windows closes all 3 windows at once; the simulator logs the connection closed.
- [ ] **CHK2-G5** [SIM] Closing W1 with the profile modified, 2 native windows, and unapplied edits in "Poll 2" (a sub-window): "Save changes to "{name}" before closing? This also closes 2 poll windows. Unapplied edits in: Poll 2."; Cancel keeps all; Don't save closes all. With 1 native window the text reads "This also closes 1 poll window.".
- [ ] **CHK2-G6** [NONE] (revision 8, D-002-09, O-2) The S6 sentence "A kept poll keeps polling in the background." depends on the poll's state when S6 opens. Open S6 for a sub-window in each case and check the sentence:
  | Connection | Poll state (chip) | `active` | Sentence |
  |---|---|---|---|
  | connected | Polling | true | shown |
  | connected | Waiting… (polling, no data yet) | true | shown |
  | connected | Timeout | true | shown |
  | connected | Exception 02 | true | shown |
  | connected | Bad response | true | shown |
  | connected | Paused (user paused) | false | not shown |
  | connected | Paused ("Start polling when connected" off, run intent on) | true | not shown |
  | idle | Offline | true | not shown |
  | disconnected | Offline | true | not shown |
  The rest of S6 ("Keep "{name}" on this connection, or delete it?", buttons, default focus Keep poll) is the same in every case. Repeat the Paused (`active` true) and Polling rows in a native window.
  **Snapshot while open (revision 9, D-002-18):** the S6 body is computed when the dialog opens and does not change while it is open. Check each, in a sub-window and in a native window:
  - Given poll 1 Polling and S6 open showing "A kept poll keeps polling in the background.", when the fake sets `setPollActive(1, false)` (chip becomes Paused behind the dialog), then the sentence is **still shown**, unchanged, for as long as S6 stays open (wait 2 s and check again).
  - Given poll 1 Paused and S6 open without the sentence, when the poll is resumed from another host (sidebar or the other window), then the sentence is **still absent**.
  - Given poll 1 Polling and S6 open, when the fake drops the link (connection disconnected, poll Offline), then the body is unchanged (sentence still shown) and the dialog stays open.
  - After Cancel, opening S6 again shows the body for the **new** state (for example no keeps-polling sentence after the poll became Paused).
  - Pressing Keep poll after the state changed while open keeps the poll in its **current** state (the sidebar shows Paused and "closed" in the first case).

## H. Arrange popped-out windows, monitors, compact mode
- [ ] **CHK2-H1** [WIN] 4 native windows on a 1920 x 1080 monitor (work area 1920 x 1032): Window > Popped-out windows > Tile gives 960 x 516 windows at (0,0), (960,0), (0,516), (960,516); `Ctrl+Shift+T` in a native window does the same.
- [ ] **CHK2-H2** [WIN] 9 native windows: Tile gives 3 x 3 at 640 x 344. 13: 12 tiled at 480 x 344, toast "1 window did not fit and was cascaded.".
- [ ] **CHK2-H3** [WIN] Side by side with 3: three 640 x 1032 columns. Stacked with 3: three 1920 x 344 rows. Cascade with 3: 24 px steps from the work-area top-left at 900 x 640.
- [ ] **CHK2-H4** [WIN][MON2] Two native windows on monitor 1 and two on monitor 2, "Each monitor (in place)" + Tile: each pair is tiled side by side on its own monitor. "Display 2" + Tile: all four move to monitor 2 in 2 x 2.
- [ ] **CHK2-H5** [WIN][MON2] With "Display 2" chosen, unplug monitor 2, Tile: toast "That display is no longer connected."; the target returns to "Each monitor (in place)".
- [ ] **CHK2-H6** [NONE] With no native windows, the W1 Window menu item "Popped-out windows" is disabled with the title "No poll is open in its own window.". With exactly one native window, Tile from its own menu makes it fill the work area of its monitor. Fake race (the only native window is docked between the menu click and the command): toast "No poll is open in its own window.".
- [ ] **CHK2-H7** [NONE] Compact mode (`Ctrl+Shift+\`, Window menu, native `⋯`): the W1 sidebar becomes a rail with one state icon per poll (tooltip "{name}: {pill label}"); every native setup panel becomes the 30 px rail; every sub-window dock closes. `Ctrl+\` in one sub-window opens only that dock. Toggling compact off restores the previous presentation.
- [ ] **CHK2-H8** [NONE] Compact mode and tile mode survive Save and reopen and do not mark "Modified".
- [ ] **CHK2-H9** [SIM][WIN] (revision 10; REPORT-006 H7/H8 not run, real backend) **Compact and tile mode, real backend.**
  - **Setup:** Standard 8 polls, P1-P5 as sub-windows and P6, P7 as native windows (P8 closed).
  - (a) Press `Ctrl+Shift+\` in W1 with hardware input [HW]:
    - the W1 sidebar becomes the 44 px rail with 8 state icons in list order (tooltip "{name}: {pill label}", e.g. "Poll 6: Exception 02");
    - both native windows show the 30 px setup rail within 500 ms;
    - every sub-window dock closes.
  - (b) `Ctrl+\` in P1's sub-window opens only P1's dock. A rail click in P6 opens P6's panel if its width is ≥ 640, otherwise the popover (F14).
  - (c) `Ctrl+Shift+\` in P7's native window turns compact mode off everywhere, and the previous presentations return.
  - (d) Turn compact on and Window > Tile, then Save as "Compact" and check the title has no " *" (not Modified by these). Close the app gracefully, restart it on the same data dir, and open "Compact":
    - compact mode is on in W1 and both native windows;
    - tile mode is on (check mark, "Tile mode" corner indicator, tiles in list order);
    - the title has no " *".
  - (e) `mm_export_profile` shows `workspace.compact` = true and `workspace.tileMode` = true.

## I. Drag and drop
- [ ] **CHK2-I1** [NONE] Move: pressing a title bar raises the sub-window at once; moving 3 px does nothing; moving 40 px moves the frame live under the pointer; release keeps it there.
- [ ] **CHK2-I2** [NONE] Constraint: dragging far left/up/right/down stops with 80 x 30 px of the title bar still inside the workspace (x = 80 - width at the left limit; y = 0 at the top).
- [ ] **CHK2-I3** [NONE] Esc during a move and during a resize restores the rectangle from before the press and announces "Move cancelled.".
- [ ] **CHK2-I4** [NONE] Resize from each edge and each corner: live size change; the opposite edge stays fixed; the minimum is 320 x 180; announcement "{name} resized to {w} by {h}.".
- [ ] **CHK2-I5** [NONE] (revision 10, D-002-24; REPORT-006 O4) **Edge snap threshold 8 px inclusive, and gap offsets in both directions.**
  - **Setup:** the same as I22. Tile area 1316 x 700 (x 8-1324, y 8-708), free layout, zoom 100 %, only B at (700, 200, 400, 300) and A at (100, 100, 320, 200). Press A's title bar at (260, 115) and move the pointer by (dx, dy). The table gives A's unsnapped x or y, which is the press rectangle plus (dx, dy). Distances are CSS px. At 125 % in integration, set the exact unsnapped values with the keyboard (`Alt+Shift+Arrow`, 1 px) during a keyboard move, with "Snap while moving" on, or with the fake layout.
  - Check the guide during the drag, and A's rectangle after release.

    | Case | Unsnapped A | Nearest candidate (distance) | Guide | A after release |
    |---|---|---|---|---|
    | gap right of B, d 4 | x 1112 | B.right + 8 = 1108 (4) | vertical x = 1108 | (1108, 100, 320, 200) |
    | d 7 | x 1115 | 1108 (7) | x = 1108 | (1108, 100, 320, 200) |
    | **d 8 (inclusive)** | x 1116 | 1108 (8) | x = 1108 | (**1108**, 100, 320, 200) |
    | **d 9** | x 1117 | 1108 (9) | **none** | (**1117**, 100, 320, 200) |
    | d 10 | x 1118 | 1108 (10) | none | (1118, 100, 320, 200) |
    | d 14 | x 1122 | 1108 (14) | none | (1122, 100, 320, 200) |
    | inner offset `left + 8`, d 5 | x 713 | B.left + 8 = 708 (5); B.left 700 (13) | x = 708 | (708, 100, 320, 200) |
    | inner `left + 8`, d 8 | x 716 | 708 (8) | x = 708 | (708, 100, 320, 200) |
    | inner `left + 8`, d 9 | x 717 | 708 (9) | none | (717, 100, 320, 200) |
    | inner offset `right - 8` (A's right edge) | x 775 (A.right 1095) | B.right - 8 = 1092 (3); B.right 1100 (5) | x = 1092 | (772, 100, 320, 200) |
    | inner offset `top + 8` (horizontal) | y 216 | B.top + 8 = 208 (8) | horizontal y = 208 | (100, 208, 320, 200) |
    | inner `top + 8`, d 9 | y 217 | 208 (9) | none | (100, 217, 320, 200) |
    | tile-area left edge, d 8 | x 16 | tile left 8 (8) | x = 8 | (8, 100, 320, 200) |
    | tile-area left edge, d 9 | x 17 | 8 (9) | none | (17, 100, 320, 200) |

  - The guide is a 1 px dashed dark line over the full workspace height (vertical) or width (horizontal). Each release announces "{A's name} moved.".
  - The same threshold applies to resize (moving edges) and to keyboard moves: with "Snap while moving" on, a 1 px keyboard step to a distance of 8 snaps, and to 9 does not.
- [ ] **CHK2-I6** [NONE] Holding Alt during the move disables both snapping and zones; releasing Alt mid-drag re-enables them.
- [ ] **CHK2-I7** [NONE] Snap zones (tile area 1316 x 700): pointer at the left edge shows a preview (accent tint, dashed border) at (8, 8, 654, 700); drop gives that rectangle and announces "{name} moved to the left half."; right edge -> (670, 8, 654, 700); top edge -> full area (state stays normal, the maximize button still shows "Maximize"); top-left corner -> (8, 8, 654, 346); the bottom edge alone shows no zone. (Revision 8, O-4) While a zone preview is shown, no guide line is drawn and the frame does not edge-snap, even when one of its edges is within 8 px of another sub-window's edge. A press that starts inside the 24 px band (sub-window at (8, 8)) shows no zone until the pointer has been outside the band once in that drag.
- [ ] **CHK2-I8** [NONE] Swap: Ctrl-drag A over B's title bar shows "Swap" on B; release exchanges the two rectangles and announces "A swapped with B."; releasing Ctrl before the drop makes it a normal move.
- [ ] **CHK2-I9** [NONE] Maximized drag: dragging the title of a maximized sub-window restores it to its normal size under the pointer.
- [ ] **CHK2-I10** [NONE] Tile mode reorder: tiles [A, B, C, D]; dragging A shows the slot indicator; dropping on slot 3 gives tiles and sidebar order [B, C, A, D] and announces "A moved to slot 3 of 4."; no resize handles in tile mode; Ctrl-drop of A on D swaps their slots.
- [ ] **CHK2-I11** [NONE] Tile mode re-tiling: New poll appends a tile at the end; closing, minimizing or popping out removes its slot; Window > Cascade or unchecking Tile mode ends tile mode with rectangles kept.
- [ ] **CHK2-I12** [NONE] List reorder: dragging row 1 below row 3 shows the 2 px indicator with a circle between rows 3 and 4, gives the new order in the sidebar, Window menu, traffic filter and tile order; announcement "{name} moved to position 3 of 4."; Esc during the drag cancels; the profile does not become "Modified".
- [ ] **CHK2-I13** [NONE] List auto-scroll: with 16 polls in a short sidebar, holding a dragged row near the bottom edge scrolls the list.
- [ ] **CHK2-I14** [NONE] Drag a closed poll's row into the workspace: a preview at 640 x 368 with its title bar centered under the pointer; release shows the sub-window there. Into the right snap zone: right half. In tile mode: inserted at the slot under the pointer.
- [ ] **CHK2-I15** [SIM] Drag a popped-out poll's row into the workspace: the native window closes and the sub-window appears at the drop point with selection and draft kept. With the Write dialog open in that native window: toast "Close the dialog in the "{name}" window first." and nothing moves.
- [ ] **CHK2-I16** [WIN] Pop out by drag: dragging a title bar more than 48 px outside the workspace shows the ghost card and "Release to open in its own window" while the frame returns to its place at 40% opacity; moving back cancels that mode; release outside W1 opens the native window with its title bar under the cursor; the new window does not keep following the pointer (re-grab needed, accepted). Esc in pop-out mode cancels. If the spike disabled this feature, mark "n/a (R1)" and attach the spike note.
- [ ] **CHK2-I17** [WIN][P2] Dock by drag: moving a native poll window over W1's workspace shows the outline with "Release to dock in the workspace" and the placement preview; releasing docks it there; leaving hides the preview; a native window of another connection over this W1 shows nothing.
- [ ] **CHK2-I18** [NONE] Keyboard equivalents with focus in a sub-window grid: `Alt+Right` moves 16 px, `Alt+Shift+Right` 1 px; `Ctrl+Alt+Down` grows the height 16 px (if the graphics driver rotates the screen, use title bar menu > Size and note the driver, R6); `Ctrl+Shift+Right` swaps with the right neighbor; inside an alias editor `Alt+Right` and `Ctrl+Shift+Right` act on the text, not the window.
- [ ] **CHK2-I19** [NONE] Title bar menu (`Shift+F10` on the focused title bar): Move mode (arrows, `Enter` commits, `Esc` cancels), Size mode, Move to ▸ Left half … Full workspace, Own window; in tile mode "Slot 1 … Slot n". Unchecking "Snap while moving" stops keyboard snapping.
- [ ] **CHK2-I20** [NONE] `Alt+Up` / `Alt+Down` on a sidebar row reorder it; on the first row `Alt+Up` does nothing.
- [ ] **CHK2-I21** [NONE] No Alt leak: after an Alt-drag, focus stays in W1 content (not in an OS system menu) (R7). Revision 10: this is the UI-mode check. The authoritative check, with hardware input and explicit expectations, is **CHK2-R7** (D-002-25).
- [ ] **CHK2-I22** [NONE] (revision 8, D-002-10, O-3) Snap tie: touching beats the gap line. Setup: tile area 1316 x 700 (x 8-1324, y 8-708), free layout, zoom 100%, two sub-windows only: B at (700, 200, 400, 300) (B.left = 700, gap line B.left - 8 = 692) and A at (100, 100, 320, 200). Press A's title bar at its center (260, 115) and move the pointer by dx with dy = 0 (the pointer stays far from the 24 px zone band; A's top and bottom are more than 8 px from every horizontal line). Check the frame and the guide during the drag and A's rectangle after release (all values computed by hand):
  | dx | Unsnapped A.x / A.right | Distance to 692 / to 700 | During the drag | A after release |
  |---|---|---|---|---|
  | 260 | 360 / 680 | 12 / 20 | no guide | (360, 100, 320, 200) |
  | 266 | 366 / 686 | 6 / 14 | guide at x = 692 | (372, 100, 320, 200) |
  | 275 | 375 / 695 | 3 / 5 | guide at x = 692 | (372, 100, 320, 200) |
  | 276 | 376 / 696 | **4 / 4 (tie)** | guide at x = **700** | (**380**, 100, 320, 200): A touches B |
  | 277 | 377 / 697 | 5 / 3 | guide at x = 700 | (380, 100, 320, 200) |
  | 284 | 384 / 704 | 12 / 4 | guide at x = 700 | (380, 100, 320, 200) |
  | 276 with Alt held | 376 / 696 | (snapping off) | no guide | (376, 100, 320, 200) |
  Each release announces "{A's name} moved.". The guide is a 1 px dashed dark vertical line over the full workspace height.

## J. Alias
- [ ] **CHK2-J1** [NONE] Double-click an alias cell, type "Tank top", Enter: saved; the next row's editor opens; Esc there leaves it empty; the profile shows "Modified".
- [ ] **CHK2-J2** [NONE] `F2` with grid focus edits the alias of the focused row; `F2` on the title bar renames the poll.
- [ ] **CHK2-J3** [NONE] Validation: 33 characters -> "Alias must be at most 32 characters." (Enter blocked); " a" -> "Alias cannot start or end with a space."; a pasted tab -> "Alias cannot contain control characters."; 32 characters accepted; spaces only removes the alias.
- [ ] **CHK2-J4** [NONE] Aliases follow the address: aliases on 0-2, change Start to 1 and Apply: address 1 and 2 keep their aliases at their new rows; Start back to 0 shows the alias of 0 again.
- [ ] **CHK2-J5** [NONE] Changing FC03 to FC04 keeps the aliases.
- [ ] **CHK2-J6** [NONE] Paste aliases: clipboard "A\nB\n\nC" with row 8 selected in a poll 0-9: 8 = A, 9 = B, toast "Pasted 2 aliases. 2 lines were beyond the poll range."; a line with a control character is skipped and counted in " Skipped {m} invalid lines.".
- [ ] **CHK2-J7** [NONE] Clear alias on 3 selected rows removes all three.
- [ ] **CHK2-J8** [NONE] "Alias column" off hides the column in that poll only (both hosts); it is saved with the profile and marks it Modified.
- [ ] **CHK2-J9** [NONE] Duplicate aliases in one poll are allowed (no message).
- [ ] **CHK2-J10** [NONE] Aliases survive pop out and dock, and a profile round trip (N1).

## K. Traffic and counters
- [ ] **CHK2-K1** [SIM] Traffic bar collapsed shows "Requests … · Responses … · Errors … · Timeouts … · link load {p}%"; `Ctrl+J` expands the panel; expanded state survives Save and reopen without "Modified".
- [ ] **CHK2-K2** [SIM] Filter "Poll 3" shows only P3 frames; header counters equal P3's counters and P3's status line `Tx`.
- [ ] **CHK2-K3** [SIM] "Writes" shows only writes; "All polls" shows totals; total Requests = sum of per-poll Requests + write Requests.
- [ ] **CHK2-K4** [NONE] A filter without frames: "No frames for Poll 8 yet.".
- [ ] **CHK2-K5** [SIM] (revision 11, D-002-33) "Show traffic for this poll" from a sub-window expands the panel with that filter, and the focus stays where it was. From a native window:
  - W1 is restored if it was minimized, and brought to the front as the foreground window (also when it was only behind the native window);
  - the traffic panel is expanded, and the filter is set to that poll;
  - the keyboard focus is on the panel's Filter select in W1;
  - the native window stays open and keeps updating.
  - With a modal dialog open in W1, W1 still comes to the front and the dialog keeps the focus. After the dialog is closed, the panel is expanded with the filter set.
  - **Harness rule (revision 12, D-002-39):** in an automated run, disable Playwright's focus emulation on every page involved (W1 and the native window) before the test, with the CDP command `Emulation.setFocusEmulationEnabled` and `enabled: false`. Under `connectOverCDP` with the emulation on, `document.hasFocus()` is always true, so the app cannot tell that the request came from another window and the Filter select is not focused (REPORT-008: 0/10 with the emulation on, 10/10 with it off). A run with the emulation on is invalid, not failed. Record in the REPORT that it was off.
- [ ] **CHK2-K6** [SIM] Deleting the filtered poll switches the filter to "All polls". Filter entries follow the list order after a reorder.
- [ ] **CHK2-K7** [FAULT] Per-poll counter semantics (CHK-001 N7): P7 with 3 drops gives Timeouts 3 and status line `Err 3`; P6 exceptions count in Responses and Errors.
- [ ] **CHK2-K8** [SIM][WIN] (revision 10; REPORT-006 K4-K6 not run, real backend) **Traffic filter with the real backend.**
  - (a) K4: Standard 8 polls with P8 paused **before** Connect (so it never sends). Filter "Poll 8": the panel shows "No frames for Poll 8 yet." and the header counters read Requests 0 · Responses 0 · Errors 0 · Timeouts 0. Resume P8: within 1.5 s its first frames appear, and the empty text is gone.
  - (b) K5: from P3's sub-window `⋯` > "Show traffic for this poll", the panel expands with filter "Poll 3", and every listed frame's Poll column reads "Poll 3". Revision 11 (D-002-33; REPORT-007 defect D7): from P2 popped out, run the menu entry in two cases:
    - **W1 minimized:** within 1 s, W1 is restored (Win32 `IsIconic` false) and is the foreground window (`GetForegroundWindow` is W1). The panel is expanded, the filter reads "Poll 2" (checked), and `document.activeElement` in W1 is the Filter select;
    - **W1 behind the native window** (not minimized, the native window overlapping it in front): within 1 s, W1 is the foreground window and above the native window in the z-order, with the same panel, filter and focus checks.
    - In both cases the native window stays open and its values keep updating.
    - Harness: Playwright focus emulation off on both pages (`Emulation.setFocusEmulationEnabled` `enabled: false`), as in K5 (revision 12, D-002-39). Run each case 5 times (REPORT-008: 5/5 and 5/5).
    - The bytes of the last 20 frames equal the simulator log lines for P2's start address.
  - (c) K6: with filter "Poll 5", delete P5 (S7, Delete): the filter switches to "All polls" and the header shows the totals. Reorder the list (drag P1 below P3) and the filter entries follow the new list order.
  - No frame is lost or duplicated by the filter changes: the total Requests equals the simulator's request count.

## N. Profiles v2 and migration
- [ ] **CHK2-N1** [SIM] Round trip: Standard 8 polls; list order changed; P1 Hex, P3 1-based; aliases on P1 (0-2) and P3 (0); 4 sub-windows at moved positions (one minimized, one maximized, z-order noted); tile mode off; 2 native windows at moved positions; P8 closed; compact on; traffic expanded. Save, close, reopen the app, open the profile: list order, names, definitions, display, aliases, rectangles, states, z-order, minimized bar order, hosts, native placements, closed state, compact and traffic return exactly; state idle. Revision 10 (D-002-26, O6): placements are stored in whole logical px. At a fractional scale (125 %, 150 %, 175 %) a native window or W1 may reopen up to **1 logical px** away per axis per save/restore cycle (REPORT-006: physical y 111 -> 110 at 125 %). That is a pass; record the deltas. At 100 % (and 200 %) positions and sizes must be exact. Sub-window rectangles (CSS px) are always exact.
- [ ] **CHK2-N2** [NONE] Not Modified by: moving, resizing, snapping, swapping, tiling, cascading, minimizing, maximizing, list reorder, pop out, dock, close (keep), compact, traffic expand, Pause/Resume, filter. Modified by: rename, Apply, format change, alias commit, alias column toggle, "Include alias in copy", scale change, New poll, Delete.
- [ ] **CHK2-N3** [NONE] Schema-1 profile: one sub-window "Poll 1" at (8, 8) with the old definition and display, empty aliases, notice "This profile was saved by an earlier version. Its poll is now "Poll 1". Saving stores it in the new format, which earlier versions cannot open." [Dismiss]; no "Modified".
- [ ] **CHK2-N4** [NONE] After N3 and Save, the file has `schemaVersion` 2 with `workspace`, `view` and `aliases`; the schema-1 file is unchanged before Save.
- [ ] **CHK2-N5** [NONE] "Cannot be opened (newer or damaged file)" for: schemaVersion 3; schema 2 with 17 polls; a poll with 2001 aliases; a duplicate alias address; a `minimizedOrder` index out of range.
- [ ] **CHK2-N6** [SIM] Loading while connected asks "Disconnect and load?"; after confirming, all sub-windows and native windows close without S6, then the profile's hosts open.
- [ ] **CHK2-N7** [NONE] A profile whose sub-window rectangles exceed a smaller W1 restores them clamped (80 x 30 px of the title bar visible); a native placement on a missing monitor cascades on W1's monitor.
- [ ] **CHK2-N8** [NONE] `Ctrl+S` in a native window saves the whole profile (no dialog when named); untitled: W1 comes to the front with Save as.
- [ ] **CHK2-N9** [NONE] (revision 8, O-5) Given a named profile and sub-windows A and B with B in front, when A is raised by a pointer press on its body (no move), then the fake records **no** `mm_set_workspace_layout` for that press, and A is drawn in front. When a layout action follows (for example B is minimized), the one reported layout has A above B. Separately: raise A by a press, then press `Ctrl+S` with no other action: the fake records a `mm_set_workspace_layout` with A above B **before** the save command, and reopening the profile shows A in front. The profile is not marked "Modified" by the raise.
- [ ] **CHK2-N10** [NONE] (revision 10, D-002-26; REPORT-006 O7) **"Save changes?" wording in the load flow.**
  - All cases run with the connection idle. When connected, "Disconnect and load?" (N6) comes first, and the same texts follow it.
  - Given an **untitled** W1 that is Modified (a poll added), with 1 popped-out window and unapplied edits in "Poll 2", when File > Open profile… opens a profile, then "Save changes?" reads exactly "Save this setup as a profile before loading? This also closes 1 poll window. Unapplied edits in: Poll 2." with Save (default focus), Don't save and Cancel.
  - Given a **named** profile "Plant" that is Modified, with no native window and no unapplied edits, the text is exactly "Save changes to "Plant" before loading?".
  - Neither text contains the word "closing".
  - Cancel keeps the current setup (nothing loads, the windows stay open).
  - Don't save loads the chosen profile and closes the native window without S6.
  - The close-window variant (G5) still says "before closing".

## P. Invalid input
- [ ] **CHK2-P1** [NONE] Poll name messages (B4) and alias messages (J3) exactly; poll definition fields give the CHK-001 J8-J16 messages in both the dock/popover and the native panel.
- [ ] **CHK2-P2** [NONE] Save blocked: invalid connection field, `Ctrl+S` from a native window brings W1 to the front with "Fix the highlighted fields before saving.".
- [ ] **CHK2-P3** [SIM][WIN] (revision 10; REPORT-006 P1/P2 not run, real backend)
  - (a) P1 with the real backend. In a sub-window dock, a sub-window popover (frame 600) and a native panel (and the native popover at client width 626, F14), enter each value and check the exact message under the field, with `aria-invalid="true"`:
    - Name: empty, 49 characters, " a", a duplicate "poll 2" (B4 messages);
    - Slave ID: 248 ("Slave ID must be a whole number from 0 to 247.");
    - Quantity: 0 and 126 for FC03, and 2001 for FC01 ("Quantity for FC01 must be from 1 to 2000.");
    - Start + Quantity beyond 65535: start 65535 with qty 2. Start 65535 with qty 1 is valid;
    - Scan rate: 19 and 60001 ("Scan rate must be a whole number from 20 to 60000 ms."; other texts as CHK-001 J8-J16);
    - alias: 33 characters and a tab (J3).

    In each case [Apply] sends nothing: the simulator log shows no request with the invalid definition, and the poll keeps its previous definition and keeps polling. The edge values are accepted and applied with a real request: start 0 qty 1, qty 125, scan 20, scan 60000, slave 247.
  - (b) P2 with the real backend. With an invalid connection field (port 0) in W1, press `Ctrl+S` in a native window with hardware input [HW]. W1 comes to the front (restored if minimized) with the error toast "Fix the highlighted fields before saving." (`circle-x`, 4 s), and the Port field shows "Port must be a whole number from 1 to 65535.". No profile file is written or changed (the data dir file timestamps are unchanged).

## Q. Performance
**Measurement note (revision 8, D-002-15).** The criterion "0 long tasks over 50 ms" in Q1-Q3 is evaluated on a **quiet machine**: no Vitest, build, other browser test or other heavy process running alongside; the REPORT states that it was quiet. In the browser smoke, if a run on a shared CPU shows **one isolated** long task of 50-52 ms, record it as an observation (value, time, what was running) and not as a failure; two or more long tasks in a run, or any task over 52 ms, is a failure. **Q4 (WebView2) is the authoritative run** and applies "0 long tasks over 50 ms" strictly.
- [ ] **CHK2-Q1** [SIM] Standard 8 polls at 100 ms, all 8 as tiled sub-windows in one W1, 60 s browser smoke: 0 long tasks over 50 ms; Pause of one poll reaches "Paused" within 100 ms.
- [ ] **CHK2-Q2** [SIM] Same, with 4 sub-windows and 4 native windows: 0 long tasks over 50 ms in every window.
- [ ] **CHK2-Q3** [SIM] Drag while polling: 8 sub-windows polling at 100 ms; one sub-window dragged and resized continuously for 30 s (scripted): 0 long tasks over 50 ms; the other 7 tables keep updating; render-count probe shows no extra renders of the other tables caused by the drag.
- [ ] **CHK2-Q4** [SIM][WIN] Q1-Q3 on WebView2 in integration mode, recorded separately, on a quiet machine. This run is authoritative for the long-task criterion (no observation allowance).
- [ ] **CHK2-Q5** [SIM] 10 minutes of 8 polls at 100 ms with 5 pop out / dock cycles: memory flat within 10% after the traffic buffer is full; no leaked view channels (fake/dev counter of attached views equals the number of shown polls).

## R. Accessibility
- [ ] **CHK2-R1** [NONE] (revision 8, rewritten; D-002-08, closes Q-FE2-16) W1 focus order: toolbar, banner, sidebar (connection, list), workspace, minimized bar, traffic. Inside the workspace, Tab follows **ascending poll id** (DOM order), not z-order and not list order. Given P1, P2, P3 created in that order (ascending poll ids), all as normal sub-windows, the list reordered to [P3, P1, P2], and the z-order P3 (front) > P2 > P1, setup closed:
  - Tab from the last focusable element before the workspace (the sidebar's last stop) reaches P1's title bar first, then P1's status line controls and P1's grid; the next Tab after P1's grid reaches P2's title bar; after P2's grid, P3's title bar; after P3's grid, the minimized bar (when shown) or the traffic bar.
  - `Shift+Tab` goes back through the same stops in reverse.
  - Raising P1 (pointer press on its body), or activating it by `Ctrl+F6` or the sidebar, does not change this order, and the element that had the focus keeps it after the raise.
  - With P1's setup dock open, its dock fields come after its status line controls and before its grid.
  - A minimized sub-window has no stop in the workspace; it is reached through its minimized bar pill.
  - `F6` / `Shift+F6` cycle the regions toolbar, sidebar, workspace (focus goes to the active sub-window), minimized bar, traffic.
- [ ] **CHK2-R2** [NONE] Sub-window accessible name "{name}, {pill label}, sub-window" and `aria-current="true"` on the active one; sidebar options "{name}, {full pill label}, {marker or 'in workspace'}".
- [ ] **CHK2-R3** [NONE] Every drag action has a keyboard path (I18-I20) and its announcement from DES-002 2.10.8 fires once.
- [ ] **CHK2-R4** [NONE] Grayscale screenshot: every poll state, connection state, host marker and the active sub-window are distinguishable by icon, text or border width.
- [ ] **CHK2-R5** [NONE] Dark text on the warning-filled status line (5.2:1) and light text on the active title bar (11.6:1); no red or orange text on light surfaces.
- [ ] **CHK2-R7** [SIM][WIN][HW] (revision 10, D-002-25; REPORT-006 defect D2) **A lone Alt never activates the OS window menu.** Use hardware input only (`SendInput` or a real keyboard and mouse). Setup: P1 polling in a W1 sub-window, P2 polling in a native window, and the simulator log open.
  - (a) **Lone Alt in W1:** W1 in the foreground, focus in P1's data grid (row 3 focused). Press and release Alt alone, wait 500 ms, then press `Ctrl+P`. Within 500 ms:
    - P1's chip reads "Paused" and the simulator log shows no further request for P1's range;
    - the page answers: a CDP `evaluate` returns within 1 s, or the dev overlay updates;
    - focus is still on P1's grid with row 3 focused (focus ring visible);
    - no OS window menu is open, and no title-bar or menu highlight is drawn (the `winhelper` OS-menu detection reports none).

    Press `Ctrl+P` again: P1 resumes.
  - (b) **After an Alt-drag:** hold Alt, drag P1's title bar 100 px with the mouse (no snapping, as I6), release the mouse, then release Alt. Then `Ctrl+P` pauses P1 within 500 ms, with the same checks as (a). Repeat with Alt released **before** the mouse button.
  - (c) **Twice:** two lone Alt taps in a row, then `Ctrl+P`: it acts. A lone Alt must not toggle any state that a second tap undoes.
  - (d) **Native window:** the same as (a) in P2's native window, with focus in its grid. `Ctrl+P` pauses P2.
  - (e) **Launcher:** a lone Alt in the launcher, then `Tab`: focus moves to the same next element as it does without the Alt tap, and no OS menu opens.
  - (f) **Alt combos unaffected:** `Alt+Right` with focus in P1's grid moves P1 16 px (I18). `Alt+Space` opens the OS window menu (OS behavior kept). Revision 11 (D-002-29): press `Esc` **twice**, 300 ms apart. The first `Esc` closes the menu popup (no `#32768` window remains), and the page may still be in menu mode; that is Windows behavior and not a failure. After the second `Esc`: menu mode has ended (`GetGUIThreadInfo` not in menu mode), the page answers (CDP `evaluate` within 1 s), focus is still on P1's grid, and `Ctrl+P` pauses P1 within 500 ms. **Fails if** the page does not answer after the second `Esc`.
  - (g) **Alt+F4 still closes through the confirm flow:**
    - in W1 with unsaved changes, "Save changes?" opens (G5 text), and Cancel keeps everything;
    - in W1 with no unsaved changes, W1 and its native windows close;
    - in P2's native window, S6 "Close poll window?" opens with default focus Keep poll, and Cancel keeps the window.
  - Run (a)-(g) in the debug exe and in a release (non-debug) build. Both must pass.
**Keyboard layouts (revision 11, D-002-31; REPORT-007 defect D8; DES-002 3.1).** Setup for R8 to R11: the real app, the Standard 8 polls connected, P1 to P5 as sub-windows, P2 popped out to a native window, a named profile "Plant" saved (not Modified), and the simulator log open. Each check uses hardware input [HW] with scan codes (`SendInput` or a real keyboard), sent only while the target window is in the foreground. Switch the layout of the tested window only, and restore US English at the end. Record the layout, its KLID, and the `key` / `code` pair the page receives for `Ctrl+P` (REPORT-007: `key` "ย", `code` "KeyP").
- [ ] **CHK2-R8** [SIM][WIN][HW][LAYOUT] **Thai layout (Kedmanee).** With the Thai layout active, each shortcut acts as with US English:
  - `Ctrl+P` with focus in P1's grid: P1 shows "Paused" within 500 ms, and the simulator log shows no further request for P1's range. A second `Ctrl+P` resumes it;
  - `Ctrl+E` with focus in P1's grid (connected): the dialog "Write · Poll 1" opens, prefilled from the focused row. `Esc` closes it;
  - `Ctrl+J` in W1: the traffic panel expands. Press it again: the panel collapses;
  - `Ctrl+S` in W1 after renaming P4 (profile Modified, " *" in the title): the profile is saved with no dialog, the " *" disappears, and the profile file's timestamp changes;
  - `F6` in W1: the focus moves to the next region (toolbar, sidebar, workspace, minimized bar, traffic), as with US English;
  - `Ctrl+Shift+N` in W1: a new poll appears in the workspace. In P2's native window: a new poll opens in a new native window (F7). Delete both afterwards;
  - `Ctrl+Shift+O` with focus in P1's grid: P1 pops out to a native window. `Ctrl+Shift+D` in that native window docks it back;
  - also spot-check `Ctrl+L` (does nothing while connected in a native window), `Ctrl+Shift+P` (pause all, then resume all) and `Ctrl+1` / `Ctrl+3` in P1's grid (format Unsigned / Hex).
  - **Backslash shortcuts (revision 12, D-002-38; REPORT-008 defect D8b).** Record the `key` / `code` pair received (REPORT-008: `Ctrl+\` gives `key` "+", `code` "Backslash"; `Ctrl+Shift+\` gives `key` "ฅ", `code` "Backslash"):
    - `Ctrl+\` (the physical Backslash key) with focus in W1's sidebar list: the sidebar collapses to the rail; again: it expands;
    - `Ctrl+\` with focus in P1's grid: P1's setup toggles (opens, then closes);
    - `Ctrl+\` in P2's native window: its setup panel (or the rail popover below 640 css px) toggles;
    - `Ctrl+Shift+\` in W1 and in P2's native window: compact mode turns on; again: off.
  - Typing in a text field still types Thai: in P1's setup Name field, the key at the US P position types "ย", and no shortcut fires while typing without Ctrl.
  - **Fails if** any listed shortcut does nothing, or does something different from US English.
**Revision 12 (D-002-40):** the QA dev machine has only US English and Thai Kedmanee installed. Cyrillic (Russian), French AZERTY, US Dvorak and German QWERTZ are **not installed** there, so R9, R10 and the German part of R11 are run by the owner as **CHK2-M11**. QA marks them "owner manual" (not pass, not fail, not skipped) unless the PM installs the layouts on the QA machine.
- [ ] **CHK2-R9** [SIM][WIN][HW][LAYOUT][OWNER on the QA dev machine, M11] **Cyrillic layout (Russian ЙЦУКЕН).** The same steps and expectations as R8 with the Russian layout active (`Ctrl+P` gives `key` "з", `code` "KeyP"). Also run `Ctrl+P` and `Ctrl+Shift+D` in P2's native window. Backslash (revision 12): `Ctrl+\` (`key` "\", `code` "Backslash") toggles the setup and `Ctrl+Shift+\` (`key` "/", `code` "Backslash") toggles compact mode, as in R8.
- [ ] **CHK2-R10** [SIM][WIN][HW][LAYOUT][OWNER on the QA dev machine, M11] **Latin layouts that move keys: French AZERTY and US Dvorak.**
  - **AZERTY, backslash (revision 12, D-002-38):** `Ctrl` + the physical Backslash key (types "*") toggles P1's setup. `AltGr+8` types "\" in P1's Name field and toggles nothing.
  - **AZERTY, digit row:** with focus in P1's grid, press `Ctrl` plus the physical digit-row keys 1 to 4 (they type "&", "é", """ and "'" without Shift). The format becomes Unsigned, Signed, Hex and Binary in turn. For each, the raw column of HR0 = 1234 shows the same text as `Ctrl+1` to `Ctrl+4` with US English (record the four texts). `Ctrl` with the numeric keypad's 1 to 4 (Num Lock on) does the same.
  - **AZERTY, letters:** `Ctrl+A` is the key labelled A on AZERTY (physical `KeyQ`) and selects all rows in the grid. `Ctrl+P` (same position as US) pauses P1.
  - **Dvorak** (run in P2's native window, where `Ctrl+L` does nothing while connected): `Ctrl+P` is the key labelled P on Dvorak (physical `KeyR`) and pauses P2. The physical `KeyP` (which types "l" on Dvorak) with Ctrl does **not** pause P2: it acts as `Ctrl+L`, so nothing happens and the connection stays connected. `Ctrl` with the physical `KeyE` (which types "." on Dvorak) does **not** open the Write dialog. `Ctrl+E` is the key labelled E on Dvorak (physical `KeyD`) and opens it.
- [ ] **CHK2-R11** [SIM][WIN][HW][LAYOUT] **AltGr and native text-field keys (German QWERTZ, then Thai).** Revision 12 (D-002-40): the German part is owner manual on the QA dev machine (M11); QA runs the Thai part.
  - **German backslash (revision 12, D-002-38):** `AltGr+ß` types "\" in P1's Name field and does **not** toggle the setup or compact mode. With focus in P1's grid, a lone `Ctrl` + the physical Backslash key (types "#") **does** toggle P1's setup.
  - German: in P1's setup Name field, `AltGr+Q` types "@" and `AltGr+E` types "€". In an alias editor of P1 and in the Quantity field (which rejects the text), the same keys type the characters. No shortcut fires: P1 is not paused, no Write dialog opens, and the traffic panel does not toggle. With focus in P1's grid, `AltGr+P` (Ctrl+Alt+P) does not pause P1.
  - `Ctrl+Alt+Down` with focus in P1's grid still grows P1's height by 16 px (I18). It is not a letter shortcut.
  - In the Name field, with the German layout and then with the Thai layout: type "Tank", then `Ctrl+A` selects the whole text, `Ctrl+C` then `Ctrl+V` at the end gives "TankTank", `Ctrl+X` cuts the selection, and `Ctrl+Z` undoes the last edit. These are the browser's native editing keys: none of them pauses a poll, copies grid rows, or pastes aliases.
  - With focus in P1's grid and the Thai layout: `Ctrl+C` copies the selected rows (the clipboard holds the DES-003 3.4 text) and `Ctrl+V` pastes aliases (J6), as with US English.
- [ ] **CHK2-R12** [NONE] (revision 11, D-002-31) **Matching vectors in UI mode.** Dispatch synthetic `keydown` events with these `key` / `code` / modifier values to P1's grid (the fake backend), and check the result:

  | `key` | `code` | Modifiers | Expected |
  |---|---|---|---|
  | "p" | KeyP | Ctrl | P1 paused |
  | "ย" (Thai) | KeyP | Ctrl | P1 paused |
  | "з" (Russian) | KeyP | Ctrl | P1 paused |
  | "π" (Greek) | KeyP | Ctrl | P1 paused |
  | "פ" (Hebrew) | KeyP | Ctrl | P1 paused |
  | "ح" (Arabic) | KeyP | Ctrl | P1 paused |
  | "l" (Dvorak) | KeyP | Ctrl | handled as `Ctrl+L`, not `Ctrl+P`: P1 is not paused (in W1 the fake records a disconnect; reconnect before the next row) |
  | "p" (Dvorak) | KeyR | Ctrl | P1 paused |
  | "." (Dvorak) | KeyE | Ctrl | nothing (no Write dialog) |
  | "&" (AZERTY) | Digit1 | Ctrl | format Unsigned |
  | "'" (AZERTY) | Digit4 | Ctrl | format Binary |
  | "3" | Numpad3 | Ctrl | format Hex |
  | "p" | KeyP | Ctrl, Alt (AltGr) | nothing |
  | "p" | KeyP | Ctrl, `AltGraph` modifier state | nothing |
  | "Process" | KeyP | Ctrl | nothing (IME) |
  | "ฯ" (a Thai letter) | KeyN | Ctrl, Shift | new poll created |
  | "์" (a Thai combining mark, U+0E4C) | KeyN | Ctrl, Shift | new poll created |
  | "ü" (German) | BracketLeft | Ctrl | nothing |
  | "F6" | F6 | none | next region |
  | "\" (US) | Backslash | Ctrl | setup toggles |
  | "\|" (US) | Backslash | Ctrl, Shift | compact mode |
  | "+" (Thai with Ctrl, REPORT-008 hardware) | Backslash | Ctrl | setup toggles |
  | "ฅ" (Thai) | Backslash | Ctrl, Shift | compact mode |
  | "ฃ" (Thai, unshifted character) | Backslash | Ctrl | setup toggles |
  | "#" (German, lone Ctrl on the physical Backslash key) | Backslash | Ctrl | setup toggles |
  | "'" (German, with Shift) | Backslash | Ctrl, Shift | compact mode |
  | "\" (German AltGr+ß) | Minus | Ctrl, Alt (AltGr) | nothing |
  | "\" (German AltGr+ß) | Minus | Ctrl, `AltGraph` modifier state | nothing |
  | "*" (AZERTY) | Backslash | Ctrl | setup toggles |
  | "µ" (AZERTY, with Shift) | Backslash | Ctrl, Shift | compact mode |
  | "\" (AZERTY AltGr+8) | Digit8 | Ctrl, Alt (AltGr) | nothing (and not format, digit rule: AltGr excluded) |
  | "\" (Russian) | Backslash | Ctrl | setup toggles |
  | "/" (Russian, with Shift) | Backslash | Ctrl, Shift | compact mode |
  | "\" (UK, the layout's own backslash key) | IntlBackslash | Ctrl | setup toggles |
  | "\" | Backslash | Ctrl, Alt (AltGr) | nothing |
  | "\" | Backslash | none | nothing (no Ctrl) |
  | "Process" | Backslash | Ctrl | nothing (IME) |

  The rows from "\" (US) down are the revision 12 backslash vectors (D-002-38). "Setup toggles" means P1's setup opens (it was closed before the row); "compact mode" means compact mode turns on (it was off). Reset the state between rows. For the backslash rows also dispatch the same events with focus in W1's sidebar list (`Ctrl+\` collapses the sidebar instead of toggling P1's setup) and in a W2 host (its setup panel toggles).

  In P1's setup Name field, `Ctrl+A`, `Ctrl+C`, `Ctrl+V`, `Ctrl+X` and `Ctrl+Z` events with `key` "ฟ" / `code` KeyA and so on are **not** `defaultPrevented` by the app.
- [ ] **CHK2-R6** [NONE] (revision 8, DES-002 2.3.1 and 9) Given the R1 setup with P3 overlapping P2 and focus in P1's grid, when Tab moves the focus into P2's title bar, then P2 becomes the active sub-window (dark title bar, `aria-current="true"`, sidebar selection on P2) and is drawn above P3, so the focused control is not covered. No `mm_set_workspace_layout` is sent for this (N9). The focus stays on P2's title bar (not moved to its grid).

## S. Scale factors and second monitor (revision 10, D-002-27)
REPORT-006 ran on one monitor at 125 % only. These items repeat the geometry checks at the other scales and with two monitors. Every item records:
- the scale(s) and the monitor layout;
- the work area in physical and logical px;
- the measured native frame (outer minus client).

Expected rectangles come from the independent DES-002 2.8 oracle on the **measured** logical work area, converted with each monitor's scale. Physical results may differ by at most 1 physical px from rounding. An item that cannot run on the available hardware is "not run [DPI]" or "not run [MON2]".
- [ ] **CHK2-S1** [SIM][WIN][DPI] **100 % Arrange vectors.** One 1920 x 1080 monitor at 100 % with a 48 px bottom taskbar (work area 1920 x 1032).
  - H1: 4 windows tile to (0,0,960,516), (960,0,960,516), (0,516,960,516), (960,516,960,516) in physical px, which equal the logical values.
  - H2: 9 windows tile 3 x 3 at 640 x 344 (vector NT-2, which could not occur at 125 %). 13 windows give 12 tiled at 480 x 344 and 1 cascaded, with the toast "1 window did not fit and was cascaded.".
  - H3: Side by side 3 gives 640 x 1032 columns; Stacked 3 gives 1920 x 344 rows; Cascade 3 gives 24 px steps at 900 x 640.
  - All of these are outer rectangles.
- [ ] **CHK2-S2** [SIM][WIN][DPI] **150 % Arrange.** One 1920 x 1080 monitor at 150 %. Compute the oracle on the measured logical work area. Example: for a work area of 1280 x 672 logical, maxCols = 2 and maxRows = 2, so 9 windows give 4 tiled at 640 x 336 and 5 cascaded, with the toast "5 windows did not fit and were cascaded.".
  - Every outer rectangle equals the oracle × 1.5, within 1 physical px.
  - No window extends beyond the work area, and tiles do not overlap.
  - The minimum outer size at 150 % is 720 x 480 physical (F13).
- [ ] **CHK2-S3** [SIM][WIN][DPI] **Pop out geometry at 100 % and 150 %.** A sub-window at its default 640 x 368, popped out with the button:
  - the W2 outer size is 640 x 368 physical at 100 %, and 960 x 552 physical at 150 %;
  - the W2's top-left is at the sub-window's screen position, within 1 physical px;
  - its client PollView width is about 624 at 100 % and about 626 at 125 % (record it), so the setup is the rail with popover (F14);
  - a default new native window (`Ctrl+Shift+N` in a W2) is 900 x 640 logical outer: 900 x 640 physical at 100 %, 1350 x 960 at 150 %.
- [ ] **CHK2-S4** [NONE][WIN][DPI] **Status line and setup threshold at 100 % and 150 %.**
  - Repeat at each scale: E12 (frames 640 and 639, active and inactive), the E20-E25 boundary frames, the E26 reference frames 640 / 600 / 560 / 430, and F14 (native widths 639 and 640 and the minimum).
  - At each frame, `data-step` follows the measured L, the dock/popover follows the frame's `offsetWidth`, and the fit check passes.
  - At 150 % exact frames need the keyboard (`Ctrl+Alt+Shift+Arrow`, 1 px), as at 125 %.
- [ ] **CHK2-S5** [SIM][WIN][MON2][DPI] **Mixed DPI: moving a native window between monitors.** Monitor 1 at 100 %, monitor 2 at 150 % (either side). W1 is on monitor 1.
  - Pop out P1 and drag its W2 by the OS title bar, with hardware input [HW], fully onto monitor 2. Then:
    - its logical outer size is unchanged within 1 px (640 x 368 logical = 960 x 552 physical on monitor 2);
    - its minimum on monitor 2 is 720 x 480 physical (F13);
    - the status line steps and the setup presentation follow the measured widths;
    - values keep updating.
  - Dock, then pop out again: the W2 reopens on monitor 2 at its saved placement, logical rectangle within 1 px (N1 precision).
  - Save the profile, restart the app, and open the profile: P1's W2 opens on monitor 2 at the same logical rectangle within 1 px.
- [ ] **CHK2-S6** [SIM][WIN][MON2][DPI] **Pop out anchor on the other monitor.** W1 spans both monitors (mixed DPI), with sub-window P1 placed so its top-left lies on monitor 2. Pop out with the button:
  - the W2 opens on **monitor 2** (the monitor holding the anchor point), at P1's screen position;
  - it has P1's logical size (at least 480 x 320) at monitor 2's scale;
  - it lies entirely inside monitor 2's work area, clamped if needed.
- [ ] **CHK2-S7** [NONE][WIN][MON2] **W1 clamp on a second, smaller monitor.** Monitor 2 with a small work area (for example 1366 x 768 at 100 %, work area 1366 x 728). Open Modbus Master from a launcher placed on monitor 2. The default W1 opens on monitor 2 and its outer rectangle fits monitor 2's work area entirely (A7 rule): outer height ≤ 728 and width 1280 + frame. With the launcher on monitor 1, `Ctrl+N` from a W1 on monitor 2 also fits monitor 2.
- [ ] **CHK2-S8** [SIM][WIN][MON2][DPI] **Arrange "Each monitor (in place)" with mixed DPI.** Two native windows on monitor 1 (100 %) and two on monitor 2 (150 %), then Tile. Each pair fills its own monitor's work area side by side, each according to the oracle in that monitor's logical px. On monitor 2 the physical rectangles are the logical ones × 1.5, within 1 physical px. "Display 2" + Tile moves all four to monitor 2 in 2 x 2 (H4 at mixed DPI).

## M. Owner manual tests (revision 11, D-002-35; REPORT-007 section 8)
QA could not run these on its machine (one monitor at 125 %, no second monitor, no RTU device, no NVDA, synthetic keyboard). The owner runs them on his own hardware with a **release** build (`pnpm --filter @esefact/desktop tauri build --no-bundle`), or the build named by the PM. Before each test, start the dev simulator at `127.0.0.1:5020` as in the Reference setup. For each item, tick the box and write the date, the machine, the scale and monitor layout, and pass or fail with a short note. A screenshot helps for any failure.

**Keyboard layouts on the QA dev machine (revision 12, D-002-40; REPORT-008):** only US English (`00000409`) and Thai Kedmanee (`0000041E`) are installed. **Cyrillic (Russian), French AZERTY, US Dvorak and German QWERTZ are NOT installed**, so every case that needs them is an owner manual test: CHK2-R9, CHK2-R10, the German part of CHK2-R11, step 1 of CHK2-M5 (German AltGr), and the German / AZERTY / Cyrillic backslash cases. They are collected in **CHK2-M11**.

**How to read a window's outer size in physical px:** use a window inspection tool, either the QA helper (`e2e/integration/winhelper.cs`, command `rect`) or Spy++ (Visual Studio). Both report the window rectangle with the frame. If no tool is available, take a screenshot at 100 % zoom and measure the window from its outer edge to its outer edge. Write down which method you used.

- [ ] **CHK2-M1** [OWNER][HW][MON2][DPI] **Mixed DPI: the native minimum follows the monitor (REPORT-006 M-1).** Two monitors at different scales, for example monitor A at 125 % and monitor B at 150 %. W1 on monitor A, one poll polling.
  1. Pop out the poll (button in its title bar). Shrink its window by dragging the right edge, then the bottom edge, inward as far as it goes. Read the outer size. **Expected:** ceil(480 x s) x ceil(320 x s) for monitor A's scale s (600 x 400 at 125 %).
  2. Drag the window by its title bar fully onto monitor B and release. **Expected:** it keeps its logical size within 1 px (at 150 % that is 720 x 480 physical when it was 600 x 400 at 125 %). The values keep updating.
  3. Shrink it again by edge drags. **Expected:** 720 x 480 at 150 % (ceil(480 x s) x ceil(320 x s) for monitor B). It must **not** be 726 x 492 (the defect).
  4. Drag it back to monitor A and shrink again. **Expected:** 600 x 400 at 125 %. It must **not** be 594 x 388 (the defect).
  5. Repeat steps 2 to 4 three times. The results must be the same every round.
  6. At the minimum on each monitor: no page scrollbar, and the bottom status bar is one line ("Last OK …" cut with "…" if needed) (F17).
  7. **Pop out anchor (S6):** stretch W1 across both monitors, move a sub-window so its top-left corner is on monitor B, and pop it out. **Expected:** the window opens on monitor B at the sub-window's position, inside monitor B's work area.
  8. **Arrange (S8):** two poll windows on each monitor, then Window > Popped-out windows > "Each monitor (in place)" > Tile. **Expected:** each pair fills its own monitor's work area side by side, with no overlap and nothing outside the work area.
- [ ] **CHK2-M2** [OWNER][DPI] **Other scale factors: 100 %, 150 % and 175 %.** Windows Settings > System > Display > Scale. Sign out and in after each change if Windows asks. Run steps 1 to 5 at each scale:
  1. Close ESEfact. Delete `%APPDATA%\com.esefact.desktop\.window-state.json`. Start ESEfact and open Modbus Master from the launcher. **Expected:** W1's whole window is inside the screen above the taskbar (no part under the taskbar or off-screen). At 100 % on a 1920 x 1080 monitor, W1's content area is exactly 1280 x 800 (the window is not shrunk). At 150 % and 175 %, it is shrunk only as much as needed to fit.
  2. Pop out a poll and shrink it by edge drags. **Expected outer size:** 480 x 320 at 100 %, 720 x 480 at 150 %, 840 x 560 at 175 % (F13 table).
  3. At that minimum: no page scrollbar, the bottom status bar is one line, and the status line above the data shows no clipped button (`⋯` opens "Poll actions").
  4. Widen the poll window slowly from the minimum to about 900 px wide. **Expected:** the setup rail turns into the panel only once the window is wide enough (PollView 640 css px), and no page scrollbar appears at any width.
  5. Window > Popped-out windows > Tile with 4 poll windows. **Expected:** 2 x 2 windows fill the work area with no overlap.
  - Optional for QA: re-run the integration project at that scale (REPORT-007 section 8, "How to re-run"); it prints the physical frame and work area.
- [ ] **CHK2-M3** [OWNER][HW][MON2] **Second monitor: F4, H4, H5.**
  1. **F4:** pop out a poll and move its window to monitor 2. Dock it ([Dock to workspace]) and pop it out again. **Expected:** it reopens on monitor 2 at the same place and size. Unplug monitor 2 (or disable it in Display settings), dock and pop out again. **Expected:** it opens on W1's monitor, fully visible.
  2. **H4:** two poll windows on monitor 1 and two on monitor 2. Window > Popped-out windows > "Each monitor (in place)" > Tile. **Expected:** each pair is tiled side by side on its own monitor. Then choose "Display 2" > Tile. **Expected:** all four move to monitor 2 in 2 x 2.
  3. **H5:** with "Display 2" chosen, unplug monitor 2 and choose Tile. **Expected:** the error toast "That display is no longer connected." (`circle-x`, 4 s), and the target returns to "Each monitor (in place)".
- [ ] **CHK2-M4** [OWNER][HW] **Real Win+Left snap is kept across a restart (REV-008 m-5).**
  1. Open Modbus Master. With W1 focused, press `Win+Left`. If Snap Assist offers other windows, press `Esc`. **Expected:** W1 fills the left half of the screen down to the top of the taskbar.
  2. Close W1 with no unsaved changes (or answer Don't save), then close the launcher. Start ESEfact and open Modbus Master. **Expected:** W1 opens at the same left-half rectangle: it does not move, does not shrink, and its bottom edge is still on the taskbar's top edge (within 1 px).
  3. Repeat with `Win+Right` (right half), and with `Win+Left` then `Win+Up` (top-left quarter).
- [ ] **CHK2-M5** [OWNER][HW][LAYOUT] **AltGr, Alt codes and IME.** Test in W1 (a sub-window) and in a poll window (W2).
  1. **AltGr (German layout):** in the poll Name field, the Quantity field and an alias editor (double-click an Alias cell), press `AltGr+Q` and `AltGr+E`. **Expected:** "@" and "€" are typed. No poll pauses, no Write dialog opens, and the traffic panel does not toggle. The Quantity field then shows its validation message (the text is not a number).
  2. **Alt codes (US layout, Num Lock on):** in the Name field and in an alias editor, hold `Alt`, type `0176` on the numeric keypad, and release `Alt`. **Expected:** "°" is typed. No OS window menu opens, the title bar is not highlighted, focus stays in the field, and `Ctrl+P` afterwards (with focus moved to the grid) pauses the poll.
  3. **IME (Japanese, Microsoft IME):** in the Name field, switch the IME to Hiragana, type `kanji`, press `Space` to convert, then `Enter` to commit. **Expected:** the converted text is in the field. The `Enter` that commits does not apply the setup, and the `Esc` that cancels a composition does not close the setup popover or the dialog. No shortcut fires during the composition. Repeat with a Chinese (Pinyin) IME if available.
- [ ] **CHK2-M6** [OWNER][HW] **NVDA screen reader (R4).** Start NVDA. Open W1 with the Standard 8 polls, focus P1's grid.
  1. Press `Alt` alone and release it. **Expected:** NVDA does not announce a menu or "menu bar". The focus is still on the grid.
  2. Press `Insert+F7`. **Expected:** the NVDA Elements List opens. Close it with `Esc`.
  3. Press `Insert+Down` (say all). **Expected:** NVDA reads the page. Stop it with `Ctrl`.
  4. Press `Insert+Space` twice. **Expected:** NVDA switches to browse mode and back to focus mode (it says so, or plays its sounds).
  5. Press `Ctrl+P`. **Expected:** P1 pauses, and NVDA reads the change on the focused poll.
  6. Pop out a poll and narrow its window until the bottom status bar is cut with "…". Move the NVDA review cursor to it. **Expected:** NVDA reads the complete text ("Last OK … · Round trip … · Resp … · Timeouts …").
- [ ] **CHK2-M7** [OWNER][HW][LAYOUT] **A real keyboard with the Thai layout (REPORT-007 defect D8).** Add Thai (Kedmanee) in Windows Settings > Time & language > Language & region, and switch to it with `Win+Space` while W1 is focused. With the physical keys (labelled for US English), run every step of CHK2-R8 in W1 and in a poll window: `Ctrl+P`, `Ctrl+E`, `Ctrl+J`, `Ctrl+S`, `F6`, `Ctrl+Shift+N`, `Ctrl+Shift+O`, `Ctrl+Shift+D`, `Ctrl+1` to `Ctrl+4`. **Expected:** each acts exactly as with US English. Typing in the Name field without `Ctrl` still types Thai. Also check `Ctrl+C` / `Ctrl+V` in the Name field (native copy and paste) and in the grid (copy rows). Optional: the same with a Russian layout (CHK2-R9).
- [ ] **CHK2-M8** [OWNER][HW] **Alt+letter beep (record only, R7).** With focus in P1's grid, press `Alt+F`, then `Alt+X`. Write down whether Windows plays its default beep. Either result is recorded, not failed. The page must still answer: `Ctrl+P` pauses P1.
- [ ] **CHK2-M9** [OWNER][RTU] **RTU hardware (CHK2-D7).** With an RTU device or a USB-RS485 adapter and a slave at 9600 8E1, run CHK2-D7 (3 polls, silence of at least `max(t3.5, 5 ms)` before every request, as read by a serial sniffer or the device log). Also run CHK2-C3 (timeout) with the slave unplugged.
- [ ] **CHK2-M10** [OWNER][SIM] **10-minute soak (CHK2-Q5).** Run Q5 for the full 10 minutes (REPORT-007 ran 3): 8 polls at 100 ms, the traffic panel open, and 5 pop out / dock cycles spread over the run. **Expected:** the app's memory in Task Manager (the `esefact-desktop` process and its WebView2 processes) is within 10 % between minute 2 and minute 10. Every poll still updates at the end.
- [ ] **CHK2-M11** [OWNER][HW][LAYOUT] **Layouts not installed on the QA dev machine: Russian, French AZERTY, US Dvorak, German QWERTZ (revision 12, D-002-40).** Add each layout in Windows Settings > Time & language > Language & region (Russian, French (France) with the AZERTY keyboard, English (United States) with the "United States-Dvorak" keyboard, German (Germany)). Use the physical keys of your keyboard (labelled for US English). Switch with `Win+Space` while the tested window is focused, and switch back to US English at the end. Setup as for CHK2-R8 (the Standard 8 polls, P2 in a native window). Write down each layout tested.
  1. **Russian:** run CHK2-R9. **Expected:** every shortcut of CHK2-R8 acts as with US English. `Ctrl+\` (the key above Enter) toggles the setup in P1's sub-window and in P2's window; `Ctrl+Shift+\` turns compact mode on, and again off.
  2. **AZERTY:** run CHK2-R10 (AZERTY parts). **Expected:** `Ctrl` + digit-row keys 1 to 4 set Unsigned, Signed, Hex, Binary; `Ctrl+A` (the key labelled A on AZERTY, US Q position) selects all grid rows. `Ctrl` + the key above Enter (types "*") toggles P1's setup. `AltGr+8` in the Name field types "\" and toggles nothing.
  3. **Dvorak:** run CHK2-R10 (Dvorak part) in P2's native window. **Expected:** `Ctrl` + the key that types "p" (US R position) pauses P2; `Ctrl` + the US P position (types "l") does not pause P2 and the connection stays connected; `Ctrl` + the key that types "e" (US D position) opens "Write · Poll 2".
  4. **German:** run the German part of CHK2-R11 and step 1 of CHK2-M5. **Expected:** `AltGr+Q` types "@" and `AltGr+E` types "€" in the Name field, an alias editor and the Quantity field, with no shortcut; `AltGr+P` in P1's grid does not pause P1. `AltGr+ß` types "\" in the Name field and toggles nothing. With focus in P1's grid, `Ctrl` + the key above Enter (types "#") toggles P1's setup, and `Ctrl+Shift` + that key turns compact mode on.
  - **Fails if** any shortcut does nothing or does something different from US English, or any AltGr combination fires a shortcut.

## State coverage index
| State | Items |
|---|---|
| connection idle | A1, A6, F13, B5, D9, G6, N10 |
| connection connecting | A4 |
| connection connected | A2, A3, C1, C2, B5, B11 |
| connection disconnected | A3, A5, D6, D9, G6 |
| poll offline | A2, A4, A5, F11, B5, G6 |
| poll paused | A2, B5, B7, B8, B10, G6, K8, R7, R8-R12, M7, M11 |
| poll polling | B1, B5, C1, C7, D1-D3, D10, F3, E16-E26, F17, G6, R7, R8-R12, M10 |
| polling at a slowed rate (`effective` suffix, link saturated) | D3, E19, E27 |
| poll timeout | C3, C5, K7, E16-E26, E27, G6, M9 |
| poll exception | C1, C2, C6, K7, G6 |
| poll badResponse | C4, G6 |
| host workspace normal / minimized / maximized | E1-E4, E9, I9, R1 |
| host native | F1-F17, H1-H5, S3, S5, S6, M1-M3 |
| pop out in progress (spinner, poll shown nowhere ≤ 1 s) | F1, F15 |
| pop out / dock failure (toast, rollback, focus kept) | F8, F16 |
| host closed | C6, F6, G2 |
| tile mode | E5, E6, I10, I11, H9 |
| drag (move, resize, snap, zone, swap, cancel) | I1-I9, I21, I22, R7 |
| pop-out mode / dock preview | I16, I17 |
| PV loading (attach) and data loading | E15, E14, B9 |
| invalid input | B3, B4, B11, J3, P1, P2, P3, M5 |
| empty data | A1, E11, K4, K8, B10 |
| compact mode | H7, H8, H9 |
| setup dock / popover (frame width) | B1, E12, S4 |
| native setup rail / popover (PollView width) | F13, F14, S3 |
| narrow status line steps (`data-step` 0..5) | E13, E16-E27, S4 |
| S6 open (body snapshot) | G1, G6, R7 |
| focus order and activation | R1, R6, R7, E9, F8, F16, K5, K8 |
| keyboard layouts (non-Latin, AZERTY, Dvorak, AltGr, IME, native text-field keys, backslash by physical key) | R8-R12, M5, M7, M11 |
| OS window menu / menu mode (lone Alt, `Alt+Space` + two `Esc`) | R7, M6, M8 |
| W1 raised from a native window (restore, foreground) | K5, K8, P3 |
| layout reporting (z-order) | N9 |
| "Save changes?" (close and load variants) | G5, N10, R7 |
| window geometry: work-area clamp, minimum size, placement precision, scale factors | A7, A8, F13, N1, S1-S8, M1-M4 |
| narrow native window: no document scrollbar, one-line status bar | F17, M1, M2, M6 |
| saturated link with the dev simulator's quantized delay | D3 |
