# REV-004 Backend review: multi-poll, host and routing model (BE-002 phase 1)

Scope: the Rust side of BE-002 phase 1:
- `crates/shared-types`
- `crates/modbus-master` (session actor, scheduler, connection_state, poll_state, emitter, poll, validate)
- `crates/platform` (mm_profile.rs, arrange.rs, profiles.rs)
- `crates/transport/src/link.rs` (`buffered()`)
- `crates/dev-sim-slave`
- `apps/desktop/src-tauri` (commands, poll_windows, desktop, tauri_desktop, windows, state, lib, `capabilities/default.json`)

The frontend (`apps/desktop/src`) was not reviewed. It was only read to check which window APIs and command keys it uses.

Inputs: CLAUDE.md; DES-002 rev 6 (sections 1, 2.5, 2.8, 2.11, 2.13, 4, 6, 7, 8); BE-002, including its PM decisions and Final contract; `docs/questions.md` Q-BE2-01..06; REV-001.

Reviewer: code-reviewer, 2026-10-16. The working tree is uncommitted, so this review covers the files on disk.

## Commands run (read-only)
| Command | Result |
|---|---|
| `cargo fmt --all --check` | clean |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `cargo test --workspace` (part of the log was lost; the missing crates were re-run with `cargo test -p esefact-desktop -p dev-sim-slave -p modbus-core`) | all pass. 266 tests in total, matching the BE-002 inventory: modbus-core 19 + 8, transport 21, modbus-master 28 unit + 19 multi_poll + 25 session + 3 tcp_loopback, platform 26, shared-types 87, src-tauri 15, dev-sim-slave 3 + 10 + 1 + 1 |
| `node scripts/gen-bindings.mjs --check` | "bindings: up to date (76 files)" |
| Tauri 2.12.4, tauri-runtime-wry 2.12.2 and tao 0.37.1 sources in the cargo registry (read-only) | checked when the Destroyed handler runs, and how tao enforces the minimum window size (finding M1) |
| `cargo nextest` | not installed, so not run |

## What was checked and found correct

### Scheduler (DES-002 section 7)
- One request in flight: `dispatch` only runs when `inflight` is `None` and the link is idle (`session.rs:1526-1551`).
- Queued writes are popped before `Scheduler::pick`.
- `pick` takes the earliest `nextDue` that is not in the future. Ties go to the least recently served poll (`last_served` tick), then to the lower id (`scheduler.rs:101-107`).
- `served` sets `nextDue = start + scan`. This equals the DES formula `max(lastStart + scan, now)` because it is applied at serve time, so after a slow request the poll gets one immediate request and no burst.
- No starvation. Every other poll that is served gets `nextDue >= serve time + 20 ms > t0`, so it cannot overtake an already-due poll a second time. A due poll therefore waits at most 15 requests plus queued writes.
- List order, host, attach, detach, reorder and layout never call the scheduler (checked every `scheduler.` call site).
- **Poll changed while its request is in flight:**
  - remove: the entry and the scheduler entry are gone; the reply counts only in the totals.
  - pause, Apply, link down: the generation is bumped, so `is_current` rejects the reply.
  - rename: nothing changes.
  - All of these are tested (`remove_while_in_flight_discards_the_reply`, `pause_resume_apply_and_disconnect`).
- **RTU:**
  - `hold_line` runs after every reply (t3.5 or 5 ms), after a timeout (frame silence), after a broadcast (turnaround) and after unsolicited bytes. It is per exchange, so it also applies between different polls and units.
  - Slave 0 reads are rejected on RTU at add, update and resume time. On link up such a poll comes up paused (Q-BE2-05).
  - Broadcast applies to RTU writes only (REV-001 F1 holds).

### State machines (DES-002 1.3 and 1.4)
- `ConnectionMachine` implements exactly C1-C7, and `PollMachine` implements exactly PT1-PT7 plus PT6b. Table tests cover every legal pair and every illegal pair, and an illegal pair leaves the state unchanged.
- Failure counting is per poll and saturates.
- I traced every `conn_event` and `poll_event` call site. None can produce an illegal pair:
  - link-lost paths only run while connected;
  - `LinkUp` is only applied to offline polls;
  - `Resume` is only applied to paused polls.
