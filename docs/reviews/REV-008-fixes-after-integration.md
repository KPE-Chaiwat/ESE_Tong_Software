# REV-008 Review of the REPORT-006 fixes (D1 to D5, O1, O7)

Reviewer: code-reviewer. Date: 2026-10-17. Read-only review of the uncommitted working tree (HEAD f75f3f4).
Upstream read: CLAUDE.md, REPORT-006 (sections 3, 4, 7, 9), BE-002 "REPORT-006 fixes", DES-002 revision 10 (2.6, 2.13, 3.1, 6.3, 7), CHK-002 (A7, A8, D10, F13, F14, F16, R7), FE-002 task 31 and "Implementation notes (REPORT-006 fixes)".
Third-party sources read to check the window claims: tao 0.37.1 (`WM_DPICHANGED`, `WM_GETMINMAXINFO`, `WM_SYSCOMMAND`, `outer_position`), tauri-runtime-wry 2.12.2 (`send_user_message`, `run_on_main_thread`, Focused synthesis), tauri 2.12.4 (`attach_window`), tauri-plugin-window-state 2.5.0 (`on_window_ready`, `restore_state`), dpi 0.1.2 (`from_f64` rounding), windows-sys 0.61 (power throttling constants).

## Commands run (all read-only)
| Command | Result |
|---|---|
| `cargo fmt --all --check` | clean |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `cargo clippy -p esefact-desktop --all-targets --features dev-hooks -- -D warnings` | clean |
| `cargo test --workspace` | all pass (desktop 36, modbus-master 35 + 24 + 26 + 3, dev-sim-slave incl. `scan_rate` 19.8 s, ...) |
| `cargo test -p esefact-desktop --features dev-hooks` | 36 pass |
| `cargo test -p dev-sim-slave --test scan_rate -- --nocapture` | pass. Measured: 20 ms: mean 21.22, min 19.67, p90 21.99, effective 21; 50: 51.20 / 49.51 / 51.92, effective 52; 100: 101.34 / 100.03, effective 102; 250: 250.48 / 249.75, effective 250; 500: 501.66 / 501.11, effective 502 |
| `pnpm --filter @esefact/desktop typecheck` | clean |
| `pnpm lint:web` (Biome) | clean, 320 files |
| `pnpm test:web` | 126 files, 3165 tests pass |

The GUI was not launched and Playwright was not run (as instructed).

## Findings

### Major

**M-1 (major) `apps/desktop/src-tauri/src/lib.rs:44-57`, `apps/desktop/src-tauri/src/commands/poll_windows.rs:84-88`: the D3 recompute after a DPI change runs while the window still has its old size, not after it.**
- Problem: BE-002 and the comment say the recompute is "queued on the main thread after the DPI change". It is not queued. `on_window_event` runs on the main thread, and in tauri-runtime-wry 2.12.2 `run_on_main_thread` calls `send_user_message`. When the caller is already on the main thread, `send_user_message` runs the closure at once (`if current_thread().id() == self.main_thread_id { handle_user_message(..) }`). tao 0.37.1 sends `ScaleFactorChanged` from inside `WM_DPICHANGED`. At that point it has already set `window_state.scale_factor` to the new scale, but it has not yet called `SetWindowPos`. So `refresh_min_size` reads `outer_size - inner_size` with the old DPI's frame and combines it with the new scale: `ceil(480 * s_new) - frame_old`.
- Failure scenario: take the frames BE-002 uses itself (18 x 47 px at 125 %, 24 x 59 px at 150 %). Drag a W2 from a 125 % monitor to a 150 % one. The client minimum becomes 720 - 18 = 702 and 480 - 47 = 433, so the outer minimum is 726 x 492 instead of 720 x 480. Tile cells sized from the 480 x 320 minimum can then overlap or be refused. Drag it back from 150 % to 125 %: the client minimum is 600 - 24 = 576 and 400 - 59 = 341, so the outer minimum is 594 x 388. That is defect D3 again, worse, and on the first monitor. Single-monitor QA (REPORT-006) cannot see this. The fake `Desktop` tests cannot see it either, because they have no event ordering.
- Suggested fix: really defer the recompute. Either post it from a non-main thread so it goes through the event-loop proxy (for example `tauri::async_runtime::spawn(async move { let _ = handle.run_on_main_thread(...); })`), or set a per-label "scale changed" flag and recompute on the next `WindowEvent::Resized` of that window. Another option is to scale the measured frame by `s_new / s_old` before using it. Fix the comment in `lib.rs` and the BE-002 sentence. Add CHK2-F13 at mixed DPI to the [MON2] list (see the QA list below).

