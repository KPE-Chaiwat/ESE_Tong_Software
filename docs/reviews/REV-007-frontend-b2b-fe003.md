# REV-007 FE-002 part B2b (tasks 22-25, 28, REV-006 fixes) and FE-003 (value scaling): frontend review

Reviewer: code-reviewer, 2026-10-16.
Scope: `apps/desktop/src` (tools/modbus-master lib, store, runtime, components; shared/ipc including the fake; shared/ui) and `apps/desktop/biome.json`.
Not reviewed: `e2e/` (QA is writing it) and Rust. Rust files were only read to check the IPC contract.

Upstream documents read:
- CLAUDE.md
- DES-003 (all), REQ-003, FE-003 (with its notes and Q-FE3-01 to 06), CHK-003
- DES-002 rev 6 (sections 2.2, 3, 4, 6 and 9), DES-001 (S2, profile dialogs, validation texts)
- FE-002 (notes for B2a and B2b), CHK-002
- BE-002 final contract, REV-005, REV-006

## Commands run (read-only)
| Command | Result |
|---|---|
| `pnpm --filter @esefact/desktop typecheck` | clean |
| `pnpm lint:web` | clean (307 files) |
| `pnpm test:web`, first run (another CPU-heavy process of mine was running at the same time) | 1 failed / 2871: `Performance.test.tsx` "two seconds of 100 ms cycles…" timed out at 5000 ms |
| `pnpm test:web`, second run (no other load) | 118 files and 2871 tests pass |
| `vitest run --reporter verbose`, full suite | slowest tests: "two seconds of 100 ms cycles…" 4011 ms and "Tab visits the regions in that order" 4004 ms, both against the 5000 ms default timeout |
| `vitest run A11y.test.tsx Performance.test.tsx` | Tab test 2177 ms, two-seconds test 907 ms (only these 2 files running) |
| Scratch script (node, outside the repo; a port of `formatScaled` checked against exact BigInt rational rounding) | 7,471,164 cases; see section 1 |

## What was checked and found correct

### 1. Scale math (the priority)

**Worked examples recomputed by hand and compared with the code.** I recomputed 24 of the 43 CHK-003 A examples with the code path each one takes:
- A1, A3, A5 (12.000122… gives "12.0001" at 4 dp), A7 (-0.25 x 16 + 4 = 0 exactly), A9.
- A10 (5.001221), A12 (12.2100), A15 (11.8515).
- A17, A18, A20: exact ratios, for example -100/100 = "-1.00".
- A23 and A26: 25/10 and -25/10 tie away from zero, giving 3 and -3.
- A27: -4/10 gives magnitude 0, so "0" without a minus sign.
- A29: 10/-2 = "-5.00", sign from the denominator.
- A31: 6.25 is detected as a tie, giving "-6.3".
- A35: -20.0000000000000x gives "-20.00".
- A36: forward raw range with reversed Y, above the range: clamps to yMax = 0, marker arrow-up.
- A37 to A39: 0.15, 0.05 and 0.25 stored as 0.1499…; the tie band catches them.
- A40 to A42: signed range -32768 to 32767.
- A43: 2 x 999999999999999 is 1.99e15, so "too large".

Every one matches `scale-math.ts`. `scale-math.test.ts` is table-driven over all 43 and passes.

**Other checks:**
- **`rawToX`.** 0xFFFF gives -1, 0x8000 gives -32768, 0x7FFF gives 32767, and the result is unsigned when `rawSigned` is false (`scale-math.ts:46-49`).
- **Clamp for reversed ranges.** The nearest raw end is taken from the settings, so the clamp is exact (`:81-87`).
- **Guards.** `xMin == xMax` and divisor 0 or non-finite return null, which shows "—" (`:64-76`).
- **Integer divisor in `formatRatio`.** It is exact BigInt half-away rounding (`:129-138`).

**Rounding against the DES-003 1.3 rule, and the deviation "tie band capped at 1e-6" (Q-FE3-01).** I compared the implementation and the literal design rule with exact rational rounding:
- linear scales (16 raw/eng ranges, every 3rd raw value from -32768 to 65535, decimals 0, 1, 2, 3, 4 and 6);
- divide by typed decimals (0.1, 0.01, 2.5, 0.3, 1.1, 6553.6, 0.001, -2.5, 1.75) for every raw value.

