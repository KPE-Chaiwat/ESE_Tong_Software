# REV-011 Debug bulk native-window fault hook

Date: 2026-10-18. Scope: the dev-only adapter and bulk coordinator, Desktop abstraction/fake/native implementation, existing actor recovery records and setup instructions. Upstream: CLAUDE.md, REQ/DES/BE/CHK-004. This review does not sign off the full feature checklist or hardware QA.

## Finding fixed

- **Medium, deterministic fault scope:** `apps/desktop/src-tauri/src/dev_hooks.rs:147` previously consumed `bulkDestroy` for every `destroy_checked` invocation, even when the native window did not exist. Bulk deletion visits workspace and closed polls too, so these no-op calls could consume `skip` or fabricate a destroy failure for a nonexistent orphan. The adapter now checks underlying window existence before consuming the hook. Regression `bulk_destroy_counts_only_existing_native_windows` intersperses absent labels with two existing windows and proves that skip/failure applies to the second actual native window, then disarms.

## Assessment

- Release bulk behavior is unaffected by injection: the adapter is selected only under `all(feature = "dev-hooks", debug_assertions)` in `commands/poll_bulk.rs:91`. Default builds do not register the hook. Explicit release feature builds retain the previously existing dev command, but bulk execution does not use the adapter.
- Definition validation/readiness/commit completes before the first injected OS boundary. Native create/place/show failures resolve committed results; placement maps to `create`, show to `show`, cleanup to `destroy`. Added explicit stage/recovery assertions to the existing coordinator regressions.
- The mutex arm is one-shot, replacement discards an older arm, and only matching calls decrement skip. Existing-window destruction now excludes no-op cleanup. The arm is app-wide (matching the existing pop-out/dock hook); concurrent bulk operations in different connections share its call order. QA must serialize fault scenarios.
- Recovery and ordinary Show use the underlying Desktop without the injection adapter. Show preserves the committed copy id; cleanup uses recorded operation ids and the connection label. Poll ids do not repeat within a session. Current open surviving polls are excluded from orphan destruction; repeated cleanup never repeats the definition mutation. Existing actor records provide bounded session-scoped token idempotency.
- Partial create/place/show cleanup uses checked destruction after the normal create helper; deleted orphans fail session command lookup with pollNotFound. Incarnation-aware destruction callbacks protect a replacement native view from late destruction notifications.

## Verification and limits

Code review completed with no remaining blocker in this hook scope. The backend agent had already run workspace feature-filtered bulk tests before the review changes. This reviewer did not run a duplicate Cargo build or full check; root must include the new regression and stage assertions in the coordinated verification. Real WebView2 fault QA remains separate evidence, particularly asynchronous native destruction/absence and focus behavior.
