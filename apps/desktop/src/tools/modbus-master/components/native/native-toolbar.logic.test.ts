import {
  snapToolbarWidth,
  TOOLBAR_ICON_ONLY_BELOW,
  toolbarLabelMode,
  toolbarLayoutFor,
} from "./native-toolbar.logic";

describe("toolbarLabelMode (DES-002 2.6 Squeeze at the minimum, D-002-36)", () => {
  it("the threshold is 640 css px", () => {
    expect(TOOLBAR_ICON_ONLY_BELOW).toBe(640);
  });

  // The widths named by the task: the native minimum at 125 % is 465.6.
  it.each([
    [900, "full"],
    [700, "full"],
    [640, "full"],
    [639.9, "icon"],
    [560, "icon"],
    [520, "icon"],
    [466, "icon"],
    [465.6, "icon"],
    [0, "icon"],
  ] as const)("%s css px -> %s", (width, mode) => {
    expect(toolbarLabelMode(width)).toBe(mode);
  });

  it("the snapped width tells the same mode as the exact width, everywhere", () => {
    for (let w = 400; w <= 1000; w += 0.1) {
      expect(toolbarLabelMode(snapToolbarWidth(w))).toBe(toolbarLabelMode(w));
    }
    expect(snapToolbarWidth(639.9)).toBe(0);
    expect(snapToolbarWidth(640)).toBe(640);
    expect(snapToolbarWidth(900)).toBe(640);
  });
});

describe("toolbarLayoutFor: classes per mode", () => {
  it("full keeps the 60 px minimum height and the 12 px gaps", () => {
    const l = toolbarLayoutFor("full");
    expect(l.root).toContain("min-h-[60px]");
    expect(l.root).toContain("flex-wrap");
    expect(l.root).toContain("gap-x-3");
    expect(l.name).toBe("max-w-64");
  });

  it("icon has no minimum height, tighter padding and gaps, and still wraps", () => {
    const l = toolbarLayoutFor("icon");
    expect(l.root).not.toContain("min-h-");
    expect(l.root).toContain("flex-wrap");
    expect(l.root).toContain("py-1");
    expect(l.root).toContain("gap-x-2");
    expect(l.name).toBe("max-w-48");
  });

  it("both modes: the groups do not wrap inside", () => {
    for (const mode of ["full", "icon"] as const) {
      expect(toolbarLayoutFor(mode).group).not.toContain("wrap");
    }
  });
});