The exact value is `((x-x0)(y1-y0) + y0(x1-x0)) / (x1-x0)`, or `x*q/p` for a divisor p/q.

Results:
- **Implementation:** 20,061 mismatches out of 7.47M. The smallest mismatch is at |Y x 10^d| = 5.77e13. Example: Y = 57692835.889219… at 6 dp, where float64 has no 14th significant digit left. Below about 13 significant digits it equals exact decimal rounding in every case tested, including the ties that float64 stores as x.xx4999… (0.105 at 2 dp gives "0.11").
- **Literal DES rule:** 1,802,306 mismatches (24%). It is already wrong for 4-20 mA at 6 dp. For example, 4.175051499 shows as 4.175052, because at |s| = 4.2e6 the band 1e-9·|s| = 0.004 treats .4992 as a tie. At 0 dp, 1000000000.4 shows "1000000001".
- **Conclusion:** where the design rule is sound (|s| < 1000) the code applies it exactly, and above that the cap gives the mathematically correct digit while the literal rule does not.
- **Whole part and fraction rounded separately.** Correct and needed. The carry when the fraction rounds up to 10^d goes through the BigInt sum.
- **Recommendation:** the designer should accept Q-FE3-01 and amend DES-003 1.3 (relative band capped at 1e-6).

**Remaining float64 edge cases:**
- "-0" is never shown (`plainDigits`).
- Decimals are clamped to 0-6.
- NaN or Infinity shows "too large". This is not reachable: Rust rejects non-finite numbers in `check_scale`.
- See n-1 for the `1e15` boundary after rounding.

### 2. Validation, applied and draft state, PATCH semantics
- **Messages and limits.** The messages in `scale-validation.ts` are word for word DES-003 4.
- **Signed ranges.** They follow `rawSigned` (`rawLimits`).
- **Number format.** `1e3`, `4,5` (comma message), `-0` and `0.0` (divisor rejected) are handled.
- **Unit.** Units are counted in code points, and the control-character set (C0, DEL, C1) is the same as Rust's `char::is_control`.
- **Toggling "Raw is signed".** It re-validates xMin and xMax.
- **Last valid scale kept.** `scale-draft.store.ts:194-218`: an invalid Apply sends nothing, and the IPC failure path keeps the draft.
- **Unapplied edits.** The draft is mirrored into `pollViewUiStore.scaleDraft`. It feeds `hasUnappliedEdits` (`poll-view-runtime.ts:299-306`) and survives the handoff (`hydrate`).
- **Modified.** `contentSignature` includes scale, overrides, value columns and display. It excludes hosts, rectangles, `active`, workspace settings and the traffic filter (`profile.logic.ts:22-39`). Key order of optimistic copies equals serde order, so no false Modified.
- **PATCH.**
  - Rust has `PollViewSettings.scale: Option<Option<ScaleSettings>>` with the `present` deserializer (`crates/shared-types/src/session.rs:181-211`). A missing key leaves the value unchanged, and `null` removes it.
  - The frontend sends only the given keys (`poll.store.ts:333-366`).
  - The first scale switches to `both`, and removing the last one switches to `raw`, in the same patch (`poll-scale.logic.ts:26-68`).
  - The fake does the same (`modbus-master.fake.ts:1330-1352`).

**IPC contract: every command the new code uses, both sides.**

