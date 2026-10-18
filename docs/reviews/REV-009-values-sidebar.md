# REV-009: combined values, sidebar, and numeric persistence

2026-10-18. Independent review of REQ-006 frontend/backend, REQ-007 frontend, and BE-005 persistence/validation. Excludes the unfinished REQ-005 color editor/evaluator and BE-004 bulk operations. This review does not approve those excluded features or replace real-window QA.

Read CLAUDE/AGENTS, reviewer instructions, STATUS/SETUP, decisions, REQ/DES/FE/BE/CHK-005/006 and REQ/DES/FE/CHK-007 (no BE-007 exists or is needed). Reviewed the working diff and relevant new files, existing snapshot/selection/alias/dialog infrastructure, and tests.

## Findings

### R1 — major: interpretation published before acknowledgment

- Original location: `apps/desktop/src/tools/modbus-master/store/poll.store.ts:359` (original optimistic branch), called by `components/poll-view/InterpretationSection.tsx:42`.
- The display-only patch immediately replaced `config` before awaiting `setPollView`. Both the table and Applied summary therefore showed an unacknowledged interpretation. DES-006 section 5 / CHK6-B4 explicitly require the previous applied view while pending.
- Scenario: retain a raw threshold of `1.5`, choose Signed 64-bit, and delay the IPC rejection. During the delay the frontend uses Signed 64-bit although Rust retains the original format. An unrelated view update can replace the optimistic object and defeat its reference-identity rollback.
- Fix: keep interpretation/rule patches unapplied until the authoritative config event or successful acknowledgment; ignore stale completions and retain the previous state on rejection. Add a delayed-response test, not only immediate resolve/reject coverage.
- Status: **resolved on source recheck**. Display/rule patches now await acknowledgment without publishing optimistically; a config event that supersedes the captured config prevents the completion fallback from overwriting it. The delayed rejected-interpretation test in `RuleSection.test.tsx` asserts the original config remains identical both while pending and after failure.

### R2 — minor: clicking an alias input commits it prematurely

- Original location: `apps/desktop/src/tools/modbus-master/components/poll-view/CombinedGrid.tsx:233` (row click handler; lines shifted during concurrent integration). Related: `components/poll-view/DataGrid.tsx:106` (`AliasEditor.onBlur`).
- The row click handler handles clicks from the nested input and unconditionally focuses the grid. AliasEditor stops key events, but does not stop click bubbling. Focusing the grid blurs the input and commits its draft.
- Scenario: F2 on a combined row, then click inside its alias input to position the caret or select text. The row handler steals focus and closes/commits editing instead.
- Fix: exclude input/button/editor descendants from row selection/refocus, preserving native editing interactions. Add a both-host regression that clicks inside the editor and verifies focus/draft remain active.
- Status: **resolved on source recheck**. Row clicks now exclude input/button descendants. `CombinedGrid.test.tsx` clicks the active editor, verifies retained input focus, and types a draft without premature commit.

### R3 — minor: keyboard group focus is neither scrolled nor exposed

- Original location: `apps/desktop/src/tools/modbus-master/components/poll-view/CombinedGrid.tsx:166` (keyboard handler), and grid attributes at line 161.
- Arrow/Home/End handlers only change selection. Unlike the existing DataGrid, this grid has no focused-row scroll effect, row ids/`aria-activedescendant`, or equivalent DOM focus movement.
- Scenario: show 125 registers in a short host, focus the grid and press End or repeatedly ArrowDown. The focused group moves below the visible viewport while the scroll position stays put; assistive technology receives no active-row relationship. Enter/Copy then act on a row that is not visible.
- Fix: give logical rows stable ids and expose the active descendant; scroll the focused/edited row into view without moving DOM focus away from an active input. Cover keyboard focus and restoration across both hosts.
- Status: **resolved on source recheck**. Rows now have stable ids, the grid exposes `aria-activedescendant`, and focused-row changes call nearest `scrollIntoView`. The regression checks End targets the final row and requests scrolling. A related transition fix carries group width through UI handoff, resets selection on entering a different width, and preserves transferred multiselection when the same combined format mounts in a new host; both transitions have regression coverage.

## Other reviewed behavior and evidence

- Decoder uses BigInt for integer assembly and signed conversion; exact decimal copy never converts those values through Number. DataView float decoding, documented byte/word transforms, missing/incomplete groups, and raw-word order agree with the numeric contract. Existing definition/sequence gates prevent reuse of mismatched snapshots.
- Backend validates the prospective display/rules before mutating any view field. Disabled rules participate; thresholds remain strings; integer thresholds use checked bounded i128; schemas 1/2 migrate through closed legacy format types; schema 3 requires the new fields. Duplicate/export/apply preserve them. No additional verified blocker found in this backend scope by source inspection.
- Sidebar visibility is shared, compact peek preserves durable collapse choice, hidden sidebar remains mounted, and focus restoration uses the persistent toolbar control. No additional verified source-level blocker found in REQ-007. The added fixed-width toolbar control still needs CHK7-A7 actual layout measurements at minimum sizes/DPI; jsdom cannot establish pixel fit.
- Existing focused tests run successfully: 5 files / 54 tests (combined decoder, combined copy, CombinedGrid, InterpretationSection, SidebarToggle). These tests did not cover the findings above. Command: `pnpm.cmd --filter @esefact/desktop exec vitest run` with those five explicit paths. The `.cmd` shim was needed because PowerShell script execution is disabled. No full check or Rust builds were run by this reviewer.
- After fixes, the implementation owner reports 8 files / 120 focused tests passing, plus desktop TypeScript and Biome. The reviewer inspected the final fixes and the new delayed-acknowledgment, alias-focus, active-row-scroll, width-transition and handoff regressions; that final run is implementation-owner evidence, not a second independent execution.
- User-visible CHANGELOG entries exist for REQ-006 and REQ-007. Product source, STATUS, configuration and CHANGELOG were not edited by this reviewer.

## Verdict

**Approve the reviewed source scope after R1–R3 fixes.** No unresolved verified blocker remains in this review. Full workspace checks and CHK-006/007 browser/real-window QA remain separate release gates, including toolbar pixel fit and real keyboard/assistive-technology behavior. This verdict excludes unfinished REQ-005 frontend and BE-004 bulk operations.