- Poll timeout, exception and bad response never reach `conn_event` (`on_timeout`, `on_reply`). Only link errors cause C6.
- C6 takes every poll to offline (`polls_link_down`), and C2 restarts each poll according to `active && autoStartPoll`. Both are tested.

### Routing
- At most one view per poll (`PollEntry.view: Option<ViewRoute>`).
- Attach validates the host and the open flag. The window layer also checks that a W2 attaches only its own poll as `native`, and that W1 attaches only `workspace` views.
- Replacing a view sends `ViewDetached{replaced}` as the old channel's last event.
- A late detach with an old token is a no-op.
- Coalescing is per view:
  - `PollUpdate` at most once per 50 ms, latest wins, flushed before `PollStateChanged`, discarded on Apply, C5 and C7;
  - counters at most once per 100 ms;
  - `seq` is stored per poll, so it stays monotonic across views.
- Dead sinks are pruned on every actor turn.
- A W2 that is destroyed without detaching is handled by `on_destroyed`. Tauri removes the window from the manager (`app.rs:2707-2714`) before the user handler runs (`tauri-runtime-wry` `lib.rs:4219-4228`), so the "recreated under the same label" guard is correct.
- Handoff:
  - stored once and delivered once;
  - delivered only if at most 10 s old (`<=`);
  - limited to 256 KiB, checked both at the pop-out boundary and in the session;
  - the 1 s request timeout runs outside the actor (`request_handoff`), so the actor never blocks.
- Pop out, dock, show and close change only host fields and routing. This is tested with 5 cycles: no extra requests, and the poll state is unchanged.

### Validation
- Rules checked:
  - 16-poll limit (`polls`);
  - poll names: DES-002 section 4 rule order, uniqueness ignoring case (`to_lowercase`);
  - aliases: count 2000, unique address, the 32-character, space and control-character rules, stored sorted;
  - reorder: a full permutation with no duplicates;
  - layout: sidebar width 220-400 (NaN rejected), finite traffic height and rectangles;
  - handoff size;
  - `AppError.field` is carried to the frontend (REV-001 N8 holds).

### Profiles
- **v1 -> v2 migration** (`migrate_v1`) matches DES-002 6.2 field by field:
  - "Poll 1", `active: true`;
  - display plus `showAlias: true`, `copyAlias: false`;
  - `scale: null`, `[]` overrides, `raw` value columns, `[]` aliases;
  - view `{workspace, open, null, null}`;
  - default workspace settings, `connectionWindow: null`, `migratedFrom: 1`;
  - the file on disk stays v1 until it is saved.
- Schemas 3 and up return `UnsupportedSchema`.
- Damaged v2 files (11 cases) are `Invalid`, and `profiles_list` shows them as `readable: false`.
- `profiles_save` writes v2 without `migratedFrom`.
- Writes are atomic: `write_atomic` and `write_new`, with `create_new` semantics through a hard link.
- **REV-001 regressions all hold:**
  - F3: names cannot start with a dot;
  - N1: superscript device names are rejected;
  - N2: no check-then-act race on create or rename;
  - path traversal: names exclude `\ / :`, leading and trailing dots, and Windows device names; `get` and `delete` only match listed files; `tool_id` is whitelisted.

### Tauri layer
- Commands only delegate. Label and route are `modbus-master-<n>-poll-<id>` and `tools/modbus-master/poll?pollId=<id>`, with min 480 x 320 and default 900 x 640, created hidden.
- **Teardown:** when W1 is destroyed, `remove_session` calls `Session::close` (non-blocking on the main thread). The actor aborts and awaits the in-flight task, then closes the link, and every W2 of that connection is destroyed.
- No `std::sync::Mutex` is held across an `.await`. File I/O and port listing run on `spawn_blocking`. Windows are only created from async commands.
- **Capabilities:** the frontend (`shared/ipc/window.ts`) calls only `setTitle` and `onCloseRequested`. The latter needs `core:event` listen (in `core:default`) and calls `destroy()` when the close is not prevented. Monitors and arrange go through commands. `core:default` plus `allow-set-title` plus `allow-destroy` therefore covers every call, and `modbus-master-*` matches the W2 labels. **No permission is missing**, and the fs and dialog grants from REV-001 N6 are gone.

