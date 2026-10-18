# FE-003 Value scaling - frontend tasks

**Revision 7 (2026-10-16): after REV-007.**
- **Q-FE3-01 to Q-FE3-06 are answered.** See DES-003 section 7 and `docs/questions.md`. Q-FE3-01, -02, -03 and -05 are accepted as built. Q-FE3-04 is decided as built: S8 has no None preset. Q-FE3-06 is a new rule for the FC16 preview.
- **Task 01:** the tie rule is now DES-003 1.3 revision 7, which is the implemented rule. The property test "equals the literal DES-003 1.3 rule where that rule is sound" can stay, but its reference is now the revision 7 steps.
- **New task 10** lists the follow-ups that change behaviour. Each has a CHK-003 item that fails until it is done.

**Revision 6 (2026-10-16): hybrid hosting.** The scale editor is part of the shared PollSetup inside the shared PollView (FE-002 task 11), so it renders as a panel/rail in a native poll window and as a dock/popover in a workspace sub-window. The unapplied scale draft lives in `pollViewUiStore.scaleDraft` (FE-002 task 07) so it survives presentation changes and pop out/dock. Tasks 04, 05, 06, 07 and 08 gain alias and hosting criteria; prerequisites renumbered. Tasks 01-03 and 09 are unchanged.

Upstream: `docs/design/DES-003-value-scaling.md` revision 6 (DES-003), DES-002 revision 6 (where scale settings are stored, hosts, aliases), DES-001 rev 4. QA: `docs/qa/CHK-003-value-scaling.md`.
Prerequisite: FE-002 tasks 01, 07 and 11 (was 01, 05 and 10). Scale settings travel with `mm_set_poll_view` and arrive in `PollConfig`.

## Ground rules
- **Display only:** scaling is computed in pure frontend functions. Nothing new goes on the wire, and the raw value is never changed.
- **Source of truth:** the applied scale settings live in Rust as part of the poll view settings (DES-002 section 8). The editor is a local draft.
- **Strings:** copied exactly from DES-003. Each store is a factory tested with the fake.

## Tasks (ordered)

### 01 Scale math (pure)
- **Goal:** pure functions:
  - `scaleValue(raw: number /*0..65535*/, s: ScaleSettings): { y: number; outOfRange: 'below' | 'above' | null } | null`
    - linear presets use the owner's formula
    - Divide with an integer divisor uses exact integer math
    - clamp per DES-003 1.4, including reversed ranges
    - `rawSigned` reinterprets 32768-65535 as negative
  - `formatScaled(y, decimals): string`
    - half away from zero, with the tie tolerance from DES-003 1.3
    - no negative zero
    - "too large" at 1e15 or more
  - `presetDefaults(preset, current?)` (DES-003 2)
  - `scaleSummary(s, full: boolean)` (DES-003 3.1)
  - `effectiveScale(address, pollScale, overrides)` (the override wins)
- **States:** live and stale rendering of the scaled column.
- **Store:** none.
- **Acceptance (Vitest):** every worked example in CHK-003 section A, exactly, plus:
  - `formatScaled(-0.04, 1) === "0.0"`
  - `formatScaled(0.15, 1) === "0.2"` (float tie)
  - a reversed scale clamps to the nearest end
  - `effectiveScale` returns the override for addresses inside it and the poll scale outside

### 02 Scale validation (zod)
- **Goal:** `scaleSchema(rawSigned)`, `overrideSchema(base, existingOverrides, editingIndex?)`, and a 64-override limit. Messages exactly as in DES-003 4 (comma message, equal min/max messages placed under the max field, signed ranges).
- **States:** invalid input (scale).
- **Store:** none.
- **Acceptance (Vitest):** each row of DES-003 4 with boundary values:
  - raw min -1, 0, 65535, 65536 (unsigned) and -32769, -32768, 32767, 32768 (signed)
  - eng `4,5` gives the comma message
  - `1e3` is rejected
  - divisor 0 and -0 are rejected, -2.5 is accepted
  - decimals 7 is rejected
  - a 13-character unit is rejected
  - overlapping 5-9 with existing 8-12 gives "This range overlaps the override for 8-12."
  - the 65th override is rejected

