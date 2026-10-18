# DES-006 Combined-register numeric interpretations

Revision 1, 2026-10-18. Upstream: REQ-006, DES-003 revision 7, D-006-01. Downstream: FE-006, CHK-006; PM supplies BE-006. Documents only; implementation and QA are pending.

## 1. Screens and controls

Use the shared PollSetup in the workspace dock/popover and native panel. Replace the existing format select label with **Interpretation**; keep the four existing choices and shortcuts Ctrl+1..4. Add Signed 32-bit, Unsigned 32-bit, Float 32-bit, Signed 64-bit, Unsigned 64-bit, Float 64-bit (Double). No new global shortcuts.

The normal and combined-register value-row menus include **Format / endian…**. It reveals Poll setup and focuses the Interpretation select. Selection remains a draft until **Apply interpretation**; the menu does not bypass validation.

Below a combined choice show a **Byte order** select with four explicit choices: `Big-endian (ABCD)`, `Little-endian (DCBA)`, `Big-endian byte swap (BADC)`, and `Little-endian byte swap (CDAB)`. For 64-bit, show the corresponding eight-byte patterns. These choices map to the same persisted `swapBytes` and `reverseWords` flags; existing profiles need no migration. Default is Big-endian. Follow with the order example below and **Apply interpretation**. Inputs are a draft; changing them previews the order example, Apply updates the table after acknowledgment. The summary names the applied order, e.g. `Applied: Unsigned 32-bit · Big-endian (ABCD)`. Existing 16-bit shortcuts remain applied view changes and retain saved order settings for the next combined selection.

```
INTERPRETATION
[Unsigned 32-bit              v]
[Byte order: Big-endian (ABCD) v]
Raw: 12 34 56 78 -> Decode: 12 34 56 78
2 registers per value. Quantity counts registers.
[Apply interpretation]
Applied: Unsigned 32-bit · Big-endian (ABCD)
```

FC01/02 disable these controls with `Combined values apply to registers (FC03 and FC04) only.` and `Register interpretation and order are kept for FC03 or FC04.` Bit values remain 0/1. For combined modes, Scale/override editing and scaled copy are disabled with `Scaling is unavailable for combined values. Saved scales apply again in 16-bit mode.` Preserve scale, overrides, valueColumns and all constituent aliases. The effective table shows Interpreted and Raw words; returning to 16-bit restores DES-003 effective columns. Write preview does not use a saved scale while in combined mode.

## 2. Grouping and table

For start S, width W = 2 or 4 and quantity Q, complete group k contains S+kW through S+kW+W-1; no alignment to absolute multiples. Consume only words from one successful snapshot of the current poll definition. A response rejected by existing protocol validation supplies no new data. A definition change invalidates old grouping until a compatible new snapshot arrives; never fill from previous frames or another poll. Display changes may reinterpret a retained complete snapshot without issuing a request.

Columns: Alias | Address | Interpreted (type) | Raw words. Alias and address belong to the first register. Address shows `1–4` (base 0 example, start 1, width 4), with accessible description `Registers 1 through 4; group address 1`. Single remaining register shows its single address. Range presentation follows address base everywhere. Column resizing and selection retain the existing grid behavior; there is one selectable row per complete group, plus one trailing incomplete row. Changing width resets selection/focus to the group containing the previous focused protocol address when present, otherwise the first row.

Raw words are uppercase four-digit hex in wire/address order, e.g. `0x1234 0x5678`, regardless of swaps. Every row has **Inspect raw registers** (context menu and keyboard-accessible button). A modal titled `Raw registers · {first}–{last}` lists Address | Alias | Unsigned | Hex for every constituent, with saved aliases and a scale-preserved note when applicable. No tooltip-only data. Trap Tab, Escape closes, return focus to opener; modal text inputs preserve native copy/paste. Raw inspector permits copy, not combined writes or alias reassignment.

Q mod W remaining registers form one trailing row; Interpreted says **Incomplete**, with info icon and `Needs {W} registers; only {R} available.` Raw words and inspector show the R actual registers. No padding or extra request. Start 1, Q=5, W=2 gives 1–2, 3–4 and incomplete 5; W=4 gives 1–4 and incomplete 5. Q=1 or 3 with W=4 is one incomplete row. At address 65535, Q=1 never wraps.

