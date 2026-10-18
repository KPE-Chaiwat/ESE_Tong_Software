# BE-004 Atomic bulk poll duplicate/delete

Revision 1, 2026-10-18. Upstream REQ/DES/FE-004, DES/FE-007, BE-002 final contract; decision D-004-01 in questions.md. Contract only; implementation and QA pending. Existing single-poll commands retain their public contracts. No backend work is needed for REQ-007: existing workspace layout persistence already carries sidebar visibility/width.

## Commands and generated DTOs

All JSON camelCase; Rust DTOs derive serde and ts-rs. Runtime ids remain session-local PollId; tokens are opaque strings, never numeric u64 in JavaScript. Only W1 invokes prepare/duplicate/delete/recovery; W2 may acknowledge readiness only for its own attached view.

| Command | Exact invoke keys | Return |
|---|---|---|
| mm_prepare_poll_bulk | { action: "duplicate" or "delete", pollIds: PollId[] } | PollBulkPlan |
| mm_duplicate_polls | { planToken: string } | PollBulkResult |
| mm_remove_polls | { planToken: string } | PollBulkResult |
| mm_ack_poll_bulk_ready | { operationToken: string, pollId: PollId, viewToken: ViewToken, ready: boolean } | null |
| mm_recover_poll_bulk_windows | { operationToken: string } | PollBulkResult |

PollBulkPlan = { planToken: string, action: PollBulkAction, targets: PollSummary[], available: number }. Targets are server sidebar order, not input order; UI freezes these full names/hosts/dirty flags for confirmation. Prepare neither mutates definitions nor reserves UI while the human confirms. Keep at most one current plan per W1; replacing it invalidates the old token. Cancel needs no IPC. Plan lasts until replacement, use or session teardown (no surprise human confirmation timeout).

PollBulkResult = { operationToken: string, action: PollBulkAction, definitionsCommitted: boolean, created: PollBulkCreated[], removedIds: PollId[], polls: PollSummary[], issues: PollBulkWindowIssue[] }.
PollBulkCreated = { sourceId: PollId, pollId: PollId }; ordered by source sidebar order. PollBulkWindowIssue = { pollId: PollId, stage: "create" or "show" or "destroy", code: "internal", message: string, recovery: "showPoll" or "retryWindowCleanup" }. No issue means complete. Normal mutation results always have definitionsCommitted=true; precommit failures reject AppError and commit nothing. Recovery returns the original mapping/removal set and current full list, with remaining issues; it never replays definition mutation. Poll ids for destroy issues refer to deleted definitions, not surviving rows.

A consumed successful plan token is idempotent for its session: duplicate/remove returns the recorded committed outcome with the same mapping, never new copies. Store the last 16 committed operation records, bounded and session-scoped; eviction makes an old token invalidState, never executable again. A transport rejection whose delivery is uncertain is resolved by retrying the SAME token; do not prepare a fresh duplicate plan automatically. Precommit failed plans are invalidated and require prepare again. UI must mark Modified from the committed outcome/list once, keyed by operationToken, including recovery outcomes.

## Validation, stale confirmation and reservation

Prepare rejects empty/duplicate input ids (validation, field pollIds), unknown ids (pollNotFound, field pollIds), wrong-window invocation or wrong action/token (invalidState). Never silently deduplicate/drop unknown ids. Validate every id before capacity; count + target count must be <=16 for duplicate. Capacity message is exactly `Cannot duplicate {n} polls. This connection has room for {available} more (maximum 16).` code validation, field polls. Repeat capacity validation at execute.

Server stores a guard for every target: identity plus monotonic definition/view/lifecycle revisions covering name, committed definition/display/aliases/scales/rules, active intent, host/open, attachment identity and unapplied-edit flag. Also guard list order and profile generation. Do not guard counters, samples, ordinary polling status or timestamps; these must not invalidate a confirmation. Any guarded change, even one later reverted, invalidates the whole plan. Unknown/deleted target after prepare uses validation, field pollIds, exact message `The selected polls changed. Review your selection and try again.` Other conflicting operations use invalidState, field planToken. No target is omitted from a confirmed deletion.

Execute acquires one session bulk-mutation reservation, rechecks guards/capacity, and reserves all affected view lifecycles. Existing add/remove/rename/update/set-view/reorder/profile-apply, host move/Show/close, attachment replacement and active-intent changes must reject invalidState while their state conflicts with the reservation. Ordinary link I/O/counters continue. Readiness is NOT inferred from dirty flag or a one-time modal read.

Add PollViewEvent `BulkOperationPrepare { operationToken, action }` and `BulkOperationRelease { operationToken }`. Send prepare to each currently attached affected view (workspace as well as native); view atomically refuses if a modal/handoff/close is already active, otherwise locks new modal/close/host/definition actions, then acknowledges its current viewToken. Dirty setup drafts alone are allowed; delete confirmation already discloses their loss and duplicate copies only applied settings. No per-window Keep prompt. W1's bulk confirmation is the coordinator and is exempt from its own readiness refusal; its affected workspace child views still acknowledge. Missing ACK/refusal after 1 second aborts ALL before definition commit: validation, field lifecycle, `Close dialogs in the selected poll windows and try again.` Late/wrong-token/wrong-view ACKs cannot satisfy readiness. ACKs require the current originating window/view identity.

An unattached open native host cannot prove readiness: reject before commit; user can Show/reload it, then prepare again. Closed hosts need no ACK. If a window/view disappears or changes attachment after prepare/ACK and before actor commit, invalidate reservation and reject unchanged definitions. Recheck guards, membership, view generations and readiness under the actor immediately before commit. Serialize window-destruction notifications with this check; external OS death may close its own view but never authorize partial definition mutation. Release all surviving leases on every exit, including cancellation, failed IPC, timeout and W1 teardown. W2 teardown cannot leave a permanent lock.