### Minor

**m-1 (minor) `crates/modbus-master/src/scheduler.rs:138` (`TIMER_SLACK` = 1 ms) and the test `timer_lateness_does_not_add_up` (`scheduler.rs:340-372`): the on-time rule rarely applies in the real app, and the virtual test hides that.**
- Problem: Tokio rounds every sleep deadline up to the next whole millisecond. The parked thread then wakes on the 1 ms OS period, with jitter on top. A real wake-up is therefore often more than 1 ms after `timer_target`, so `on_time_start` returns `now` and the lateness adds up again. The real-time test shows this: 20 ms gives a mean of 21.22 ms and effective 21 (+6 %), 100 ms gives 101.34 ms and effective 102. The virtual model wakes "on the next whole ms (up to 1 ms late)", which is exactly the slack, so it passes by construction.
- Failure scenario: no CHK limit is broken (D10 allows a mean up to S + 4). But the claim "wake-up lateness does not add up" (BE-002, DES-002 7 item 8) is not true at 20-50 ms. The 1 ms bias stays and shows in the UI as `effective 21 ms`.
- Suggested fix: allow a slack of up to 2 ms, still capped at scan/4. The CHK2-D10 rule still holds: the physical gap is at least `S - slack`, which is at least S - 2. Make the virtual model use Tokio's round-up plus a sub-millisecond jitter, so the test measures the real wake-up pattern.

**m-2 (minor) `crates/dev-sim-slave/tests/scan_rate.rs:85-178`: a wall-clock test runs by default in `cargo test --workspace` and `cargo nextest`.**
- Problem: the pass/fail bounds depend on how busy the machine is. One request logged late by at least 2 ms makes the next interval shorter than S - 2. The simulator, the session and the test share one 2-worker runtime. In my run the margin was 1.67 ms (20 ms: shortest 19.67 against the limit of 18). Three attempts per rate reduce the risk but do not remove it. nextest runs test binaries in parallel, which adds CPU load.
- Failure scenario: a loaded CI or dev machine fails `pnpm check` with no code change. It also adds about 20 s to every test run.
- Suggested fix: mark it `#[ignore]` and run it with `--ignored` in a dedicated step (QA or nightly), or gate it on an environment variable. Keep the virtual-time tests as the default gate.

**m-3 (minor) `apps/desktop/src/tools/modbus-master/components/poll-view/PollView.tsx:120-132` and `223`: keyboard focus is lost or moved when a live resize crosses 640 px with the setup open.**
- Problem: the setup element moves between the popover `div` and the panel `aside`, so React remounts it.
  - 639 to 640: the focused field is unmounted. The effect then tries `railRef.current?.focus()`, but the rail is not rendered in `panel` mode (`presentation === "rail" || nativePopover` is false), so `railRef.current` is null and focus falls to `body`.
  - 640 to 639: the effect moves focus to the first invalid field or to Name, not to the field the user was typing in.
- Failure scenario: a keyboard or screen-reader user edits Scan rate in a W2 at 640 px and the window is narrowed by 1 px (Windows snap, Arrange, or a DPI change). Focus jumps to Quantity, or it is lost and the next Tab starts from the top of the document. The draft is kept; only focus is affected.
- Suggested fix: only run "focus the first invalid field or Name" when the popover was opened by the user (`toggleSetup`), not when the width changed. On a width change, remember the `id` of the active element inside the setup and focus the element with the same `id` after the remount. If the rail does not exist, fall back to the panel's first field.