## 3. Numeric definition and test oracle

Treat each received u16 as high byte then low byte. Byte swap exchanges each pair; word reversal reverses the sequence of complete 16-bit words. Decode the resulting byte sequence as big endian. Signed integers use two's complement; float types use IEEE 754 binary32/binary64. Unsigned/signed 64-bit values stay exact integers (BigInt in frontend); they never pass through Number, including formatter, clipboard, comparison or JSON. Profiles store settings, not sampled readings.

| Byte swap | Word reverse | 32-bit bytes / unsigned decimal for 1234 5678 | 64-bit bytes for 0123 4567 89AB CDEF |
|---|---|---|---|
| off | off | ABCD / 305419896 | ABCDEFGH = 0x0123456789ABCDEF |
| on | off | BADC / 873625686 | BADCFEHG = 0x23016745AB89EFCD |
| off | on | CDAB / 1450709556 | GHEFCDAB = 0xCDEF89AB45670123 |
| on | on | DCBA / 2018915346 | HGFEDCBA = 0xEFCDAB8967452301 |

Finite float display and copy use the ECMAScript Number.toString() decimal representation of the decoded value: shortest decimal that round-trips to that binary64 number, decimal dot, no grouping or locale formatting. Float32 is first decoded exactly then promoted to Number; e.g. `3DCC CCCD` displays `0.10000000149011612`, not `0.1`. This intentionally exposes stored precision. Scientific notation is allowed (e.g. `5e-324`); show all digits via horizontally scrollable cells/inspector, never silently ellipsize numeric text. Float64 `3FB9 9999 9999 999A` displays `0.1`. Both signed zeros display/copy `0`; underlying sign may be shown in inspector as `Negative zero`. Integer text is full base-10 without exponent. DES-003 fixed-decimal rounding does not apply.

Nonfinite text is exactly `NaN`, `+Infinity`, `-Infinity`, accompanied by info icon and `Nonfinite value` accessible description. These are data representations, not communication errors. They never match numeric rules, including Not equals. Incomplete and missing values never match either.

| Width/type | Raw words, default order | Display |
|---|---|---|
| i32 / u32 | FFFF FFFE | -2 / 4294967294 |
| i32 min / max | 8000 0000 / 7FFF FFFF | -2147483648 / 2147483647 |
| u32 max | FFFF FFFF | 4294967295 |
| i64 / u64 | FFFF FFFF FFFF FFFF | -1 / 18446744073709551615 |
| i64 min / max | 8000 0000 0000 0000 / 7FFF FFFF FFFF FFFF | -9223372036854775808 / 9223372036854775807 |
| u64 adjacent safe boundary | 0020 0000 0000 0000 / 0020 0000 0000 0001 | 9007199254740992 / 9007199254740993 |
| f32 one / fraction / negative | 3F80 0000 / 3FC0 0000 / BFC0 0000 | 1 / 1.5 / -1.5 |
| f32 smallest positive subnormal | 0000 0001 | 1.401298464324817e-45 |
| f32 zero / negative zero | 0000 0000 / 8000 0000 | 0 / 0 |
| f32 NaN / positive infinity / negative infinity | 7FC0 0000 / 7F80 0000 / FF80 0000 | NaN / +Infinity / -Infinity |
| f64 one / fraction / negative | 3FF0 0000 0000 0000 / 3FF8 0000 0000 0000 / BFF8 0000 0000 0000 | 1 / 1.5 / -1.5 |
| f64 smallest positive subnormal | 0000 0000 0000 0001 | 5e-324 |
| f64 zero / negative zero | 0000 0000 0000 0000 / 8000 0000 0000 0000 | 0 / 0 |
| f64 NaN / positive infinity / negative infinity | 7FF8 0000 0000 0000 / 7FF0 0000 0000 0000 / FFF0 0000 0000 0000 | NaN / +Infinity / -Infinity |

## 4. Copy, write, rules and hosts

