# CHK-003 Value scaling - QA checklist

**Revision 7 (2026-10-16): rounding rule and PM decisions after REV-007** (DES-003 revision 7). Changes:
- **Added**
  - A45-A55: the tie rule of DES-003 1.3, the "too large" rounding case, the carry case and the edges of the tie band.
  - C15: signed default range.
  - D10-D13: S8 titles, no None preset, a selection touching an existing override, an override holding None.
  - F10-F11: the FC16 preview with mixed units and out-of-range values.
  - Section I (I1-I4): regressions for REV-007 m-5, m-3, m-1 and m-2.
- **Changed**
  - The A pass line.
  - B5 (FC01/02 as decided).
  - B6 (removing the last scale resets to Raw).
  - C10 (the short summary).
  - C12 (stacking at 260 px).
  - D1 (the single-address marker title).
  - F3 (exact text with " …").
  - The state coverage index.
- **Expected to fail until fixed:** A50 (REV-007 n-1), D13 (n-3), F10-F11 (m-4), I1-I4 (m-5, m-3, m-1, m-2).

**Revision 6 (2026-10-16): hybrid hosting and aliases.** Added C12-C14 (scale editor in the workspace dock and popover, draft kept across pop out), D9 (S8 example line), E6-E9 (alias in copy), F7-F9 (Write dialog alias line, title and preview box), and changed C11 and G3 for both hosts. Unless an item names a host, run it in a workspace sub-window; items marked "(both hosts)" are run once in a sub-window and once in a popped-out poll window.

Upstream: `docs/design/DES-003-value-scaling.md` (DES-003), DES-002, DES-001 rev 4. Tags as in CHK-001: [NONE], [SIM], [FAULT], [WIRE].

## Setup
- **Most items are [NONE]:** the fake supplies raw values.
- **[SIM] items** use the CHK-001 simulator. Set registers with the simulator control, or with an FC06 write in raw, to the raw value given.
- **Default poll:** FC03, start 0, qty 10, format Unsigned, base 0, value columns Both.
- **Reading the tables:** "dp" means decimals. The expected text is the exact cell text (value only; the unit is shown separately unless stated).

---

## A. Worked examples (exact display)
Each row is one item, CHK3-A{n}. Check the scaled cell text and, where listed, the marker.

| Id | Scale | Raw (register) | Expected scaled text | Marker |
|---|---|---|---|---|
| A1 | 4-20 mA, raw 0-65535, 2 dp | 0 | 4.00 | none |
| A2 | same | 65535 | 20.00 | none |
| A3 | same | 32768 | 12.00 (exact 12.000122…) | none |
| A4 | same | 16384 | 8.00 (exact 8.000061…) | none |
| A5 | same, 4 dp | 32768 | 12.0001 | none |
| A6 | 4-20 mA, raw 4000-20000, 2 dp, flag | 12000 | 12.00 | none |
| A7 | same | 0 | 0.00 | out of range (flag): warning tint + triangle-alert. Tooltip "Raw 0 is outside the raw range 4000-20000." |
| A8 | same, clamp | 0 | 4.00 | arrow-down-to-line, accessible name "4.00 mA, clamped" |
| A9 | 4-20 mA, raw 4000-20000, flag | 3000 | 3.00 | out of range |
| A10 | 0-10 V, raw 0-4095, 2 dp | 2048 | 5.00 (exact 5.001221…) | none |
| A11 | same | 4095 | 10.00 | none |
| A12 | same, flag | 5000 | 12.21 | out of range |
| A13 | same, clamp | 5000 | 10.00 | arrow-up-to-line |
| A14 | 0-10 V, raw 0-27648 | 13824 | 5.00 | none |
| A15 | same, flag | 32767 | 11.85 | out of range |
| A16 | Divide by 10 (1 dp) | 253 | 25.3 | — |
| A17 | Divide by 10 | 65535 (unsigned) | 6553.5 | — |
| A18 | Divide by 10, Raw is signed | 65535 | -0.1 | — |
| A19 | Divide by 100 (2 dp) | 1234 | 12.34 | — |
| A20 | Divide by 100, signed | 65436 | -1.00 | — |
| A21 | Divide by 1000 (3 dp) | 1 | 0.001 | — |
| A22 | Divide by 1000 | 65535 | 65.535 | — |
| A23 | Divide by 10, 0 dp | 25 | 3 (tie, away from zero) | — |
| A24 | same | 35 | 4 | — |
| A25 | same | 24 | 2 | — |
| A26 | same, signed | 65511 (-25) | -3 | — |
| A27 | same, signed | 65532 (-4) | 0 (no "-0") | — |
| A28 | Divide, custom 4 (2 dp) | 10 | 2.50 | — |
| A29 | Divide, custom -2 (2 dp) | 10 | -5.00 | — |
| A30 | Custom linear 4000-20000 to 0-100, unit "%", 1 dp, flag | 12000 | 50.0 | none |
| A31 | same | 3000 | -6.3 (exact -6.25, tie away from zero) | out of range |
| A32 | same, clamp | 3000 | 0.0 | arrow-down-to-line |
| A33 | same, flag | 24000 | 125.0 | out of range |
| A34 | Custom linear reversed: raw 0-1000 to 100-0, 2 dp, flag | 250 | 75.00 | none |
| A35 | same, flag | 1200 | -20.00 | out of range |
| A36 | same, clamp | 1200 | 0.00 (nearest raw end 1000) | arrow-up-to-line |
| A37 | 0-10 V, raw 0-1000, 1 dp (float tie check) | 15 | 0.2 | none |
| A38 | same | 5 | 0.1 | none |
| A39 | same | 25 | 0.3 | none |
| A40 | Custom linear, Raw is signed, raw -32768 to 32767, to -100 to 100, 2 dp | 32768 (-32768) | -100.00 | none |
| A41 | same | 32767 | 100.00 | none |
| A42 | same | 0 | 0.00 (exact 0.0015…) | none |
| A43 | Custom linear raw 0-1 to 0-999999999999999, flag | 2 | too large | out of range |

