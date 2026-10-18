import { expect, it } from "vitest";
import { createPollViewUiStore } from "./poll-view-ui.store";

it("transfers interpretation draft and error through host handoff without sampled values", () => {
  const source = createPollViewUiStore({ getConfig: () => null });
  const destination = createPollViewUiStore({ getConfig: () => null });
  const draft = {
    format: "unsigned64",
    swapBytes: true,
    reverseWords: true,
    error: "Could not apply interpretation. Try again.",
  };
  source.getState().setInterpretationDraft(draft);
  expect(destination.getState().applyHandoff(source.getState().toHandoff())).toBe(true);
  expect(destination.getState().interpretationDraft).toEqual(draft);
});
