# DES-005 Configurable value color rules

Revision 1, 2026-10-18. Upstream REQ-005, REQ-006, DES-003 revision 7, D-005-01. Downstream FE-005, CHK-005; persistence contract owned by PM in BE-005. Documents only; implementation/QA pending.

Owner amendment, 2026-10-18: add **Custom colors** to Highlight. It reveals native color inputs labeled **Background color** and **Text color** and updates Preview before Apply. Store both as `#RRGGBB`; invalid hex shows an inline error and blocks Apply, while low contrast shows an advisory warning. Switching back to a preset clears the custom pair. Saved preset rules without a custom pair continue to render as before. The palette restriction below describes the original presets only.

Owner correction, 2026-10-18: add **Set colors for register N…** to normal and combined value-row menus. It opens the rule editor with a static **Always (no condition)** rule scoped to the clicked protocol address; if one already exists for that address, edit it. The Addresses control offers **Single register** with one address input as well as Whole poll and Range. The rule summary shows its address scope. Static rules have no threshold field. Only the addressed live value cell receives the colors. Limit is 256 rules per poll.

## 1. Editor and interaction

Add **VALUE COLOR RULES** below Scale/Overrides in shared PollSetup. Empty text: `No value color rules.` Button **Edit rules…** opens a host-modal dialog titled `Value color rules · {poll name}`. It fits the host viewport with internal scrolling; footer stays visible. No additional global shortcut. Table summary is `3 rules · 2 enabled`.

The normal and combined-register row context menus also contain **Value color rules…**. Selecting it reveals Poll setup and opens the same modal with a conditional rule scoped to the clicked register. If the only existing rule covers the whole poll, the draft narrows that rule to the clicked register while retaining its name, comparison, threshold and colors. The setup **Edit rules…** button opens the full applied list for poll-wide editing. Right-click keeps the table's existing selection behavior. Cancel discards the modal draft; applied rules remain unchanged.

The Comparison select and the selected-rule summary spell out each relation with its operator in parentheses, for example `greater than (>)` and `less than or equal to (<=)`. Between reads `between (inclusive)`.

```
Value color rules · Poll 1
First matching enabled rule wins for each value cell.
1 [x] High temperature   Displayed > 25    [Edit] [Up] [Down] [Remove]
2 [x] Normal range      Displayed Between 0 and 25 ...
[Add rule]                         2 / 256 rules
Name [High temperature              ]
Source [Displayed v]  Comparison [Greater than v]
Threshold [25]        (Between: Lower / Upper)
Addresses [Whole poll v] (or Range: Start / End)
Highlight [Lime v]    Preview: ◆ 25.3
[Cancel] [Apply rules]
```

Editing a list entry selects its fields; Add creates `Rule {next unused positive number}`, enabled, Displayed, Greater than, empty threshold, Whole poll, Lime. Rules have stable draft identities for focus/reordering; identity serialization belongs to BE-005. Add at 256 disabled, explained by `A poll can have at most 256 value color rules.` Disabled entries count toward 256 and must still validate. Reorder with Up/Down buttons (no drag dependency), maintaining selection/focus; Remove focuses next entry or Add if empty. All edits, including enable/reorder/remove, remain draft until Apply rules. Once applied they reevaluate current readings immediately without a request. Cancel/Escape closes and discards this modal draft; return focus to Edit rules. Apply success closes; failure retains draft and focus. Pop out/dock preserves open editor draft/errors via existing host handoff. Unsaved editor participates in existing unapplied-changes close warning.

Focus order: close, list row controls in order, Add, selected fields, Cancel, Apply. Trap Tab. Native text copy/paste/undo remain native, modal blocks grid view shortcuts. Validation on blur and Apply; focus first invalid field on failed Apply. Preview is a labeled style example, not a live match or alarm. No audible/latched behavior.

## 2. Evaluation contract