**Revision 7: tie rule, carry and "too large" (DES-003 1.3).** The exact value and the step that decides it are given for each row. Every row was computed by hand from the 1.3 steps.

| Id | Scale | Raw (register) | Expected scaled text | Marker | Why (DES-003 1.3) |
|---|---|---|---|---|---|
| A45 | 4-20 mA, raw 0-65535, 6 dp | 717 | 4.175051 | none | exact 4 + 11472/65535 = 4.175051499199…; the distance to the half is 0.000801 > band 1e-6, so this is not a tie (the old rule showed 4.175052) |
| A46 | Custom linear raw 0-4000 to 0-4, 2 dp | 2675 | 2.68 | none | 2.675 is held as 2.67499999999999982…; the distance is about 2e-14 <= band 2.675e-7, so this is a tie |
| A47 | Custom linear raw 0-4000 to 0 to -4 (reversed Y), 2 dp | 2675 | -2.68 | none | negative tie, away from zero |
| A48 | Divide, custom 0.4 (float path), 0 dp, Raw is signed | 65535 (-1) | -3 | — | -2.5 is a tie, away from zero |
| A49 | Custom linear raw 0-10 to 0-10000000004, 0 dp | 1 | 1000000000 | none | 1000000000.4: the distance 0.1 > band 1e-6, so this is not a tie (the old rule showed 1000000001) |
| A50 | Custom linear raw 0-2 to 999999999999998-999999999999999, 0 dp, flag | 3 | too large | out of range; tooltip "Raw 3 is outside the raw range 0-2." | 999999999999999.5 is a tie and rounds up to 1000000000000000 >= 1e15 (it must **not** show "1000000000000000") |
| A51 | same scale, 1 dp, flag | 3 | 999999999999999.5 | out of range | the rounded magnitude is below 1e15 |
| A52 | same scale, 0 dp | 2 | 999999999999999 | none | the largest number shown at 0 dp |
| A53 | Custom linear raw 0-1 to 0-0.1499999999, 1 dp | 1 | 0.2 | none | the distance 1e-9 <= band 1.5e-9, so the band treats it as a tie (by design) |
| A54 | Custom linear raw 0-1 to 0-0.14999999, 1 dp | 1 | 0.1 | none | the distance 1e-7 > band 1.5e-9, so this is not a tie |
| A55 | Custom linear raw 0-1000 to 0-2, 2 dp | 998 | 2.00 | none | 1.996: the fraction 99.6 rounds to 100 and carries into the whole part |