### Arrange and placement
- `arrange.rs` follows DES-002 2.8 steps 1-9 and passes WT-1..4 and NT-1..3:
  - remainder pixels go to the last column and row;
  - a short last row shares the full width;
  - overflow is cascaded from A's top-left;
  - cascade uses `m = min(n, 10)` with the 240 px column shift.
- The DES-002 2.13 restore rule and the cascade fallback on W1's monitor are implemented and tested. A missing target monitor returns `validation` with `field: "monitor"`.

## Findings

### Blocker
None.

### Major

**M1. The native window minimum is set as an inner size, while arrange and pop-out compute outer rectangles. NT-2 and NT-3 (3 x 3 and 4 x 3 on 1080p) do not fit in a real decorated window.**
- **Where:**
  - `apps/desktop/src-tauri/src/commands/poll_windows.rs:37`: `.min_inner_size(480, 320)`.
  - `crates/platform/src/arrange.rs:77-81` and `:106-110`: `NATIVE.min = (480, 320)` is used to compute `maxCols` and `maxRows` of **outer** rectangles.
  - `arrange.rs:303-306`: `pop_out_rect` applies the minimum to the outer size.
  - `apps/desktop/src-tauri/src/tauri_desktop.rs:101-113`: `place` converts the wanted outer size into an inner size by subtracting the frame.
- **Mechanism (verified by reading tao 0.37.1 `platform_impl/windows/event_loop.rs:1783-1810`):** tao answers `WM_GETMINMAXINFO` with `ptMinTrackSize` = the minimum inner size plus the frame. `DefWindowProc` enforces this minimum on every `SetWindowPos` of a captioned, resizable window.
- **Scenario (Windows 11, 100 %, work area 1920 x 1032):**
  - NT-2 asks for 640 x 344 outer cells. The frame is about 16 x 39 px (invisible resize borders plus the caption), so the requested inner height is about 305 px, below the 320 minimum.
  - Each window becomes about 359 px tall. Rows overlap by about 15 px, and the third row ends about 45 px under the taskbar.
  - NT-3 (480 x 344 cells) is also too narrow: about 464 px inner width against a 480 minimum. Rows and columns overlap.
  - This is exactly the case the owner lowered the minimum for (Q-002-10: "Tile fits 3 x 3 native windows on a 1080p monitor"). The unit tests pass because the fake `Desktop` does not enforce a minimum.
- **Fix (needs a PM or designer decision, because DES-002 does not say whether 480 x 320 is the inner or the outer size):**
  - Either keep `NATIVE.min` as an outer size and set the W2 `min_inner_size` to that size minus the frame (for example 464 x 280), so a 480 x 320 outer window is allowed;
  - or keep the inner minimum and compute `maxCols`/`maxRows` and `pop_out_rect` with `min + frame`, where the frame is measured from a live window. In that case, update the DES-002 2.8 NT vectors.
- Also add a check to CHK-002 that runs NT-2 on a real 1080p display.

### Minor

**m1. On the view channel, `ConnectionStateChanged` does not flush the pending `PollUpdate`, although the Final contract says it does.**
- **Where:** `crates/modbus-master/src/emitter.rs:221-226` flushes only for `PollStateChanged`. `session.rs:1228-1238` (`conn_event`) broadcasts `ConnectionStateChanged` to the views, and `link_lost` (`session.rs:1458-1464`) only then calls `polls_link_down`.
- **Scenario (C6 within 50 ms of a good cycle):** the view receives `ConnectionStateChanged(disconnected)`, then the `PollUpdate` (flushed by the next event), then `PollStateChanged(offline)`. For a moment a view can apply "fresh" values after it has already shown the connection as lost. The BE-002 Final contract ("ConnectionStateChanged, PollStateChanged: ... a pending PollUpdate is flushed first") does not hold for the first of the two.
- **Fix:** in `ViewEmitter::now`, also call `send_update()` for `ConnectionStateChanged`. Add an emitter test.

