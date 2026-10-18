# REQ-004 Sidebar poll selection and bulk actions

Source: owner request, 2026-10-18. Extends REQ-002. Screenshots are visual references only.

## Goal and user story
An engineer selects several polls in one connection's sidebar and duplicates or deletes them in one action.

## Scope and PM defaults
- Provide visible selection controls and a selected count, plus Duplicate selected and Delete selected actions. Selection is distinct from the currently active poll window. Selecting a checkbox must not open, raise, start or pause a poll.
- Support individual selection, Shift range selection in sidebar order, Select all and Clear selection, including keyboard equivalents. Ctrl+A applies only while the poll list owns focus; native text editing keeps its shortcuts. A normal row click retains the existing Show behavior.
- Selection is per connection, transient, initially empty and cleared on profile replacement. Deleted ids are removed from selection. New and duplicated polls are initially unselected.
- Duplicate all selected definitions in sidebar order, inserting the copies after the last selected source. Each receives a fresh id and the existing single-duplicate naming rule, settings, aliases, scaling, interpretations and color rules. Runtime values, counters and drafts are never copied. Follow D-002-11 for polling state and the existing single-duplicate host behavior.
- Enforce the existing 16-poll limit before making any copies. If the complete operation would exceed it, reject it without partial copies and explain available capacity.
- Delete requires one confirmation naming the count and identifying all affected polls; native/open/closed polls are included. Cancel changes nothing. Confirm removes those definitions and views and stops their polling using existing lifecycle rules. Keep the current rule for deleting the last poll; design must state it explicitly rather than inventing a second rule.
- A bulk operation validates the selected ids and commits the definition change as one transaction. Invalid/stale ids, capacity failures or deletion precondition failures leave definitions unchanged. Window errors must be reported with a recoverable state; they must not silently lose a surviving definition.
- Duplicate/delete marks the profile Modified. Selection alone does not. Busy actions cannot be submitted twice.

## Acceptance criteria
1. Selecting polls 1 and 3, or a contiguous Shift range, affects precisely those polls; active-window and selection indicators remain distinguishable without color.
2. Duplicate preserves source order and all persisted settings, produces unique ids, leaves sources intact and follows auto-start defaults when connected and disconnected.
3. At 15 polls, duplicating two is rejected with no changes; duplicating one succeeds. Backend validation also enforces this boundary.
4. One confirmation deletes a mixture of running, paused, closed and native-hosted polls. Unselected polls and their scheduling remain intact. Cancel and failed validation preserve everything.
5. Selection count, keyboard operation, focus after deletion, empty selection and stale selections are covered by design/QA. No destructive shortcut fires inside a text field or unrelated window.
6. Profiles round-trip copies/deletions; selection is not persisted. English UI and existing performance/accessibility rules hold.

## Out of scope
Bulk editing, bulk writes, bulk start/pause, copying between connections, multi-poll drag/reorder, undo history and increasing the poll limit.

## Handoff and open questions
Designer produces DES/FE/CHK-004, including last-poll behavior from the current implementation and exact selection gestures. PM then supplies BE-004 contract. No owner decision blocks design.