Evaluate applied rules in order for each numeric value cell, first enabled eligible match wins. Address filters use protocol addresses inclusive; missing range means whole poll. Ranges outside the current poll remain stored, list note `Not in the current poll range`; intersecting ranges work normally. Overlaps are allowed. Combined groups use first register only, never any-address overlap. Raw-word inspector cells are not evaluated.

Displayed resolves separately for each visible numeric column: Raw -> interpreted raw; Scaled -> effective scaled result before display rounding; combined Interpreted -> decoded value. Explicit Raw or Scaled evaluates that source for the row and applies the resulting match independently to every visible numeric value cell with a valid finite displayed value. Thus an explicit Raw >250 can highlight both Raw 253 and Scaled 25.3. A missing/nonfinite displayed cell itself never highlights. Alias/address/units outside a value cell do not acquire rule fill.

Raw follows Signed/Unsigned or combined interpretation; Hex/Binary use unsigned u16; FC01/02 use 0/1. Scaled uses effective override/poll scale, its own rawSigned flag, and clamp if selected, before rounding. No scale/combined/bit mode makes Scaled unavailable. A scale yielding a nonfinite result does not match; a finite result displayed as `too large` is also not highlighted because the visible cell is not a numeric value. No tolerance/epsilon for equality: compare represented numeric values, never formatted text. Not equals excludes unavailable, stale, incomplete and nonfinite values.

Only the current successful snapshot in actively polling/current state evaluates. Pending next ordinary request does not clear matches on a still-current successful snapshot. Paused values retain `Paused` text and lose match styling; timeout, exception and link loss lose matches and retain Stale status. Connecting/new definition/missing samples have none. A successful recovery reevaluates all rules. Rule changes mark Modified after acknowledgment; changing matches never does.

## 3. Numeric entry and exact integer comparisons

Trim surrounding whitespace. General threshold grammar: `[+-]?(digits(.digits*)?|.digits)([eE][+-]?digits)?`; decimal dot only, no hex/binary prefix, separators, NaN or Infinity. Parse to finite binary64 for float/scaled/16/32-bit sources; reject overflow and nonzero decimals that underflow to zero. No unit suffix. Help: `Use a decimal number, for example -12.5 or 1e3.` Store validated threshold as decimal text, never a JSON numeric literal; preserve entered precision for later interpretation changes. Zero may canonicalize to `0`.

For signed/unsigned integer64 with Raw or Displayed, require `[+-]?digits` (no decimal point/exponent), parsed and compared as BigInt. Thresholds may lie outside the source's range: e.g. unsigned < -1 valid but never matches. Bound integer thresholds to signed magnitude <=18446744073709551615 (covers all i64/u64 boundaries plus useful negative boundary); reject beyond that with the exact message below. Decimal integer `9007199254740993` must remain distinct from `9007199254740992`. Between ordering uses the same comparison domain as evaluation. Never convert BigInt to Number. Scaled thresholds use general grammar even if combined interpretation currently makes Scaled unavailable. Switching to integer64 validates existing Raw/Displayed rules; DES-006 blocks the switch on incompatible rules, including disabled ones. Profile validation applies the same active-interpretation compatibility check.

| Field / invalid case | Exact inline message |
|---|---|
| Name empty after trim | `Enter a rule name.` |
| Name >64 Unicode characters | `Rule name must be at most 64 characters.` |
| Name control character | `Rule name cannot contain control characters.` |
| General threshold syntax or nonfinite/overflow | `Enter a finite decimal number, for example -12.5 or 1e3.` |
| Comma in threshold | `Use a dot as the decimal separator.` |
| Nonzero threshold underflows | `Threshold is too small to represent.` |
| Integer64 fractional/exponent syntax | `Enter a whole decimal number for a 64-bit integer comparison.` |
| Integer64 magnitude beyond limit | `Threshold must be between -18446744073709551615 and 18446744073709551615.` |
| Between lower > upper | `Upper threshold must be greater than or equal to lower threshold.` (Upper field) |
| Range endpoint not integer/in bounds | `{Start|End} address must be a whole number from {0|1} to {65535|65536}.` |
| End < Start | `End address must not be before the start address.` |
| >256 rules | `A poll can have at most 256 value color rules.` |
| Unknown source/comparison/palette | `Choose a supported {source|comparison|highlight}.` |
| Invalid Apply | `Rules not applied. Fix the highlighted fields.` (dialog header) |
| IPC failure | `Could not apply value color rules. {message}` (dialog header) |

