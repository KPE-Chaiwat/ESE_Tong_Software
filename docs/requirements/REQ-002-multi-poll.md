# REQ-002 Multiple polls per connection, each viewable in its own window

Source: owner feedback after trying the first build of Modbus Master (REQ-001). Owner answer to the clarifying question: "multiple polls in one connection".
Extends REQ-001. Today one window = one connection = one poll definition. Real work needs several readings watched at the same time (different slave / function / address range / scan rate), as Modbus Poll does with several poll windows over one connection.

## Goal
An engineer connects once and then watches several independent poll definitions at the same time, each in its own view that can be placed freely (including on another monitor).

## User stories
1. As an engineer I connect once, then add several poll definitions to that connection. Each has its own slave id, function (01-04), start address, quantity and scan rate, plus a user-given name (e.g. "Tank 1 temperatures").
2. As an engineer I open each poll as its own window and arrange the windows freely (own monitor, resize, move). A poll can also be shown inside the main window for compact work (designer decides the exact presentation; separate native windows are mandatory, in-window panes optional).
3. As an engineer I start, pause, edit and remove each poll independently without touching the others.
4. As an engineer I see the state of each poll separately (live, timeout, exception, bad response, paused) and the state of the connection (connected, disconnected, ...) clearly separated from them.
5. As an engineer I see one Communication Traffic view for the connection, and can filter it to one poll.
6. As an engineer I write values from any poll window (existing Write dialog, using that poll's slave id), and the write is queued correctly among the polls.
7. As an engineer I save and reload the whole setup in one profile: connection, all polls (with their names, scaling from REQ-003, display options) and where their windows were. Profiles saved by REQ-001 (one poll) must still open (migration).
8. As an engineer I can still open more than one connection window (REQ-001 story 8: two devices at the same time).

## Out of scope (new REQ later)
Charts/trending, logging to file, different connections inside one window, linked/computed registers across polls, 32-bit/float decoding.

## Acceptance criteria
- Up to 16 polls on one connection run at the same time; requests never overlap on the wire (the link is serial); each poll honors its own scan rate as far as the link allows, and no poll is starved (round-robin/earliest-deadline; designer and backend document the rule).
- A timeout, exception or bad response in one poll does not stop the others (the connection stays up; only socket errors or close cause `disconnected` for everything).
- Closing a poll window removes the view only after the user chooses whether to keep or delete that poll definition (no silent loss); closing the connection window closes or detaches all its poll windows with a clear confirm if any has unsaved changes.
- Windows opened for a poll keep working if the main connection window is minimized.
- Values written from a poll window go on the wire between poll requests (same queue rule as REQ-001: after the in-flight request, before the next poll cycle).
- Traffic panel bytes still match the wire exactly; counters are per connection with per-poll counts available.
- 8 polls at 100 ms scan on the simulator do not freeze any window (0 long tasks over 50 ms in the browser smoke and WebView2 runs); memory stays bounded (frame cap per connection as before).
- Old one-poll profiles open without data loss; saving writes the new schema (schemaVersion bump; unknown newer version is still rejected).
- English UI only; visual identity per CLAUDE.md.

## Constraints and notes for the team
- This changes the Rust session model (today `PollDefinition` is single). The designer must analyze the impact on the DES-001 state machine (T1-T15) and propose how connection state and per-poll state are modeled; the PM will then write BE-002. Existing contract names stay where possible; migration path for bindings must be explicit.
- Event delivery: each poll window needs its own ordered event stream (or a demultiplexed one) and a snapshot on open/reload, as in REQ-001.
- Window management stays in the thin Tauri layer; the frontend never polls on a timer.
- Windows first, portable later.

## PM defaults (owner may override)
Max 16 polls per connection. Default poll name "Poll N". New polls start paused, not auto-polling, unless "Start polling when connected" is on for the connection.

## Open questions for the designer
How poll windows are created (from the main window list, a toolbar button, drag out?), how a closed poll window is brought back, and whether the main window shows a compact list of all polls with their states.
