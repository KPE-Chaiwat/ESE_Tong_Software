# CHK-005 Configurable value color rules

Revision 1, 2026-10-18. Upstream DES-005/FE-005, DES-006 exact numeric model. All unchecked; implementation and QA pending. [UNIT] utility/fake IPC; [UI] browser and real WebView2; [SIM] actual app/simulator. Record separate evidence per ID, including state transitions and raw traffic.

Owner amendment, 2026-10-18: verify Custom colors exposes separate Background color and Text color pickers, Preview updates before Apply, low contrast warns but Apply succeeds, raw/scaled/combined live values use the chosen pair, profile save/reopen and duplication preserve it, and schema 4 preset rules still load.

Owner correction, 2026-10-18: right-click a register and choose **Set colors for register N…**. The editor must select Single register N and Always, without a threshold. Applying colors must affect N only; a different register can have a different pair, and reopening N edits its existing static rule. Test a combined logical value using the group's first register.

Owner report, 2026-10-18: right-click register 1 and choose **Value color rules…** with both registers 0 and 1 reading 200. A conditional custom rule `>50` must default to Single register 1 and color only register 1 after Apply. When a prior sole Whole poll rule exists, editing from register 1 narrows it to register 1 in the draft. Verify native text selection does not mask the value colors. Setup **Edit rules…** remains the whole-poll editor.

## A. Comparison vectors and sources

- [ ] A1 [UNIT][UI] Given threshold 25 and values 24/25/26, verify Equals F/T/F; Not equals T/F/T; Less T/F/F; Less or equal T/T/F; Greater F/F/T; Greater or equal F/T/T. Between 24 and 26 matches 24/25/26, excludes 23/27. Between 25 and 25 equals 25 only.
- [ ] A2 [UNIT][UI] Given raw 253 and /10 scale, Both columns, Displayed >25 matches both; Displayed >250 matches raw only. Explicit Raw >250 matches both eligible cells; explicit Scaled >25 matches both. Show Raw/Scaled/Both switches Displayed resolution correctly.
- [ ] A3 [UNIT][UI] Given raw 253 /10 at zero displayed decimals (`25`), Scaled >25 still matches unrounded 25.3. Scaled Equals25 does not. For linear clamp beyond upper bound, compare clamped value; flag compares extrapolated finite value. A finite `too large` display receives no marker.
- [ ] A4 [UNIT][UI] Given raw FFFF, Signed Raw equals -1 matches; Hex/Binary Raw equals65535 matches, equals-1 does not. Signed scale with unsigned raw display follows scale rawSigned independently. FC01/02 evaluate 0/1; Scaled source unavailable, retained with note.
- [ ] A5 [UNIT][SIM] Given u64 9007199254740992 and 9007199254740993, Equals9007199254740993 matches second only, Greater9007199254740992 matches second only. Between9007199254740993..9007199254740993 matches second only. Save/reload thresholds and repeat.
- [ ] A6 [UNIT][SIM] u64 max18446744073709551615 equals itself, greater than18446744073709551614; i64 min-9223372036854775808 equals itself and less than-9223372036854775807; i64 max9223372036854775807 equals itself. Verify exact text in editor/profile without exponent or rounding. Unsigned < -1 never matches.
- [ ] A7 [UNIT][UI] Given NaN/+Infinity/-Infinity, incomplete, missing and `too large`, every operator including Not equals produces no match. Scaled rule in combined mode has unavailable note and no match. Finite float equality uses decoded represented value without epsilon; f32 0.10000000149011612 differs from threshold0.1.
- [ ] A8 [UNIT][UI] Given two enabled overlapping matching rules, first wins; Apply disable/reorder/remove exposes next match immediately. Draft edits before Apply leave old rule active. Range1..2 on combined start1 width2 matches first group; range2..2 does not. Range outside poll stays saved/inactive, reexpansion restores it.

## B. Editor and validation