A37 (0.15 at 1 dp, which gives "0.2") is the DES-003 1.3 example of a float tie, and stays as it is.

- [ ] **CHK3-A1 … A43, A45 … A55** [NONE] each row in both tables passes. Each A item fails on its own, so record pass/fail per id. A50 fails until REV-007 n-1 is fixed: today it shows "1000000000000000".
- [ ] **CHK3-A44** [SIM] A3, A10 (raw range 0-4095 on HR0 = 2048), A16 and A19 pass with the values coming from the simulator. The traffic bytes are unchanged by scaling: the RX for HR0 = 1234 still reads `04 D2`.

## B. Format and scale together
- [ ] **CHK3-B1** [NONE] Format Hex with 4-20 mA (0-65535) and raw 32768: Raw shows "0x8000" and Scaled shows "12.00".
- [ ] **CHK3-B2** [NONE] Format Binary with Divide by 10, signed, raw 65535: Raw shows "1111 1111 1111 1111" and Scaled shows "-0.1".
- [ ] **CHK3-B3** [NONE] Format Signed with Divide by 10, **not** signed, raw 65535: Raw shows "-1" and Scaled shows "6553.5". The scale's own "Raw is signed" option decides the scaled value.
- [ ] **CHK3-B4** [NONE] With format Signed selected when the scale is first created, "Raw is signed" starts checked.
- [ ] **CHK3-B5** [NONE] (revision 7, Q-FE3-05) Given a poll with 4-20 mA applied, an override 0-1, and value columns Both:
  - **When** the poll is changed to FC01:
    - The Scale section is disabled with "Scaling applies to registers (FC03 and FC04) only." and the note "The scale is kept and applies again with FC03 or FC04.".
    - The table shows Address and Raw only.
    - The Show control shows Raw selected, is disabled, and its title is "Scaling applies to registers (FC03 and FC04) only.".
    - `Ctrl+C` on row 0 gives `0\t{raw}` with no scaled field.
    - "Copy scaled" and "Copy raw and scaled" are disabled.
    - "Set scale for selected rows…" and [+ Add override] are disabled, and `Ctrl+Shift+E` opens nothing.
    - The override list still shows 0-1.
  - **When** it is switched back to FC03: Both columns, the 4-20 mA values and the override marker on rows 0-1 return, and nothing had to be re-entered.
- [ ] **CHK3-B6** [NONE] Value columns:
  - The first applied scale switches to Both. `Ctrl+Shift+V` cycles Raw, then Scaled, then Both.
  - With no scale, the control is disabled with the title "Set a scale to show scaled values.".
  - A row without a scale shows "—" in Scaled.
  - (revision 7) Given poll scale 4-20 mA, no overrides and value columns Scaled: setting the preset to None and pressing [Apply scale] switches the table to Raw only, and the Show control is disabled with the title above. The same happens when the only override is removed while the poll scale is None. Each is one change, and the profile shows "Modified".

## C. Editor and validation (scale not applied when invalid)
Each item: given an applied valid scale "4-20 mA (raw 0-65535)", when the field is set as shown and Apply scale is pressed, then the message appears, the header reads "Scale not applied. Fix the highlighted fields.", "Applied:" is unchanged, and the table still uses the old scale.
- [ ] **CHK3-C1** [NONE] Raw min -1 (unsigned): "Raw min must be a whole number from 0 to 65535.". Raw max 65536: "Raw max must be a whole number from 0 to 65535.". 0 and 65535 are accepted.
- [ ] **CHK3-C2** [NONE] Signed: raw min -32769 gives "Raw min must be a whole number from -32768 to 32767.". -32768 and 32767 are accepted, and 32768 is rejected.
- [ ] **CHK3-C3** [NONE] Raw min 100 = raw max 100 gives, under Raw max, "Raw min and raw max must be different.".
- [ ] **CHK3-C4** [NONE] Custom linear eng. min `abc` gives "Engineering min must be a number, for example 4 or -12.5.". Eng. max `1e3` gives "Engineering max must be a number, for example 20 or 100.5.". `4,5` gives "Use a dot as the decimal separator.".
- [ ] **CHK3-C5** [NONE] Eng. min 5 = eng. max 5 gives "Engineering min and max must be different.".
- [ ] **CHK3-C6** [NONE] Divide custom 0 gives "Divisor must be a number other than 0.". -2.5 is accepted.
- [ ] **CHK3-C7** [NONE] Decimals 7 gives "Decimals must be a whole number from 0 to 6.". 0 and 6 are accepted.
- [ ] **CHK3-C8** [NONE] A 13-character unit gives "Unit must be at most 12 characters.". A pasted tab in the unit gives "Unit cannot contain control characters.".
- [ ] **CHK3-C9** [NONE] Selecting 4-20 mA shows Eng. min 4 and max 20 read-only with "Choose Custom linear to change the engineering range.", unit "mA", 2 decimals. Quick pick "4000-20000" fills raw 4000 and 20000.
- [ ] **CHK3-C10** [NONE] After a valid Apply of 4-20 mA, raw 4000-20000, 2 dp, unit "mA":
  - The line reads exactly "Applied: 4-20 mA (raw 4000-20000)". This is the short form, without ", 2 dp, mA" (revision 7).
  - The profile shows "Modified".
  - An override with the same settings is listed with the full form "4-20 mA (raw 4000-20000), 2 dp, mA".
