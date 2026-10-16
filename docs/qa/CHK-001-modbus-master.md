# CHK-001 Modbus Master (MVP) - QA checklist

Upstream: `docs/design/DES-001-modbus-master.md` (DES), `docs/requirements/REQ-001-modbus-master.md`. Report results in `docs/qa/REPORT-001.md`, marking every item pass or fail.

**Revision 4 (2026-10-16):** follows DES-001 revision 4 (REPORT-002-integration finding 1 and notes, plus PM decisions).
- Changed: CHK-N7 (counter semantics per BE-001, with a worked example), CHK-I1 (Timeout 3000 ms), CHK-M17 Path 1b (Timeout 3000 ms, note on the short-timeout text).
- New: CHK-I11 (short timeout against a refused port, either text passes), CHK-J29 (binary values list), CHK-N8 (clipboard refused toast).
- No ids changed.

**Revision 3 (2026-10-16):** follows DES-001 revision 3 (REPORT-001-ui-mode F-3 and section 8).
- Changed: CHK-M17 (Reconnect from inside the Write dialog's result area, plus `Ctrl+L` after closing the dialog), CHK-M11 (focus returns to the data grid), CHK-S3 (criterion and environments).
- No ids changed and no items were added.

**Revision 2 (2026-10-16):** follows DES-001 revision 2.
- Changed: CHK-H1, CHK-I6, CHK-M7, CHK-M8, CHK-N5.
- New: CHK-H5 to H8, CHK-J25 to J28, CHK-M15 to M18, CHK-O10, CHK-Q8, CHK-Q9.
- All existing ids are unchanged.

## Device tags
- **[NONE]**: no device needed (UI only, or the frontend fake IPC in dev mode).
- **[SIM]**: needs the simulated Modbus TCP slave (reference setup below).
- **[RTU]**: needs a serial Modbus device, real or simulated over a virtual COM pair.
- **[FAULT]**: needs a fault-injecting simulator or proxy that can delay, drop or corrupt replies, or close the socket on demand.
- **[WIRE]**: also needs a packet capture (Wireshark on loopback/LAN, or a serial sniffer) to compare bytes.

## Reference simulator setup ([SIM])
Use any spec-compliant TCP slave at `127.0.0.1:5020`, unit ID 1. Load this map:
- Holding registers 0-99: HR0=1234, HR1=65535, HR2=32768, HR3=0, HR4=32767, all others 0.
- Input registers 0-99: IR0=4321, others 0.
- Coils 0-99: coil0=1, coil1=0, coil2=1, others 0.
- Discrete inputs 0-99: DI0=1, others 0.
- Any read or write outside 0-99 must answer exception 02.
- Unit ID 0 must be answered as this device. Most TCP servers do this (for example, a single-device server context). It is needed for CHK-M15.
- For the FC limit tests, a second map covers all of 0-65535 (or the simulator accepts any address).

Defaults assumed unless the step says otherwise:
- TCP host `127.0.0.1`, port `5020`, timeout 1000 ms
- poll slave 1, FC03, start 0, quantity 10, scan 1000 ms
- base 0-based, format Unsigned, "Start polling when connected" checked

---

## A. idle
- [ ] **CHK-A1** [NONE] Given a new window, then the pill shows the plug icon and "Not connected", the title is "Modbus Master - Untitled - Not connected", the data card shows "Not connected. Configure a connection and press Connect (Ctrl+L).", and there is no banner.
- [ ] **CHK-A2** [NONE] Given idle, then all Connection and Poll fields are editable, and the toolbar shows Connect with tooltip "Connect (Ctrl+L)".
- [ ] **CHK-A3** [NONE] Given idle, then Write… is not in the toolbar, and `Ctrl+E` opens nothing.
- [ ] **CHK-A5** [SIM] Given the Write dialog is open while connected, when the simulator is stopped (state becomes disconnected), then Send is disabled and the result area reads "Not connected. Connect before writing."
- [ ] **CHK-A4** [NONE] Given idle, then the traffic panel shows "No frames yet. Requests and responses appear here." and all four counters are 0.

## B. connecting
- [ ] **CHK-B1** [FAULT] Given a host that accepts the connection slowly (the proxy delays the SYN-ACK by 3 s), when Connect is pressed, then the pill shows the spinner and "Connecting…", the banner reads "Connecting to {host}:{port}…" with [Cancel], and the data card shows the same connecting text.
- [ ] **CHK-B2** [FAULT] Given connecting, then the Connection fields are read-only with the hint "Disconnect to change connection settings."
- [ ] **CHK-B3** [FAULT] Given connecting, when Cancel (or `Ctrl+L`) is pressed, then the state returns to idle (pill "Not connected") without an error banner.
- [ ] **CHK-B4** [NONE] Given reduced motion is enabled in Windows, when connecting, then the loader icon does not spin and the "Connecting…" text is still shown.

## C. connected
- [ ] **CHK-C1** [SIM] Given "Start polling when connected" is unchecked, when Connect is pressed, then the pill shows the link icon and "Connected" (dark fill, light text), and the data card shows "Connected. Press Start polling (Ctrl+P) to read 10 holding registers from slave 1."
- [ ] **CHK-C2** [SIM] Given connected, then the Connection fields are read-only, the Poll fields are editable, and the toolbar shows Disconnect, Start polling and Write….
- [ ] **CHK-C3** [SIM] Given connected and the poll quantity set to 126 (invalid), then the data card shows "Fix the poll settings to start polling." and `Ctrl+P` sends nothing (the traffic panel shows no new TX).
- [ ] **CHK-C4** [SIM] Given connected, when Disconnect is pressed, then the state is idle and the data card shows the idle text.

## D. polling and live data
- [ ] **CHK-D1** [SIM] Given defaults, when Connect is pressed, then the state goes connecting -> polling with no manual step, and the pill shows the activity icon and "Polling" (green fill, dark text).
- [ ] **CHK-D2** [SIM] Given polling, then rows 0-9 show 1234, 65535, 32768, 0, 32767, 0… and the chip reads "Updated {HH:MM:SS.mmm}" with the check icon.
- [ ] **CHK-D3** [SIM] Given polling, when `Ctrl+2` (Signed) is pressed, then rows 0-4 read 1234, -1, -32768, 0, 32767.
- [ ] **CHK-D4** [SIM] Given polling, when `Ctrl+3` (Hex) is pressed, then rows 0-4 read 0x04D2, 0xFFFF, 0x8000, 0x0000, 0x7FFF.
- [ ] **CHK-D5** [SIM] Given polling, when `Ctrl+4` (Binary) is pressed, then row 0 reads `0000 0100 1101 0010` and row 1 reads `1111 1111 1111 1111`.
- [ ] **CHK-D6** [SIM] Given polling, when `Ctrl+B` is pressed, then the header reads "Address (1-based)", the first row address is 1, the values are unchanged, and the Start address field shows 1 with helper "Protocol address 0". When `Ctrl+B` is pressed again, all of these revert.
- [ ] **CHK-D7** [SIM] Given FC01, start 0, quantity 3, when polling, then the values read 1, 0, 1, Format is disabled, and its tooltip is "Coils and discrete inputs are shown as 0 or 1."
- [ ] **CHK-D8** [SIM] Given FC02, start 0, quantity 1, then the value is 1. Given FC04, start 0, quantity 1, then the value is 4321.
- [ ] **CHK-D9** [SIM] Given polling at scan 1000 ms, then TX frames in the traffic panel are spaced about 1000 ms apart (Time column), and each TX has a matching RX.
- [ ] **CHK-D10** [SIM][WIRE] Given polling FC03 start 0 quantity 10, then the TX bytes in the traffic panel equal the captured request byte for byte (`xx xx 00 00 00 06 01 03 00 00 00 0A`, with the transaction ID matching), and the RX bytes equal the captured response.
- [ ] **CHK-D11** [RTU][WIRE] Given RTU on the COM port at 9600 8E1, slave 1, FC03 start 0 quantity 2, then TX reads `01 03 00 00 00 02 C4 0B` and the RX bytes equal the sniffer capture, CRC included.
- [ ] **CHK-D12** [SIM] Given polling, when Apply is pressed with quantity changed to 20, then the data view briefly shows "Waiting for first response…" and then 20 rows. No row from the old definition remains.
- [ ] **CHK-D13** [SIM] Given polling, then the status bar shows "TCP 127.0.0.1:5020 · Last OK {time} · Round trip {n} ms".

## E. paused
- [ ] **CHK-E1** [SIM] Given polling, when `Ctrl+P` is pressed, then the pill shows the pause icon and "Paused", values remain in muted text, the chip reads "Paused - values from {time}", and no further TX appears.
- [ ] **CHK-E2** [SIM] Given paused, when `Ctrl+P` is pressed, then polling resumes, the pill shows "Polling", and the values return to normal text.
- [ ] **CHK-E3** [SIM] Given paused, when the start address is changed to 5 and Apply is pressed, then no TX is sent, the data card shows "Poll settings changed. Press Resume (Ctrl+P) to read with the new settings.", and Resume polls from address 5.
- [ ] **CHK-E4** [SIM] Given paused, when Write… sends FC06 to address 3 with value 7, then the write succeeds, and after Resume row 3 reads 7.

## F. timeout
- [ ] **CHK-F1** [SIM] Given polling, when the slave ID is set to 99 (no such unit, and the simulator does not reply to unknown units) and applied, then within about 1 s the pill shows the timer-off icon and "Timeout" (orange fill, dark text), and the banner reads "Timeout: slave 99 did not respond within 1000 ms. Retrying every 1000 ms (1 in a row)." If the simulator answers unknown units, use [FAULT] drop-replies instead.
- [ ] **CHK-F2** [FAULT] Given timeout persists for 3 cycles, then the banner reads "(3 in a row)", the Timeouts counter increases by 1 per cycle, the values stay with the chip "No response - values from {time}", and the screen reader does not re-announce the timeout.
- [ ] **CHK-F3** [FAULT] Given timeout, when the proxy stops dropping replies, then the next cycle returns the state to polling, the banner disappears, and the values are live.
- [ ] **CHK-F4** [FAULT] Given timeout with no data ever received (it started timing out from the first cycle), then the rows show "—" and the chip reads "Waiting for first response…".
- [ ] **CHK-F5** [FAULT] Given timeout, when Pause is pressed, then the state is paused and the banner is gone.
- [ ] **CHK-F6** [FAULT] Given the timeout is set to 50 ms and the proxy delays replies by 100 ms, then the state is timeout and the banner reads "within 50 ms".

## G. exception response
- [ ] **CHK-G1** [SIM] Given polling, when the start address is set to 95 with quantity 10 and applied (beyond the 0-99 map), then the pill shows the octagon-x icon and "Exception 02", and the banner (error left border, dark text) reads "Exception 02 (Illegal data address) from slave 1 for FC03 at 95-104. Retrying every 1000 ms (1 in a row)."
- [ ] **CHK-G2** [SIM] Given G1, then the traffic RX row Info reads "Exception 02 Illegal data address" with an icon, the RX bytes contain `83 02`, and the Errors counter increments per cycle.
- [ ] **CHK-G3** [SIM] Given exception with no prior data for this definition, then the data card shows "No data: the device answered with exception 02 (Illegal data address)."
- [ ] **CHK-G4** [SIM] Given exception, when the start address is set back to 0 and applied, then the state returns to polling and the banner disappears (recovery without restart).
- [ ] **CHK-G5** [FAULT] Given the simulator answers exception 0x0C (unknown), then the banner reads "Exception 0C (Unknown exception) …".
- [ ] **CHK-G6** [NONE] Given exception and then timeout from the fake, then the pill and banner switch to Timeout and the counter text restarts at "(1 in a row)".

## H. bad response
- [ ] **CHK-H1** [FAULT] Given polling, when the proxy corrupts each reply, then the pill shows the triangle-alert icon and "Bad response", and the banner reads:
  - RTU (proxy flips one CRC byte): "Bad response from slave 1: CRC mismatch. Retrying every 1000 ms (1 in a row)."
  - TCP (proxy rewrites the reply's unit ID to 2): "Bad response from slave 1: reply from slave 2, expected 1. Retrying every 1000 ms (1 in a row)."
- [ ] **CHK-H2** [FAULT] Given bad response, then the traffic RX row shows the raw (corrupted) bytes exactly as received, the Info shows the note, and the Errors counter increments.
- [ ] **CHK-H3** [FAULT] Given bad response, when corruption stops, then the state returns to polling.
- [ ] **CHK-H4** [NONE] Given timeout then bad response from the fake, then the pill shows "Bad response" with the triangle icon, never the timer icon (distinct from timeout).
- [ ] **CHK-H5** [SIM][FAULT] Given TCP polling FC03 start 0 quantity 10 (full reply is 29 bytes on the wire), when the proxy forwards only the first 20 bytes of each reply, drops the rest and keeps the socket open, then:
  - the banner reads "Bad response from slave 1: short frame (20 of 29 bytes). Retrying every 1000 ms (1 in a row)."
  - the RX row shows Len 20
  - Errors increases by 1 per cycle and Timeouts does not change
- [ ] **CHK-H6** [RTU][FAULT] Given RTU polling FC03 start 0 quantity 10 (full reply 25 bytes: slave + FC + byte count + 20 data + 2 CRC), when the reply is cut after 20 bytes, then the banner reads "Bad response from slave 1: short frame (20 of 25 bytes). …".
- [ ] **CHK-H7** [FAULT] Given TCP polling FC03 quantity 2, when the proxy replaces the reply with `00 01 00 00 00 04 01 03 04 00` (the MBAP length says the frame is complete, but the byte count disagrees; the transaction ID is adjusted to match), then the banner starts with "Bad response from slave 1: malformed frame", and it does **not** say "short frame" (REV-001 F4).
- [ ] **CHK-H8** [FAULT] Given TCP polling FC03, when the proxy rewrites the reply function code to 04, then the banner reads "Bad response from slave 1: reply for FC04, expected FC03. …".

## I. disconnected
- [ ] **CHK-I1** [SIM] Given the simulator is stopped and the connection **Timeout is set to 3000 ms** (Windows reports a refused loopback connect only after about 1 s; see DES 3.4), when Connect is pressed, then the pill shows the unplug icon and "Disconnected", and the banner reads "Connection refused by 127.0.0.1:5020." with [Reconnect] and [Dismiss].
- [ ] **CHK-I2** [NONE] Given host `no-such-host.invalid`, when Connect is pressed, then the banner reads "Host "no-such-host.invalid" could not be resolved."
- [ ] **CHK-I3** [FAULT] Given a host that never answers (blackhole IP), when Connect is pressed, then after about 1000 ms the banner reads "No answer from {host}:{port} within 1000 ms."
- [ ] **CHK-I4** [SIM] Given polling, when the simulator process is stopped, then the state goes to disconnected, the banner reads "The device at 127.0.0.1:5020 closed the connection." (or the ioError text), the values are kept with the chip "Disconnected - values from {time}", and the screen reader announces it once (assertive).
- [ ] **CHK-I5** [SIM] Given I4, when the simulator is restarted and Reconnect is pressed (or `Ctrl+L`), then the state goes connecting -> polling and the values are live (recovery without app restart).
- [ ] **CHK-I6** [SIM] Given disconnected, when Dismiss is pressed, then Dismiss shows a spinner until the backend reports idle (it goes through `mm_disconnect`, with no local reset). Then the state is idle, the banner and stale values are cleared, and the idle text shows.
- [ ] **CHK-I7** [RTU] Given RTU polling over a USB adapter, when the adapter is unplugged, then the banner reads "{COMx} was removed." After replugging, Refresh and Reconnect resume polling.
- [ ] **CHK-I8** [RTU] Given window 1 is connected on COM3, when window 2 connects to COM3, then window 2 shows "COM3 is in use by another application or window." and window 1 keeps polling.
- [ ] **CHK-I9** [RTU] Given a port that disappeared since the list was loaded, when Connect is pressed, then the banner reads "{COMx} is not available. Refresh the port list."
- [ ] **CHK-I10** [NONE] Given disconnected, then the Connection fields are editable again.
- [ ] **CHK-I11** [SIM] **Short connect timeout against a refused loopback port (Windows).** Given the simulator is stopped and Timeout is 300 ms, when Connect is pressed, then the state is disconnected and the banner reads **either** "No answer from 127.0.0.1:5020 within 300 ms." **or** "Connection refused by 127.0.0.1:5020." (both pass). Record which one appeared. No other text is acceptable, and the app must not hang in connecting.

## J. invalid input (nothing is sent: the traffic TX count is unchanged in every item)
Connection:
- [ ] **CHK-J1** [NONE] Host empty, then Connect gives "Enter a host name or IPv4 address.", focus moves to Host, and the setup header reads "1 field needs attention". With Host and Port both invalid, it reads "2 fields need attention".
- [ ] **CHK-J2** [NONE] Host `256.1.1.1`, then "Enter a valid host name or IPv4 address, for example 192.168.1.10."
- [ ] **CHK-J3** [NONE] Port 0, then "Port must be a whole number from 1 to 65535." Port 1 is accepted, 65535 is accepted, and 65536 shows the same message. Port `50.5` and `abc` show the same message.
- [ ] **CHK-J4** [NONE] Timeout 49, then "Timeout must be a whole number from 50 to 10000 ms." 50 and 10000 are accepted, and 10001 is rejected.
- [ ] **CHK-J5** [NONE] RTU with no port selected, then "Select a serial port."
- [ ] **CHK-J6** [NONE] RTU with data bits 7, then the warning "Modbus RTU uses 8 data bits. 7 may not work with most devices." appears, and Connect is still allowed.
- [ ] **CHK-J7** [NONE] RTU with parity None and stop bits 1, then the warning "The Modbus specification uses 2 stop bits when parity is None."

Poll:
- [ ] **CHK-J8** [NONE] Slave ID 248, then "Slave ID must be a whole number from 0 to 247." Slave ID 247 is accepted. Slave ID 0 on TCP is accepted.
- [ ] **CHK-J9** [NONE] RTU with poll slave ID 0, then "Slave ID 0 is broadcast and cannot be used for reads. Use 1 to 247."
- [ ] **CHK-J10** [SIM] Start address 0 is accepted. Start address 65535 with quantity 1 is accepted and sent (the TX shows address bytes `FF FF`). 65536 gives "Start address must be a whole number from 0 to 65535."
- [ ] **CHK-J11** [NONE] 1-based: start 0 gives "Start address must be a whole number from 1 to 65536." 65536 is accepted with helper "Protocol address 65535".
- [ ] **CHK-J12** [NONE] FC03 quantity 0 and 126 give "Quantity for FC03 must be from 1 to 125." 1 and 125 are accepted. FC04 behaves the same.
- [ ] **CHK-J13** [NONE] FC01 quantity 2001 gives "Quantity for FC01 must be from 1 to 2000." 2000 is accepted. FC02 behaves the same.
- [ ] **CHK-J14** [NONE] Start 65530, quantity 10 (FC03) gives "This range ends after the last address (65535). The maximum quantity from 65530 is 6." Quantity 6 is accepted.
- [ ] **CHK-J15** [NONE] Scan rate 19 gives "Scan rate must be a whole number from 20 to 60000 ms." 20 and 60000 are accepted, and 60001 is rejected.
- [ ] **CHK-J16** [NONE] Given an error was shown on blur, when the value is corrected, then the message disappears as you type (before blur).

Write:
- [ ] **CHK-J17** [SIM] FC06 Unsigned value 65536 gives "Value must be from 0 to 65535." Signed -32769 gives "Value must be from -32768 to 32767." Hex `0x10000` gives "Enter a hex value from 0x0000 to 0xFFFF." Binary with 17 digits gives "Enter up to 16 binary digits (0 or 1)."
- [ ] **CHK-J18** [SIM] FC16 with 124 values gives "Enter from 1 to 123 values (you entered 124)." 123 values at address 0 are accepted (map permitting).
- [ ] **CHK-J19** [SIM] FC16 values `1 2 70000` (Unsigned) give "Value 3 ("70000") is not valid: Value must be from 0 to 65535."
- [ ] **CHK-J20** [SIM] FC15 with 1969 values gives "Enter from 1 to 1968 values (you entered 1969)." Values `1 0 2` give "Value 3 ("2") is not valid: enter 0 or 1."
- [ ] **CHK-J21** [NONE] FC16 at address 65534 with 3 values gives "These values end after the last address (65535). At most 2 values fit from 65534."
- [ ] **CHK-J22** [NONE] FC16 with values box empty gives "Enter from 1 to 123 values (you entered 0)."

Profile name:
- [ ] **CHK-J23** [NONE] Save as with an empty name gives "Enter a profile name." A 65-character name gives "Profile name must be at most 64 characters." `a/b` gives "Profile name cannot contain \ / : * ? " < > |".
- [ ] **CHK-J24** [NONE] Renaming to a name that differs only in case from an existing profile gives "A profile named "{name}" already exists."
- [ ] **CHK-J25** [NONE] Given a profile file hand-edited to RTU baud 250000, data bits 6 and stop bits 3, when it is opened, then the window stays idle and the fields show:
  - Baud: "250000 (not supported)" with "Choose a baud rate from the list."
  - Data bits: "Data bits must be 7 or 8."
  - Stop bits: "Stop bits must be 1 or 2."

  Connect sends nothing until the values are fixed.
- [ ] **CHK-J26** [NONE] Profile name (Save as and Rename):
  - `.hidden` gives "Profile name cannot start with a dot."
  - `bench.` gives "Profile name cannot end with a dot."
  - ` bench` and `bench ` give "Profile name cannot start or end with a space."
  - a name with a pasted tab or other control character gives "Profile name cannot contain control characters."
  - `CON`, `nul`, `com1`, `LPT9` and `con.backup` each give ""{name}" is reserved by Windows and cannot be used as a profile name."
  - `COM10` and `CONSOLE` are accepted
- [ ] **CHK-J27** [NONE] Given a setup field is invalid (for example quantity 126), when `Ctrl+S`, toolbar Save, `Ctrl+Shift+S` or Save as… is used, then:
  - nothing is saved and no dialog opens
  - the field messages show and focus moves to the first invalid field
  - the toast reads "Fix the highlighted fields before saving."
  - the profile list is unchanged
- [ ] **CHK-J28** [NONE] Given unsaved changes and an invalid setup field, when the window is closed and Save is chosen in "Save changes?", then the toast "Fix the highlighted fields before saving." appears and the window stays open.
- [ ] **CHK-J29** [NONE] **Binary values list: whitespace always separates values** (DES 3.3). With the Write dialog on FC16 and Value format Binary:
  - When `0000 0100 1101 0010` is pasted into the values box, then the box shows "Values (4)", and with address 10 the helper reads "Writes addresses 10-13.". On Send, 4 registers are written (0, 4, 13, 2), never one merged value.
  - When `0000010011010010` is entered, then "Values (1)", and the written value is 1234.
  - `0000 0100 1101 00102` gives "Value 4 ("00102") is not valid: Enter up to 16 binary digits (0 or 1)."
  - A 17-digit value `10000000000000000` gives "Value 1 ("10000000000000000") is not valid: Enter up to 16 binary digits (0 or 1)."
  - `0b` alone gives "Value 1 ("0b") is not valid: Enter up to 16 binary digits (0 or 1)."

## K. empty data
- [ ] **CHK-K1** [NONE] Each data card empty text from DES 2.4 appears verbatim in its state (A1, B1, C1, C3, E3, G3, I4 with no prior data: "Connection lost. Press Reconnect to continue.").
- [ ] **CHK-K2** [SIM] Given frames exist, when `Ctrl+Shift+K` is pressed, then the traffic list shows "Log cleared at {time}. New frames appear here.", and the counters are unchanged.
- [ ] **CHK-K3** [NONE] Given no profiles saved, when `Ctrl+O` is pressed, then the dialog shows "No saved profiles yet. Use Save as (Ctrl+Shift+S) to create one." and Open is disabled.
- [ ] **CHK-K4** [NONE] Given profiles exist, when the filter is `zzz`, then the dialog shows "No profiles match "zzz"."
- [ ] **CHK-K5** [NONE] Given a PC with no COM ports, when RTU is selected, then the dialog shows "No serial ports found. Connect a device and press Refresh."

## L. loading
- [ ] **CHK-L1** [SIM] Given connected, when Start polling is pressed, then until the first response the rows show "—" and the chip reads "Waiting for first response…". (Use [FAULT] with a 500 ms delay to observe it reliably.)
- [ ] **CHK-L2** [NONE] Given the fake delays the profile list, then the dialog shows "Loading profiles…" and Open is disabled.
- [ ] **CHK-L3** [NONE] Given the fake delays the port list, then the select shows "Loading ports…" and is disabled.
- [ ] **CHK-L4** [FAULT] Given a write with the reply delayed by 500 ms, then the result area shows "Writing…" and Send is disabled until the result arrives.
- [ ] **CHK-L5** [NONE] Given the fake rejects the profile listing, then the dialog shows "Could not load profiles: {message}" with [Retry], and Retry reloads.

## M. Write dialog results
- [ ] **CHK-M1** [SIM] FC06 address 3 value 500, then the result reads "Write confirmed by slave 1: register at 3." Polling shows 500 at row 3.
- [ ] **CHK-M2** [SIM] FC16 address 10 values `10 20 30`, then the result reads "Write confirmed by slave 1: 3 registers at 10-12." The helper read "Writes addresses 10-12." before sending.
- [ ] **CHK-M3** [SIM] FC05 address 1 ON, then "Write confirmed by slave 1: coil at 1." An FC01 poll shows 1.
- [ ] **CHK-M4** [SIM] FC15 address 0 values `0 1 0 1`, then "Write confirmed by slave 1: 4 coils at 0-3."
- [ ] **CHK-M5** [SIM] FC06 address 200 (outside the map), then "Exception 02 (Illegal data address). Nothing was confirmed."
- [ ] **CHK-M6** [FAULT] With the write reply dropped, then "No response within 1000 ms. The write may or may not have been applied."
- [ ] **CHK-M7** [FAULT] With the write reply corrupted, then:
  - RTU (CRC byte flipped): "Bad response: CRC mismatch. The write may or may not have been applied."
  - TCP (reply unit ID rewritten to 2): "Bad response: reply from slave 2, expected 1. The write may or may not have been applied."
- [ ] **CHK-M8** [RTU][WIRE] **RTU mode only.** Slave ID 0 shows the warning "Broadcast: devices do not reply, so the result cannot be confirmed." Send stays enabled. When FC06 address 3 value 500 is sent, then:
  - the result reads "Broadcast sent. Devices do not reply to slave ID 0, so the write cannot be confirmed."
  - the TX bytes equal the sniffer capture `00 06 00 03 01 F4 78 0C`
  - no RX row follows for this write
  - Requests increases by 1 and Responses does not change
  - polling to slave 1 continues without a timeout or bad response
- [ ] **CHK-M9** [SIM] Given row 1 is selected in an FC03 poll in Hex format, when `Enter` is pressed, then the dialog opens with FC06, address 1, slave 1, Value format Hex and value `0xFFFF`.
- [ ] **CHK-M10** [SIM] Given an FC04 poll, when a row is double-clicked, then the toast reads "Discrete inputs and input registers are read-only." and no dialog opens.
- [ ] **CHK-M11** [SIM] Given the dialog after success, when Send is pressed again, then a second identical TX appears. When the dialog was opened with `Enter` on row 3 of the data grid, `Esc` closes it and focus returns to the data grid element (`document.activeElement` is the grid). The grid's `aria-activedescendant` is row 3's id. When the dialog was opened from the toolbar Write… button, focus returns to that button.
- [ ] **CHK-M12** [SIM][WIRE] FC16 address 10 values `10 20 30`, then the TX bytes equal the capture: PDU `10 00 0A 00 03 06 00 0A 00 14 00 1E`.
- [ ] **CHK-M13** [SIM] While polling at 100 ms, then 20 consecutive FC06 writes all succeed and polling continues without entering timeout.
- [ ] **CHK-M14** [SIM] Pasting a 3-cell spreadsheet column `1\n2\n3` into the FC16 values box gives "Values (3)".
- [ ] **CHK-M15** [SIM][WIRE] **TCP, unit ID 0 is not a broadcast.** Given TCP polling slave 1 at 100 ms, when the Write dialog uses slave ID 0, then no broadcast warning is shown. When FC06 address 3 value 500 is sent, then:
  - the result reads "Write confirmed by slave 0: register at 3."
  - the TX bytes equal the capture `tt tt 00 00 00 06 00 06 00 03 01 F4`, where `tt tt` is the transaction ID
  - the next RX row is the echo `tt tt 00 00 00 06 00 06 00 03 01 F4` with the same transaction ID
  - Responses increases by 1
  - the session stays in polling: no badResponse and no "discarded" RX notes. Repeat 5 times at 100 ms polling.
- [ ] **CHK-M16** [FAULT] Given TCP and a proxy that answers writes to unit 0 with exception 02, when FC06 to slave 0 is sent, then the result reads "Exception 02 (Illegal data address). Nothing was confirmed." It is never "Broadcast sent".
- [ ] **CHK-M17** [SIM][FAULT] **Link lost during a write.** Given polling with the Write dialog open, when FC06 address 3 value 9 is sent while the proxy holds the reply for 2 s and then closes the socket, then:
  - the result area shows the `unplug` icon, the text "Connection lost during the write. The write may or may not have been applied. Reconnect and check the value before sending again." and a [Reconnect] button
  - the pill behind the dialog shows "Disconnected"
  - Send is disabled and the draft (address 3, value 9) is still in the fields
  - `Ctrl+L` does nothing while the dialog is open: no `mm_connect` call and no new TX

  Path 1, Reconnect in the dialog (proxy forwarding normally again). When [Reconnect] in the result area is pressed, then:
  - the button shows a spinner and is disabled while connecting
  - the dialog stays open and the draft is unchanged
  - once the session is back in polling, the result area is empty (no Reconnect button), Send is enabled and focused, and after closing the dialog row 3 shows the device's actual value

  Path 1b, reconnect fails (simulator stopped, connection **Timeout 3000 ms**; with a timeout below 1000 ms the text may instead be "Reconnect failed: No answer from 127.0.0.1:5020 within {n} ms.", see DES 3.4). When [Reconnect] in the result area is pressed, then the result area reads "Reconnect failed: Connection refused by 127.0.0.1:5020." and [Reconnect] is enabled again.

  Path 2, Ctrl+L after closing (repeat the link loss). When `Esc` closes the dialog and `Ctrl+L` is pressed, then the app reconnects (same as the banner [Reconnect]) and polling resumes.
- [ ] **CHK-M18** [FAULT] **Queued write when the link drops.** Given polling where the proxy holds each poll reply for 900 ms, when Send is pressed during that wait (the write is queued) and the proxy closes the socket before the poll reply, then:
  - the write result reads "Not connected. Connect before writing."
  - the traffic panel shows no TX frame for that write
  - the state is disconnected

## N. Traffic panel
- [ ] **CHK-N1** [SIM] Each frame shows the # (absolute sequence), Time `HH:MM:SS.mmm`, the direction as an arrow plus "TX" or "RX" text, Len equal to the byte count, and hex bytes in uppercase pairs separated by spaces.
- [ ] **CHK-N2** [SIM] Given more than 5,000 frames (poll at 20 ms for about 3 min), then the list holds exactly 5,000 frames, the oldest # is newest - 4,999, and the counters keep counting beyond 5,000.
- [ ] **CHK-N3** [SIM] When scrolled up, Auto-scroll unchecks itself and the view stays put while frames arrive. When re-checked, the view jumps to the newest frame.
- [ ] **CHK-N4** [SIM] Selecting an FC16 request frame (long bytes) shows the detail strip with offsets `0000`, `0010`, … and 16 bytes per line. "Copy bytes" puts only the spaced hex on the clipboard.
- [ ] **CHK-N5** [SIM] The traffic list uses single-frame selection. Selecting one frame and pressing `Ctrl+C` copies exactly one line `{time}\t{TX|RX}\t{hex}\t{info}`, and the toast reads "Copied 1 frame." With no frame selected, `Ctrl+C` copies nothing and shows no toast.
- [ ] **CHK-N6** [SIM] Reset counters sets all four to 0 and keeps the frames.
- [ ] **CHK-N7** [SIM][FAULT] **Counter semantics follow the BE-001 contract** (DES 1, Traffic panel). Setup:
  - The counters are reset and no frames are evicted.
  - Polling 15 requests, with the simulator scripted to: answer 5 normally, drop 3 replies, answer 3 with exception 02, answer 2 with a wrong unit ID, and truncate 2 replies.
  - There must be no late replies: rows noted "(discarded)" must not appear. If any do, rerun with a longer scan rate.

  Then:
  - **Requests = 15**: equals the TX rows.
  - **Responses = 8**: valid replies (5 normal + 3 exception). It is **not** the 12 RX rows: the 2 wrong-unit and 2 truncated replies are not Responses.
  - **Errors = 7**: 3 exception + 2 wrong unit + 2 truncated.
  - **Timeouts = 3**: the dropped replies.
  - The list shows 12 RX rows.

  General rule for any mix:
  - Responses = RX rows that are valid replies (including exceptions)
  - Errors = exception replies + bad replies (wrong unit, wrong transaction, wrong function, truncated, malformed, garbage)
  - Timeouts = requests with no reply byte
- [ ] **CHK-N8** [NONE] **Clipboard refused.** Given the clipboard write is denied (browser permission denied, or the fake rejects the write), when `Ctrl+C` is pressed in the data table, `Ctrl+C` is pressed on a selected traffic frame, or "Copy bytes" is clicked, then each time the toast "Could not copy to the clipboard." appears with the circle-x icon (error tone) for about 4 s, and no "Copied …" toast appears.

## O. Profiles
- [ ] **CHK-O1** [SIM] Given polling with FC04, start 5, Hex, 1-based, when Save as "Bench A" is used, then the title reads "Modbus Master - Bench A - Polling" with no "*" and no "Modified" text.
- [ ] **CHK-O2** [SIM] Given O1, when the quantity is changed, then the toolbar shows "Modified" with a dot and the title shows "*". `Ctrl+S` saves without a dialog and the marker clears.
- [ ] **CHK-O3** [SIM] Given a new window, when `Ctrl+O` is pressed and "Bench A" opened, then all connection, poll and display settings are restored, the state stays idle (no auto-connect), and Connect polls FC04 from 5 in Hex 1-based.
- [ ] **CHK-O4** [SIM] Given polling, when another profile is opened, then the dialog reads "Disconnect and load?" / "Loading "{name}" will disconnect from TCP 127.0.0.1:5020." Cancel keeps polling. Disconnect and load ends idle with the new settings.
- [ ] **CHK-O5** [NONE] Save as with an existing name shows "Replace profile?" / "A profile named "Bench A" already exists. Replace it?", with the default focus on Cancel.
- [ ] **CHK-O6** [NONE] Delete shows "Delete profile?" / "Delete "Bench A"? This cannot be undone." After confirming, the profile is gone from the list and from a newly opened window's list.
- [ ] **CHK-O7** [NONE] Given "Bench A" is loaded in this window, when it is renamed inline to "Bench B", then the toolbar and title show "Bench B", and `Ctrl+S` saves to "Bench B".
- [ ] **CHK-O9** [NONE] Given "Bench A" is loaded in window 1 and deleted from window 2, when `Ctrl+S` is pressed in window 1, then "Bench A" is created again, with no error.
- [ ] **CHK-O8** [NONE] Profiles survive an app restart.
- [ ] **CHK-O10** [NONE] Given a profile file with a newer `schemaVersion` (or damaged JSON) in the profile folder, when `Ctrl+O` is pressed, then that profile is listed with the triangle-alert icon and "Cannot be opened (newer or damaged file)", and Open is disabled for it.

## P. Multi-window
- [ ] **CHK-P1** [SIM] `Ctrl+N` opens a second window offset by 24px, idle, Untitled.
- [ ] **CHK-P2** [SIM] Window 1 polls 127.0.0.1:5020 while window 2 polls a second simulator on port 5021. Each shows its own values, counters, traffic and state. Pausing window 1 does not affect window 2.
- [ ] **CHK-P3** [SIM] Stopping simulator 5020 puts only window 1 in disconnected.
- [ ] **CHK-P4** [NONE] Closing a window with unsaved changes shows "Save changes?" (Save / Don't save / Cancel), and Cancel keeps the window open. Closing a window that is polling with no changes closes immediately and the simulator sees the socket closed.
- [ ] **CHK-P5** [NONE] Window size and position are restored after reopening.

## Q. Keyboard, copy, layout
- [ ] **CHK-Q1** [SIM] Every shortcut in DES 5.1 performs its action. `Ctrl+P` does not open a print dialog, `F5` and `Ctrl+R` do not reload, and `Ctrl+O`/`Ctrl+S` do not open browser dialogs.
- [ ] **CHK-Q2** [NONE] With a modal open, `Ctrl+L` and `Ctrl+P` do nothing and `Esc` closes the modal.
- [ ] **CHK-Q3** [SIM] With rows 0-1 selected in Hex, `Ctrl+C` pasted into a spreadsheet gives 2 rows x 2 columns: `0 | 0x04D2`, `1 | 0xFFFF`. The toast reads "Copied 2 rows."
- [ ] **CHK-Q4** [NONE] Dragging the Value column handle resizes it. It cannot go below 96px. Double-click auto-fits.
- [ ] **CHK-Q5** [NONE] The panel splitter has a focus ring, `Up`/`Down` move it, it clamps at 120px and 70%, and double-click resets to 35%.
- [ ] **CHK-Q6** [NONE] `Ctrl+\` hides the setup panel. `Ctrl+J` collapses traffic to its header, with the counters still visible.
- [ ] **CHK-Q7** [NONE] At the minimum window size of 960 x 600, there is no horizontal page scroll and all toolbar actions are reachable.
- [ ] **CHK-Q8** [SIM] The setup panel contains no Connect button.
  - Given idle with a valid host, when `Enter` is pressed in the Host, Port or Timeout field, then the app connects, exactly as with the toolbar Connect.
  - Given disconnected, `Enter` in a Connection field reconnects.
  - Given polling, `Enter` in a Connection field does nothing.
- [ ] **CHK-Q9** [SIM] In the traffic list:
  - `Ctrl+A` selects nothing (the data table is unaffected)
  - Shift-click and Ctrl-click after a selection leave exactly one frame selected
  - `Up`/`Down` move the single selection

## R. Accessibility and style
- [ ] **CHK-R1** [NONE] Tab order follows DES 7 exactly, and the focus ring is visible on light (dark ring) and dark panels (lime ring).
- [ ] **CHK-R2** [NONE] For each of the 9 session states, a grayscale screenshot still distinguishes the state by icon and label text alone.
- [ ] **CHK-R3** [NONE] No text sits on a solid red fill. Error text is dark with a red icon or border. Orange appears only on warning elements (timeout, bad response, warnings).
- [ ] **CHK-R4** [NONE] A screen reader (NVDA) announces "Disconnected. {reason}" once on link loss and does not announce value updates while polling.
- [ ] **CHK-R5** [NONE] All text uses Afacad except values, addresses, bytes and times, which use the monospace font. The UI is English only.
- [ ] **CHK-R6** [NONE] Invalid fields have `aria-invalid=true` and the message is linked via `aria-describedby`.

## S. Performance
- [ ] **CHK-S1** [SIM] FC03, quantity 125, scan 100 ms, for 10 minutes: the UI stays responsive (scrolling the table and traffic is smooth, Pause reacts within 100 ms), and the app's memory does not grow beyond the 5,000-frame cap (compare at 2 min and 10 min, within 10%).
- [ ] **CHK-S2** [SIM] S1 with two windows polling at the same time: both remain responsive.
- [ ] **CHK-S3** [NONE] The pass criterion is **0 long tasks over 50 ms** (PerformanceObserver `longtask`, after warm-up), for the Playwright long-task check from FE-001 task 18 (125 registers at 100 ms with the table and traffic list scrolled). It is run in two environments, with the same 50 ms criterion in both:
  - the browser smoke (Chromium with the fake IPC), now
  - WebView2 in integration mode (the real app), when available

  Record each result separately in the REPORT.

## State coverage index
| State | Items |
|---|---|
| idle | A1-A4, C4, I6 |
| connecting | B1-B4, I5 |
| connected | C1-C4 |
| polling | D1-D13, M13, M15, S1-S3 |
| paused | E1-E4, F5 |
| timeout | F1-F6, G6, M6 |
| exception response | G1-G6, M5, M16 |
| badResponse | H1-H8, M7 |
| disconnected | I1-I11, A5, P3, M17 (write link lost), M18 (queued write) |
| invalid input | J1-J29 |
| empty data | A1, C1, C3, E3, G3, K1-K5 |
| loading | L1-L5, D12, F4 |
| live / stale | D2, E1, F2, I4 |
