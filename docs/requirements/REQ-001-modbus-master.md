# REQ-001 Modbus Master (MVP)

Owner-facing name: **Modbus Master** (in-house replacement for Modbus Poll). Launched from the ESEfact launcher.

## Goal
An engineer connects to a Modbus device (TCP or serial), polls registers cyclically, sees the values live in a table, writes values, and can inspect the raw bytes exchanged.

## User stories
1. As an engineer I create a connection (Modbus TCP: host + port; Modbus RTU: COM port, baud, data bits, parity, stop bits) and connect/disconnect.
2. As an engineer I define a poll: slave id, function (01, 02, 03, 04), start address, quantity, scan rate (ms), and see the values refreshing in a table.
3. As an engineer I can view values in several formats (signed, unsigned, hex, binary; 16-bit registers) and choose address base (0-based or 1-based display).
4. As an engineer I write a single coil/register (05, 06) and multiple coils/registers (15, 16) with validation.
5. As an engineer I see a Communication Traffic panel with timestamped raw TX/RX bytes in hex, and counters (requests, responses, errors, timeouts).
6. As an engineer I see clearly when the device returns a Modbus exception, times out, or the link drops.
7. As an engineer I can save and reload connection + poll definitions (named profiles).
8. As an engineer I can open more than one Modbus Master window at the same time, each with its own connection.

## Out of scope (new REQ later)
ASCII mode, Modbus Slave, charts/trending, CSV export, scripting, 32-bit/float decoding, multi-poll-per-window tabs.

## Acceptance criteria
- Every function in the user stories works against a simulated TCP slave.
- Invalid input (address 0-65535, quantity limits per function, slave id 0-247) is rejected before sending, with a clear message.
- Timeout, exception response and disconnect each have a visible, distinct state and recover without restarting the app.
- Polling 125 registers at 100 ms does not freeze the UI.
- Raw frame bytes in the traffic panel match what is on the wire.
- UI follows CLAUDE.md visual identity; English only.

## Constraints
Windows first, portable later. Implemented from the public Modbus specification (no decompilation of Modbus Poll). Follow all rules in CLAUDE.md.

## Defaults chosen by PM (owner may override)
Display base default 0-based; default scan rate 1000 ms; default timeout 1000 ms; traffic log keeps the last 5,000 frames.

## Open questions
None blocking.