- [ ] **CHK3-C11** [NONE] (both hosts) Unapplied scale edits, when the sub-window or the poll window is closed, trigger the S6 sentence "Unapplied changes in the poll setup will be lost." (DES-002 2.11).
- [ ] **CHK3-C12** [NONE] Sub-window 900 px wide: `⚙` opens the 300 px dock with POLL, SCALE and OVERRIDES; field pairs side by side. Sub-window 600 px wide: the same content in the popover. (revision 7, Q-FE3-02) The Raw min/max, Eng. min/max and Unit/Decimals pairs:
  - stay side by side in the 300 px dock (about 274 px of content) and at 261 px of content;
  - stack at 260 px of content width or less.
  Measure the content width in DevTools in the real window.
- [ ] **CHK3-C13** [NONE] Type Raw max = Raw min in the popover (message shown), close the popover with `Esc`, reopen it: the text and "Raw min and raw max must be different." are still there; "Applied:" unchanged.
- [ ] **CHK3-C14** [SIM] With the C13 draft open, pop the poll out: the poll window's setup panel shows the same draft and message; dock back: the dock shows it again; the table still uses the last applied scale throughout.
- [ ] **CHK3-C15** [NONE] (revision 7, Q-FE3-03) Given a poll with format Signed and no scale, when 4-20 mA is selected in SCALE:
  - "Raw is signed" is checked, Raw min is 0 and Raw max is 32767.
  - After Apply, raw 32767 shows "20.00".
  - Raw 65535 (read as -1) shows "4.00" with the out-of-range marker: exact 4 - 16/32767 = 3.99951…, which rounds to 4.00.
  - Pressing the quick pick "0-65535" and then Apply shows "Raw max must be a whole number from -32768 to 32767." under Raw max, and "Applied:" is unchanged.

## D. Overrides
- [ ] **CHK3-D1** [NONE] With rows 0, 1, 5, 9, 10, 11, 12 selected, `Ctrl+Shift+E` opens the dialog with "Applies to 0-1, 5, 9-12". Saving with Divide by 10 creates 3 overrides. Those rows show the sliders icon with the titles "Scale override 0-1: Divide by 10, 1 dp", "Scale override 5: Divide by 10, 1 dp" (revision 7: a single address, not "5-5") and "Scale override 9-12: Divide by 10, 1 dp", and are scaled /10. The other rows keep the poll scale.
- [ ] **CHK3-D2** [NONE] With an override 8-12, adding 5-9 gives "This range overlaps the override for 8-12.".
- [ ] **CHK3-D3** [NONE] End 3 with start 5 gives "End address must not be before the start address.".
- [ ] **CHK3-D4** [NONE] In 1-based mode, override start 0 gives "Start address must be a whole number from 1 to 65536."
- [ ] **CHK3-D5** [NONE] Adding a 65th override gives "A poll can have at most 64 scale overrides.".
- [ ] **CHK3-D6** [NONE] "Remove scale override" on a selection crossing two overrides removes both. Those rows fall back to the poll scale immediately.
- [ ] **CHK3-D7** [NONE] Shrinking the poll quantity so an override lies outside lists it with "Not in the current poll range". Growing it back applies it again.
- [ ] **CHK3-D8** [NONE] Example "temperature /10 and pressure /100 in one poll":
  - Poll scale None. Override 0-3 Divide by 10, unit "°C". Override 8-9 Divide by 100, unit "bar".
  - Raw 253 at row 0 shows "25.3 °C", raw 1234 at row 8 shows "12.34 bar", and row 5 shows "—".
