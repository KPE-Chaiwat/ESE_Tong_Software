# BE-005 Value color rule persistence and validation

Revision1, 2026-10-18. Upstream REQ/DES/FE-005 revision1 and DES/FE-006; use BE-006 shared schema3 migration and D-005-02/D-006-02. Contract only; implementation and QA pending.

Owner amendment, 2026-10-18: `colors` is an optional nullable pair `{background,foreground}` of six-digit `#RRGGBB` strings. Missing/null retains the preset `highlight`. Validate both channels on view/input/profile; low contrast is an editor warning. Schema 5 writes the pair and reads schema 4 rules without it.

Owner correction, 2026-10-18: accept `comparison: "always"` with empty `threshold` and null `upperThreshold`. A single-register rule uses the existing inclusive range with equal start/end. Raise the validated limit to 256 rules per poll. Existing profile rules remain valid.

## Generated types and persistence

Add `colorRules: ValueColorRule[]` to PollConfigInput, PollConfig and PollProfile; add optional `colorRules?: ValueColorRule[]` to PollViewSettings. Required array in current-schema/complete input/config; omitted patch retains, [] clears, null rejects. Existing mm_set_poll_view({pollId,view:{colorRules}}) applies the ENTIRE ordered list. No dedicated color command, live matches or backend evaluator.

ValueColorRule JSON fields (all required except where explicitly null):

| Key | Rust / JSON domain |
|---|---|
| name | String; trimmed nonempty, <=64 Unicode scalars, no controls |
| enabled | bool |
| range | Option<ValueColorRange>; explicit null means whole poll; object {start:u16,end:u16}, start<=end |
| source | ValueColorSource enum `displayed`, `raw`, `scaled` |
| comparison | ValueColorComparison enum `equals`, `notEquals`, `lessThan`, `lessThanOrEqual`, `greaterThan`, `greaterThanOrEqual`, `between` |
| threshold | String, one threshold or Between lower |
| upperThreshold | Option<String>; required string for Between, explicit null for every other comparison |
| highlight | ValueColorHighlight enum `lime`, `neutral`, `warning` |

Derive serde + ts-rs and export ValueColorRule/Range/Source/Comparison/Highlight. No persisted rule id: array order is precedence; duplicate names permitted. FE stable draft ids are local strings and stripped before IPC/serialization; accessible duplicate-rule identity includes position. Upper/lower threshold text remains decimal string, never a JSON number, never round-trip through f64 formatting. Trim threshold/name surrounding whitespace at validation and store trimmed text; reject name controls BEFORE trimming (tabs/newlines cannot become an accepted name). Preserve precision, leading zeroes and exponent spelling; zero need not canonicalize. Cap each threshold at256 ASCII bytes before parsing (validation text below); this bounds untrusted profile work while retaining decimal precision. Reject unknown enum, wrong shape/type, missing fields and unknown rule/range keys. Optional/null semantics are explicit, not serde fallbacks.

Schema3 required rules, schema1/2 migration to empty list, save/read/apply all-or-nothing and unsupportedSchema behavior are BE-006. Copy/order/host transfer/export must preserve every field; do not drop out-of-poll ranges, disabled entries, currently unavailable Scaled rules or settings when changing function. Saved ranges always protocol-based 0..65535, independent of display base/current poll bounds. No rule-specific modification of scheduler, raw requests, values or traffic.

## Atomic validation shared with interpretation

Validate all<=16 entries including disabled ones, in list order/field order: name, range, source/comparison/highlight, threshold, upperThreshold and Between ordering. Construct prospective display+rules from existing config plus patch and validate once before publishing. Current stored format signed64/unsigned64 with source Raw/Displayed requires integer64 syntax, even while FC01/02 hides combined controls. Explicit Scaled always uses general decimal syntax regardless of format/source availability. This conservative invariant ensures switching FC never activates an invalid stored rule. Rejected rule/interpretation update changes nothing, including other keys in the same view patch; valid identical patch no-op. Incoming data never marks Modified; UI marks after acknowledged applied config.

