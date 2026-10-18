# REPORT-018 — CHK-004..007 consolidated checklist status

2026-10-18. Consolidation of REPORT-010..017, 019..023 and referenced focused tests. Status is clause-level: **PASS** requires direct evidence for every clause in the checklist item; **PARTIAL** means cited subclauses passed but at least one named requirement remains unverified; **OPEN** means no direct evidence establishes a checklist subclause. Unit/component evidence is cited but does not substitute for a required real-window, simulator, accessibility, or hardware clause. No release sign-off.

## CHK-004 — bulk poll actions

| ID | Status | Evidence and remaining clause(s) |
|---|---|---|
| CHK4-A1 | PARTIAL | REPORT-010 initial empty selection/no Modified; REPORT-011 bulk roundtrip and selection clear on reopen; REPORT-014 replacement/reused-id matrix remains open. |
| CHK4-A2 | PARTIAL | REPORT-011 A/C selection, active/current behavior and copy/delete flow; exact B,D selection with all window/focus/scheduling assertions not established. |
| CHK4-A3 | PARTIAL | REPORT-010 pointer range; REPORT-012 Shift+Arrow range; REPORT-014 reverse extension. Reorder-following range and deleted-anchor reset remain open. |
| CHK4-A4 | PARTIAL | REPORT-010/012 Home, arrows, Shift+Arrow and list Ctrl+A/Ctrl+Shift+A; REPORT-014 real-window Space/Shift+Down/Home/End. Tab, Shift+Space, Up, polite announcement not verified end-to-end. |
| CHK4-A5 | PARTIAL | REPORT-012 Host Ctrl+A exclusion; REPORT-014 same real-window case. Other named focus targets, native clipboard/IME/AltGr and row Delete behavior remain open. |
| CHK4-A6 | OPEN | No direct evidence for row activation, checkbox drag exclusion, checked-row drag, or legacy reorder/context actions as a whole. |
| CHK4-A7 | OPEN | No 16-row narrow-sidebar/accessibility-tree/screen-reader evidence. |
| CHK4-B1 | PARTIAL | REPORT-011 exact order, copies, selected sources, fresh unchecked copies and persisted display/rules/scales. Full per-source alias/interpretation/color settings and absence/reset of every runtime/draft field not all asserted. |
| CHK4-B2 | PARTIAL | REPORT-014 case-insensitive existing-name collision and 48-character bound; collision against earlier copies in the same transaction remains open. |
| CHK4-B3 | PARTIAL | REPORT-011 connected auto-start copy behavior; idle/connecting/disconnected, auto-start off, loading/empty and RTU-invalid cases remain open. |
| CHK4-B4 | PARTIAL | REPORT-014 real-window 15/16 capacity boundary and exact UI errors; direct backend full-operation overflow/no-mutation clause remains open. |
| CHK4-B5 | PARTIAL | REPORT-011 workspace/native/closed source coverage and live native copy; full host-kind, placement, focus and no-grouped-drag matrix remains open. |
| CHK4-B6 | PARTIAL | REPORT-013 injected create/place/show/destroy recovery and source/survivor checks; exact typed commit result/token/idempotency and full stale/precondition/error-focus/announce clauses remain open. |
| CHK4-C1 | PARTIAL | REPORT-011 modal names native host and initially focuses Cancel; REPORT-014 repeats focus. Dirty-view names/warning and Cancel/Esc preservation across all states remain open. |
| CHK4-C2 | PARTIAL | REPORT-011 confirms deletion, survivor/native behavior and profile Modified. Busy/duplicate submission, totals, traffic filter and full scheduling matrix not all verified. |
| CHK4-C3 | PARTIAL | REPORT-014 component test invalidates modal on rename with exact error/no remove; real concurrent edit and stale-id/lifecycle backend rejection remain open. |
| CHK4-C4 | PARTIAL | REPORT-014 idle deletion focus/empty state/connection retention. Connected scheduling and surviving-active poll clauses remain open. |
| CHK4-C5 | PARTIAL | REPORT-013 real injected postcommit native failure and recovery; backend rejection/no-mutation, authoritative host reconciliation and all affected-poll notices are not fully exercised together. |
| CHK4-D1 | PARTIAL | REPORT-011/014 connected and idle subcases; connecting, paused, empty/loading, timeout, exception, disconnected and invalid-draft matrix remains open. |
| CHK4-D2 | PARTIAL | REPORT-011 save/reopen definitions/settings and selection absence; cancel/failure Modified behavior and full duplicate/delete roundtrip matrix remain open. |
| CHK4-D3 | PARTIAL | REPORT-011 hide/show, native Show/Keep and add/delete behavior; 16-poll minimum-rate render/cadence measurement remains open (REPORT-014 explicitly notes it). |

