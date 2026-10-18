# DES-003 Value scaling (engineering units)

**Revision 7 (2026-10-16): rounding rule and PM decisions after REV-007.** Changes:
- **1.3 rewritten.** The revision 6 tie rule ("within 1e-9 x max(1, |s|) of 0.5 is a tie") is replaced by the rule the code implements: the tie band is capped at 1e-6, and the whole part and the fraction are rounded separately. REV-007 compared both with exact rounding over 7.47 million cases. The old rule was wrong in about 24% of them, and above |s| = 5e8 every value rounded up. The section now has worked examples, the validity range, and "too large" judged on the **rounded** value.
- **PM decisions on Q-FE3-01 to Q-FE3-06** (`docs/questions.md`):
  - 1.5: value columns fall back to Raw, and the FC01/02 behaviour is defined.
  - 2: a signed scale starts with raw range 0-32767.
  - 3.1: field pairs stack at a content width of 260 px or less, and "Applied:" uses the short summary.
  - 3.2: S8 titles, no None preset, overlap on a selection, the single-address marker.
  - 3.5: the FC16 preview gets per-value units and out-of-range notes.
- **New 3.6:** keyboard and context-menu rules confirmed by REV-007 (m-1, m-2, m-5).

**Revision 6 (2026-10-16): hybrid hosting and aliases** (DES-002 revision 6, owner decisions D-002-01 to D-002-06). Changes: the scale editor lives in the shared PollSetup component, shown as a panel or rail in a native poll window and as a dock or popover inside a workspace sub-window (3.1); the data table gains the Alias column first (3.3); copy can include the alias (3.4); the Write dialog shows the alias of the target address and the poll name in its title (3.5); S8 shows an example line (3.2). Scale math, presets, validation and profile rules are unchanged.

Upstream: `docs/requirements/REQ-003-value-scaling.md`. Builds on `DES-002-multi-poll.md` (scale belongs to each poll) and `DES-001-modbus-master.md` revision 4.
Downstream: `FE-003-value-scaling.md` and `CHK-003-value-scaling.md`. There is no BE-003: scaling is display only and computed in the frontend. The only backend work is the storage fields listed in DES-002 section 8.
Owner questions: `docs/questions.md` (Q-003-xx). **Assumption:** the owner's "40-20 mA" means **4-20 mA** (REQ-003).

---

## 1. Model

### 1.1 Where the settings live
Every poll has a **poll scale** and up to 64 **overrides**. Both live in the poll's view settings, which are stored in Rust through `mm_set_poll_view` (DES-002 section 8) and saved in the profile. Overrides win over the poll scale. Removing an override falls back to the poll scale.

```
ScaleSettings {
  preset: 'none' | 'current4to20' | 'voltage0to10' | 'divide' | 'linear'
  rawSigned: boolean          // X is read as signed 16-bit (-32768..32767) instead of unsigned (0..65535)
  xMin, xMax: integer         // raw range (linear presets)
  yMin, yMax: number          // engineering range (linear presets)
  divisor: number             // divide preset
  decimals: 0..6
  unit: string                // 0..12 chars
  outOfRange: 'flag' | 'clamp'   // linear presets only
}
ScaleOverride { start: number, end: number /* protocol addresses, inclusive */, scale: ScaleSettings }
ValueColumns = 'raw' | 'scaled' | 'both'
```

### 1.2 Formulas
- **Linear presets** (4-20 mA, 0-10 V, Custom linear), using the owner's formula:
  `Y = (X - Xmin) / (Xmax - Xmin) x (Ymax - Ymin) + Ymin`
  - X is the raw register, read unsigned or signed according to `rawSigned`.
  - It is computed in 64-bit floating point.
  - `Xmin > Xmax` and `Ymin > Ymax` are both allowed (reversed scales). Only equal values are invalid.
- **Divide:** `Y = X / divisor`.
  - With an integer divisor it is computed **exactly** in integer/decimal arithmetic, so ties are exact.
  - With a non-integer custom divisor, float64 is used.
- **None:** no scaled value. The scaled column shows "—".

### 1.3 Rounding and display (revision 7)
Y is shown with d = `decimals` places (0-6), rounding **half away from zero**. The steps below are the normative definition. Unit tests and QA check them, not a library function: for example, `toFixed(2)` gives "2.67" for 2.675, where this rule gives "2.68".

