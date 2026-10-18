import { NARROW_WIDTH, SQUEEZE_WEIGHT, toolbarSqueezeFor } from "./toolbar.logic";

describe("toolbarSqueezeFor (REPORT-008 D12)", () => {
  it("narrow from below 1100 css px", () => {
    expect(NARROW_WIDTH).toBe(1100);
  });

  it.each([
    [960, true],
    [1000, true],
    [1099.9, true],
    [1100, false],
    [1300, false],
  ] as const)("at %s css px narrow is %s", (width, narrow) => {
    const s = toolbarSqueezeFor(width);
    expect(s.narrow).toBe(narrow);
    expect(s.showProfile).toBe(!narrow);
    expect(s.shortChip).toBe(narrow);
  });

  it.each([960, 1000, 1100, 1300])(
    "at %s css px the row is one fixed 56 px row that does not wrap",
    (w) => {
      const s = toolbarSqueezeFor(w);
      expect(s.root).toContain("h-14");
      expect(s.root).toContain("shrink-0");
      expect(s.root).not.toContain("wrap");
      expect(s.root).not.toMatch(/(^|\s)(min-h|max-h)-/);
    },
  );

  it("the gaps and the padding get smaller below 1100", () => {
    expect(toolbarSqueezeFor(960).root).toMatch(/gap-1\.5.* px-3(\s|$)/);
    expect(toolbarSqueezeFor(1099).root).toContain("gap-1.5");
    expect(toolbarSqueezeFor(1100).root).toMatch(/gap-2.* px-3\.5/);
    expect(toolbarSqueezeFor(960).actions).toContain("gap-1.5");
    expect(toolbarSqueezeFor(1300).actions).toContain("gap-2");
  });

  it("the weights order the squeeze: profile, then chip, then pill; the actions never shrink", () => {
    expect(SQUEEZE_WEIGHT.profile).toBeGreaterThan(SQUEEZE_WEIGHT.chip);
    expect(SQUEEZE_WEIGHT.chip).toBeGreaterThan(SQUEEZE_WEIGHT.pill);
    for (const w of [960, 1000, 1100, 1300]) {
      const s = toolbarSqueezeFor(w);
      expect(s.profile).toContain(`shrink-[${SQUEEZE_WEIGHT.profile}]`);
      expect(s.chip).toContain(`shrink-[${SQUEEZE_WEIGHT.chip}]`);
      expect(s.pill).toMatch(/(^|\s)shrink(\s|$)/);
      for (const part of [s.profile, s.chip, s.pill]) expect(part).toContain("min-w-0");
      expect(s.actions).toContain("shrink-0");
      expect(s.actions).not.toMatch(/(^|\s)min-w-0/);
    }
  });
});