Focused component evidence cited by REPORT-014: `PollBulk.test.tsx` and `PollList.test.tsx` (28 tests); REPORT-014 also records its exact command and the relevant cases. These tests do not close the real-window/manual gaps above.

## CHK-005 — configurable value color rules

| ID | Status | Evidence and remaining clause(s) |
|---|---|---|
| CHK5-A1 | PARTIAL | REPORT-010 comparison operators; REPORT-012 inclusive Between and overlap reorder. Remaining full operator/source/range vectors are open. |
| CHK5-A2 | PARTIAL | `apps/desktop/src/tools/modbus-master/lib/color-rules.test.ts` source math; browser raw/scaled/displayed column matrix is open. |
| CHK5-A3 | PARTIAL | `color-rules.test.ts` parser/matcher; rounding, clamp, extrapolation and too-large display marker behavior remain open. |
| CHK5-A4 | PARTIAL | `color-rules.test.ts` signed/raw source vectors; bit-function and Hex/Binary UI cases remain open. |
| CHK5-A5 | PARTIAL | REPORT-011 exact 9007199254740993 UI/copy/save/reload; adjacent-u64 comparison and full reload matrix remain open. |
| CHK5-A6 | PARTIAL | `color-rules.test.ts` u64 maximum and i64 minimum; i64 maximum and exact editor/profile text remain open. |
| CHK5-A7 | PARTIAL | REPORT-015 nonfinite values and timeout no-marker; missing/incomplete/too-large/scaled-unavailable and finite-float exactness remain open. |
| CHK5-A8 | PARTIAL | REPORT-012 inclusive Between and first-match reorder; disable/remove, draft isolation, range/group mapping and re-expansion remain open. |
| CHK5-B1 | PARTIAL | REPORT-010 empty/default/add/cancel; REPORT-021/022 component evidence for both row-menu paths and operator labels. Limit 16, reorder focus and complete editor state coverage remain open. |
| CHK5-B2 | PARTIAL | REPORT-010 blank/comma errors; REPORT-012 reversed Between; `color-rules.test.ts` parser/validation subsets. Full exact-message/placement matrix remains open. |
| CHK5-B3 | PARTIAL | `color-rules.test.ts` general/exact parser cases; full editor grammar and address endpoints remain open. |
| CHK5-B4 | PARTIAL | REPORT-010 successful Apply; utility/store failure tests are referenced by REPORT-015; rule-editor IPC failure/retry with draft retention remains unverified. |
| CHK5-B5 | PARTIAL | Combined/profile rejection subsets in REPORT-011 and utility suites; full incompatible-rule correction/retry matrix remains open. |
| CHK5-C1 | OPEN | No direct empty/loading/first-data state matrix. |
| CHK5-C2 | PARTIAL | REPORT-011 pause, timeout, exception and recovery with live values; link loss and disconnect policy cases remain open. |
| CHK5-C3 | OPEN | No measured palette contrast or accessible marker/detail evidence. |
| CHK5-C4 | OPEN | No scale-marker/high-contrast interaction evidence. |
| CHK5-C5 | OPEN | No focused minimum-host editor handoff, focus-trap or invalid-draft host transition evidence. |
| CHK5-D1 | PARTIAL | REPORT-011 rule persistence and schema migration subsets; mixed-rule duplicate/profile roundtrip remains open. |
| CHK5-D2 | PARTIAL | REPORT-017 real-window 125-register/16-rule steady capture, all combined modes/orders and zero >50ms long tasks; browser performance, reorder isolation, incoming-match Modified behavior, and full baseline comparison remain open. |
| CHK5-D3 | OPEN | No affected-row-only render and complete scale/copy/write regression matrix. |