**A. Divide by an integer divisor** (10, 100, 1000, or a whole-number custom divisor): exact integer arithmetic.
1. Let n = |X| x 10^d and p = |divisor|.
2. q = floor(n / p), plus 1 when 2 x (n mod p) >= p.
3. The text is q with the decimal point placed d digits from the right.
4. The sign is negative when X and the divisor have opposite signs.

**B. Every other scale** (linear presets, non-integer divisor): Y is a float64, and is rounded as follows.
1. Let a = |Y|, w = floor(a) (the whole part) and f = (a - w) x 10^d (the fraction counted in units of the last shown digit). Both `a - w` and `w` are exact in float64.
2. **Tie band:** t = min(1e-9 x max(1, a x 10^d), 1e-6).
   - Below |s| = a x 10^d = 1000, the band is the relative 1e-9 x max(1, |s|).
   - From |s| = 1000 up, the band is a fixed 1e-6 of one last-digit unit.
3. **Tie:** if |f - floor(f) - 0.5| <= t, the value is a tie and the fraction digits are floor(f) + 1 (away from zero). Otherwise the fraction digits are f rounded to the nearest whole number.
4. **Magnitude:** m = w x 10^d + fraction digits, in exact integer arithmetic. A fraction that rounds up to 10^d carries into the whole part: 1.996 at 2 dp gives f = 99.6, digits 100, m = 100 + 100 = 200, so "2.00".
5. **Too large:** if m >= 10^15 x 10^d, the cell shows "too large". So the limit applies to the **rounded** magnitude: a value that rounds up to 1e15 shows "too large". A non-finite Y also shows "too large". This is not reachable, because the backend rejects non-finite settings.

The same "too large" limit applies to A: q >= 10^15 x 10^d. A 16-bit raw value divided by a whole number never reaches it.

**Common to A and B:**
- **No negative zero:** a result with m = 0 (or q = 0) is shown without a minus sign ("0", "0.0", "0.00").
- **Number format:**
  - a dot as the decimal separator
  - no thousands separator
  - trailing zeros kept (`12.30` with 2 decimals)
  - no exponent notation
- **The raw value never changes.** Scaling never changes what is sent on the wire.

**Worked examples** (all are CHK-003 A items):

| Scale, raw | Exact value | Steps | Shown |
|---|---|---|---|
| 4-20 mA, raw 0-65535, 6 dp, raw 717 | 4 + 11472/65535 = 4.175051499199… | w = 4. f = 175051.499199…, so f - floor(f) = 0.499199… and the distance to 0.5 is 0.000801. t = 1e-6, so this is not a tie and f rounds to 175051. (The revision 6 band, 1e-9 x 4175051.5 = 0.0042, would have called it a tie and shown 4.175052.) | `4.175051` |
| 0-10 V, raw 0-1000, 1 dp, raw 15 | 0.15 (float64 holds 0.1499999…) | w = 0. f = 1.4999999999999998, distance about 2e-16. t = 1e-9 x 1.5 = 1.5e-9, so this is a tie and the digits are 1 + 1 = 2. | `0.2` |
| Custom linear raw 0-4000 to 0-4, 2 dp, raw 2675 | 2.675 (float64 holds 2.67499999999999982…) | w = 2. f = 67.49999999999998, distance about 2e-14. t = min(1e-9 x 267.5, 1e-6) = 2.675e-7, so this is a tie and the digits are 67 + 1 = 68. | `2.68` |
| Custom linear raw 0-4000 to 0 to -4, 2 dp, raw 2675 | -2.675 | a = 2.675, the same steps as the row above, then the minus sign | `-2.68` |
| Divide by custom 0.4 (non-integer, so float), 0 dp, Raw is signed, raw 65535 (-1) | -2.5 | a = 2.5, w = 2, f = 0.5, distance 0, so this is a tie and the digits are 0 + 1 = 1. m = 3, then the minus sign. | `-3` |
| Custom linear raw 0-10 to 0-10000000004, 0 dp, raw 1 | 1000000000.4 | f = 0.4, distance 0.1 > t = 1e-6, so this is not a tie and f rounds to 0. (The revision 6 band is 1e-9 x 1e9 = 1, which would have shown 1000000001.) | `1000000000` |
| Custom linear raw 0-2 to 999999999999998-999999999999999, 0 dp, flag, raw 3 (above the range) | 1.5 x 1 + 999999999999998 = 999999999999999.5 (exact in float64) | w = 999999999999999, f = 0.5, so this is a tie and the digits are 1. m = 10^15 >= 10^15, so the result is too large. | `too large` |
| the same scale, 1 dp, raw 3 | 999999999999999.5 | f = 5.0, distance 0.5, so this is not a tie and the digits are 5. m = 9999999999999995 < 10^16. | `999999999999999.5` |
| Custom linear raw 0-1 to 0-0.1499999999, 1 dp, raw 1 | 0.1499999999 (not a half) | f = 1.499999999, distance 1e-9 <= t = 1.5e-9, so the band treats it as a tie | `0.2` (inside the band, by design) |
| Custom linear raw 0-1 to 0-0.14999999, 1 dp, raw 1 | 0.14999999 | f = 1.4999999, distance 1e-7 > t = 1.5e-9, so this is not a tie | `0.1` |