**m-4 (minor) `crates/modbus-master/Cargo.toml:10-13`, `apps/desktop/src-tauri/Cargo.toml:14-17`: the change from `unsafe_code = forbid` to `deny` (my opinion is in the section below).**
- Problem: the two crates replaced `[lints] workspace = true` with a local `[lints.rust]`. Any lint added to `[workspace.lints]` later will silently not apply to them. Also, with `deny`, an `#[allow(unsafe_code)]` anywhere in either crate compiles without a warning. Today exactly two modules have it (I checked by grep: only `timer.rs` and `key_menu.rs` contain `unsafe`), but nothing enforces that.
- Failure scenario: a later change adds an `#[allow(unsafe_code)]` helper in `session.rs` or `commands/`, and clippy and CI stay green.
- Suggested fix:
  - add a test or `pnpm check` step that fails if `allow(unsafe_code)` appears outside the two listed modules;
  - add `clippy::undocumented_unsafe_blocks = "deny"` to both crates;
  - add a comment in the root `Cargo.toml` next to `[workspace.lints]` saying these two crates must mirror it;
  - optional: move the Windows timer implementation into `src-tauri` and inject it through `SessionDeps.timer`, which is already a trait. Then `modbus-master`, which by the layout should hold no OS code, keeps `forbid`, and only the thin Tauri layer has unsafe code.

**m-5 (minor) `apps/desktop/src-tauri/src/desktop.rs:175-194` with `tauri_desktop.rs:63-81`: the W1 clamp treats the invisible resize borders as part of the window.**
- Problem: `outer` comes from tao `outer_position`/`outer_size`, which use `GetWindowRect`. On Windows 10 and 11 that rectangle includes the invisible left, right and bottom resize borders (about 7 px at 100 %, 9 px at 125 %). `clamp_to_work_area` keeps that whole rectangle inside the work area.
- Failure scenario: a W1 whose visible left edge is at the screen edge (outer x = -9 at 125 %, for example after a Snap or a drag to the edge) is saved by the window-state plugin. On the next restore it moves 9 px to the right. A W1 whose visible bottom edge touches the taskbar is shortened by the bottom border, leaving a visible gap.
- Suggested fix: clamp the visible frame instead: use `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` behind the Windows `Desktop` implementation, or allow the left, right and bottom invisible borders (outer minus client frame) to go past the work area. Tell QA that A7 and A8 should check the visible edge.

### Nits

- **n-1** `key_menu.rs:12-15, 26-29`: subclassing the UI-thread child windows (`WRY_WEBVIEW`) is harmless but not needed. `DefWindowProc` sends `WM_SYSCOMMAND(SC_KEYMENU)` to the top-level ancestor, which is why the top-level subclass is the right level (see below). The docs could say so, so nobody later depends on the child subclass.
- **n-2** `key_menu.rs` / `lib.rs:78`: the guard depends on a `Focused(true)` event. Because `run_on_main_thread` is synchronous on the main thread, the install happens inside the focus event, so there is no real gap. Installing once more right after each `build()` (launcher setup, `window_open_tool`, `create_poll_window`) would remove the dependency on tauri-runtime-wry's focus de-duplication and on its "add_GotFocus failed" path.
- **n-3** `alt-guard.ts:37-39`: `keyDown` only looks at the latest key, so Ctrl down, Alt down, Alt up counts as a lone Alt (the keyup is prevented). This is harmless because nothing depends on that default action, but the docs describe "a press with no other key in between". On Windows, AltGr arrives as Control then AltGraph, so a lone AltGr tap is prevented as well, which is intended.
- **n-4** BE-002 says "a `preventDefault` in the page is not required", while FE-002 adds the alt-guard with a keydown `preventDefault` outside text fields as a "second line of defence". The two documents disagree. After CHK2-R7 passes, the PM should decide whether to keep the frontend layer (it costs little; see the Alt keydown notes below).
- **n-5** `timer.rs:99-122`: the power-throttling opt-out is process-wide and stays set after polling stops. That is correct (it only matters while a `timeBeginPeriod` request is active). A line in the module docs would stop a future reader from "pairing" it.

## Focus areas, verified without a finding

