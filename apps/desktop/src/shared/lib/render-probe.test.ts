import { createRenderProbe } from "./render-probe";

describe("render probe", () => {
  it("counts commits per key, lists them and resets", () => {
    const probe = createRenderProbe(true);
    probe.record("poll-view:1");
    probe.record("poll-view:1");
    probe.record("poll-view:2");
    expect(probe.get("poll-view:1")).toBe(2);
    expect(probe.get("poll-view:3")).toBe(0);
    expect(probe.all()).toEqual({ "poll-view:1": 2, "poll-view:2": 1 });
    probe.reset();
    expect(probe.all()).toEqual({});
  });

  it("is inert when disabled (a production build)", () => {
    const probe = createRenderProbe(false);
    probe.record("poll-view:1");
    expect(probe.enabled).toBe(false);
    expect(probe.get("poll-view:1")).toBe(0);
    expect(probe.all()).toEqual({});
  });
});