**Validity range (what the rule guarantees):**
- **Up to about 5e13:** for |s| = |Y| x 10^d below about 5e13, the text equals exact half-away-from-zero rounding of the true mathematical value. There is one deliberate exception: a true value that is within t of a half without being exactly a half is rounded away from zero, as in the 0.1499999999 row. t is at most 1e-6 of one last-digit unit, far below any sensor accuracy.
  - REV-007 checked this against exact rational arithmetic over 7,471,164 cases: 16 linear raw/engineering ranges, the divisors 0.1, 0.01, 2.5, 0.3, 1.1, 6553.6, 0.001, -2.5 and 1.75, and 0, 1, 2, 3, 4 and 6 dp.
  - It found no difference below |s| = 5.77e13.
- **From about 5.8e13 up to the "too large" limit:** float64 holds only about 15-16 significant digits, so the last shown digits can differ from exact rounding of the true value. The text is still rounded from the float64 Y exactly as in steps B1-B5: no exponent, no "-0", and the carry is handled.
- **Rounded magnitude of 1e15 or more:** the text is "too large".
- **Divide by an integer (A):** exact for every raw value.

### 1.4 Out-of-range (linear presets only)
X is in range when `min(Xmin, Xmax) <= X <= max(Xmin, Xmax)`.

| `outOfRange` | Value shown | Marker |
|---|---|---|
| **flag** (default, Q-003-03) | Y from the formula (extrapolated) | Cell background `--color-warning-tint` (new derived token, below), plus the `triangle-alert` icon (12px, `dark`) before the value. Tooltip: "Raw {x} is outside the raw range {xmin}-{xmax}." Accessible name: "{value} {unit}, out of range" |
| **clamp** | Y limited to the engineering range: `Ymin` below the raw range, `Ymax` above it. For reversed scales this is the Y of the nearest raw end | `arrow-down-to-line` (below the raw range) or `arrow-up-to-line` (above it), 12px `dark` icon. Tooltip: "Raw {x} is outside the raw range {xmin}-{xmax}; shown clamped." Accessible name: "{value} {unit}, clamped" |

Flag is the default because a 4-20 mA input below 4 mA usually means a broken wire. Clamping would hide that.

New derived token: `--color-warning-tint` = `warning` at 20% over the surface. Dark text on it measures above 8:1 (it is lighter than the full warning fill, where dark text gives 5.2:1). Used only for out-of-range cells.

### 1.5 How format and scale combine
- The **raw column** keeps the DES-001 format (Unsigned / Signed / Hex / Binary, `Ctrl+1..4`). It always shows the raw register.
- The **scaled column** is always a decimal number. Its interpretation of X comes from the scale's own **"Raw is signed"** option (`rawSigned`), not from the display format. For example, Hex raw display next to a signed scaled value is valid.
- When a scale is created, `rawSigned` defaults to `true` if the poll's format is Signed at that moment, and `false` otherwise.
- **FC01/02 (bits)** (revision 7: PM decision on Q-FE3-05):
  - The Scale section is disabled with the text "Scaling applies to registers (FC03 and FC04) only."
  - A scale saved on a poll that is changed to FC01/02 is kept and ignored, with the note "The scale is kept and applies again with FC03 or FC04." Overrides are kept and ignored the same way.
  - The table shows the Raw column only, whatever `valueColumns` is stored.
  - The Show control shows Raw selected, is disabled, and has the title "Scaling applies to registers (FC03 and FC04) only."
  - `Ctrl+C` and the copy entries give raw values only: "Copy scaled" and "Copy raw and scaled" are disabled.
  - "Set scale for selected rows…", `Ctrl+Shift+E` and [+ Add override] are disabled, so S8 cannot open.
  - Switching back to FC03 or FC04 restores the stored value columns and the scaled values.