**Unsafe code and Win32 (`key_menu.rs`, `timer.rs`).**
- Every unsafe block has a correct SAFETY comment.
- `SetWindowSubclass` is only called on the thread that owns the window: `install` runs through `run_on_main_thread`, and `subclass` also checks `GetWindowThreadProcessId(hwnd) == GetCurrentThreadId()` and `IsWindow`. Windows of the WebView2 browser process are skipped.
- No reference data is used (`0`), so nothing can leak or dangle. The subclass procedure is a `'static` function. The pair (procedure, id `0x4553_4B4D`) cannot collide with tao's or wry's subclasses, which use other procedures. A second install only updates the data, so installing twice is harmless.
- On `WM_NCDESTROY` the procedure calls `RemoveWindowSubclass` and then `DefSubclassProc`, which is the documented pattern.
- The HWND crosses threads as an integer and is checked again on the owning thread. If the handle were reused, the worst case is subclassing another window of our own UI thread, which is harmless.
- A WebView2 child that is created or re-created later needs no new install, because `SC_KEYMENU` goes to the top-level window.

**Is the subclass at the right level, and can it fix the freeze?**
- Yes, plausibly. A lone Alt keyup in the focused WebView2 window (browser process) makes that window's `DefWindowProc` send `WM_SYSCOMMAND(SC_KEYMENU, 0)` to the top-level ancestor, which is our window. Our window procedure then runs the modal menu loop, and the browser thread stays blocked in that cross-process `SendMessage` until Alt or Esc ends the loop.
- That matches REPORT-006 exactly: CDP and the page are frozen, and the next Alt or Esc recovers them.
- Returning 0 at the top-level subclass makes the `SendMessage` return at once. Our subclass is installed last, so it runs before tao's, and tao only looks at `SC_RESTORE`, `SC_MINIMIZE` and `SC_SCREENSAVE`.
- This explanation cannot be proven without hardware input (see the QA list).

**`decide`.**
- Swallowed: `SC_KEYMENU` with `lParam` 0 (lone Alt, F10) or a character (Alt+letter: with no menu bar the OS would only beep or enter menu mode).
- Passed:
  - `Alt+Space` (`lParam` 0x20, the window menu stays);
  - `SC_CLOSE` (Alt+F4 goes through `WM_CLOSE` to the close-confirm flow);
  - `SC_MOUSEMENU`, `SC_MOVE` and everything else;
  - the key messages themselves.
- Alt+Tab, Alt+Esc and the input-language hotkey are handled by the system and never become `SC_KEYMENU`. AltGr characters and IME toggles come from `WM_CHAR` or the IME, not from `SC_KEYMENU`.
- The only keyboard path that is lost is "tap Alt, then Down or Enter, to open the window menu without Space". Alt+Space still does this, as DES-002 3.1 intends.

**`timeBeginPeriod` / `timeEndPeriod`.**
- `PrecisionHold` only acquires or releases when the wanted state changes, and it releases in `Drop`.
- It is set from `scheduler.next_due().is_some()` on every loop pass, and `polls_link_down` calls `stop_all`. So it is released on pause-all, on user disconnect, on link loss (the next pass) and at the end of the session (`run` returns and `Actor` is dropped).
- A panic or abort of the actor task also drops `Actor`, so the release happens there too.
- Several sessions each hold their own pair, and the OS counts requests per process, so the counts stay balanced.
- `PROCESS_POWER_THROTTLING_STATE { Version: 1, ControlMask: IGNORE_TIMER_RESOLUTION (4), StateMask: 0 }` is the documented opt-out. On older Windows the call fails and nothing breaks.
- `timer_precision_is_held_only_while_polling` covers pause, disconnect and shutdown.

**`on_time_start`.**
- `timer_target` is only set on `Wake::Tick`, which is the `dispatch_at` computed just before the `select!`, and it is cleared after each dispatch.
- `dispatch_at` = max(the earliest `next_due`, `quiet_until`), so the target is never earlier than the picked poll's `next_due`. The recorded start is therefore at least `prev_start + S`. The physical gap is at least S - slack, which is at least S - 1 ms. The CHK2-D10 limit "shortest at least S - 2" holds.
- RTU gaps push the target later, never earlier.
- Queued writes go first. The target is then the quiet time, and it is cleared before the next poll dispatch.
- Lateness beyond the slack falls back to `now`, so no poll catches up and none starves.
- The virtual-time tests are deterministic (pure model, or paused Tokio time, which wakes exactly at the target).