### 03 Poll view store: scale part (per poll view, both hosts)
- **Goal:** mirror the applied scale, overrides and value columns, and apply changes through IPC.
- **States:** applied, not applied (invalid input), and inactive for FC01/02.
- **Store unit:** `pollViewStore` (extends FE-002 `pollStore.setView`; display already there)
  ```
  state: {
    display: DisplaySettings
    scale: ScaleSettings | null
    overrides: ScaleOverride[]
    valueColumns: 'raw' | 'scaled' | 'both'
    scaleActive: boolean                      // false for FC01/02
    pending: boolean
  }
  derived: anyScale (scale || overrides.length > 0), scaleKey(address) (memo key for rows)
  actions:
    applyFromConfig(config) /* PollConfig / PollConfigChanged */,
    applyScale(s) /* validated draft -> setPollView; first scale switches valueColumns to 'both' */,
    clearScale(), addOverrides(ranges[], s), updateOverride(i, o), removeOverrides(addresses[]),
    setValueColumns(c), cycleValueColumns()
  ```
- **Acceptance (Vitest):**
  - `applyScale` with the first scale sets `valueColumns` to `both`. `cycleValueColumns` goes raw -> scaled -> both.
  - `removeOverrides` for a selection crossing 2 overrides removes both.
  - With FC01, `scaleActive` is false and the scale is kept.
  - Every change calls `setPollView` once.

### 04 Scale editor in PollSetup (panel, rail, dock, popover)
- **Goal:** the DES-003 3.1 SCALE section, rendered by PollSetup in every presentation (native panel, workspace dock, workspace popover; hidden behind the rail in compact mode):
  - preset select, "Raw is signed", raw fields and quick picks
  - read-only engineering fields for the 4-20 mA and 0-10 V presets, with the hint
  - unit, decimals, out-of-range segmented control
  - [Apply scale] (and `Enter`), the "Applied: {summary}" line, the header error "Scale not applied. Fix the highlighted fields."
  - the FC01/02 disabled text and the kept-scale note
  - unapplied scale edits report `hasUnappliedEdits` (FE-002 07)
- **Store unit:** `scaleDraftStore` (local draft, persisted into `pollViewUiStore.scaleDraft` on every change so the handoff and presentation switches keep it)
  ```
  state: { draft: ScaleDraft /* strings for inputs */; errors: Record<string,string>; dirty: boolean }
  actions: setPreset(p) /* presetDefaults; keeps raw range for linear */, setField(k, v), quickPick(range),
           reset(fromApplied), validate(): ScaleSettings | null, hydrate(draft) /* from handoff */
  ```