- **Value columns** (`valueColumns`):
  - Raw, Scaled or Both. Default **Both** once any scale (poll or override) is set, otherwise Raw.
  - Control: the segmented "Show (Raw)(Scaled)(Both)" in the data card header. `Ctrl+Shift+V` cycles Raw -> Scaled -> Both.
  - With no scale anywhere, the control is disabled with the title "Set a scale to show scaled values."
  - **Removing the last scale** (revision 7): when the poll scale is set to None and no override is left, or the last override is removed while the poll scale is None, `valueColumns` is set to Raw in the same `mm_set_poll_view` change.
  - **Effective columns** (revision 7, REV-007 m-3): when the poll has no scale available, the table, the Show control and `Ctrl+C` use **Raw**, whatever `valueColumns` holds. "No scale available" means no poll scale, no override, or a bit function (FC01/02).
    - This covers a hand-edited or newer profile that holds `"valueColumns": "scaled"` with `"scale": null`.
    - The stored value is not rewritten, so the profile does not become "Modified".
    - While the Show control is disabled, `Ctrl+Shift+V` does nothing.

---

## 2. Presets and defaults

| Preset (label in the select) | Y range | Unit | Decimals | Raw range default | Other |
|---|---|---|---|---|---|
| None (raw) | — | — | — | — | |
| 4-20 mA | 4 to 20 (fixed) | "mA" | 2 | 0-65535 (Q-003-02) | outOfRange flag |
| 0-10 V | 0 to 10 (fixed) | "V" | 2 | 0-65535 (Q-003-02) | outOfRange flag |
| Divide | — | "" | 10: 1, 100: 2, 1000: 3, custom: 2 | — | Divisor: (10)(100)(1000)(Custom [ ]) |
| Custom linear | typed | "" | 2 | 0-65535 | outOfRange flag |