**D3 rounding.**
- dpi 0.1.2 converts with `round()`. The logical value `(P + 0.25) / s` lands on P with both rounding and truncation at 1.0, 1.25, 1.5, 1.75 and 2.0. Physical frames are whole px, so fractional frames do not occur after measuring.
- The W1 minimum is lowered with a -0.25 bias, which gives P with rounding and P - 1 with truncation, so it never ends up too large.
- Mixed DPI is broken; see M-1.

**D5.**
- The `clamp_to_work_area` edge cases are correct with i64 arithmetic: a window larger than the work area, negative or non-zero work-area origins, and maximized or minimized windows (left alone).
- Order with the window-state plugin: in tauri 2.12.4, `attach_window` posts `window_created`, and with it the plugin's `restore_state`, through `run_on_main_thread` from the command thread. `window_open_tool` posts the clamp afterwards from the same non-main thread, so the proxy's FIFO order runs the clamp after the restore. Inside `restore_state`, `set_position`, `set_size` and `maximize` run synchronously on the main thread. So the plugin cannot restore after the clamp at creation. A maximized restore is skipped by the clamp.

**dev-hooks.**
- The feature is off by default, and nothing in the repository turns it on (checked: `package.json`, the Tauri config, scripts; only docs mention it).
- The command (`#[cfg(feature)]`), its `generate_handler!` entry, the `AppState.dev_fail` field and both check sites are all gated by the feature.
- The module is compiled under `cfg(test)` only for its unit tests, and it is not registered there.
- No capability entry exists or is needed (app commands have no ACL here). As a result, a dev-hooks build lets every window call the command, which is acceptable for a QA build.
- The check runs right after `session_of` and before `poll_windows::pop_out` / `dock`, so no window, host, routing or handoff has changed when it fails.
- Clippy with the feature is clean.

**alt-guard.**
- The tracker vectors are correct. An Alt-drag ends with the keyup prevented. A window blur resets the press. Key repeat keeps it lone.
- Alt+F4, Alt+Space, Alt+Arrow and the other key of any combination are never prevented, and nothing is stopped from propagating.
- One install per window, reference-counted. Each caller's release only counts once. The App, W1 and W2 installs share one listener, and React StrictMode's double effect is safe.
- Alt keydown `preventDefault` is skipped in inputs, textareas, selects and contenteditable, so Alt codes still work.
- Screen readers (NVDA and JAWS use Insert or CapsLock) read keys through OS hooks before the page sees them, so page-level `preventDefault` does not affect them. The app has no `accesskey`.

**KEEP_FOCUS_ON_PRESS.**
- It only acts on the primary mouse button's `mousedown`.
- Tab order and keyboard activation are unchanged. A button inside a dialog is still reached by Tab, and the dialog's focus trap is untouched.
- A click with focus outside the dialog still fires.
- No drag handle uses it (checked every usage: ScaleSection, PollSetup, OverrideDialog, SaveAsDialog, WriteDialogView).
- The fields commit on change, so submitting without a blur sends the current values.
- The side effect (focus stays in the field after a click) is documented in FE-002.
- The `clickWithLayoutShift` tests are meaningful: FE-002 states they fail without the fix, and they model the real reason the click was lost.

**Native setup popover.**
- `role="dialog"`, `aria-modal="false"` and `aria-label="Poll setup"` are present. The rail has `aria-expanded` and `aria-controls`.
- Esc and [Done] close it, and focus returns to the rail (when the rail exists; see m-3).
- An outside click does not close it, and the vectors match FE-002 31a.

**Load-flow prompt.**
- The wording matches DES-002 6.3 and the CHK2-N10 texts.
- The new trigger (unapplied edits alone) matches the close rule of DES-002 2.11 ("profile modified, or any poll with unapplied edits").

## Opinion on the `unsafe_code = "deny"` policy change
It is acceptable and is the standard Rust pattern. `forbid` cannot be overridden locally, so a crate that must call Win32 has to use `deny` with a module-scoped `allow`.
- The two exceptions are small: two winmm calls and one kernel32 call in `timer.rs::windows_impl`, and comctl32 subclassing in `key_menu.rs::win`.
- Each sits behind `#[cfg(windows)]` and a trait, and has correct SAFETY comments.
- `windows-sys` adds no new download, since it was already in the lock file.
- Every other crate keeps `forbid`.