- [ ] **CHK3-D9** [NONE] (both hosts) S8 opened for rows 0-1 with raw 253 at row 0 and Divide by 10, unit "°C": the line reads "Example: raw 253 shows 25.3 °C. Overrides win over the poll scale."; with Divisor Custom 0 it reads "Overrides win over the poll scale."; S8 is modal in the poll's host (centered on the connection window for a sub-window).
- [ ] **CHK3-D10** [NONE] (revision 7) S8 opened with `Ctrl+Shift+E` or [+ Add override] has the title "Scale override". S8 opened with [Edit] in the override list has the title "Edit scale override".
- [ ] **CHK3-D11** [NONE] (revision 7, Q-FE3-04) The S8 preset select lists exactly "4-20 mA", "0-10 V", "Divide" and "Custom linear", with no "None (raw)". The SCALE section's preset select still lists "None (raw)" first.
- [ ] **CHK3-D12** [NONE] (revision 7) Given an override 8-12, when rows 10-14 are selected and `Ctrl+Shift+E` is pressed:
  - S8 reads "Applies to 10-14".
  - Saving with Divide by 10 shows "This range overlaps the override for 8-12." under "Applies to 10-14", with the `circle-x` icon, and S8 stays open.
  - After Cancel, the override list still holds only 8-12 with its old settings, and rows 13-14 have no marker.
- [ ] **CHK3-D13** [NONE] (revision 7) Given a profile (edited by hand) with poll scale 4-20 mA (raw 0-65535) and an override `{start: 5, end: 6, scale: {preset: "none", …}}`, when it is opened:
  - Rows 5 and 6 show "—" in Scaled, with no sliders icon after the address.
  - The override list shows "5-6  Raw (no scale)".
  - Row 4 shows its 4-20 mA value.
  - This fails until REV-007 n-3 is fixed.

## E. Copy
- [ ] **CHK3-E1** [NONE] Both, 4-20 mA (0-65535), rows 0-1 with raw 0 and 65535: `Ctrl+C` gives `0\t0\t4.00` and `1\t65535\t20.00`.
- [ ] **CHK3-E2** [NONE] Scaled mode: `Ctrl+C` gives `0\t4.00`. Raw mode gives `0\t0`.
- [ ] **CHK3-E3** [NONE] "Copy with header" in Hex Both gives first line `Address (0-based)\tRaw (Hex)\tScaled`, then `0\t0x0000\t4.00`.
- [ ] **CHK3-E4** [NONE] An out-of-range flagged value (A12) copies as `12.21`, and clamped (A13) as `10.00`. A row without a scale copies an empty scaled field (`5\t0\t`).
- [ ] **CHK3-E5** [NONE] "Copy raw", "Copy scaled" and "Copy raw and scaled" in the context menu ignore the current value columns.
- [ ] **CHK3-E6** [NONE] Alias column order: the header reads Alias, Address (0-based), Raw (Unsigned), Scaled; the out-of-range tint (A12) covers only the Scaled cell, not the Alias cell.
- [ ] **CHK3-E7** [NONE] "Include alias in copy" on, Both, 4-20 mA (0-65535), alias "PT-201" on row 0 and none on row 1: `Ctrl+C` gives `PT-201\t0\t0\t4.00` and `\t1\t65535\t20.00`. "Copy with header" in Hex gives first line `Alias\tAddress (0-based)\tRaw (Hex)\tScaled`.
- [ ] **CHK3-E8** [NONE] "Include alias in copy" off (default): E1-E5 outputs are unchanged (no alias field). Toggling it marks the profile "Modified" and it survives Save and reopen.
- [ ] **CHK3-E9** [NONE] "Copy aliases" on rows 0-2 with aliases "A", none, "C" gives `A`, empty line, `C`; pasting that into rows 5-7 of another poll with "Paste aliases" gives 5 = A, 6 none, 7 = C.

