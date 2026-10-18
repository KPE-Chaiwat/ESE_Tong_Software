# REQ-005 Configurable value color rules

Source: owner request, 2026-10-18. Extends REQ-002/003 and works with REQ-006.

Owner clarification, 2026-10-18: each rule must also support an individually chosen background and text color like the Modbus Poll reference. Preserve the original presets. Validate custom colors as six-digit RGB. Show a warning below 4.5:1 text contrast without blocking Apply or profile load. A custom match retains its visible non-color marker.

Owner correction, 2026-10-18: colors must be configurable for an individual register. The value-row context menu must create or reopen a rule scoped to the clicked register, with separate background/text pickers. A static color needs no numeric threshold. Other registers keep their own appearance. Combined values use their first register address. Raise the per-poll rule limit to 256 so every register in a 125-register holding/input poll can be colored separately while leaving room for conditional rules.

## Goal and user story
An engineer highlights live values that meet configured numeric conditions, without changing device values or hiding communication status.

## Scope and PM defaults
- Each poll has an ordered list of up to 256 enabled/disabled rules. No rules exist by default. Rules are editable, reorderable and removable, saved in profiles and included in duplication.
- A rule has a nonempty name, an optional inclusive address range (default whole poll), numeric source (Displayed, Raw or Scaled), comparison, threshold(s) and highlight color. **Owner confirmed: Displayed is the default**, following the numeric value shown in the table. If Raw and Scaled columns are both shown, evaluate/highlight each visible value column against its own numeric source. Explicit Raw/Scaled choices allow a stable source when display columns change. Range bounds use protocol addresses internally and the existing address-base presentation.
- The rule editor is reachable from Poll setup and from the value-row context menu in both normal and combined-register tables. Poll setup edits all rules; the row's `Value color rules…` entry starts or reopens a conditional rule scoped to that row's register. If the poll has a single whole-poll rule, opening it from a row narrows that rule to the clicked register in the draft. `Set colors for register N…` opens a static rule with no threshold. Right-click keeps the table's existing selection behavior, and applied rules do not change until Apply.
- Comparisons: equals, not equals, less than, less than or equal, greater than, greater than or equal, and inclusive Between. Between requires lower <= upper. First enabled matching rule wins for a value cell.
- The Comparison choices show their operators in parentheses (`=`, `!=`, `<`, `<=`, `>`, `>=`); Between is labeled inclusive.
- Raw compares the current numeric interpretation, including signed values and REQ-006 combined values; hex/binary presentation uses unsigned 16-bit numeric values. FC01/02 compare 0 or 1. Scaled compares the unrounded finite engineering value from the effective scale; unavailable scaled values do not match. Never compare formatted text or rounded display strings.
- Thresholds must be finite valid numbers. For signed/unsigned 64-bit integer Raw values, integer comparisons must remain exact beyond JavaScript's safe integer range; reject fractional integer thresholds. Designer specifies validation text and supported numeric entry syntax.
- Highlight the affected value cell with a readable foreground/background pair from an approved palette; arbitrary low-contrast color combinations are not required. Orange remains warning-only: an orange choice must explicitly denote a warning rule. Every matched cell also provides a visible non-color marker and accessible rule name/condition. Existing stale, error and out-of-range indicators remain readable.
- Only current successful values are evaluated. On timeout/link loss, retained values retain stale status and must not appear as fresh rule matches; missing, incomplete, NaN and infinity values do not match numeric conditions. Recovery reevaluates rules.
- Changing a rule updates existing current readings without a new request. Invalid drafts preserve the last applied rules. Rule changes mark Modified; incoming match changes do not.

## Acceptance criteria
1. Defaults preserve the existing appearance. Values below, equal to and above each threshold demonstrate all comparison boundaries; Between includes both endpoints.
2. Overlapping enabled rules use list precedence. Disabling/reordering/removing a rule immediately exposes the next match or default styling.
3. A selected address range affects only that range. For REQ-006, its logical value is addressed by the first register of its group.
4. Raw 253 with /10 scaling matches Raw > 250 and Scaled > 25; display rounding does not change matching. Negative values and exact 64-bit integer boundaries are tested.
5. Invalid ranges, nonfinite thresholds and excessive rule counts are rejected before applying and on profile loading. Older profiles load with no rules; save/load and duplicate preserve rules.
6. Stale/no-data/nonfinite cases and subsequent recovery have unambiguous text/icon status. Rule editing adds no wire traffic and preserves the existing 125-register/100-ms performance requirement.

## Out of scope
Audible alarms, notifications, acknowledged/latched alarms, hysteresis, scripts, timers, logging, global shared rule libraries and writing values from conditions.

## Handoff and open questions
Designer produces DES/FE/CHK-005, specifying the palette, accessible marker, editor and exact validation. PM then supplies BE-005 persistence contract. No owner decision blocks design.
