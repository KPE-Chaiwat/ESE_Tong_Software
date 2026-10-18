# REQ-003 Value scaling (engineering units)

Source: owner feedback after trying the first build of Modbus Master (REQ-001). Extends REQ-001 and works together with REQ-002 (scaling is part of each poll's definition).

## Goal
Raw 16-bit register values are shown in engineering units. Typical field cases: 4-20 mA and 0-10 V analog inputs mapped from a raw range, and plain division (/10, /100, /1000) because devices store decimals as integers.

## Formula (owner's reference image)
Linear scaling: `Y = (X - Xmin) / (Xmax - Xmin) x (Ymax - Ymin) + Ymin`
where X is the raw value, Xmin/Xmax the raw range, Ymin/Ymax the engineering range.

## User stories
1. As an engineer I choose a scale for a poll from presets: **None (raw)**, **4-20 mA**, **0-10 V**, **Divide by 10 / 100 / 1000**, and **Custom linear** (I type Xmin, Xmax, Ymin, Ymax).
2. For the 4-20 mA preset, Ymin = 4 and Ymax = 20 with unit "mA"; for 0-10 V, Ymin = 0 and Ymax = 10 with unit "V". The raw range (Xmin, Xmax) is always editable because devices differ (for example 0-4095, 0-65535 or 4000-20000); the designer proposes the defaults.
3. For Divide, I choose the divisor (10, 100, 1000 or a custom number) and the number of decimal places shown.
4. I can set the scale for the whole poll and override it for individual registers/rows or address ranges (for example temperature /10 and pressure /100 inside the same poll).
5. I see the scaled value and its unit in the data table next to (or togglable with) the raw value; copy exports whatever I choose (raw, scaled or both).
6. I set decimal places and an optional unit label per scale; I can choose whether out-of-range raw values are clamped to Ymin/Ymax or shown beyond the range (flagged as out of range).
7. Writes: the Write dialog keeps raw values as the source of truth; it also shows the scaled preview for the value being sent, and (designer decides if MVP) allows typing the value in engineering units that is converted back to raw with the inverse formula, with a rounding rule shown to the user.
8. Scale settings are saved in the profile together with the poll (REQ-002).

## Rules
- Signed/unsigned/hex/binary display of the raw value (REQ-001) remains; scaling applies to the numeric interpretation chosen (unsigned or signed 16-bit). The designer defines how format and scale combine (for example scale only for Signed/Unsigned decimal, hex/binary stay raw).
- Division by zero (Xmax = Xmin) is invalid input with a clear message; Divide by 0 is invalid.
- Rounding and precision are explicit: computed in 64-bit floating point, displayed with the chosen decimal places (round half away from zero); the raw value never changes.
- Scaling is a display/input feature; it never changes what is sent on the wire except when the user writes through the inverse conversion, and then the raw value sent is shown before sending.

## Acceptance criteria
- Worked examples pass: with 4-20 mA and raw range 0-65535, raw 0 shows 4.00 and 65535 shows 20.00, raw 32768 shows about 12.00; with 0-10 V and raw range 0-4095, 2048 shows about 5.00; Divide by 10: 253 shows 25.3; Divide by 100 with 2 decimals: 1234 shows 12.34; signed raw 65535 with Divide by 10 shows -0.1. (Designer fixes the exact numbers and rounding in CHK.)
- Invalid scale input is blocked with an exact message and the poll keeps its last valid scale.
- Per-row overrides win over the poll scale; removing an override falls back to the poll scale.
- Profiles round-trip all scale settings; profiles without scale open as "None".
- Scaled values update with the live stream without extra backend traffic (scaling is not on the wire); no extra re-render cost for unchanged rows (REQ-001 performance criterion still holds).
- English UI only; follow CLAUDE.md visual identity.

## Out of scope
32-bit and float register pairs, non-linear scales (square root, tables), logging, alarms/thresholds.

## Assumption to confirm
The owner wrote "40-20 mA"; the PM assumes this means **4-20 mA** (the standard current loop). Tell the PM if a different range was meant.

## Open questions for the designer
Where scale settings live in the UI (poll setup panel vs column header menu), how overrides are shown, whether Write accepts engineering units in the MVP.