Focused test references: `color-rules.test.ts`; REPORT-010 and REPORT-012 browser spec `e2e/tests/chk4-7-new-features.spec.ts`; REPORT-015 browser spec `e2e/tests/chk5-6-values-remaining.spec.ts`. See each report for exact commands/results; tests cover subsets only.

## CHK-006 — combined-register interpretations

| ID | Status | Evidence and remaining clause(s) |
|---|---|---|
| CHK6-A1 | PARTIAL | REPORT-010/011 exact UI/copy signed32, unsigned32, signed64 min, unsigned64 max and 2^53+1, plus float examples; all numeric vectors and clipboard variants remain incomplete. |
| CHK6-A2 | PARTIAL | REPORT-010/011 four 32-bit orders; REPORT-012 four unsigned64 orders and raw-word order. REPORT-023 adds explicit option labels/patterns, focused mapping tests and two browser assertions that printed `ok` before runner shutdown hung. Full transformed hex matrix and clean browser exit remain open. |
| CHK6-A3 | PARTIAL | REPORT-011 finite float, infinities and NaN; subnormals, signed zero and narrow-cell reachability remain open. |
| CHK6-A4 | PARTIAL | REPORT-010 start1/Q5 incomplete groups and real-word remainder; Q1/Q3/Q125, start0 and 65535 boundary cases remain open. |
| CHK6-A5 | PARTIAL | REPORT-011 live pause/fault/recovery; delayed definition changes and truncated/exception atomic-snapshot cases remain open. |
| CHK6-B1 | OPEN | No dedicated idle/loading/first-success placeholder matrix. |
| CHK6-B2 | PARTIAL | REPORT-011 pause/resume retained snapshot and marker behavior; ordinary pending-state snapshot case remains open. |
| CHK6-B3 | PARTIAL | REPORT-011 timeout/exception stale and recovery; link loss and disconnect matrix remains open. |
| CHK6-B4 | PARTIAL | REPORT-010 successful draft/Apply behavior; IPC rejection and retry with both draft/applied state assertions remain open. |
| CHK6-B5 | OPEN | No focused integer64 incompatible-rule correction/retry case. |
| CHK6-B6 | PARTIAL | REPORT-011 malformed/newer profile rejection and current-workspace preservation subsets; complete fixture matrix remains open. |
| CHK6-C1 | PARTIAL | REPORT-022 component evidence: normal and combined row-menu Format / endian path reveals/focuses Interpretation without applying a draft. Saved scale/columns/function roundtrip matrix remains open. |
| CHK6-C2 | PARTIAL | REPORT-010 address grouping/remainder and focus subset; alias, base-address, resize and selection mapping remain open. |
| CHK6-C3 | PARTIAL | REPORT-010/011 exact selected numeric UI/copy; header, alias, raw, incomplete, missing and clipboard-denial cases remain open. |
| CHK6-C4 | PASS | REPORT-019 verifies clicked-group raw write targeting in a real app: Float32/Unsigned64 × four byte/word orders × FC06/FC16 (16/16 vectors), including exact TX/RX and simulator readback. |
| CHK6-C5 | PARTIAL | REPORT-011 schema2/3 roundtrip and schema1/2 migration; all interpretation/order combinations and invalid schema/settings rejection remain open. |
| CHK6-C6 | PARTIAL | REPORT-011 native host attachment and minimum-size sidebar geometry; editor focus trap/scroll/handoff, native minimum-size table and text-edit behavior remain open. |
| CHK6-D1 | PARTIAL | REPORT-017 real-window 125-register/100ms run, all combined formats/orders, unchanged quantity, no overlap, no >50ms long tasks and no requests from paused settings edits. Historic baseline lacks comparable timing totals; reorder isolation and full regression comparison remain open. |
| CHK6-D2 | OPEN | No screen-reader/high-contrast/grayscale evidence. |
| CHK6-D3 | PARTIAL | Existing combined/color utility tests and REPORT-011 selected 16-bit/raw behavior; complete scale/copy/write/shortcut regression and Modified checks remain open. |

