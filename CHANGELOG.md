# Changelog

All notable changes to ESEfact are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is below
1.0.0 the product has not been signed off by the owner and minor releases may change behavior.

Every user-visible change adds a line under `## [Unreleased]` in the same change. On release the
entries move into a new version section (see "Versioning and changelog" in `docs/SETUP.md`).

## [Unreleased]

### Added
- The app version is shown as "ESEfact v{version}" in the launcher footer and at the right end of
  the Modbus Master status bar. The version comes from a single source (the workspace
  `Cargo.toml`); `pnpm version:set <x.y.z>` updates every file and `pnpm version:check` (part of
  `pnpm check`) fails when they disagree.
- This changelog.

- Modbus Master, several polls per connection (REQ-002). Connect once, then add up to 16 named
  polls (own slave id, function, address range and scan rate). Each poll is shown as a sub-window
  inside the connection window's workspace, or popped out into its own window and docked back.
  Polls start, pause, edit and delete independently; a poll's timeout, exception or bad response no
  longer changes the connection state. One Communication Traffic view per connection, filterable
  by poll. Profiles save the whole setup including window layout; profiles saved by 0.1.0 (one
  poll) still open and are migrated when saved.
- Modbus Master workspace: move, resize, minimize, maximize and close sub-windows; snapping to
  edges, other windows and snap zones; Window menu with Tile, Cascade and tile mode; reorder polls
  in the sidebar by dragging; drag a poll from the list into the workspace; keyboard equivalents
  for every drag action; Arrange for popped-out windows (Tile, Side by side, Stacked, Cascade, per
  monitor) and a compact mode.
- Modbus Master Alias column: an optional label per address, editable in the table, saved in the
  profile, optionally included when copying.
- Modbus Master value scaling (REQ-003): presets None (raw), 4-20 mA, 0-10 V, divide by 10, 100 or
  1000, and a custom linear scale (Xmin, Xmax, Ymin, Ymax), with decimal places, unit, signed raw
  and flag or clamp for values outside the raw range. Per-poll scale with per-row or per-range
  overrides, a Scaled column next to Raw, copy options, and a scaled preview in the Write dialog.
  Scaling is display only; the value sent is always the raw value.
- Dev simulator (`esefact-sim-slave`): fault filter per unit id (`... unit=<id>`), `OVERLAP` and
  `ABANDONED` log lines and a `master-timeout` command (test tool only, not part of the app).

- Modbus Master polls issue requests at the configured scan rate on Windows (the system timer
  resolution is raised to 1 ms only while a poll is running), instead of being rounded up to the
  15.6 ms timer tick (a 100 ms poll used to run every 109 ms).
- Keyboard: a lone Alt tap no longer freezes the window (it used to enter the Windows window-menu
  mode); shortcuts defined by a Latin letter or digit also work with non-Latin keyboard layouts
  such as Thai (matched by the physical key).
- Modbus Master native poll windows: the setup opens as a popover when the window is narrower than
  640 px; no page scrollbar at any width; the connection window now fits the screen's work area.

### Changed
- Modbus Master native window minimum size is 480 x 320 including the title bar and borders, so
  nine popped-out windows tile on a 1080p screen.
- Profile format is now schema 2 (layout, aliases, scale settings). Earlier builds cannot open a
  profile that was saved in the new format.

### Known limitations (unreleased work)
- The multi-poll, workspace, drag and scaling features are covered by unit, component and
  simulated-IPC tests but have not been run in a real window yet: pop out, dock, Arrange, DPI and
  multi-monitor behavior, the real close behavior and migration of real 0.1.0 profiles are
  unverified until the integration run.
- Pop out by dragging a sub-window out of the workspace and dock by dragging a native window back
  are not implemented (planned for a later phase; buttons and shortcuts work).

## [0.1.0] - 2026-10-16

First working build of the ESEfact launcher with its first tool, Modbus Master (REQ-001). This is
a pre-1.0 build: the owner has not signed off the visual identity or the final status colors.

### Added
- ESEfact launcher: a page with one card per tool (manifest-driven). "Open" starts the tool in its
  own window; the launcher stays open to start more.