## F. Write dialog (raw input only, with preview)
- [ ] **CHK3-F1** [SIM] FC06 at address 0 with 4-20 mA (0-65535) and value 32768 shows "Scaled: 12.00 mA". Send writes raw 32768 (the TX contains `80 00`).
- [ ] **CHK3-F2** [NONE] Value 70000 shows the DES-001 error and no preview. FC05 and FC15 show no preview.
- [ ] **CHK3-F3** [NONE] Given an override 0-9 (Divide by 10, 1 dp, °C), with FC16 at address 0:
  - Values `253 254` show exactly "Scaled: 25.3, 25.4 °C".
  - Values `253 254 255 256 257 258 259` show exactly "Scaled: 25.3, 25.4, 25.5, 25.6, 25.7 … °C": the first 5 values, then " …", then the unit once (revision 7).
- [ ] **CHK3-F4** [NONE] With 4-20 mA (4000-20000, flag) and value 0, the preview reads "Scaled: 0.00 mA (out of range)". With clamp it reads "Scaled: 4.00 mA (clamped)".
- [ ] **CHK3-F5** [NONE] There is no way to type an engineering value in the dialog (MVP decision). The value fields accept only raw in the chosen value format.
- [ ] **CHK3-F6** [NONE] An address without any scale shows no preview line.
- [ ] **CHK3-F7** [NONE] (both hosts) The dialog title reads "Write · {poll name}". FC06 at address 4 with alias "FT-102 outlet flow" shows "Alias: FT-102 outlet flow" under Address; changing the address to 5 (no alias) removes the line; an invalid address removes it.
- [ ] **CHK3-F8** [NONE] FC16 at start 0, 3 values, aliases on 0 and 2: "Alias: {alias of 0} (+1 more with aliases)".
- [ ] **CHK3-F9** [NONE] Preview box: in range on neutral tint without icon; 4-20 mA (4000-20000, flag) with 3600 on the warning tint with `triangle-alert` and "Scaled: 3.60 mA (out of range)"; under it "Writes send the raw value only. The preview shows what it means under the scale for address 4.".
- [ ] **CHK3-F10** [NONE] (revision 7, Q-FE3-06, REV-007 m-4) Setup: poll scale None, override 2 (Divide by 10, 1 dp, "°C") and override 3 (Divide by 100, 2 dp, "bar").
  - FC16 at address 2 with values `253 1234` shows exactly "Scaled: 25.3 °C, 12.34 bar". The units differ, so each value has its own unit.
  - Values `253 1234 5` (address 4 has no scale) show exactly "Scaled: 25.3 °C, 12.34 bar, —".
  - The box is the neutral tint with no icon.
  - Send writes raw 253, 1234 and 5. With [SIM], the FC16 TX data bytes are `00 FD 04 D2 00 05`.
- [ ] **CHK3-F11** [NONE] (revision 7, Q-FE3-06) Setup: poll scale 4-20 mA, raw 4000-20000, 2 dp, flag. FC16 at address 0 with values `0 12000`:
  - The preview shows exactly "Scaled: 0.00 (out of range), 12.00 mA", in the warning-tint box with `triangle-alert`.
  - Switched to clamp, the same values show exactly "Scaled: 4.00 (clamped), 12.00 mA", in the neutral-tint box with no icon.
  - The values sent stay raw 0 and 12000.

## G. Profiles and performance
- [ ] **CHK3-G1** [NONE] Save a profile with a poll scale, 2 overrides, value columns Scaled and clamp on, then reopen it: every setting returns exactly. The `scale` fields in the file use JSON numbers.
- [ ] **CHK3-G2** [NONE] A profile without scale fields (schema 1, or schema 2 without `scale`) opens with "Applied: Raw (no scale)" and value columns Raw.
- [ ] **CHK3-G3** [SIM] 8 polls at 100 ms, each with a scale, 4 overrides and 10 aliases, all 8 as tiled sub-windows in the workspace (and a second run with 4 sub-windows + 4 popped-out windows): 0 long tasks over 50 ms (browser smoke, and WebView2 recorded separately). No extra requests appear in traffic compared with the same polls unscaled.
- [ ] **CHK3-G4** [NONE] The perf unit test shows that one changed raw value re-renders one row, scaled column included.