| Frontend (`shared/ipc/modbus-master.ts`) | Args | Rust (`src-tauri/src/commands`) |
|---|---|---|
| `:147` `mm_set_poll_view` | `{pollId, view}` | `modbus_master.rs:264-275` `(poll_id, view: PollViewSettings)` |
| `:148` `mm_write` | `{request, pollId}` | `:286-297` `(request: WriteRequest, poll_id: Option)` |
| `:173` `mm_set_profile_name` | `{name}` | `:536-546` `name: Option<String>` |
| `:174` `mm_request_save` | `{saveAs}` | `:550-560` `save_as: Option<bool>` |
| `:175` `mm_show_traffic` | `{pollId}` | `:563-570` |
| `:176` `mm_apply_profile` | `{profile}` | `:576-585` |
| `:177-178` `mm_export_profile` | `{name, connection}` | `:591-610` (both `Option`) |
| `:165` `mm_focus_connection_window` | none | `:468-477` |
| `:179-185` `profiles_list/get/save/rename/delete` | `{toolId, name / profile, overwrite / oldName, newName}` | `profiles.rs:35-115` |

The payload shapes match the generated bindings:
- `WriteRequest {slaveId, function, address, values}`;
- the `WriteResult` union;
- `ScaleSettings` field names and types (`x_min: i32`, `decimals: u8`, `y_*: f64`);
- `ScaleOverride {start, end, scale}` with u16 protocol addresses;
- `PollProfile.scale / scaleOverrides / valueColumns`.

### 3. Overrides
- **Creation.** Overrides are created one per contiguous run of the normalized selection (`openForSelection(ui.selection)`).
- **Overlap.** Overlap and the 64 limit are checked before any command (`overrideRangesMessage`), against the other overrides when editing.
- **Address base.**
  - Start and End are in the display base and converted with `toProtocolAddress`.
  - The stored ranges are protocol addresses.
  - The marker, list and overlap texts are in the display base (`rangeLabel`).
- **Precedence and range.** The override wins in `effectiveScale`. Overrides outside the poll range are listed with "Not in the current poll range".
- **Remove.** It drops every override touching the selection.
- **Index.** The list index equals the `config.scaleOverrides` index, because the frontend always sends a sorted list.

### 4. Write dialog: the raw value sent is the raw value typed
- **Preview and send use the same parse.** The preview is computed from `validateDraft(draft, base).value.values` (`WriteDialogView.tsx:135-138`). `send()` sends `validateDraft(s.draft, base).value` from the same draft and the same base source (`write.store.ts:144-178`).
  - The provider only reads the numbers. It never writes back into the draft or the request.
  - Signed (`n & 0xffff`), hex and binary are parsed once by `parseValue` (`lib/parse.ts`).
- **Other Write rules:**
  - FC05 and FC15 have no preview.
  - An invalid value gives no preview.
  - Whitespace always separates list values. The prefill closes up binary nibbles.
  - Broadcast is RTU-only, and TCP unit 0 is a normal unit (`schemas.ts:381-386`, fake `:1356-1358`).
  - The link-lost result outranks "Not connected" and is cleared on reconnect (`write-flow.ts:60-66`).
  - The modal lock refuses pop out, dock and handoff (`poll-host.store.ts:125, 192, 219`).
  - `generation` drops late results.

### 5. Profiles
- **Save:**
  - Save validates the form, flushes the layout, exports from Rust and writes with `overwrite: true`.
  - Save as asks Replace only after `profileExists`.
  - A `SaveRequested` from W2 is relayed (`connection-runtime.ts:461-464`) and brings W1 to the front only when something is shown.
- **Load:**
  - Load reads the file first.
  - "Disconnect and load?" covers connected and connecting.
  - List syncing is suspended during `mm_apply_profile`.
  - Load rebaselines after `applySnapshot`.
  - The migration notice follows `migratedFrom`.
- **Scale round trip.** Scale fields are passed through Rust untouched (export and apply), so the round trip is lossless as far as the frontend goes.

