import { createPollSelectionStore } from "./poll-selection.store";

describe("transient poll selection", () => {
  it("toggles nonadjacent membership independently and moves the anchor", () => {
    const s = createPollSelectionStore();
    s.getState().toggle(1);
    s.getState().toggle(3);
    expect([...s.getState().selectedIds]).toEqual([1, 3]);
    s.getState().toggle(1);
    expect([...s.getState().selectedIds]).toEqual([3]);
    expect(s.getState().anchorId).toBe(1);
  });
  it("adds inclusive ranges without removing previous membership or moving the anchor", () => {
    const s = createPollSelectionStore();
    s.getState().toggle(4);
    s.getState().toggle(1);
    s.getState().addRange(3, [1, 2, 3, 4]);
    expect([...s.getState().selectedIds].sort()).toEqual([1, 2, 3, 4]);
    expect(s.getState().anchorId).toBe(1);
    s.getState().addRange(2, [1, 3, 2, 4]);
    expect(s.getState().anchorId).toBe(1);
  });
  it("uses current order after a reorder", () => {
    const s = createPollSelectionStore();
    s.getState().toggle(1);
    s.getState().addRange(2, [1, 3, 2]);
    expect([...s.getState().selectedIds]).toEqual([1, 3, 2]);
  });
  it("adds target alone with no anchor and uses starting checkbox for Shift arrows", () => {
    const s = createPollSelectionStore();
    s.getState().addRange(3, [1, 2, 3]);
    expect([...s.getState().selectedIds]).toEqual([3]);
    s.getState().clear();
    s.getState().addRange(3, [1, 2, 3], 2);
    expect([...s.getState().selectedIds]).toEqual([2, 3]);
  });
  it("prunes deleted ids and anchor, while additions and copies stay unselected", () => {
    const s = createPollSelectionStore();
    s.getState().selectAll([1, 2]);
    s.getState().toggle(3);
    s.getState().reconcile([1, 2, 4]);
    expect([...s.getState().selectedIds]).toEqual([1, 2]);
    expect(s.getState().anchorId).toBeNull();
  });
  it("profile replacement clears membership even when ids are reused", () => {
    const s = createPollSelectionStore();
    s.getState().toggle(1);
    s.getState().resetForProfile();
    s.getState().reconcile([1]);
    expect(s.getState().selectedIds.size).toBe(0);
    expect(s.getState().anchorId).toBeNull();
  });
});