- [ ] B1 [UI] Given empty rules, correct empty text; Add produces named enabled Displayed/Greater-than/Lime/Whole-poll draft with empty threshold. Add sixteen total including disabled; seventeenth disabled/explained. Remove/reorder retains focus. Cancel/Escape discards draft and restores focus. Normal and combined-register row context menus open the same per-poll editor when setup is hidden, preserve right-click selection behavior, and leave applied rules unchanged before Apply. Comparison options show the relation and operator in parentheses, including inclusive Between.
- [ ] B2 [UNIT][UI] Test every DES-005 section3 validation row with exact message and placement: blank/65-character/control name; blank/abc/NaN/Infinity/1e309; comma1,5; underflow1e-999; integer64 1.5/1e3; magnitude18446744073709551616; Between lower26 upper25; invalid addresses; reversed range; invalid enums/palette; list17. Applied rules remain unchanged on each invalid Apply.
- [ ] B3 [UNIT][UI] Accept -12.5, +12, .5, 1., 1e3 in general domain; reject hexadecimal0x10, binary0b10 and unit suffix. Integer64 accepts +9007199254740993 and -9223372036854775808, rejects decimal/exponent syntax even if numerically integral. Accept both address endpoints in bases0/1 and Between equal bounds.
- [ ] B4 [UI] Valid Apply shows Applying/aria-busy with no duplicate invocation; success closes and updates existing readings/Modified. Inject IPC error: exact header retains draft/applied rules; retry succeeds. Disabled malformed rules also block Apply/profile load.
- [ ] B5 [UI] Given incompatible fractional Raw/Displayed rule, switch to integer64: DES-006 named error, old format retained; correct threshold then switch succeeds. Scaled threshold1.5 remains valid but inactive in combined mode. Unknown/newer/malformed profile rejected before current workspace mutation.

## C. States, styling and access

- [ ] C1 [UI] Given idle/empty, connecting/loading and connected waiting first data, no match appears. Record each state and unchanged existing status UI.
- [ ] C2 [SIM] Given matching live values, ordinary next-request pending keeps current match; pause removes fresh match and marks Paused. Resume valid success restores match. Timeout, exception and link loss each remove match with existing reason and Stale; recovery reevaluates. User Disconnect clears per existing policy.
- [ ] C3 [UI] Given matching rules in each palette, visible diamond/Warning triangle, exact accessible name/condition and details available via grid keyboard focus. Lime/Neutral do not imply warning; orange choice and summary explicitly say Warning. Text contrast >=4.5:1, focus/marker contrast >=3:1; record measured colors.
- [ ] C4 [UI] Given scale out-of-range and a matching Lime rule, warning fill/triangle remain, separate rule badge identifies match. Given clamped matching value, clamp arrow remains. Selection/focus and high-contrast/grayscale preserve markers. No live announcement every poll cycle.
- [ ] C5 [UI] In workspace and native minimum-size host, editor fits via inner scroll; Tab/Shift+Tab trapped, Cancel/Escape restore focus, inputs retain native copy/paste/undo. Pop out/dock with invalid draft preserves fields/error; close-host unapplied warning follows existing flow.

## D. Persistence and regression

- [ ] D1 [UI][SIM] Save/reload and duplicate mixed rules preserve names/order/enabled/ranges/source/operator/text thresholds/palette. Schema1/2 without rules loads empty with prior format/scale/alias unchanged; no Modified on migration alone. No sampled match state in profile.
- [ ] D2 [SIM] With125 registers at100 ms and16 rules, record steady-state performance in browser and real window; no long tasks >50 ms or changed polling cadence attributable to feature. Apply/edit/reorder changes produce no additional wire request; incoming matches do not mark Modified.
- [ ] D3 [UNIT][UI] Changing one raw row reevaluates/rerenders affected row only; rules/scale/interpretation/freshness changes invalidate required rows. Existing scale rounding, raw writes, clipboard fields and statuses remain unchanged; copied values contain no rule marker/condition suffix.

State coverage: idle/empty/connecting/loading/connected C1; polling A1/C2; paused/timeout/exception/disconnected/recovery C2; editing B1/C5; invalid B2/B5; applying/failure B4; inactive source A4/A7/B5.