- **Acceptance (Testing Library):**
  - In a 300px dock the field pairs stay side by side; at 260px content width they stack.
  - An invalid Raw max typed in a workspace popover, then the popover closed and the sub-window popped out: the native panel shows the same text and "Raw min and raw max must be different." (with the fake's handoff).
  - Selecting 4-20 mA fills "mA", 2 decimals, Y 4/20 read-only.
  - The quick pick "4000-20000" fills the raw fields.
  - Raw min = raw max shows "Raw min and raw max must be different." under Raw max, and the applied summary is unchanged.
  - Switching to Divide/100 sets decimals to 2.

### 05 Data table scaled column
- **Goal:**
  - Raw / Scaled / Both columns, with the "Show (Raw)(Scaled)(Both)" control and `Ctrl+Shift+V`
  - scaled cell layout (value + unit), out-of-range markers (warning-tint plus icon for flag, arrow icons for clamp), override marker on the address
  - "—" for rows without a scale
  - accessible names per DES-003 6
  - the new token `--color-warning-tint`
  - per-row memo on (raw, scale key)
  - column order Alias | Address | Raw | Scaled (Alias from FE-002 task 11/12); the out-of-range tint never covers the Alias cell
  - the Raw header stays "Raw ({format})" in Raw-only mode
- **States:** live, stale and loading for the scaled column.
- **Store:** `pollViewStore`, `pollDataStore`.
- **Acceptance:**
  - Testing Library:
    - a flagged cell has the `triangle-alert` icon and the accessible name "12.21 V, out of range"
    - a clamped cell has the `arrow-up-to-line` icon and "10.00 V, clamped"
    - the address cell of an override row has the `sliders-horizontal` icon with the title from DES-003 3.2
  - Perf test (FE-001 style): one changed raw value re-renders one row, scaled column included.

### 06 Overrides UI
- **Goal:**
  - the context menu "Set scale for selected rows…" and `Ctrl+Shift+E`, opening the S8 dialog with "Applies to {ranges}"
  - [+ Add override] with Start and End fields (display base plus the protocol helper)
  - the override list (Edit, Remove), and "Not in the current poll range"
  - the context menu "Remove scale override"
- S8 is a modal of the poll's host (W1 for a sub-window, the poll window for a popped-out poll) and shows the example line "Example: raw {x} shows {scaled} {unit}. Overrides win over the poll scale." (DES-003 3.2 revision 6).
- **Store:** `pollViewStore`, `tableSelectionStore`, plus `overrideDialogStore`:
  ```
  state: { open: boolean; ranges: Array<{start; end}>; editingIndex: number | null; draft: ScaleDraft; errors }
  actions: openForSelection(rows), openNew(), openEdit(i), save() /* validate all ranges, then addOverrides/updateOverride */, close()
  ```
- **Acceptance (Testing Library):**
  - Selecting rows 0, 1, 5, 9-12 gives "Applies to 0-1, 5, 9-12" and creates 3 overrides.
  - An overlapping range gives the exact overlap message.
  - An override outside a shrunk poll range shows "Not in the current poll range".

### 07 Copy options
- **Goal:** `Ctrl+C` follows `valueColumns`. Context menu entries "Copy raw", "Copy scaled", "Copy raw and scaled", "Copy with header", "Copy aliases", and the checkbox "Include alias in copy" (`display.copyAlias`), in the formats of DES-003 3.4 revision 6. The clipboard refusal toast is reused.
- **Store:** none new. Pure `formatCopy(rows, mode, header, includeAlias)` and `formatAliases(rows)`.
- **Acceptance (Vitest):**
  - With alias on: "PT-201\t0\t0\t4.00\n\t1\t65535\t20.00"; with header in Hex: "Alias\tAddress (0-based)\tRaw (Hex)\tScaled\nPT-201\t0\t0x0000\t4.00".
  - `formatAliases` for rows 0-2 with aliases "A", none, "C" gives "A\n\nC".
  - Both mode, 4-20 mA on 0-65535, rows 0-1 with raw 0 and 65535 gives "0\t0\t4.00\n1\t65535\t20.00".
  - With header in Hex: "Address (0-based)\tRaw (Hex)\tScaled\n0\t0x0000\t4.00".
  - A row without a scale gives an empty scaled field.

### 08 Write dialog scaled preview
- **Goal:** the FC06 line "Scaled: {value} {unit}", with "(out of range)" or "(clamped)" appended, and the FC16 line with the first 5 values and the unit once, using the effective scale per target address. No preview for FC05/15, for invalid raw input, or for unscaled addresses. Raw input only (no engineering-unit entry).
- Also (revision 6): the preview box styles (neutral tint, warning tint + `triangle-alert` for out of range, clamp icons) and the helper "Writes send the raw value only. The preview shows what it means under the scale for address {address}."; the "Alias: {alias}" line under Address (FC15/16: start address plus " (+{n} more with aliases)"); title "Write · {poll name}".
- **Store:** `writeStore` (FE-001), plus `pollViewStore` and `aliasStore` (read).
- **Acceptance (Testing Library):**
  - FC06 address 4 with alias "FT-102 outlet flow" shows "Alias: FT-102 outlet flow"; FC16 at 0 with quantity 3 where 0 and 2 have aliases shows "Alias: {alias of 0} (+1 more with aliases)".
  - Value 3600 under 4-20 mA (4000-20000, flag) shows the warning-tint box with "Scaled: 3.60 mA (out of range)".
  - FC06 address 0 with value 32768 under 4-20 mA (0-65535) shows "Scaled: 12.00 mA".
  - The value 70000 shows no preview.
  - FC16 at an override range with Divide by 10 and values `253 254` shows "Scaled: 25.3, 25.4 °C".

### 09 Profile round-trip of scale settings
- **Goal:** export and apply of `scale`, `scaleOverrides` and `valueColumns` per poll. Missing fields read as None/Raw. Applied scale changes mark the profile "Modified" (FE-002 23).
- **Store:** `profileStore` (FE-002 23), `pollViewStore`.
- **Acceptance:**
  - Vitest: a profile with 2 overrides round-trips deep-equal through apply and then export.
  - A schema-1 or scale-less profile opens with scale None and Raw columns.
  - Applying a scale marks the profile modified, and changing value columns marks it modified too (display setting).

### 10 REV-007 follow-ups (revision 7)
Each sub-task is small and can be tested on its own.

- **10a "too large" after rounding** (n-1, DES-003 1.3 step B5).
  - **Goal:** `formatScaled` applies the 1e15 limit to the rounded magnitude m (m >= 10^15 x 10^d), as `formatRatio` already does.
  - **Store:** none.
  - **Acceptance (Vitest):** CHK3-A45 to A55 are added to the table-driven test, in particular:
    - `formatScaled(999999999999999.5, 0) === "too large"`
    - `formatScaled(999999999999999.5, 1) === "999999999999999.5"`
    - `formatScaled(1.996, 2) === "2.00"`
- **10b Effective value columns** (m-3, DES-003 1.5).
  - **Goal:** effective columns = `scaleAvailable(config) ? config.valueColumns : "raw"`. Use them in the grid, the Show control value, `copyRows`, and the `Ctrl+Shift+V` handler (no-op while the control is disabled). The stored value is not rewritten.
  - **Store:** `pollViewStore` derived selector `effectiveValueColumns`. It has no new state.
  - **Acceptance:**
    - Vitest: a config with `valueColumns: "scaled"` and `scale: null` gives `"raw"`, the same config with FC01 gives `"raw"`, and `contentSignature` is unchanged.
    - Testing Library: CHK3-I2.
- **10c FC16 preview** (m-4, Q-FE3-06, DES-003 3.5).
  - **Goal:** `writePreview` for FC16:
    - When the units of the listed scaled items differ, it prints the unit after each value. When they are the same, it prints the unit once at the end, after " …".
    - It appends " (out of range)" or " (clamped)" per item.
    - The tone is `warning` with `triangle-alert` when any item is flagged. Otherwise it is `neutral` with no icon.
  - **Store:** none (pure function in `store/write.logic.ts`).
  - **Acceptance (Vitest):** the exact texts of CHK3-F3, F10 and F11.
- **10d No marker for a None override** (n-3, DES-003 3.2).
  - **Goal:** `markerAt` skips overrides whose scale is None.
  - **Store:** none.
  - **Acceptance:** CHK3-D13.
- **10e Summaries without exponent** (n-2, DES-003 3.1).
  - **Goal:** `scaleSummary` and the tooltips print numbers with `plainNumber`.
  - **Acceptance (Vitest):** a divisor of 1e-7 gives "Divide by 0.0000001".
- **10f Keyboard and menu regressions** (m-1, m-2, m-5, DES-003 3.6).
  - **Goal:**
    - S8 stops only the events the sub-window frame reacts to, and lets Tab and Shift+Tab reach the Radix focus scope.
    - In the modal branch of `lib/shortcuts.ts`, `preventDefault()` is called only for `SUPPRESSED_DEFAULTS`, so `Ctrl+Shift+V` pastes in dialog fields.
    - Row-menu "Write…" uses `menu.address`.
  - **Acceptance (Testing Library):**
    - Tab from [Save] in S8 focuses the close button (CHK3-I3).
    - `Ctrl+Shift+V` in the Write Value field does not change `valueColumns` and is not default-prevented (CHK3-I4).
    - Right-clicking row 7 inside a 0-9 selection focused on 0, then choosing "Write…", opens with address 7 (CHK3-I1).

---

## Implementation notes (2026-10-16)

All nine tasks are done in `apps/desktop/src` (frontend only; no crate, `src-tauri`, `e2e/`, `CHANGELOG.md` or other doc was touched). `pnpm --filter @esefact/desktop typecheck`, `pnpm lint:web`, `pnpm test:web` (118 files, 2871 tests; part B2b ended at 105 files and 2479) and `pnpm build:web` pass. Root `pnpm typecheck` also runs the e2e project and fails there in QA's untracked `e2e/tests/chk2-e-workspace.spec.ts` (`Object is possibly 'undefined'`, line 200); not mine and not touched.

### Layout of the code
- **01 math (pure):** `lib/scale-math.ts` (`scaleValue`, `formatScaled`, `formatRatio`, `effectiveScale`, `scaleKey`), `lib/scale-presets.ts` (`presetDefaults`, `scaleSummary`, quick picks, divisor choices, fixed texts), `lib/scaled.ts` (the real provider `createScaled`, `createScaledFactory` which hands back the same provider while scale, overrides, base and function are unchanged, `scaleActive`, `scaleAvailable`), `lib/scale-example.ts` (S8 example line).
- **02 validation:** `lib/scale-validation.ts` (`scaleSchema(rawSigned)`, `overrideSchema(base, existing, editingIndex)`, `overrideRangesMessage`, `ScaleForm`, `formFromSettings`, `sanitizedSettings`), zod, messages word for word from DES-003 4.
- **03-04, 06 stores (each with a Vitest file):** `store/poll-scale.store.ts` + `.logic.ts` (applied scale, overrides, value columns, `scaleActive`; one `setView` per change), `store/scale-draft.store.ts` (editor draft, mirrored into `pollViewUiStore.scaleDraft`, `hydrate` for the handoff), `store/override-dialog.store.ts` (S8), `store/scale-form.logic.ts` (shared pure steps). They are part of `PollViewStores` as `scale`, `scaleDraft`, `overrides`. `nextValueColumns` moved to `poll-scale.logic.ts` (re-exported from `poll-view-shortcuts.ts`).
- **UI:** `components/poll-view/ScaleEditor.tsx` (presentational, shared by the setup and S8), `ScaleSection.tsx` (SCALE and OVERRIDES; `PollView` renders it by default, the `scaleSection` prop still overrides), `OverrideDialog.tsx` (S8, mounted by `PollView`, modal lock through the new `lockModal` runtime dependency wired to the window's layout store in both runtimes). `DataGrid`, `DataCard`, `StatusLine` use `scaleAvailable` (a coil/discrete poll shows Raw only and a disabled Show control). Context menu: "Set scale for selected rows…" (`Ctrl+Shift+E`, added to `SUPPRESSED_DEFAULTS` and `pollViewBindings`) and "Remove scale override". `WriteDialogView` got the note under the preview.
- **05 per-row cost:** the provider caches each row's cell on (address, raw); the factory keeps the provider across config events that are not about the scale; `Row` is memoized. `ScaledGrid.perf.test.tsx`: an identical update scales 0 rows, one changed raw value scales 1, an alias change 0, a scale change once per visible row.

### Acceptance bar
- `lib/scale-math.test.ts` is table-driven over all 43 CHK-003 examples (A1-A43: text, marker, tooltip, accessible name where the table gives one) and passes with no exception. Plus `formatScaled(-0.04, 1) === "0.0"`, `formatScaled(0.15, 1) === "0.2"`, reversed clamp, `effectiveScale`, and seeded property tests (monotonic for increasing and for reversed Y, text within half a unit, no "-0", exact divisor agrees with float away from ties, `formatScaled` equals the literal DES-003 1.3 rule where that rule is sound).
- UI tests: `ScaleSection.test.tsx` (both hosts, C1-C13, B4, B5, stacking, draft kept across popover close and pop out / dock), `ScaledGrid.test.tsx` (A and B items, H1, D8, E1-E7), `OverrideUi.test.tsx` (D1-D9), `ScalingWindow.test.tsx` (W1: shortcuts, modal lock, Modified, F1-F9), `profile-scale.test.tsx` (G1, G2), native `Ctrl+Shift+V/E` in `ShortcutMaps.test.tsx`. Test helpers: `renderPollView` got `wrapper` and `setScaleWidth`.

### Decisions and deviations (points the design left open or contradicts)
1. **Tie band (DES-003 1.3).** Taken literally, `1e-9 x max(1, |s|)` exceeds 0.5 once |s| > 5e8 and every value would round up (1e9 would show 1000000001). The band is capped at 1e-6 (`TIE_CAP`); below |s| = 1000 the rule is exactly the design's. The whole part and the fraction are rounded apart, because `y x 10^d` printed 999999999999999.00 as ...999.04. Q-FE3-01.
2. **Stacking threshold.** The dock is 300 px wide but its content is 274 px (padding and border), so "stack below 280" would stack in the dock, against "a 300px dock stays side by side". Pairs stack at 260 px content width or less. Q-FE3-02.
3. **Signed default range.** A new signed scale starts with raw 0-32767 (0-65535 is invalid for signed). Q-FE3-03.
4. **S8 has no "None"** (an override with None has no meaning in the design); a profile that holds one shows no value and no marker for those rows. Q-FE3-04.
5. **Value columns after the last scale is removed** go back to Raw (DES-003 1.5 "otherwise Raw"), in the same patch.
6. **Coil/discrete polls:** scale kept and ignored; the table shows Raw only, the Show control shows Raw, is disabled and its title is "Scaling applies to registers (FC03 and FC04) only." (the design only gives the no-scale title), copy gives raw only, S8 and Add override are disabled. Q-FE3-05.
7. **Override marker for a single address** reads "Scale override 5: ..." (not "5-5"); ranges as designed, in the display base.
8. **"Applied:" uses the short summary**, the override list, the marker title and tooltips the full one (as C10 and D1 show).
9. **Provider extension:** `ScaledProvider.override(address)` (optional) so the override marker shows while a row has no value yet.
10. **S8** has no title in the design: "Scale override" / "Edit scale override". A selection that touches an existing override reports the overlap message (no silent replace). Events inside the dialog are stopped from bubbling to the sub-window frame behind the portal (tested against a React ancestor).
11. **Draft store state** differs in names from the sketch: `{ applied, form, errors, failed, pending }`, `dirty` is the selector `form !== null`. An unreadable handoff draft is dropped.
12. **Fixed on the way:** `runtime/profile-modified.test.tsx` "a scale setting" used a scale with stale field names (`as never`); it now uses a valid `ScaleSettings`. `numberText` tolerates a missing number from a hand-edited profile.

### Not verifiable in jsdom (needs a real window or WebView2)
Real layout (container widths, the dock/popover/panel pair stacking, the 480 px dialog look, centering S8 on W1 for a sub-window), contrast of `--color-warning-tint` text, focus rings and fonts, tab order inside the setup, the clipboard permission, `Ctrl+Shift+E` and `Ctrl+Shift+V` reaching the page in WebView2, CHK3-A44 and G3 (simulator and the 8 polls at 100 ms long-task criterion), pop out / dock with the real backend.

### Questions for the designer (all answered in DES-003 revision 7, section 7)
- **Q-FE3-01** DES-003 1.3 tie band: cap it (done at 1e-6) or define it differently for large values?
- **Q-FE3-02** Stacking threshold: 260 px content (done) or measure the dock as 300 px content?
- **Q-FE3-03** Default raw range of a new signed scale: 0-32767 (done)?
- **Q-FE3-04** Should an override be able to switch scaling off for its rows (a None entry in S8)?
- **Q-FE3-05** Show control title and S8 behaviour for FC01/02 (see 6).
- **Q-FE3-06** FC16 preview: out-of-range or clamped values among the five are not flagged (the design only marks FC06); flag them?

## REV-007 fixes (2026-10-16, frontend only)

Scope: `apps/desktop/src` and these notes. Rust, `e2e/`, `CHANGELOG.md` and other docs were not touched.

### Decisions on the review points that were open
- **Q-FE3-01 (tie band cap 1e-6):** the designer amended DES-003 1.3 (revision 7) and the PM accepted it; the code was already the rule, and CHK3-A45 to A55 are in the table-driven test. I re-derived A45 to A55 and C15 independently by hand and by the code: every number in CHK-003 agrees with the code, no discrepancy.
- **Q-FE3-04 (S8 has no None preset):** decided as built (a later REQ may add it). An override that holds None (hand-edited profile) shows no value and, since n-3, no marker.
- **Q-FE3-06 (FC16 preview):** unit after each value when the units of the listed scaled items differ, once at the end (after " …") when they are the same; " (out of range)" or " (clamped)" after the affected value; warning tint + `triangle-alert` when any item is flagged, otherwise neutral without an icon; an address without a scale is "—". Exact texts (CHK3-F3, F10, F11): "Scaled: 25.3, 25.4, 25.5, 25.6, 25.7 … °C", "Scaled: 25.3 °C, 12.34 bar, —", "Scaled: 0.00 (out of range), 12.00 mA", "Scaled: 4.00 (clamped), 12.00 mA".

### What was fixed
- **m-5** `DataGrid.tsx`: row menu "Write…" uses `menu.address` (the right-clicked row), falling back to the focused row for a menu opened with the keyboard that has no row. Regression tests in `PollView.test.tsx` (both hosts) fail on the old code.
- **m-3** `lib/scaled.ts` `effectiveValueColumns(config)` = `scaleAvailable(config) ? config.valueColumns : "raw"`, used by the grid, the Show control (wide and compact), the status line menu and `copyRows`. The stored value is not rewritten, so opening such a profile is not Modified and Save writes it back unchanged. `cycleValueColumns` (`Ctrl+Shift+V`) is a no-op while the Show control is disabled. Chosen over normalizing on load because it cannot change a file the user did not edit and covers the fake and any other source of the same state. Tests: `scaled.test.ts`, `poll-scale.store.test.ts`, `ScaledGrid.test.tsx`, `profile-scale.test.tsx` (profile load: columns, not Modified, Save keeps it, first scale gives Both). Old tests that used Scaled or Both with no scale now give the poll a scale.
- **m-1** `OverrideDialog.tsx` stops pointer, context-menu and double-click events and every key except Tab, so the Radix focus trap sees Tab. The sub-window frame reacted to keys in its capture phase, which a bubble-phase stop can never prevent: `SubWindowFrame.tsx` now ignores key and pointer events whose target is not a DOM descendant of the frame (events of a portal dialog). Test in `ScalingWindow.test.tsx`: Alt+Arrow and Ctrl+Alt+Arrow in S8 do not move the sub-window, Tab on [Save] goes to the close button, two full cycles stay inside the dialog; it fails on each half of the old code.
- **m-2** `lib/shortcuts.ts`: with a modal open, `preventDefault()` only for the combos of `SUPPRESSED_DEFAULTS`; other bound keys (`Ctrl+Shift+V`) go on to the focused field and run nothing. Tests in `shortcuts.test.ts` and `ScalingWindow.test.tsx` (Write dialog Value field).
- **m-7** `shared/ipc/fake-validation.ts` `checkScale`, `checkScaleOverrides`, `checkDisplayShape` mirror `check_scale`, `check_scale_overrides`, `check_display` of `crates/shared-types/src/view.rs` (same texts, same order as `validate_view_parts`: display, scale, overrides, aliases); the fake applies them in `setPollView`, `addPoll` and `applyProfile`, and stores nothing when one fails. Tests in `modbus-master.fake.test.ts`.
- **m-6** `A11y.test.tsx` and `Performance.test.tsx`: explicit timeouts (60 s) for the heavy tests, the Tab loop stops once the four regions are seen, `eight()` adds the polls in one act, and the two suites turn off `IS_REACT_ACT_ENVIRONMENT` outside RTL's own act calls (the replies of the fake reach mounted components a few microtasks after the last act; each update warned). Both suites print no act warning now. `ScalingWindow.test.tsx` still prints some (not part of this task).
- **m-4** `store/write.logic.ts` `writePreviewFor` FC16 as in Q-FE3-06 above; tests at the logic level (real provider) and in the Write dialog.
- **n-1** `formatScaled` applies the 1e15 limit to the rounded magnitude (`999999999999999.5` at 0 dp is "too large", at 1 dp it is shown).
- **n-2** `scaleSummary` (and so the marker titles and tooltips) print numbers with `plainNumber` ("Divide by 0.0000001").
- **n-3** `createScaled` gives no marker for an override whose scale is None.
- **n-4** not changed: an invalid slave ID hides the preview as well; mention to QA for CHK3-F2.
- **n-5** `sameScale` compares field by field.

### Not verifiable in jsdom
Tab wrapping and `Ctrl+Shift+V` pasting in WebView2 (CHK3-I3, I4), and the clipboard permission.