- **Raw range** is always editable. Quick-pick buttons below the raw fields set common device ranges: "0-4095", "0-27648", "0-32767", "0-65535", "4000-20000". These are common 12-bit, 15-bit, 16-bit and µA-coded ranges.
- **Fixed Y for 4-20 mA and 0-10 V:** the engineering fields are shown read-only with the hint "Choose Custom linear to change the engineering range."
- **Changing preset** resets unit and decimals to the preset defaults. It keeps the raw range when the new preset is linear.
- **Unit and decimals** are editable for every preset except None.
- **Signed default range** (revision 7, Q-FE3-03): a new scale or override draft that starts with "Raw is signed" checked (the poll's format is Signed, 1.5) gets the raw range **0-32767** for linear presets instead of 0-65535, because 65535 is not a valid signed value. The quick pick "0-65535" stays visible. If it is picked while signed, [Apply scale] (or Save in S8) shows "Raw max must be a whole number from -32768 to 32767." under Raw max.

---

## 3. UI

### 3.1 Scale section (PollSetup, below POLL)
**Where it appears (revision 6).** The SCALE and OVERRIDES sections are part of the shared PollSetup component (DES-002 2.3.3), so they appear identically in both hosts:
| Host | Presentation of PollSetup |
|---|---|
| Native poll window (W2) | left setup panel, 340px, scrollable (mockup 2); rail in compact mode |
| Workspace sub-window, width ≥ 640px | setup dock, 300px, inside the sub-window, scrollable; opened with `⚙` or `Ctrl+\` |
| Workspace sub-window, width < 640px | setup popover, 360px, anchored to `⚙`, scrollable, closed by `Esc`, `⚙` or [Done] (not by an outside click) |

The draft lives in the poll view store, so closing the dock or popover, switching presentation, or popping out and docking (handoff, DES-002 2.5.4) keeps the unapplied scale draft and its field messages. The S8 override dialog stays a modal of the poll's host in every case.
In the dock (300px), field pairs (Raw min / Raw max, Eng. min / Eng. max, Unit / Decimals) stay side by side. They stack when the **content width is 260px or less**.
- This is revision 7, Q-FE3-02. It replaces "below 280px".
- The reason: the 300px dock has about 274px of content after padding and border, and must stay side by side.

```
 SCALE
  Preset     [4-20 mA            v]
  Raw is signed [ ]
  Raw min [0      ]   Raw max [65535  ]
  (0-4095)(0-27648)(0-32767)(0-65535)(4000-20000)
  Eng. min [4  ] (read-only)   Eng. max [20 ] (read-only)
  Unit [mA     ]   Decimals [2]
  Out of range (Flag)(Clamp)
  [Apply scale]                       Applied: 4-20 mA (raw 0-65535)
  OVERRIDES (2)                       [+ Add override]
   0-3     Divide by 10, 1 dp, °C      [Edit] [Remove]
   8-9     Divide by 100, 2 dp, bar    [Edit] [Remove]
```
- **Apply scale:** the editor is a draft and nothing applies until [Apply scale] (or `Enter` in a scale field).
  - **Valid input:** the scale is sent with `mm_set_poll_view`, the profile becomes "Modified", and the line "Applied: {summary}" updates.
  - **Invalid input:** nothing is applied, the poll keeps its last valid scale (REQ-003), field messages show (section 4), and the section header shows the `circle-x` icon with "Scale not applied. Fix the highlighted fields."
  - **Leaving with unapplied edits:** they count as unapplied poll edits in either host (DES-002 2.11, S6 and the W1 close confirm).
- **Summary texts** (used by "Applied:", the override list, the address-cell tooltip and the Write preview):
  - None: "Raw (no scale)"
  - 4-20 mA: "4-20 mA (raw {xmin}-{xmax})"
  - 0-10 V: "0-10 V (raw {xmin}-{xmax})"
  - Divide: "Divide by {d}"
  - Custom linear: "Linear {xmin}-{xmax} to {ymin}-{ymax}"
  - The full form appends ", {decimals} dp" when decimals are set, ", {unit}" when a unit is set, and ", signed" when `rawSigned` is on.
  - **Which form where** (revision 7): "Applied:" uses the **short** form, for example "Applied: 4-20 mA (raw 4000-20000)" with 2 dp and unit mA. The override list, the override marker title, its accessible name and the address-cell tooltip use the **full** form, for example "Divide by 10, 1 dp, °C".
  - Numbers in summaries follow the 1.3 number format: no exponent, so a divisor of 0.0000001 reads "Divide by 0.0000001".

### 3.2 Overrides
- **Add from the table:** select rows in the data grid, then use the context menu (`Shift+F10` or right-click) "Set scale for selected rows…", or `Ctrl+Shift+E`.
  - This opens **S8 Scale override dialog** (modal, 480px, in the poll's host). It has the same editor plus "Applies to {ranges}", and under the editor the example line (13px `--color-text-muted`, mockup 4): "Example: raw {x} shows {scaled} {unit}. Overrides win over the poll scale." where x is the current raw value of the first address in the ranges (or 1000 when no value is available) and {scaled} uses the draft; when the draft is invalid the line reads "Overrides win over the poll scale." only.
  - A non-contiguous selection becomes one override per contiguous run, for example "Applies to 0-1, 5, 9-12".
  - Saving the dialog applies the overrides (no separate Apply).
- **S8 title** (revision 7): "Scale override" when opened from a selection or from [+ Add override], and "Edit scale override" when opened from [Edit].
- **No None preset in S8** (revision 7, Q-FE3-04, PM decision for the MVP; a later REQ may add it): the S8 preset select lists 4-20 mA, 0-10 V, Divide and Custom linear only. To take rows back to the poll scale, remove the override.
  - An override that holds None (a hand-edited profile) gives "—" in the Scaled cell for its rows, and those rows show **no** override marker.
  - In the override list, its summary reads "Raw (no scale)".
- **A selection that touches an existing override** (revision 7): Save does not replace the existing override silently. Under "Applies to …" it shows "This range overlaps the override for {a}-{b}." (12px, `circle-x` icon in `error`, `dark` text, role alert), and nothing is applied. The user edits or removes the existing override first.
- **Add from the list:** [+ Add override] opens S8 with Start and End fields, in the display base, with the "Protocol address {n}" helper as in DES-001 3.2.
- **Remove:** [Remove] in the list, or the context menu "Remove scale override" on rows inside an override. If the selection crosses several overrides, all of them are removed. No confirm: the change can be undone by Edit, and the profile shows "Modified".
- **Marker:** rows covered by an override show a `sliders-horizontal` icon (12px, `dark/75`) after the address. Its title and accessible name: "Scale override {start}-{end}: {summary}" (full summary, display base). For an override of a single address the range is that one address: "Scale override 5: Divide by 10, 1 dp", not "5-5" (revision 7).
- **Overrides outside the poll range:** they are kept and listed with "Not in the current poll range" in `dark/75`. They apply again when the range covers them.

### 3.3 Data table
- **Columns (revision 6):** Alias | Address | Raw ({format}) | Scaled. Alias is shown when `display.showAlias` is on (DES-002 2.3.4, default on); it is always the first column. Raw and Scaled follow `valueColumns`. Scaled has a minimum width of 120px. With value columns Raw only, the Raw header reads "Raw ({format})" as before (the mockup 3 header "Value (Unsigned)" is not used, so the header text does not depend on the scale).
- **Row markers with the alias:** the out-of-range tint (1.4) stays on the Scaled cell only; it never covers the Alias cell. The override marker stays after the address.
- **Scaled cell:** the value right-aligned in `--font-mono` 13px, then the unit in `dark/75` 11px with a 4px gap. Out-of-range markers per 1.4. A row with no scale shows "—".
- **Performance:**
  - the scaled text is computed only for rows whose raw value or scale changed (memoized per row on (raw, scale key))
  - no extra backend traffic
  - the DES-001 performance criterion still holds
- **Stale and loading:** the same muted styles as DES-001 apply to the scaled column too.

### 3.4 Copy
| Action | Output per row |
|---|---|
| `Ctrl+C` | follows `valueColumns`: Raw `{addr}\t{raw}`; Scaled `{addr}\t{scaled}`; Both `{addr}\t{raw}\t{scaled}` |
| Context menu "Copy raw" | `{addr}\t{raw}` |
| Context menu "Copy scaled" | `{addr}\t{scaled}` |
| Context menu "Copy raw and scaled" | `{addr}\t{raw}\t{scaled}` |
| Context menu "Copy with header" | the `Ctrl+C` output plus a first line `Address ({0|1}-based)\tRaw ({Format})\tScaled` (only the columns present) |

**Alias in copy (revision 6).** The checkbox "Include alias in copy" (in the "Show ▾" menu and in the data table context menu; `display.copyAlias`, default off, saved per poll) adds the alias as the **first** field of every format above: `{alias}\t{addr}\t…`. A row without an alias gives an empty first field. "Copy with header" then starts with `Alias\t`. The context menu also has **"Copy aliases"**, which copies only `{alias}` per selected row (one per line; empty lines for rows without an alias), so a tag list can be moved between polls with "Paste aliases" (DES-002 2.3.5). Aliases are copied as stored (no quoting; aliases cannot contain tabs or newlines).

| Example (Both, alias on, 4-20 mA on 0-65535) | Output |
|---|---|
| `Ctrl+C` on rows 0-1, aliases "PT-201", none | `PT-201\t0\t0\t4.00` and `\t1\t65535\t20.00` |
| "Copy with header", Hex | `Alias\tAddress (0-based)\tRaw (Hex)\tScaled` then `PT-201\t0\t0x0000\t4.00` |

- Raw values are copied in the display format.
- Scaled values are copied as the displayed number (same decimals, dot, no unit, no marker). Out-of-range values are copied as shown: extrapolated for flag, clamped for clamp. A row without a scale gives an empty field.
- The toast is unchanged: "Copied {n} rows." Clipboard refusal shows "Could not copy to the clipboard."

### 3.5 Write dialog (MVP decision: raw input only)
**Decision (owner to confirm, Q-003-04):** the Write dialog accepts **raw values only** in the MVP, as today. It also shows a **scaled preview**.
- **FC06:** under the Value field, "Scaled: {value} {unit}", using the scale that applies to the target address (override first). If the value is out of range, " (out of range)" is appended for flag, or " (clamped)" for clamp. With no scale for that address there is no line.
- **FC16** (revision 7: PM decision on Q-FE3-06, REV-007 m-4): under the values box, "Scaled: " and then the first 5 values separated by ", ". Each value uses its own address's scale.
  - **Item text:** each item is `{value}`, followed by ` {unit}` when the units differ (see the next point), followed by ` (out of range)` (flag) or ` (clamped)` (clamp) when that value is outside its raw range.
  - **Units:**
    - If every listed item with a scale has the same unit, the unit is printed **once at the end**, after " …" when shown.
    - If the units differ, the unit follows **each** value, and nothing is added at the end.
    - An empty unit counts as a unit value: "°C" and "" differ.
  - **Address without a scale:** the item is "—", with no unit and no note. If no listed address has a scale, there is no preview.
  - **More than 5 values:** " …" follows the 5th item.
  - **Box style:** `--color-warning-tint` with the `triangle-alert` icon when any listed item is out of range (flag). Otherwise `--color-neutral-tint` without an icon. The " (clamped)" text carries the clamp information, because a single arrow icon cannot show mixed directions.
  - **Examples:**

    | Setup | Values | Preview |
    |---|---|---|
    | override 0-9 Divide by 10, 1 dp, °C; FC16 at 0 | `253 254` | "Scaled: 25.3, 25.4 °C" |
    | same | `253 254 255 256 257 258 259` | "Scaled: 25.3, 25.4, 25.5, 25.6, 25.7 … °C" |
    | address 2 in an override Divide by 10, 1 dp, °C; address 3 in an override Divide by 100, 2 dp, bar; FC16 at 2 | `253 1234` | "Scaled: 25.3 °C, 12.34 bar" |
    | poll scale 4-20 mA, raw 4000-20000, 2 dp, flag; FC16 at 0 | `0 12000` | "Scaled: 0.00 (out of range), 12.00 mA", warning tint + `triangle-alert` |
    | the same with clamp | `0 12000` | "Scaled: 4.00 (clamped), 12.00 mA", neutral tint, no icon |
- **FC05/15:** no preview.
- The preview updates as the user types. An invalid raw value shows no preview.
- **Preview style** (mockup 4): the line sits in a box with radius 8px, padding 8px 12px. In range: `--color-neutral-tint` background, no icon. Out of range (flag): `--color-warning-tint` background with the `triangle-alert` icon (dark). Clamped: `--color-neutral-tint` with the `arrow-down-to-line` / `arrow-up-to-line` icon. Under the box, 13px `--color-text-muted`: "Writes send the raw value only. The preview shows what it means under the scale for address {address}."

**Write dialog context (revision 6).**
- Title: "Write · {poll name}" (mockup 4).
- Under the Address field: "Alias: {alias}" (13px, dark, truncated, full text in the tooltip) when the target address has an alias. For FC15/16 the alias of the start address is shown, plus " (+{n} more with aliases)" when other addresses in the written range have aliases. No line when there is no alias. The line updates as the address is typed and disappears for an invalid address.
- The dialog is a modal of the poll's host: inside W1 for a workspace sub-window (it centers on the W1 window, not on the sub-window), inside the poll window for a popped-out poll.

Why engineering-unit input is not in the MVP:
1. The inverse conversion is **many-to-one**. Several engineering inputs round to the same raw value, so the device gets a value different from what was typed.
2. Out-of-range and clamp settings have no safe inverse.
3. `rawSigned` and reversed ranges add ways to send a wrong value to a live plant.

Raw input keeps the wire value explicit and the preview still shows its meaning. A later REQ can add "Enter in {unit}", with the raw value shown and confirmed before sending, as REQ-003 story 7 requires.

### 3.6 Keyboard and context-menu rules (revision 7, from REV-007)
These restate DES-001 7 and DES-002 for the dialogs and menus of this feature. They do not change any rule.
- **Focus trap in S8** (m-1): S8 follows DES-001 7. Tab on the last control ([Save]) moves the focus to the first focusable element of the dialog, its close button, and Shift+Tab on the first one moves it to [Save]. The focus never leaves S8 while it is open. Events inside S8 must still not reach the sub-window frame behind it (pointer and context-menu events, and the keys the frame handles), but Tab and Shift+Tab are not stopped.
- **`Ctrl+Shift+V` in dialog text fields** (m-2): while any modal is open (the Write dialog, S8, Save as, and others), view shortcuts do not run. `Ctrl+Shift+V` in a focused text field (for example the Write Value field, the S8 Unit field or the Save as name field) pastes the clipboard as plain text into that field. It does not cycle the value columns of the poll behind the dialog. Only the combinations whose browser default must be suppressed (DES-002 shortcut table) are blocked in modals.
- **"Write…" from the row context menu** (m-5): the Write dialog opens prefilled for the row that was **right-clicked** (its address and current raw value), not for the focused row, even when the right-clicked row is part of a larger selection that does not move the focus. This matches "Edit alias" in the same menu. Send writes to that address.

---

## 4. Validation messages (exact)
Validation runs on blur and on Apply or Save. Messages appear under the field in the DES-001 invalid input style.

| Field | Rule | Message |
|---|---|---|
| Raw min | integer. Unsigned: 0-65535. Signed: -32768 to 32767 | "Raw min must be a whole number from {min} to {max}." |
| Raw max | same | "Raw max must be a whole number from {min} to {max}." |
| Raw min / max | must differ (division by zero) | "Raw min and raw max must be different." (shown under Raw max) |
| Eng. min | number: optional `-`, digits, optional `.` and digits, at most 15 significant digits | "Engineering min must be a number, for example 4 or -12.5." |
| Eng. max | same | "Engineering max must be a number, for example 20 or 100.5." |
| Eng. min / max | contains `,` | "Use a dot as the decimal separator." |
| Eng. min / max | must differ | "Engineering min and max must be different." (under Eng. max) |
| Divisor (Custom) | number other than 0 (same number format; negative allowed) | "Divisor must be a number other than 0." |
| Decimals | integer 0-6 | "Decimals must be a whole number from 0 to 6." |
| Unit | at most 12 characters | "Unit must be at most 12 characters." |
| Unit | no control characters | "Unit cannot contain control characters." |
| Override start | display base range (DES-001 3.2) | "Start address must be a whole number from {min} to {max}." |
| Override end | same | "End address must be a whole number from {min} to {max}." |
| Override end | end >= start | "End address must not be before the start address." |
| Override | no overlap with another override | "This range overlaps the override for {a}-{b}." ({a}-{b} in display base) |
| Override count | at most 64 per poll | "A poll can have at most 64 scale overrides." |
| Section header (invalid Apply) | — | "Scale not applied. Fix the highlighted fields." |

When the "Raw is signed" checkbox is toggled, the raw min/max are re-validated against the new range.

---

## 5. Profile
- Each poll stores `scale` (or null for None), `scaleOverrides` and `valueColumns` (DES-002 6.1, schema 2).
- Profiles without these fields, including migrated schema-1 profiles, open with scale **None**, no overrides, and `valueColumns` Raw.
- Numbers are stored as JSON numbers. Engineering values keep their typed precision up to 15 significant digits.
- A profile that holds `valueColumns` "scaled" or "both" for a poll without any scale opens showing Raw (effective columns, 1.5, revision 7). Its stored value is kept unchanged and the profile is not "Modified".

---

## 6. Accessibility and style
- No color-only signals: out-of-range uses icon + tint + accessible name, clamp uses an icon, and an override uses an icon.
- The scaled column header has the accessible name "Scaled value". Each cell's accessible name is "{value} {unit}" plus ", out of range" or ", clamped".
- New token: `--color-warning-tint` (1.4). Everything else uses DES-001 tokens.

---

## 7. Decisions recorded after REV-007 (revision 7, PM, 2026-10-16)
The frontend questions are listed in `FE-003` (implementation notes), and the answers are also in `docs/questions.md`.

| Id | Decision | Where |
|---|---|---|
| Q-FE3-01 | **Accepted.** The tie band is capped at 1e-6, and the whole part and the fraction are rounded separately. The "too large" limit applies to the rounded magnitude. | 1.3 |
| Q-FE3-02 | **Accepted.** Field pairs stack at a content width of 260 px or less. | 3.1 |
| Q-FE3-03 | **Accepted.** A new signed scale starts with raw range 0-32767. | 2 |
| Q-FE3-04 | **Decision:** S8 has no "None" preset in the MVP. A later REQ may add it. An override holding None shows "—" and no marker. | 3.2 |
| Q-FE3-05 | **Accepted as built.** With FC01/02 the scale is kept and ignored, the table shows Raw only, the Show control is disabled with the registers-only title, copy gives raw only, and S8 and [+ Add override] are disabled. | 1.5 |
| Q-FE3-06 | **Decision:** the FC16 preview shows the unit after each value when the units differ, and once at the end when they are all the same. It appends " (out of range)" or " (clamped)" to the affected values. Also decided under Q-FE3-06: the S8 titles "Scale override" / "Edit scale override", the overlap message on a selection as built, the single-address marker "Scale override 5: …", the short summary for "Applied:" with the full one in the list and marker titles, and value columns reset to Raw when the last scale is removed. | 3.1, 3.2, 3.5, 1.5 |