Duplicate names allowed; list order identifies precedence. Between is inclusive; equal bounds are valid. Address bounds are full protocol bounds, not current poll bounds. All errors use error icon + existing error text token, aria-describedby, never orange validation decoration.

## 4. Palette, marker and precedence with status

Approved choices use existing identity tokens only: **Lime** (primary lime fill, dark text, diamond marker), **Neutral** (light fill, dark text, diamond), **Warning (orange)** (warning fill, dark text, triangle-alert). Selecting orange explicitly makes the rule a warning; the choice and rule summary both say Warning. No arbitrary colors; no success/error semantic palette until owner signs those off. Existing palette pairs require measured WCAG contrast >=4.5:1 for text, >=3:1 for focus/marker boundaries. Reuse design tokens, no hardcoded component hex values. Rule fill stays inside value cell; 12px marker then monospace number. Marker remains visible in grayscale/high contrast; forced colors preserve the icon and an outline using system colors.

Every matched value has a visible marker; its accessible description and focus/hover detail read `Rule: {name}. {resolved source} {condition}.` Warning adds `Warning rule.` Example: `Rule: High temperature. Scaled greater than 25.` Detail includes `Displayed → Scaled` when applicable and rule position for duplicate names. No per-sample aria-live alerts. Existing grid focus opens details without adding hundreds of tab stops.

Order of presentation: missing/stale/paused/nonfinite/incomplete disables rule styling; active out-of-range warning retains DES-003 warning cell fill and triangle before number, with a separate matched-rule diamond/triangle badge after the number using its palette and accessible rule description. Clamped arrow remains before number; normal matching cell fill may apply. Selection uses outline/inset border and focus ring so it does not erase warning or rule marker. Transport status remains in existing status area; never recolor it for a rule. If both out-of-range and warning-rule triangles exist, their accessible names distinguish `Out of range` and `Warning rule: {name}`.

## 5. State workflow and persistence handoff

| State | Event / transition | Visible result |
|---|---|---|
| idle / empty | no readings/no rules | `No value color rules.` in setup; normal grid placeholders |
| connecting / loading | connect/profile load | existing progress, no invented matches |
| connected | awaiting first success | normal placeholder cells |
| polling | success/update | first matching eligible rule marker/fill or default cell |
| paused | Pause | retained Paused text, no match fill/marker |
| timeout | timeout | Timeout warning, Stale retained data, no matches |
| exception response | exception | existing exception detail, Stale data, no matches |
| disconnected | link loss/user disconnect | existing retained-stale/clear policy, no matches |
| recovery | successful current snapshot | remove Stale and reevaluate |
| editing | open/change draft | applied rules still drive table; preview shows draft palette |
| invalid input | blur/Apply invalid | inline messages; header on Apply; applied list untouched |
| applying | valid Apply | `Applying…`, aria-busy; duplicate Apply blocked |
| apply failure | rejected IPC | exact header above, draft retained, Retry via Apply |
| inactive source | Scaled unavailable | list note `Scaled values are unavailable in this mode.`; rule kept and never matches |

BE-005 needs: ordered list max 16, enabled/name/range/source/operator/threshold text/palette, no lossy JSON thresholds; validate disabled rules too; reject malformed/newer profiles before workspace mutation; old profiles default empty rules; duplication and host transfer preserve order and all fields; atomic view update validates together with interpretation; reject failure retains last applied config. PM owns stable DTO names, version number, serialization and file errors in BE-005/006. Do not add live match state to profiles. Old migration preserves scales, aliases and old formats and does not mark Modified; save explicitly writes supported schema. Record contract questions in docs/questions.md before implementation. No backend scheduling or protocol change is requested.
