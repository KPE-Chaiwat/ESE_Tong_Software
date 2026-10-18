# REV-010 Bulk poll actions: backend and selection review

Date: 2026-10-18. Scope: BE-004 atomic bulk implementation and FE-004 selection stage. Frontend bulk command/dialog integration was being edited during this review and is excluded from this verdict.

Read CLAUDE.md, AGENTS.md, reviewer instructions, STATUS/SETUP, REQ/DES/FE/BE/CHK-004, the applicable questions/decisions, actor and desktop coordinator implementation, selection/runtime code and regression tests. Review was by source inspection; no tests or full workspace checks were run by this reviewer.

## Findings

### M-1 — Major, resolved: delayed destruction can close the recovered native host

- Files: `apps/desktop/src-tauri/src/lib.rs:25`, `apps/desktop/src-tauri/src/commands/poll_windows.rs:129`, `crates/modbus-master/src/session.rs:2362`.
- Problem: `on_destroyed` checks whether a window with the label exists, then spawns an asynchronous task that eventually calls `native_window_destroyed(poll_id)`. The actor notification has no native incarnation/generation identity. The new bulk Show recovery path destroys a failed closed-host orphan and then reuses its label after `begin_native_open`. The absence check preceding the spawn cannot protect a window created after that check.
- Concrete sequence: bulk native creation/show and cleanup fail, leaving a surviving closed definition and orphan. Show successfully destroys the orphan; the old Destroyed handler sees the label absent and schedules its task. Show opens/recreates the host and may attach its fresh route. The delayed old task then runs and unconditionally clears the native route and sets `open=false` for this same poll id. Recovery can return success while the actual visible host is marked closed and receives no further data. The same ordering can interrupt a later readiness lease.
- Fix: give each native incarnation a generation identity and make destruction notifications conditional on that identity under the actor, or serialize the old destruction notification with reopening so it cannot apply to a new incarnation. Checking label existence only before scheduling is insufficient. Add a deterministic regression that delivers the old notification after the recovered host has opened/attached, and verify the new host and route survive; also retain coverage of genuine current-host destruction.
- Verification: confirmed by the two asynchronous transitions and unconditional actor teardown in the cited source. No real-window reproduction claimed.

## Reviewed behavior and limits

The inspected actor stages copies and commits membership in one turn, suppresses intermediate list publication, retains successful token records, validates target/order revisions including rename ABA, and rechecks readiness at commit. Copy construction includes schema3 display flags/rules plus aliases/scales and fresh runtime state. The desktop coordinator reports postcommit failures as typed issues and retains surviving copies. Existing regression sources cover ordering/capacity, timeout/cancellation, wrong-view ACK, detach after ACK, token replay, native create/show/destroy failures and applied settings.

Selection uses a separate transient store with additive ranges, reconciliation and profile reset; list semantics expose separate checkbox and Show targets. Full command/dialog integration, real-window focus/accessibility, and the full `pnpm check` gate remain outside this scoped approval.

## Verdict

**Approve** the reviewed backend and selection scope after the M-1 recheck below. No unresolved findings in that scope. This is not a final feature/QA approval; frontend bulk command/dialog integration and real-window QA remain excluded.

## M-1 recheck (2026-10-18)

Verified the fix by source inspection: `TauriDesktop::create_poll_window` captures the actor-published native generation before creating a window and installs a per-window destruction callback carrying that generation. The former label-only global callback has been removed. `set_native_open` advances the generation, and `native_incarnation_destroyed` compares it within the actor before touching host state or its route. A delayed notification from the old window therefore cannot close its replacement.

Reviewed `bulk_delayed_old_native_destroy_cannot_close_recovered_route` in `crates/modbus-master/tests/bulk.rs`: it opens and attaches the replacement, delivers the old generation notification, checks open state/attachment count/no list emission, successfully completes subsequent bulk readiness, and verifies destruction of the current generation still closes and detaches. This covers the reported ordering and genuine teardown. Backend implementer reports 14 Tauri tests and workspace clippy passing; this reviewer did not rerun those commands or the full workspace gate. No DTO changes required.

## Final FE-004 integration review (2026-10-18)

Reviewed the completed coordinator, sidebar actions, confirmation, readiness runtime, native modal gating, selection freeze, and UI/store regressions against REQ/DES/CHK-004. Two concrete defects were found and fixed in this follow-up at the coordinator's request:

- **M-2 — Major, resolved:** `apps/desktop/src/tools/modbus-master/store/poll-bulk.store.ts:256` / `:288`: Show and cleanup recovery did not acquire the coordinator modal lease or guard asynchronous completion against profile reset/disposal. An old cleanup reply could restore the previous profile's recovery record; either operation's finally block could change a newer confirmation/operation to idle. Both recovery paths now acquire the modal lease and use the existing epoch/disposed guard before applying outcomes or releasing state. Parameterized regressions hold each reply, reset the profile, open a fresh confirmation, then deliver the old reply and verify confirmation, recovery state and the new modal lease remain intact.
- **m-3 — Minor, resolved:** `apps/desktop/src/tools/modbus-master/components/sidebar/PollList.tsx:201`: frozen-checkbox key handling canceled every key, including Tab/Shift+Tab. A keyboard user who entered a checkbox while an operation was busy could not tab away. Tab now passes through while selection-changing keys stay blocked. A UI regression verifies both tab directions and that Space cannot select a frozen checkbox.

Focused verification after the shared full-check run ended: **3 files / 24 tests passed** (`poll-bulk.store.test.ts`, `PollSelection.test.tsx`, `PollBulk.test.tsx`). Biome checked all four touched source/test files and formatted one test file. No overlapping full workspace check or Rust build was started by this reviewer.

Updated scoped verdict: **approve backend, selection and completed FE-004 integration after the fixes above**. No unresolved concrete findings from this review. Full-workspace failures outside this focused set and real-window/focus/accessibility QA remain the parent's release gates; this review does not claim those have passed.