- Modbus Master, connection:
  - Modbus TCP (host, port, timeout) and Modbus RTU (COM port picked from the detected ports,
    baud, data bits, parity, stop bits, timeout).
  - Connect, cancel while connecting, disconnect, reconnect and dismiss. The connection and
    session state live in the Rust backend; the UI only displays it.
  - Distinct, visible states for timeout, Modbus exception, bad response and lost link, each with
    an icon and text (never color alone). Polling recovers without restarting the app.
  - Several Modbus Master windows at the same time (launcher or Ctrl+N), each with its own
    connection and session.
- Modbus Master, polling and display:
  - One poll per window: slave id (0-247), function 01, 02, 03 or 04, start address, quantity
    and scan rate, with input validated before anything is sent. Start, pause, resume and apply
    changes while connected.
  - Live table of 16-bit values in unsigned, signed, hex or binary, with 0-based or 1-based address
    display. Values are streamed from the backend through a Tauri channel; the frontend does not
    poll on a timer.
- Modbus Master, writing:
  - Write dialog for function 05 (single coil), 06 (single register), 15 (multiple coils) and 16
    (multiple registers), with validation and a clear result (written, exception, timeout, bad
    response, not connected, or link lost during the write).
  - Writes are sent between poll requests (after the request in flight, before the next cycle).
  - On Modbus TCP, unit id 0 is a normal unit and waits for the reply; "Broadcast sent" applies
    to RTU only.
- Modbus Master, Communication Traffic panel: timestamped raw TX and RX frames in hex, exactly the
  ADU bytes on the wire (MBAP header, or slave id and CRC, included), notes for bad responses and
  late replies, the last 5,000 frames kept, and counters for requests, responses, errors and
  timeouts.
- Profiles: save, open, rename and delete named profiles (connection, poll, display settings and
  auto-start) as files in the app data folder. A profile with an unsupported newer schema version
  is listed as unreadable instead of being opened.
- Window position and size are remembered between runs.
- English-only UI with the ESEfact visual identity (tokens defined once in
  `apps/desktop/src/app/styles.css`); Afacad and JetBrains Mono are bundled with the app, so no
  network is needed at runtime.
- Windows installer target (NSIS) configured in `tauri.conf.json`. Signing is not configured in the
  repository.

### Development
These are for building and testing the product and are not part of the shipped app.
- `esefact-sim-slave` (crate `dev-sim-slave`): a Modbus TCP slave simulator with scripted faults
  (delays, dropped replies, exceptions, wrong unit, function or transaction id, truncated or
  garbage replies, closing the socket) used by QA. It is a test tool only, is not bundled, and is
  not the future Modbus Slave product. See `docs/SETUP.md` section 4.
- One-command scripts for dev, build, typecheck, lint, tests and ts-rs binding generation; CI
  fails when the committed bindings are stale (`pnpm bindings:check`).
- Test suites reported by the team: 157 Rust tests, 934 Vitest tests, Playwright UI mode 218 pass,
  0 fail and 16 skipped, and integration runs against the real app (WebView2) with the simulator,
  3 consecutive runs of 65 pass, 0 fail and 1 skipped (`docs/qa/REPORT-001-ui-mode.md`,
  `docs/qa/REPORT-002-integration.md`).

### Known limitations
- Serial RTU has not been tested on real hardware (no serial device or sniffer was available).
  RTU is covered by unit and loopback tests only; RTU broadcast and real port removal behavior are
  unverified.
- Not tested on this setup: a slow or blackholed connect and cancelling during it, DNS host
  resolution, a screen reader (NVDA), and the 10-minute soak test (only 2 minutes were run).
- One poll per window and raw values only (no 32-bit or float decoding, no scaling); see the
  Planned entries under Unreleased.
- No ASCII mode, charts or trending, CSV export or scripting (out of scope for REQ-001).
- The app icon is a placeholder.
- The Windows installer build (`pnpm build`) has not been run yet, and no code signing is
  configured.
- Owner decisions still open: final success and error colors, the surface color, and the
  monospace font.
