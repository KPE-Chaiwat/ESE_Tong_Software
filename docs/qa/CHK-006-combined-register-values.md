# CHK-006 Combined-register numeric interpretations

Revision 1, 2026-10-18. Upstream DES-006 / FE-006. All unchecked; this is a plan, not a QA report. [UNIT] pure/fake IPC, [UI] browser plus real WebView2, [SIM] actual app with simulator. Run real QA per e2e/CHECKPOINT.md and record build, fixtures, traffic, results and cleanup in REPORT-006-feature (avoid overwriting prior integration reports).

## A. Numeric values and grouping

- [ ] A1 [UNIT][SIM] For every DES-006 section 3 numeric-vector row, supply exactly its words and assert exact UI text and clipboard. Record each vector separately, including i32/i64 min/max, u64 max and adjacent 2^53 values.
- [ ] A2 [UNIT][SIM] Given 1234 5678, select the named Big-endian, Little-endian, Big-endian byte swap and Little-endian byte swap choices; verify each shown byte pattern and documented decimal output. Given 0123 4567 89AB CDEF, verify all four documented transformed unsigned BigInt hex values and their exact decimal UI/copy. Confirm raw-word text never changes.
- [ ] A3 [UNIT][SIM] Given each f32/f64 one/fraction/negative/subnormal/zero/NaN/infinity fixture, verify formatter and nonfinite marker. f32 3DCC CCCD is `0.10000000149011612`; f64 3FB9 9999 9999 999A is `0.1`. No truncation in narrow cells; all digits reachable.
- [ ] A4 [UNIT][UI] Given start 1 and Q=5, 32-bit yields 1–2/3–4/Incomplete 5; 64-bit yields 1–4/Incomplete 5. Repeat Q=1,3,125 and start 0; at 65535/Q=1 no wrap. Inspect remainder shows only real words, never zeros.
- [ ] A5 [SIM] Given polling data, change start/quantity/function and delay next response. Old definition is not reassembled as new groups; failed/truncated/exception replies supply no partial new values. Next complete success replaces snapshot atomically.

## B. States and editor

- [ ] B1 [UI] Given idle/empty, connecting/loading and connected-before-first-success, table has placeholders and existing status chip, no fabricated group/rule values. Record each state.
- [ ] B2 [SIM] Given live polling, pause then resume: retained Paused text has no fresh rule markers; resumed valid success restores current values. During ordinary pending request, existing successful current snapshot remains visible.
- [ ] B3 [SIM] Given valid values, inject timeout, exception and link loss separately: existing exact reason/code remains visible, retained values are Stale with no rule marker; user Disconnect follows existing clear policy. Clear faults/reconnect: one valid snapshot removes Stale. No mixed frames.
- [ ] B4 [UI] Given draft order edits, table remains applied until Apply acknowledgment; Applying state prevents duplicate submits. Simulated IPC rejection shows `Could not apply interpretation. {message}` and keeps draft/applied state. Retry succeeds and marks Modified once.
- [ ] B5 [UI] Given Raw rule threshold `1.5`, attempt Signed 64-bit: named-rule whole-number error, old interpretation retained. Fix rule to `1`, retry succeeds. Repeat with disabled incompatible rule. No wire request from any attempt.
- [ ] B6 [UI] Given unknown interpretation/order in profile fixture, load is rejected before workspace replacement; existing current profile remains unchanged. No silent Unsigned fallback for invalid supplied value.

## C. Interaction, retained settings and persistence

- [ ] C1 [UI] Given scales/overrides/aliases, enter combined mode: Interpreted/Raw words effective columns, scaling edit/copy/shortcuts disabled with explanation, saved settings preserved. Return to 16-bit restores exact earlier columns/scales. Switch FC03 -> FC01 -> FC04, verify bits then restored register settings and orders. In normal and combined grids, Format / endian… in the row menu reveals and focuses Interpretation without applying a draft.
- [ ] C2 [UI] Given group alias on first register and different constituent aliases, inspector lists all; table uses first only. Base 1 increments all displayed/copy addresses once. Resize columns, select ranges, change width, verify selection mapping and no lost data.
- [ ] C3 [UI] Given selected u64 groups, Ctrl+C, Copy with header and optional alias reproduce exact decimal text; incomplete copies Incomplete; nonfinite explicit text; missing empty field. Copy raw registers emits each constituent address/u16 with its own optional alias. Clipboard denial gives existing error toast.
- [ ] C4 [SIM] Given selected groups but right-click another group, Write targets clicked group's first register/raw u16. Change and send FC06 then FC16: captured TX raw words equal entered values; no float/u64 encoding. Inspector order settings do not alter TX/RX.
- [ ] C5 [UI] Save/load and duplicate retain every interpretation/order, scales, aliases and rules. Schema 1/2 fixtures with each old format retain that format; missing settings default Unsigned/off/off/no rules. Migration does not mark Modified or rewrite file until Save; unknown newer schema and invalid booleans rejected.
- [ ] C6 [UI][SIM] Repeat in workspace and native host. Pop out/dock with unapplied invalid draft preserves fields/errors/applied summary. Inspector/editor Tab trap, Escape and focus restoration work; text copy/paste/undo do not trigger grid shortcuts. At native minimum size no document scrollbar or numeric truncation; inner scroll works.

## D. Regression and performance

- [ ] D1 [SIM] At 125 wire registers / 100 ms, all combined modes and all order changes remain responsive; traffic shows same quantity and no display-edit requests. Record render timings and compare existing REQ-001 performance baseline; no long tasks >50 ms during steady-state capture.
- [ ] D2 [UI] High contrast/grayscale: Incomplete, Nonfinite, Stale and Paused remain distinguishable by text/icon; focus and selection visible. Screen reader reports type/range and marker descriptions. Test both host minimum sizes.
- [ ] D3 [UNIT][UI] Rerun affected CHK-003 scale/copy/write and 16-bit shortcut tests; existing rounding and rawSigned behavior unchanged. Incoming values and interpretation-derived rendering do not mark Modified.

State coverage: idle/empty/connecting/loading/connected B1; polling A1/D1; paused B2; timeout/exception/disconnected/recovery B3; invalid B5/B6; saving/failure B4; nonfinite A3; incomplete A4; disabled scale/function C1.
