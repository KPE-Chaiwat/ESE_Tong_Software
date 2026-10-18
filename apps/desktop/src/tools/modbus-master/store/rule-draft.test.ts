import { expect, it } from "vitest";
import { createPollViewUiStore } from "./poll-view-ui.store";
import { newRule, registerColorDraft, registerRuleDraft, ruleDraft } from "./rule-draft";

it("opens conditional color rules on the clicked register, narrowing a prior whole-poll rule", () => {
  const wholePoll = { ...newRule([]), name: "High", threshold: "50" };
  const draft = registerRuleDraft([wholePoll], 1, 1);
  expect(draft.entries).toHaveLength(1);
  expect(draft.entries[0]?.rule).toMatchObject({
    name: "High",
    comparison: "greaterThan",
    threshold: "50",
    range: { start: 1, end: 1 },
  });
  expect(draft.dirty).toBe(true);
  expect(wholePoll.range).toBeNull();
  expect(registerRuleDraft([], 1, 1).entries[0]?.rule.range).toEqual({ start: 1, end: 1 });
});

it("keeps stable draft identities, ordered exact text and errors across hosts", () => {
  const source = createPollViewUiStore({ getConfig: () => null });
  const destination = createPollViewUiStore({ getConfig: () => null });
  const draft = ruleDraft([newRule([])]);
  const entry = draft.entries[0];
  if (!entry) throw new Error("Missing draft");
  entry.rule.threshold = "9007199254740993";
  draft.dirty = true;
  draft.error = "Could not apply value color rules. Rejected";
  draft.errors = { "colorRules[0].threshold": "Invalid" };
  source.getState().setRuleDraft(draft);
  expect(destination.getState().applyHandoff(source.getState().toHandoff())).toBe(true);
  expect(destination.getState().ruleDraft).toEqual(draft);
  expect(newRule([newRule([])]).name).toBe("Rule 2");
});

it("creates and reopens a static rule for one register without changing other rules", () => {
  const first = registerColorDraft([], 11, 11);
  expect(first.entries[0]?.rule).toMatchObject({
    comparison: "always",
    threshold: "",
    range: { start: 11, end: 11 },
  });
  const second = registerColorDraft(
    first.entries.map((entry) => entry.rule),
    12,
    12,
  );
  expect(second.entries).toHaveLength(2);
  expect(second.entries[0]?.rule.range).toEqual({ start: 12, end: 12 });
  const reopened = registerColorDraft(
    second.entries.map((entry) => entry.rule),
    11,
    11,
  );
  expect(reopened.entries).toHaveLength(2);
  expect(reopened.selected).toBe("saved-1");
  expect(reopened.entries[0]?.rule.range).toEqual({ start: 11, end: 11 });
  const wholePoll = newRule([]);
  wholePoll.threshold = "0";
  const scoped = registerColorDraft([wholePoll], 11, 11);
  expect(scoped.entries[0]?.rule.range).toEqual({ start: 11, end: 11 });
  const previousColors = {
    ...wholePoll,
    colors: { background: "#337bd6", foreground: "#a33300" },
  };
  const narrowed = registerColorDraft([previousColors], 1, 1);
  expect(narrowed.entries[0]?.rule).toMatchObject({
    comparison: "always",
    range: { start: 1, end: 1 },
    colors: previousColors.colors,
  });
  expect(narrowed.entries[1]?.rule).toMatchObject({ enabled: false, range: null });
});