### 6. Shortcuts
- **Scope.** The handlers are per window (`window` listener in each window's hook). The W1 view keys act on the focused or active sub-window (`scopedSubWindow`).
- **`when()` false.** The key passes through unless it is in `SUPPRESSED_DEFAULTS`. `Ctrl+Shift+V` is not suppressed, so a plain-text paste in a field works outside modals (see m-2 for modals).
- **New entries.** `Ctrl+Shift+E` was added to the suppressed list and to both maps.

### 7. Performance
- **Rows.** `Row` is memoized and selects only its own value, alias and flags.
- **Provider.** `createScaledFactory` keys on (scaleActive, base, scaleKey(scale), override keys), so an alias or counters config event returns the same provider object and no row re-renders. The provider caches per (address, raw).
- **Test.** `ScaledGrid.perf.test.tsx` asserts real counts: 0 `scaleValue` calls for an identical update, 1 for one changed value, 0 for an alias change, and one per visible row for a scale change.
- **Per update.** The per-update work does not grow with the scale. The provider is only rebuilt when the config's scale keys change.

### 8. Accessibility and tokens
- **Markers.** The override marker is `role="img"` with an `aria-label`. The scaled cell has the accessible names "{v} {unit}, out of range / clamped", and the header has `aria-label="Scaled value"`.
- **Never color only.** Out-of-range uses tint + icon + label, and clamp uses an icon.
- **Colors.** There are no hard-coded hex colors and no `text-warning` or `text-success` classes in scope. `--color-warning-tint` is defined (`styles.css:36, 95`).
- **Biome overrides.** They are limited to six files and two a11y rules. The hand-built ARIA grid needs them in `DataGrid.tsx` and `ScaledCellView.tsx`.

### 9. REV-006 fixes, spot-checked
- **M-1:** `onDetached` keeps the frame for `poppedOut` while `pending === "popOut"` (`connection-runtime.ts:383-386`). `views.refresh` re-attaches after a failure (`:393-400`, `:734-754`).
- **m-8:** the 2 s rollback window (`:703-710`).
- **m-10:** the regression tests were ported to `Rev2Regressions.test.tsx`.

## Findings

### Blocker
None.

### Major
None.

### Minor

**m-1. The S8 override dialog breaks the focus trap: Tab on the last control leaves the dialog instead of wrapping.**
- **Where:** `components/poll-view/OverrideDialog.tsx:20-26, 98`. `KEEP_INSIDE` calls `stopPropagation()` on `onKeyDown` for the whole dialog body.
- **Problem:**
  - Radix FocusScope implements the Tab wrap in a React `onKeyDown` on the content element. This is the ancestor of that div: `node_modules/.pnpm/@radix-ui+react-focus-scope_…/dist/index.mjs:122-147`.
  - The stopped event never reaches it.
- **Scenario:**
  1. The keyboard user tabs to [Save] in S8 and presses Tab.
  2. The focus leaves the document (WebView2 has no chrome to land on).
  3. Radix's `focusin` guard puts it back on [Save].
  4. Tab never cycles back to the Close button and the Start field. Shift+Tab still works.
- **Same pattern:** any future dialog that copies `KEEP_INSIDE`.
- **Suggested fix:**
  - Stop only what the sub-window frame reacts to (pointer and context-menu events, and the specific keys the frame handles). Let Tab through.
  - Or stop propagation in the frame's handler when `event.target` is inside a `[role="dialog"]`.
  - Add a test: Tab from Save focuses the Close button.

**m-2. While any modal is open, `Ctrl+Shift+V` (paste as plain text) is swallowed in the dialog's own text fields.**
- **Where:** `lib/shortcuts.ts:111-116`. `isModalOpen()` is checked before `when()`, and every bound combo gets `preventDefault()`. `Ctrl+Shift+V` is a view binding in both windows (`runtime/poll-view-shortcuts.ts:51-61`).
- **Scenario:** in the Write dialog Value field, the S8 Unit field or the Save as name field, `Ctrl+Shift+V` does nothing. The B2b note promises the key goes to the focused control.
- **Suggested fix:**
  - In the modal branch, `preventDefault()` only for the combos in `SUPPRESSED_DEFAULTS`, and let the others pass.
  - Or evaluate `when()` first and skip `run()` while the modal is open.

**m-3. A poll with `valueColumns: "scaled"` (or `"both"`) and no scale hides its raw values, and the Show control that could fix it is disabled.**
- **Where:**
  - `components/poll-view/DataGrid.tsx:289`: the columns follow `config.valueColumns` and are guarded only for bit functions, not by `scaleAvailable`.
  - `DataCard.tsx:65-70`: Show is disabled with "Set a scale to show scaled values.".
- **Reachable:**
  - A profile file with `"valueColumns": "scaled"` and `"scale": null` (hand-edited, or written by a future version). Rust's `check_profile` does not normalize it.
  - The fake accepts the same through `setPollView`.
- **Scenario:**
  1. The poll shows only Address and a Scaled column of "—".
  2. No raw value is visible.
  3. Only the undiscoverable `Ctrl+Shift+V` brings Raw back.
- **Suggested fix:** derive the effective columns as `scaleAvailable(config) ? config.valueColumns : "raw"`. Do it in the grid, the Show control value and `copyRows` (`poll-view-runtime.ts:469`), the way bit functions are already handled.

**m-4. The FC16 Write preview mixes units and drops the out-of-range and clamp information.**
- **Where:** `store/write.logic.ts:275-283`.
- **Problem:**
  - The unit is taken from the first scaled cell and printed once.
  - Markers are ignored (Q-FE3-06). The preview box is always neutral.
- **Scenario:**
  1. FC16 at address 2 with values `253 1234`.
  2. Address 2 is in an override "Divide by 10, °C", and address 3 is in "Divide by 100, bar".
  3. The preview reads "Scaled: 25.3, 12.34 °C", so the bar value is shown as °C.
  4. A flagged value (a broken 4-20 mA loop) is previewed as if in range.
- **Severity:** the raw value sent is unaffected (section 4), so this is display only, but it is misleading on a write path.
- **Suggested fix:**
  - When the units of the listed cells differ, print each value with its unit.
  - Append " (out of range)" or " (clamped)" per value, and use the warning tint when any listed value is flagged.
  - Or raise it with the designer together with Q-FE3-06.

**m-5. "Write…" in the row context menu prefills the focused row, not the row that was right-clicked.**
- **Where:**
  - `DataGrid.tsx:603` uses `stores.ui.getState().focusAddress`.
  - `onRowContextMenu` (`:376-385`) only calls `ui.click(address)` when the row is not selected, so the focus does not move.
  - "Edit alias" in the same menu correctly uses `menu.address` (`:509`).
- **Scenario:**
  1. Rows 0-9 are selected with the focus on 0.
  2. Right-click row 7, then Write….
  3. The dialog opens for address 0 with row 0's value, and Send writes to address 0.
- **Suggested fix:** `hostActions.write?.(menu?.address ?? focusAddress)`.

**m-6. Two of the heaviest jsdom tests run at about 80% of the 5 s default timeout and fail under load. These are test problems, not product problems.**
- **Where and timings:**

  | Test | Full suite | Isolated |
  |---|---|---|
  | `components/A11y.test.tsx:156-170` "Tab visits the regions in that order" | 4004 ms | 2177 ms |
  | `components/Performance.test.tsx:79-92` "two seconds of 100 ms cycles…" | 4011 ms | 907 ms |

  The second one timed out in my first full run, while another process loaded the CPU.
- **Cause, Tab test:**
  - The loop calls `user.tab()` up to 80 times through every tab stop of a full W1 (toolbar, sidebar, two sub-windows, traffic).
  - user-event's `getTabDestination` runs `querySelectorAll(FOCUSABLE_SELECTOR)` over the whole document on every Tab and calls jsdom's `getComputedStyle` on each candidate and its ancestors (`isVisible.js:6`).
  - Each step also runs the React focus handlers.
  - The time scales with the DOM size, and no timer is involved.
- **Cause, Performance test:** most of the time is the `eight()` setup: 8 `addPoll` acts, each re-rendering the whole window, plus tile, connect and 500 ms of virtual cycles. "all eight show live values", which is only the setup, takes 3398 ms in the full run.
- **Product side:** nothing indicates a product problem. No product timer is involved, and the render-count assertions pass.
- **Also:** these tests print "An update to StatusLine / Body / FrameBody inside a test was not wrapped in act(...)". Async fake replies land after the last `act`, and this noise can hide a real warning.
- **Suggested fix:**
  - Give these integration-style tests an explicit timeout, for example `it(name, fn, 15_000)`, or set `testTimeout` for the `components/*` project.
  - In the Tab test, stop once the order is proven (break after the first `traffic`), or start from a known element near the end of the toolbar.
  - Flush pending fake promises in `afterEach` (`await act(async () => {})`) to silence the act warnings.

**m-7. The fake `setPollView` does not apply Rust's shape checks for scales and overrides.**
- **Where:** `shared/ipc/modbus-master.fake.ts:1330-1352` vs `crates/shared-types/src/view.rs:171-211` (`check_scale`, `check_scale_overrides`: at most 64 overrides, `start <= end`, unit at most 16 characters without control characters, decimals 0-6, raw -32768..65535, finite numbers).
- **Effect:** a frontend bug that sends an invalid scale passes every fake-based test and the QA runs on the fake, then fails with `validation` on the real backend. Today the editor never sends one, so this is a parity gap only.
- **Suggested fix:** port the two checks into `fake-validation.ts` and throw the same `validation` errors.

### Nit
- **n-1. A value that rounds up to 1e15 is shown instead of "too large".**
  - Where: `scale-math.ts:110`. `formatScaled` tests `|y| >= 1e15` before rounding. 999999999999999.9 at 0 dp prints the 16-digit "1000000000000000".
  - `formatRatio` tests after rounding (`:136`), so the two paths differ at the boundary.
  - Fix: apply the limit to the rounded magnitude in both.
- **n-2. Summaries and tooltips print numbers with `String(n)`.**
  - Where: `scale-presets.ts:112-121` and `scaled.ts:76`.
  - The editor accepts 15 significant digits, so a divisor of `0.0000001` becomes "Divide by 1e-7", and an engineering value `0.0000005` becomes "Linear 0-10 to 0-5e-7". DES-003 1.3 forbids exponent notation for numbers shown.
  - Fix: use `plainNumber`, as the editor does.
- **n-3. An override whose scale is `none` (hand-edited profile) still shows the sliders marker.**
  - The marker reads "Scale override 5: Raw (no scale), 2 dp", while the value shows "—".
  - Decision 4 of the FE-003 notes says "no marker".
  - Fix: `markerAt` in `scaled.ts:120-127` should skip overrides whose scale is none.
- **n-4. The Write preview also hides when only the slave ID is invalid.**
  - Where: `WriteDialogView.tsx:135-138` (`validation.ok` covers every field).
  - DES-003 3.5 only names "an invalid raw value".
  - Harmless; mention it to QA for CHK3-F2.
- **n-5. `sameScale` compares `JSON.stringify` output.**
  - Where: `poll-scale.logic.ts:46-48`.
  - It is key-order dependent. The orders match today (sanitized settings and serde both follow the struct order), but a reordered binding would turn the no-op check into a resend.
  - A field-wise compare is sturdier.

## Answers to the specific questions of the request
- **Tie band capped at 1e-6:**
  - Below |s| = 1000 it is exactly the design rule.
  - Above that, it differs from the literal rule only where the literal rule is wrong. The literal rule has 24% wrong digits at 6 dp for ordinary 4-20 mA values.
  - Compared with exact decimal rounding of the true quotient, the code has no difference below about 5.8e13 for |Y x 10^d|, which is the limit of float64.
  - Recommend that the designer accept Q-FE3-01 and amend DES-003 1.3.
- **Can a scaled preview change the bytes written?** No, in every path: FC06 and FC16, unsigned, signed, hex and binary, override or poll scale (section 4).
- **The "Tab visits the regions" timeout:** a test problem (cost of user-event's document-wide tab search in a full-window jsdom render, about 4 s of a 5 s budget in a full run). It is not a product timer or render storm (m-6).

## Verdict
**Approve.** There is no blocker and no major. The scale math is correct and better than the design's literal tie rule, the raw value written is never altered, and the IPC keys and payloads match Rust.

Fix before the QA integration run:
- m-3 and m-5: wrong or hidden data on screen or in the write prefill.
- m-1 and m-2: keyboard behaviour in modals.
- m-6: the timeouts make `pnpm test:web` flaky on a loaded CI machine.

m-4 goes with the designer's answer to Q-FE3-06. The rest can follow.