Ctrl+C copies selected logical rows as `{firstAddress}\t{interpreted}`; optional alias prepends `{alias}\t`. Copy with header adds `Address ({base}-based)\tInterpreted ({type})`. Incomplete copies literal `Incomplete`; missing copies an empty value. Nonfinite copies the explicit text. Color markers never enter copied numeric fields. **Copy raw registers** expands groups into one line per actual register `{address}\t{unsignedWord}`, in address order; optional alias uses each constituent's alias. Inspector uses the same raw-copy behavior. Existing `Copy raw` in combined mode is relabeled Copy raw registers; Copy scaled / Copy raw and scaled disabled. Existing clipboard success/error toasts retained.

Write from a group targets the right-clicked group's first register and prefills its first original raw u16. Label `Raw register value (16-bit)` and note `Writes send individual 16-bit registers. Combined values are not encoded.` FC06/16 entry and confirmation stay raw. No group-to-value conversion; FC04 retains existing write availability restrictions. Raw inspector's copy does not change write selection.

DES-005 rules evaluate logical values at first address only; raw-word inspection cells receive no rule highlights. Switching to integer64 validates any Raw/Displayed thresholds for integer syntax, including disabled rules. On incompatibility preserve old applied interpretation and show `Interpretation not applied. Rule "{name}" requires whole-number thresholds for 64-bit integers.` Scaled rules are retained but unavailable while combined mode is active.

Both hosts use the same formatter, grouping, copy and draft state. Pop out/dock transfers unapplied draft/errors, not BigInt JSON. Apply changes only view settings; acknowledgment updates all hosts and Modified. Incoming data never marks Modified.

## 5. State workflow

| State | Event and transition | Visible result |
|---|---|---|
| idle / empty | no successful data | Existing idle chip; `—` values, no highlights |
| connecting / loading | connect or load starts | Existing connecting/loading indicator; no fabricated grouped data |
| connected | connection established before first sample | Existing connected chip; values remain `—` |
| polling | valid snapshot | Complete groups decoded; remainder Incomplete; current rule evaluation |
| paused | pause after success | Existing Paused chip; retained values marked `Paused`; no fresh rule highlights |
| timeout | timeout after success | Existing Timeout warning and retained values marked Stale; no rule highlights |
| exception response | rejected response | Existing exception code/text, retained Stale values; no merge |
| disconnected | link loss | Existing disconnected reason; retained Stale values if backend retains them; user Disconnect follows existing clear-data behavior |
| recovery | next valid current snapshot | Replace the complete snapshot; remove Stale and reevaluate rules |
| invalid input | invalid enum/order or incompatible rule, Apply | Inline error; previous applied view/data untouched |
| saving view | valid Apply pending | `Applying…`, aria-busy; prevent duplicate Apply; no optimistic applied summary |
| apply failure | IPC rejects | `Could not apply interpretation. {message}` above Apply, retry enabled; draft retained |
| nonfinite / incomplete | valid data with special value | Explicit text and info marker; not a link error |

Unknown enum/order on profile load follows existing invalid-profile flow and keeps current workspace. Exact backend validation envelope is BE-006's responsibility; UI does not silently fall back.

## 6. Style, accessibility and persistence needs

Use existing Afacad labels, JetBrains Mono values, dark foreground/light surface, lime primary action, rounded controls and 8/12px existing panel spacing. Stack paired controls at content width <=260px. No new colors. Info icons use dark/muted tokens; orange only for actual Timeout/Stale warning state. Keep focus ring/selection visible independently of numeric markers. At minimum window size scroll the inner setup/grid, never the document. All labels, examples and errors are English. Marker descriptions are reachable by keyboard and screen reader; no per-poll live announcements on every sample.

BE-006 contract needs (PM to decide stable DTO/schema in docs/questions.md): interpretation enum and two independent booleans; atomic validated view acknowledgment; original raw words/current-definition snapshot identity; host handoff and duplication preserving settings; migration reads schema 1/2 and retains their original Unsigned/Signed/Hex/Binary plus scales/aliases, defaults swaps off and missing interpretation Unsigned 16-bit; new schema rejects unknown/newer versions and invalid enum/booleans without rewriting source file. Save writes the supported new schema only upon explicit save; migration itself does not mark Modified. Sample values are not persisted. Coordinate validation with BE-005 before frontend implementation; generated bindings come from Rust only.