Focused test references: `apps/desktop/src/tools/modbus-master/lib/combined.test.ts`, `combined-copy.test.ts`, and `color-rules.test.ts`; browser specs cited under CHK-005; REPORT-011/017 integration specs `e2e/tests-integration/22-report011.spec.ts` and `25-report017.spec.ts`. These are partial evidence, not full vector or regression sign-off.

## CHK-007 — visible sidebar collapse control

| ID | Status | Evidence and remaining clause(s) |
|---|---|---|
| CHK7-A1 | PASS | REPORT-010 browser and REPORT-011 real window verify both directions, 44px rail, workspace width change, synchronized button name/expanded state and restoration of the prior width. All clauses in this item have direct evidence. |
| CHK7-A2 | PARTIAL | REPORT-016 component shortcut targeting; REPORT-020 browser W1 two-subwindow/W2 setup isolation. Outside-subwindow shortcut targeting and real multi-window app rerun remain open. |
| CHK7-A3 | PASS | REPORT-010/011 compact peek and durable-state restore; REPORT-020 covers both durable starting states, peek hide/reopen, exit compact from peek, and all Show/Hide labels/expanded states. |
| CHK7-A4 | PARTIAL | REPORT-010/016 activation and focus subsets, F6 region cycling; native Tab traversal, focus rendering and assistive-technology tree/output remain open. |
| CHK7-A5 | PARTIAL | REPORT-011 real-window sidebar/profile and host checks; invalid connection draft, bulk selection/anchor, width 220/400 and all preserved runtime/grid state assertions remain open. |
| CHK7-A6 | PARTIAL | REPORT-011 idle/connected/polling and profile/window behavior; connecting/paused/timeout/exception/disconnected and empty/loading state matrix remains open. |
| CHK7-A7 | PARTIAL | REPORT-011 minimum 960x600 CSS px, 125% DPI, no document scrollbar and toggle visibility; mixed-DPI monitors, other scales, threshold widths/flicker and compact toolbar matrix remain open. |
| CHK7-A8 | PARTIAL | REPORT-011 save/reopen collapsed state, width280, compact flag and no Modified; REPORT-020 browser fake-profile roundtrip restores non-default width328 and collapsed state without Modified. Compact profile/peek persistence and real profile non-default-width rerun remain open. |
| CHK7-A9 | PARTIAL | REPORT-016 shortcut unit/component evidence and REPORT-008 Thai keyboard note; screen-reader name/state, other physical layouts and measured contrast/focus ring remain manual/open. |

Focused test references: `SidebarToggle.test.tsx` (10 tests), `ShortcutMaps.test.tsx`, `ThaiLayout.test.tsx`, and `shortcuts.test.ts` (125 tests; REPORT-016). `e2e/tests/chk4-7-new-features.spec.ts` contains browser coverage (REPORT-010/012). Assistive technology, OS focus rendering, mixed-DPI and unavailable physical keyboard layouts require owner/manual checks.

## Totals and disposition

Across 71 checklist IDs: **3 PASS, 58 PARTIAL, 10 OPEN**. CHK6-C4 is covered by REPORT-019; CHK7-A1 by REPORT-010/011; CHK7-A3 by REPORT-010/011/020. All remaining partial/open clauses are called out in the tables. Manual/hardware/accessibility work remains outstanding, and this report does not grant feature or release sign-off.