General grammar exactly `[+-]?(digits(.digits*)?|.digits)([eE][+-]?digits)?`, where digits are ASCII0..9. Decimal dot only; no internal whitespace/hex/separators/units/NaN/Infinity. Parse to finite binary64; lexical nonzero whose parsed result is +/-0 rejects underflow. Detect lexical nonzero from mantissa digits, not exponent, so 0e-999 remains valid zero. Between ordering compares parsed finite values. Integer64 syntax `[+-]?digits` only; evaluate exact signed decimal magnitude<=18446744073709551615 using checked i128 (not f64), including negative values below i64 minimum. Source range does not restrict threshold; unsigned<-1 valid. Compare Between in this exact domain. Rust needs no BigInt dependency for bounded i128 threshold validation; FE uses BigInt. General threshold 9007199254740993 retains its string but compares as binary64 in noninteger64 mode; switching to integer64 uses its exact stored string.

Existing AppError {code,message,field}: view/input validation uses code validation, stable nested field `colorRules[{i}].name|range.start|range.end|source|comparison|highlight|threshold|upperThreshold`; whole array field colorRules. Profile contexts map the same validation detail to invalidProfile, never partially apply a valid prefix. Unknown enum/type at deserialization must be mapped to the same public validation envelope. Avoid prevalidation serde errors bypassing useful UI field mapping.

Exact DES messages apply (DES-005 section3). Backend protocol-range messages use 0..65535; UI converts to selected base before IPC. Additional wire-shape errors: `Enter a threshold with at most 256 characters.`; `Between requires an upper threshold.`; `Only Between accepts an upper threshold.`; `Enter a supported value color rule.` for unknown keys/missing/wrong shape. Name validation `Enter a rule name.`, `Rule name must be at most 64 characters.`, `Rule name cannot contain control characters.` Count `A poll can have at most 16 value color rules.` Source/comparison/highlight `Choose a supported {source|comparison|highlight}.` General syntax `Enter a finite decimal number, for example -12.5 or 1e3.` Comma precedence `Use a dot as the decimal separator.` Underflow `Threshold is too small to represent.` Integer grammar `Enter a whole decimal number for a 64-bit integer comparison.` Magnitude `Threshold must be between -18446744073709551615 and 18446744073709551615.` Ordering on upperThreshold `Upper threshold must be greater than or equal to lower threshold.` Range ordering `End address must not be before the start address.` Unknown/malformed range endpoint `Start address must be a whole number from 0 to 65535.` or End equivalent. IPC wrappers add DES generic failure text only once.

Rule Apply in integer64 mode gets threshold-specific error. An interpretation switch encountering existing incompatible syntax gets BE-006 interpretation-specific named-rule message; input patch supplying replacement rules is validated against prospective format and succeeds if valid. Do not let this UI message distinction weaken atomic validation.

## Test vectors and ownership

Backend tests: empty/16/17 lists; disabled malformed rule; duplicate names accepted; Unicode64/65 and control names; range0/65535, reversed/outside current poll, base-independent storage; every enum and wrong types/null/unknown keys; all seven operators; Between inclusive equal endpoints accepted, reversed rejected; threshold `-12.5`, `.5`, `1.`, `+1e3`, `0e-999` accepted general; `1e999`, `1e-999`, `NaN`, `1,5`, `0x10`, blank rejected. Length257 rejects before numeric parsing. Integer64 `9007199254740992`, `9007199254740993`, `-9223372036854775808`, `18446744073709551615`, `-18446744073709551615` remain distinct/exact; +/-18446744073709551616 rejects; `1.0`/`1e3` rejects integer64; negative unsigned threshold accepted; Between exact adjacent-boundary order tested. Validate simultaneous display+rules patch atomically and reject whole profile if its final rule is invalid. Round-trip string spelling, precedence, disabled state and range; duplicate preservation; old schemas empty defaults; source file unchanged on migration.

FE owns pure evaluation/style and DES status gates: first enabled match, Displayed per cell, explicit source across valid visible numeric cells, finite unrounded/clamped Scaled, current-success-only matches, incomplete/nonfinite/stale/paused exclusions even for NotEquals. Backend does not emit match events or choose colors. FE tests all boundaries, ordering, exact64 and source/status cases; CHK-005 verifies contrast/markers and real-window zero added wire traffic. Backend tests settings invariants without adding a second numeric evaluator.

Publish generated bindings before FE IPC integration. Run coordinated workspace pnpm check once per implementation round; fake-window/unit evidence must be distinguished from actual QA. No production implementation, changelog or version edits are claimed by this document.