**m2. A native window created from a W2 (H2 new poll, H3 duplicate) opens 48 px or more from the invoking window instead of 24 px.**
- **Where:** `apps/desktop/src-tauri/src/commands/modbus_master.rs:176-184`. `k` counts every other native-open poll, including the invoking W2. `crates/platform/src/arrange.rs:279-281` uses a step of `24 * (k + 1)`.
- **Scenario:** with only the invoking W2 open, `k = 1`, so the offset is 48 px. With five popped-out polls it is 144 px. DES-002 H2 says "cascaded 24px from the invoking W2".
- **Fix:** pass `k = 0` when the reference is the invoking W2. Keep `k` for the W1-relative cascade of DES-002 2.13.

**m3. Duplicate ids in `minimizedOrder` are stored by `mm_set_workspace_layout`. The exported profile then cannot be saved.**
- **Where:**
  - `session.rs:2375-2380` filters unknown ids but does not remove duplicates;
  - `validate.rs:341-362` does not check them;
  - `export_profile` (`session.rs:2511-2518`) maps them to duplicate indexes;
  - `check_profile` (`mm_profile.rs:152-161`) rejects duplicate indexes.
- **Scenario:** a frontend bug (or a race between minimize and restore) sends `minimizedOrder: [3, 3]`. `Ctrl+S` then fails with `validation` / `workspace`, "workspace.minimizedOrder has an invalid poll index 0.", and the user cannot save until the layout changes again.
- **Fix:** remove duplicates in `set_workspace_layout`, as `apply_profile` already does (`session.rs:2471-2481`), or reject them in `validate_layout` with `field: "minimizedOrder"`.

**m4. Geometry from the frontend and from profiles is only checked for being finite. Huge values overflow `i64` arithmetic, which panics in debug builds.**
- **Where:**
  - `mm_pop_out_poll` does not validate `PopOutAnchor` (`modbus_master.rs:466-499`). `desktop.rs:192-215` computes `w1.inner_origin.0 + off.0` and `cursor.0 - off.0`.
  - `WindowPlacement::is_valid` (`layout.rs:121-123`) and `check_profile` accept any finite placement. `Rect::from_logical` saturates to `i64::MAX`, after which `Rect::intersection` (`arrange.rs:54-58`, `self.x + self.w`) overflows inside `restored()`.
- **Scenario:**
  - `mm_pop_out_poll` with `anchor.rect.x = 1e300` (valid JSON) overflows on addition: a panic in the async command in dev builds, and a wrapped value in release.
  - A hand-edited profile with `"native": {"x": 1e300, ...}` passes `profiles_get` and panics in `mm_apply_profile` in a debug build.
- **Fix:** validate anchors and placements at the boundary (finite, and for example `|v| <= 1e6`; reuse `LogicalRect::is_valid` plus a range check, `field: "anchor"`). Use `saturating_add`/`saturating_sub` in `Rect` and `desktop.rs`.

**m5. Only one pending handoff request exists per session. A second list-drag dock cancels the first at once.**
- **Where:** `session.rs:2334-2353`. `pending_handoff = Some((id, tx))` replaces and drops the previous sender, and `request_handoff` (`session.rs:493-496`) maps the dropped sender to a refusal.
- **Scenario:** the user drags native poll A from the list into the workspace, then drags native poll B within 1 s. A's dock fails at once with the toast "Close the dialog in the "A" window first." although no dialog is open.
- **Fix:** keep a map `PollId -> Sender`, or reject the second request with `invalidState` instead of silently cancelling the first.

**m6. The W2 is created before the session marks the poll native. The frontend does not retry a rejected attach.**
- **Where:** `modbus_master.rs:492-497` (pop out) and `:185-190` (`open_native` for Show of a closed native poll): `poll_windows::create`, then `set_native_open`. `session.rs:2155-2164` rejects `attach(native)` while the host is still `workspace` or the poll is closed. `apps/desktop/src/tools/modbus-master/runtime/poll-view-runtime.ts` turns a rejected attach into `attachFailed` with no retry.
- **Scenario:** the new webview loads and attaches before `set_native_open` has been processed. Normally the page load is much slower than the few main-thread round trips in between, so this is unlikely. If it happens, the W2 shows no poll, and the handoff waits unused for up to 10 s.
- **Fix:** mark the poll native first (the session already supports undo through `dock` or `native_window_destroyed`) and roll back if `create` fails. Alternatively, have the W2 retry the attach once when it gets `field: "host"`.