## H. Accessibility and style
- [ ] **CHK3-H1** [NONE] A flagged cell has the accessible name "12.21 V, out of range". A clamped cell has "10.00 V, clamped". In grayscale, both are recognizable by their icons.
- [ ] **CHK3-H2** [NONE] The out-of-range tint uses `--color-warning-tint` (warning at 20%), and the cell text stays dark. No orange text or icon appears on a light surface.

## I. Regressions from REV-007 (revision 7)
- [ ] **CHK3-I1** [NONE] (m-5, DES-003 3.6) "Write…" prefills the right-clicked row.
  - **Given** an FC03 poll with raw 0 at row 0 and raw 700 at row 7.
  - **And** rows 0-9 are selected with the focus on row 0: click row 9, then Shift+click row 0.
  - **When** row 7 is right-clicked and "Write…" is chosen:
    - The Write dialog opens with Address 7 and Value 700, not Address 0 and Value 0.
  - **When** the value is changed to 701 and sent:
    - Row 7 reads 701 after the next cycle and row 0 still reads 0.
  - **Also:** "Edit alias" from the same menu edits row 7.
- [ ] **CHK3-I2** [NONE] (m-3, DES-003 1.5 effective columns) A profile with value columns Scaled and no scale still shows raw values.
  - **Given** a profile file edited by hand so that one poll has `"valueColumns": "scaled"`, `"scale": null` and `"scaleOverrides": []`.
  - **When** it is opened:
    - The table shows Alias, Address and "Raw (Unsigned)" with the raw values, and no Scaled column.
    - The Show control shows Raw selected, is disabled, and has the title "Set a scale to show scaled values.".
    - `Ctrl+C` on row 0 gives `0\t{raw}`.
    - `Ctrl+Shift+V` changes nothing.
    - The profile is **not** "Modified".
  - **Repeat** with `"valueColumns": "both"`: same result.
  - **After** Divide by 10 is applied: the table shows Raw and Scaled (Both).
- [ ] **CHK3-I3** [NONE] (m-1, DES-003 3.6) Tab wraps inside S8. Run in the real app (WebView2) as well as the browser smoke.
  - **Given** S8 is open (`Ctrl+Shift+E` on rows 0-1).
  - **When** Tab is pressed until [Save] has the focus, then Tab once more: the focus moves to the dialog's close button, the first focusable element.
  - **When** Shift+Tab is pressed from the close button: the focus returns to [Save].
  - **Throughout** at least two full cycles: the focus is never outside S8 (`document.activeElement` is inside `[role="dialog"]`), and the sub-window behind does not react.
- [ ] **CHK3-I4** [NONE] (m-2, DES-003 3.6) `Ctrl+Shift+V` pastes into dialog text fields. Run in the real app (WebView2), where the clipboard permission applies.
  - **Given** value columns Both on the poll behind, and plain text on the clipboard.
  - **When** `Ctrl+Shift+V` is pressed in each of these fields:

    | Field | Clipboard | Field afterwards |
    |---|---|---|
    | Write dialog Value (FC06) | `1234` | `1234` |
    | S8 Unit | `kPa` | `kPa` |
    | Save as profile name | `Line 2` | `Line 2` |

  - **Then** after each paste, the poll behind still shows Both.
  - **Control case:** with no dialog open and the grid focused, `Ctrl+Shift+V` still cycles Both -> Raw.

## State coverage index (view states)
| State | Items |
|---|---|
| scale applied | A, B, C10, C15, D10, D12 |
| scale not applied (invalid input) | C1-C8, C13, C14, C15 (signed quick pick), D12 (overlap on Save) |
| scale editor presentation (dock, popover, panel) | C12-C14, D9, D10, D11 |
| rounding, ties and "too large" | A23, A26, A31, A37-A39, A43, A45-A55 |
| alias in copy and write | E6-E9, F7, F8 |
| scale inactive (FC01/02) | B5 |
| no scale (empty scaled cell, Raw-only columns) | B6, D8, D13, E4, F6, F10, I2 |
| out of range (flag / clamp) | A7-A9, A12-A13, A15, A31-A33, A35-A36, A50, A51, C15, F4, F11 |
| write preview (FC06 / FC16) | F1-F4, F9-F11, I1 |
| modal keyboard behaviour | I3, I4 |
| stale / loading | covered by the CHK-001 L and E items with the scaled column visible (G3) |