## One definition transaction and window failures

Stage every new entry/name/id/scheduler action in memory, then replace the list and scheduler membership in ONE actor turn. Do not loop over public single-poll commands: current remove_poll emits a list each time and open_new_native removes failed copies. Neither behavior satisfies bulk atomicity. Never await native OS operations inside actor mutation.

Duplicate: preserve all persisted settings including BE-005/006 additions; active=autoStartPoll, fresh empty runtime/counters/errors/values/drafts. Connected auto-start runs eligible polls; invalid-for-link RTU slave 0 remains Paused; disconnected/connecting is Offline. Allocate never-reused ids (gaps after aborted staging allowed). Copy names use existing copy_name and same_poll_name (Unicode lowercase comparison), suffix ` copy`, ` copy 2`, etc.; truncate base by Unicode scalar count to fit 48 characters, trim its trailing space, allocate against all originals AND prior copies. One consecutive copy block follows the last selected source: [A,B,C,D] + [C,A] input -> [A,B,C,A copy,C copy,D], mapping A then C. Open sources use same host kind; closed sources become open workspace copies. Preserve normal single-duplicate placement/activation in source order; native copies use 24 logical px from each source W2.

Delete: allow all/last deletion, no replacement/disconnect. Remove scheduler entries, pending handoffs, stored drafts/handoffs, minimized-order ids and routes together. PollRemoved is the final event for each removed view. In-flight request can finish, discarded reply counts only toward connection totals. Surviving counters/scheduling/definitions remain intact; traffic filter falls back to All polls when its id disappears.

Commit definitions before native create/destroy attempts; do not roll back or delete committed copies because a window operation fails. Keep list publication suspended for THIS transaction until window reconciliation is complete, then emit exactly ONE authoritative PollListChanged containing the final full ordered list and host/open states; no intermediate lists per id, hidden create or error recovery. Actor can continue ordinary samples/counters while reserved mutations remain blocked. New native copies are present with host=native/open=true before their window can attach; successful hidden create/place is then shown in source order. On failed create/place/show, destroy any partial window, detach route, keep copy host=native/open=false with saved placement, return issue recovery=showPoll. Copy remains scheduled according to active; Show is a host retry only, never another duplicate. Existing mm_show_poll must preserve definition on retry failure. Release reservation after final list/result. Restore W1 bulk-action focus on completion, without raising surviving native windows.

Delete destroys target native windows after actor commit using unconditional destroy (no CloseRequested/Keep prompt), confirms absence, and reports destroy failure as recovery=retryWindowCleanup. Deleted definitions/routes/scheduling never reappear. A surviving orphan webview displays terminal removed state; all its commands fail pollNotFound, no further data delivered. Operation record retains only exact connection/window/id identities; mm_recover_poll_bulk_windows retries those orphan destroys, never destroys an unrelated/reused window and never reissues delete. Existing Desktop::destroy returns no error: implementation must add a checked destruction/absence result behind the Desktop abstraction; do not claim cleanup success from a void call. Cleanup failures need a persistent W1 Retry window cleanup action, distinct from Show for surviving copies.

Result.polls equals that operation's final authoritative list payload; unrelated later list events may supersede it. Shared IPC coordinator reconciles by channel order and does not overwrite newer event state with an older returned snapshot. Emit batch list before command resolution; buffer unrelated definition/host mutation lists during reserved transaction. Future user Show/cleanup recovery may emit their own list events, never repeat the original definition commit. Ordinary polling events are not extra list commits.

## Error envelope and verification vectors

Use existing AppError { code, message, field }; existing validation/pollNotFound/invalidState/noSession/internal codes suffice. Rejections guarantee no definition commit. Postcommit OS errors ALWAYS resolve typed committed result with issues; never reject as a mutation failure. Malformed JSON/unknown action rejects validation at boundary. Runtime disconnection does not itself prohibit definition operations. Keep outcome records before resolving IPC so a response loss remains safe.

Required backend tests with fake Desktop + actor and deterministic readiness time:

| Vector | Required assertion |
|---|---|
| Input [] / [A,A] / [A,unknown] | reject; no new ids/list/scheduler mutations |
| 15 existing + two / one sources | zero copies capacity failure / exactly16 success |
| [A,B,C,D], input[C,A] | block order and mapping exactly above; one list |
| Existing A copy and a COPY 2; 48-char Unicode source | allocator skips collisions, all names <=48 scalars |
| Applied aliases/scales/order/rules; dirty draft | applied data deep copied; no runtime/draft clone |
| Connected auto-start on/off, connecting, RTU invalid | D-002-11 states, fresh counters |
| Target renamed/reordered/deleted/host moved during confirmation; ABA | full stale rejection; new confirmation required |
| Counter/sample changes during confirmation | plan remains executable |
| Native modal open, missing/late/wrong-view ACK, detach after ACK | zero definition commit; all leases released |
| All/last deletion; running in-flight + closed + native | zero polls allowed, session remains; final events, totals preserved |
| Second native create fails / partial create-place fails | ALL copies survive; failed native closed; one final list; Show recovers same id |
| First native destroy fails after delete | ALL definitions removed; orphan blocked; cleanup retry only |
| Same token double-submit/response loss | one mutation and one list; stable ids/mapping |
| Recovery repeated, W1 destroyed mid-await | no duplicate mutation, no leaked lock/window/tasks |

Generate bindings with pnpm bindings; never hand-edit generated files. Implement backend unit/fake-window tests before real-window CHK-004. Workspace checks are coordinated once via pnpm check; no per-package cargo builds or cache deletion. Final implementation handoff must list actual DTO files, commands, deviations and tests honestly. No product code is authorized by this task document itself.