**m7. The simulator logs a false `OVERLAP` when a `fault delay` is longer than the master's timeout.**
- **Where:** `crates/dev-sim-slave/src/server.rs:97-112`. The OVERLAP check runs after the fault delay.
- **Scenario:** `fault delay 2000` with a 1000 ms master timeout. The master times out and correctly sends its next request, which is waiting when the late reply is sent, so the log says OVERLAP. QA may then report a scheduler bug that does not exist (CHK items that assert "OVERLAP never logged").
- **Fix:** skip the check, or label it "(after an injected delay)", when `delay` is not zero. Document this in the SETUP lines that Q-BE2-06 asks for.

### Nit
- **n1** `apps/desktop/src-tauri/src/desktop.rs:192-198, 210-213`: the cursor anchor's `grabOffset` is converted with W1's scale factor, not the target monitor's. On a 200 % monitor with a 100 % W1, the title bar lands 20 x 10 px off. This is low priority, because pop out by drag is behind the spike.
- **n2** `desktop.rs:60-76`: `floor` for physical to logical and `round` for logical to physical leave 1 px gaps or overlaps at 125 % and 150 % (for example a logical 1706 width becomes 2559 physical). Rounding consistently, or giving the last cell `area.right - x` in physical px, would close the gaps.
- **n3** `modbus_master.rs:510-519`: with `requestHandoff: true`, `workspaceRect` is only validated in `Session::dock`, after waiting up to 1 s for the handoff. Validate it before sending `HandoffRequested`.
- **n4** `session.rs:2355-2363`: `close_view_keep` does not clear a stored, unconsumed handoff. DES-002 2.11 says Keep discards unapplied drafts, but a Show within 10 s could still restore them from that handoff. Set `p.handoff = None` there.
- **n5** `crates/transport/src/link.rs:192-206`: `buffered()` keeps reading while bytes are available, with no upper bound on `pending`. This is acceptable for a test-only caller; note it in the doc comment.
- **n6** `session.rs:1828-1829`, `1959-1961`: `add_poll` and `update_poll` validate slave 0 against the last connection's mode while idle. After an RTU session, the user cannot prepare a unit-0 poll for a TCP connection until they connect over TCP. This is conservative and consistent with Q-BE2-05; mention it in the contract.

## Tests
- Good coverage overall. The multi-poll tests assert real behaviour: overlap from the traffic log, starvation counts, failure isolation, routing, handoff, and the export/apply round trip.
- **Mirrors the implementation:** `scheduler.rs:244-256` (`sixteen_polls_mixed_rates_no_starvation`) measures "waited" with the scheduler's own `entries[].next_due`. If `served()` computed a wrong deadline, the wait count would be computed from the same wrong value. Compute "due since" from an independent model (last start + scan) in the test.
- **Missing:**
  - an RTU multi-poll test that asserts the inter-frame gap between requests of different polls and units (the existing `rtu_inter_frame_gap_before_each_request` uses writes only);
  - an emitter test for m1;
  - a `set_workspace_layout` test with duplicate ids (m3);
  - a fake-`Desktop` test whose `place` enforces a minimum outer size (M1).
- **Not covered at all (acknowledged in BE-002 "Not verified"):** the command layer, `on_destroyed`, real `Channel` delivery and real windows. The commands that are pure glue (`mm_pop_out_poll`, `mm_dock_poll`, `mm_apply_profile`) have no tests even with the fake `Desktop`, because they use `AppHandle` directly.

## Verdict
**Changes required.** There is no blocker.
- Fix, or get a decision on, **M1** before QA runs the arrange checks. As built, the owner's 3 x 3 / 1080p criterion (Q-002-10) cannot pass on a real Windows display.
- m1-m4 are small and should go into the same pass.
- m5-m7 can be scheduled.