What the change loses is the guarantee: with `deny`, any `#[allow(unsafe_code)]` in those two crates compiles silently, and the crates no longer inherit future workspace lints. I would accept it on the conditions in m-4: a mechanical check that only the two named modules allow unsafe code, `clippy::undocumented_unsafe_blocks` denied, and a note at `[workspace.lints]`. Preferably also move the Windows timer implementation into `src-tauri` (it is already injectable through `SessionDeps.timer`), so the protocol and engine crate goes back to `forbid` and all unsafe code lives in the thin Tauri layer.

## Can only be verified with real windows and hardware input (QA list)
1. **CHK2-R7 (a)-(g)** with `SendInput` or a real keyboard, on a debug build and a release build (`pnpm --filter @esefact/desktop tauri build`, no dev-hooks):
   - (a) lone Alt in W1;
   - (b) after an Alt-drag, releasing Alt both after and before the mouse button;
   - (c) two taps;
   - (d) in a W2;
   - (e) in the launcher;
   - (f) Alt+Space opens the window menu and Esc closes it; Alt+Right moves the window 16 px;
   - (g) Alt+F4 shows the W1 "Save changes?" and the W2 S6 confirm, and is never swallowed.
   Also check: F10 does not enter menu mode; Alt+letter makes no beep and does not freeze; Alt+Tab away and back with Alt still held.
2. **R7 with only one layer** (to settle n-4), if QA can build it: the backend guard with the alt-guard removed. A temporary local patch only, never committed.
3. **AltGr text** on a non-US layout (for example German: AltGr+Q = @, AltGr+E = €) in Name, Quantity and an alias field of W1 and W2. Also an Alt code (Alt+0176 = °) in a text field, and a Japanese or Chinese IME toggle in a text field.
4. **NVDA** (R4) in W1: Insert+F7, Insert+Down, and the browse-mode/focus-mode toggle work after a lone Alt.
5. **CHK2-D10**, 60 s per rate (20 / 50 / 100 / 250 / 500), simulator log as the oracle: in the foreground, with all ESEfact windows **minimized** (this checks the power-throttling opt-out), and with 16 polls at 20 ms.
6. **CHK2-F13** minimum outer size 600 x 400 at 125 %, by a real OS drag of the right edge and the bottom edge. Where possible also at 100 % / 150 %, and **[MON2] with mixed DPI: drag a W2 from 125 % to 150 % and back, then shrink it** (M-1: expect 720 x 480 and 600 x 400; the current code should show about 726 x 492 and 594 x 388).
7. **CHK2-A7 / A8**: W1 cascaded from the launcher and from Ctrl+N near the bottom-right; restore after a restart with a saved rectangle partly off-screen, saved maximized, and saved on a monitor that is now gone. Check the **visible** edges against the work area (m-5) and the lowered minimum on a 1366 x 768 or 1280 x 720 work area.
8. **CHK2-F14** at 466 / 626 / 639 / 640 / 900, including a live resize across 640 **while a setup field has focus** (m-3: where focus ends up).
9. **CHK3 [Apply scale] plain first click** (D4) and the same pattern on [Apply], Save as [Save], override [Save] and Write [Send], with a real mouse at 125 %.
10. **CHK2-F16** with a `--features dev-hooks` build: pop out and dock failure, both kinds, re-arming, and nothing changed on failure. Also confirm that `dev_fail_next_window_op` returns "command not found" in the normal build.

## Verdict
**Changes required.** There is no blocker. The unsafe Win32 code, the Alt-menu guard, the timer pairing, the scheduler rule, the dev-hook gating and the frontend changes are correct as far as code reading and the test runs can show.

**M-1 must be fixed:** the DPI-change recompute measures the old frame, which brings D3 back on mixed-DPI setups, and the documentation states the opposite. The minor findings (m-1 to m-5) can follow in this round or the next. If they are deferred, m-4 should be done before more unsafe code is added.
