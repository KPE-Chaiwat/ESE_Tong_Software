import { createAnnouncerStore } from "./announcer.store";

describe("announcerStore", () => {
  it("starts empty", () => {
    const s = createAnnouncerStore();
    expect(s.getState().polite).toEqual({ text: "", seq: 0 });
    expect(s.getState().assertive).toEqual({ text: "", seq: 0 });
  });

  it("a polite message empties the assertive region and the other way round", () => {
    const s = createAnnouncerStore();
    s.getState().announce("Connected");
    expect(s.getState().polite.text).toBe("Connected");
    s.getState().announce("Disconnected", { assertive: true });
    expect(s.getState().assertive.text).toBe("Disconnected");
    expect(s.getState().polite.text).toBe("");
  });

  it("a repeated text gets a new sequence number, so it is announced again", () => {
    const s = createAnnouncerStore();
    s.getState().announce("Pump 2 moved.");
    const first = s.getState().polite.seq;
    s.getState().announce("Pump 2 moved.");
    expect(s.getState().polite.seq).toBeGreaterThan(first);
  });

  it("clear empties both regions", () => {
    const s = createAnnouncerStore();
    s.getState().announce("x");
    s.getState().clear();
    expect(s.getState().polite.text).toBe("");
  });
});
