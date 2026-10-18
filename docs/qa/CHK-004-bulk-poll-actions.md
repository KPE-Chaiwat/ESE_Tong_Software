# CHK-004 Sidebar poll selection and bulk actions

Revision 1, 2026-10-18. Oracle: REQ-004, DES-004 and BE-004 final contract. Record pass/fail/evidence per item in REPORT-004 feature report (avoid overwriting existing numbered reports; PM assigns report name). [NONE] fake/UI; [SIM] real app + TCP simulator; [FAULT] injected failure + real app. Native/focus checks use real windows and CDP focus emulation disabled (D-002-39). Follow e2e/CHECKPOINT.md and disk guard; no new build solely for docs.

## Selection and gestures (B0/B1)

- [ ] CHK4-A1 [NONE] Given new/profile-replaced connection including replacement reusing ids, then 0 selected, all checkboxes clear and bulk actions unavailable. Selection changes never show Modified.
- [ ] CHK4-A2 [SIM] Given A active and 4 polls, when checkbox B then D is clicked, exactly B,D checked and count 2; A remains active, windows/focus hosts not raised, runtime scheduling unchanged. Activating C updates current bar/description without changing B,D.
- [ ] CHK4-A3 [NONE] Given anchor B and D checked, Shift+checkbox C adds B-C and leaves D; Shift+checkbox A adds A-B with B anchor retained. No anchor selects target only. After reorder, range follows new visible order; deleted anchor resets safely.
- [ ] CHK4-A4 [NONE] Tab to checkbox, Space toggles; Shift+Space adds range. Up/Down/Home/End move checkbox focus without selecting; Shift+Up/Down adds anchor range. Ctrl+A selects all and Ctrl+Shift+A clears only within allowed list targets; count announces politely.
- [ ] CHK4-A5 [NONE] Given focus in rename, Connection input, setup, grid, traffic, menu, toolbar or W2, then selection shortcuts do not run. Native text Ctrl+A/C/V/X/Z, IME and AltGr work. Row Delete remains single-poll confirmation even when other ids are checked; no destructive shortcut in editors.
- [ ] CHK4-A6 [SIM] Plain/Shift row click and Enter Show one poll; checkbox never Shows or arms drag. Drag checked B moves only B, membership stays by id; normal list reorder/drop/Alt+Up/Down and context menu/rename/copy retain behavior.
- [ ] CHK4-A7 [NONE] At sidebar 220 px and 16 polls, controls wrap and rows/checkbox names remain accessible. Checkmarks and active bar distinguish membership/current without color. Screen reader announces checkbox checked, current target, names/state/host and selected count; no interactive option descendants.

## Duplicate (B3/B5/B6)

- [ ] CHK4-B1 [SIM] Given [A,B,C,D], A,C selected with distinct persisted aliases/scales/display/interpretation/color settings, duplicate -> [A,B,C,A copy,C copy,D], unique fresh ids and exact persisted settings. Sources unchanged/selected; new copies unselected. Values/counters/failures/drafts absent/reset.
- [ ] CHK4-B2 [NONE] Existing case-insensitive copy names and 48-character source names allocate unique copy/copy 2 suffixes including earlier transaction copies; no name exceeds 48 chars.
- [ ] CHK4-B3 [SIM] With connected auto-start on, copies Waiting then Polling; off -> Paused. Idle/connecting/disconnected -> Offline. RTU-invalid definition follows existing paused rule (hardware test only if required). Loading/empty source is copyable without copying data.
- [ ] CHK4-B4 [NONE] At 15 polls select two: duplicate gives "Cannot duplicate 2 polls. This connection has room for 1 more (maximum 16)." and no copies. Select one: succeeds at 16. At 16 select one: room for 0. Direct backend full-operation request rejects overflow without any definition mutation.
- [ ] CHK4-B5 [SIM] Duplicate open workspace, open native and closed sources: copies use same open host kind or workspace for closed; existing placement behavior applies. Native source stays intact, W1 bulk focus recovers; no grouped drag or lost definitions.
- [ ] CHK4-B6 [FAULT] Double-click/Enter while busy sends one request, announces Duplicating; stale id/precondition failure changes no definitions. Exact error appears below actions, does not steal focus. Inject window error: result distinguishes commit state, surviving definitions remain Show-recoverable, retry does not create unintended extra copies.

## Delete (B2/B4/B5/B6)

- [ ] CHK4-C1 [SIM] Select running, paused, timeout/exception, closed and native polls including dirty views. One W1 modal names count/all full names/host markers and warns unapplied changes lost. Cancel initially focused; Cancel/Esc retains definitions, drafts, views, selection and scheduling.
- [ ] CHK4-C2 [SIM] Confirm once -> one transaction, Deleting busy state, no duplicate submission or native Keep prompts. All selected views close and scheduling stops; unselected definitions/values/hosts keep running. Existing connection totals retained; deleted traffic filter becomes All polls. Profile Modified.
- [ ] CHK4-C3 [NONE] Selection/definition changes elsewhere during confirmation cause complete rejection/invalidation and "The selected polls changed. Review your selection and try again." New confirmation required; no silently reduced deletion. Invalid/stale ids and backend lifecycle precondition rejection preserve all definitions.
- [ ] CHK4-C4 [SIM] Delete A,C from A,B,C,D: focus D checkbox; delete final-position D: previous survivor; delete last/all: 0 polls, existing No polls yet text/New poll focus, connection remains open, no replacement poll. Surviving active poll remains active.
- [ ] CHK4-C5 [FAULT] Force backend rejection and native window failure using approved hook/fake contract: no partial definition mutation on validation; committed result reconciles authoritative ids/hosts; recoverable window notice identifies affected poll and Show action, no surviving definition silently lost. Record backend recovery outcome; never assume rollback.

## State, persistence and performance

- [ ] CHK4-D1 [SIM] Repeat selection/operation in idle, connecting, connected paused, polling with empty/loading data, timeout, exception and disconnected states. Existing chips/messages and connection behavior remain correct; invalid setup drafts do not enter copies; operation alone does not connect.
- [ ] CHK4-D2 [SIM] Save/reopen profile after successful duplicate/delete -> exact definitions/settings/order. Selection absent from profile and cleared on replacement. Selection/cancel/failure do not mark Modified; successful definition changes do.
- [ ] CHK4-D3 [SIM] Hide/show sidebar, compact peek, native Show/Keep, unrelated deletion and add preserve/prune membership as specified. With 16 polls at minimum scan rate selection rows do not render on each counter event; existing performance limits hold.
