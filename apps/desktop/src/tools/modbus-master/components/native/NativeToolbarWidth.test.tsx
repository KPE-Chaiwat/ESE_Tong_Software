// The W2 toolbar label mode across the threshold (REPORT-008 D11). jsdom has no layout, so the
// ResizeObserver is simulated: each entry carries the BORDER box (the window width, which does not
// depend on the toolbar's own padding) and the CONTENT box that the padding of the CHOSEN mode would
// produce (content = border - padding(mode)), fed back after every decision. A real window
// (QA: rest at outer 848-856 physical at 125 %, drag slowly across) is the only proof of the real layout.
import { screen } from "@testing-library/react";
import { toolbarLabelMode, toolbarLayoutFor } from "./native-toolbar.logic";
import {
  disposeNativeHarnesses,
  fireToolbarWidth,
  installPollViewEnvironment,
  renderNativeWindow,
  uninstallPollViewEnvironment,
} from "./test-utils";

beforeAll(installPollViewEnvironment);
afterAll(uninstallPollViewEnvironment);
afterEach(disposeNativeHarnesses);

const toolbar = () => screen.getByRole("toolbar", { name: "Poll window toolbar" });
const mode = () => toolbar().getAttribute("data-label-mode");

/** The side padding (css px, both sides) a mode asks for, read from its real classes. */
function sidePadding(m: "full" | "icon"): number {
  const match = /(?:^|\s)px-(\d+(?:\.\d+)?)(?:\s|$)/.exec(toolbarLayoutFor(m).root);
  if (!match) throw new Error(`no px-* class in ${m}`);
  return 2 * Number(match[1]) * 4;
}

/** One update of the loop: the observer reports the border box and the content box of the CURRENT mode. */
function update(border: number): void {
  const current = mode() === "full" ? "full" : "icon";
  fireToolbarWidth(border, border - sidePadding(current));
}

const widths = (from: number, to: number, step = 0.5) => {
  const out: number[] = [];
  const n = Math.round(Math.abs(to - from) / step);
  for (let i = 0; i <= n; i++) out.push(from + Math.sign(to - from) * i * step);
  return out;
};

beforeEach(async () => {
  await renderNativeWindow();
});

describe("the real padding classes", () => {
  it("both modes use the same side padding, so the decision cannot depend on the mode", () => {
    expect(sidePadding("full")).toBe(sidePadding("icon"));
  });
});

describe("label mode sweep 630-700 css px in 0.5 px steps (border box with content box fed back)", () => {
  function sweep(list: number[]) {
    const seen: { width: number; mode: string | null }[] = [];
    let changes = 0;
    let previous: string | null = null;
    for (const width of list) {
      const loop: (string | null)[] = [];
      for (let i = 0; i < 10; i++) {
        update(width);
        loop.push(mode());
      }
      // (c) settle: after the first updates at a width the mode does not change any more.
      expect(new Set(loop.slice(1)).size, `settles at ${width}`).toBe(1);
      expect(loop[loop.length - 1], `stable at ${width}`).toBe(loop[1]);
      const now = mode();
      if (previous !== null && now !== previous) changes += 1;
      previous = now;
      seen.push({ width, mode: now });
    }
    return { seen, changes };
  }

  it("sweeping up: exactly one change, from icon to full, at border width 640 (not 664-672)", () => {
    const { seen, changes } = sweep(widths(630, 700));
    expect(changes).toBe(1);
    const firstFull = seen.find((s) => s.mode === "full");
    expect(firstFull?.width).toBe(640);
    for (const s of seen) expect(s.mode, `${s.width}`).toBe(s.width >= 640 ? "full" : "icon");
  });

  it("sweeping down: exactly one change, from full to icon, between 640 and 639.5", () => {
    const { seen, changes } = sweep(widths(700, 630));
    expect(changes).toBe(1);
    const firstIcon = seen.find((s) => s.mode === "icon");
    expect(firstIcon?.width).toBe(639.5);
    expect(seen.find((s) => s.width === 640)?.mode).toBe("full");
  });

  it("up and down with no sweep between: nothing is left over from the previous direction", () => {
    const up = sweep(widths(630, 700));
    const down = sweep(widths(700, 630));
    expect(up.changes + down.changes).toBe(2);
    expect(mode()).toBe("icon");
  });

  it("at rest in the old flicker band (664-672) the mode stays full over 60 updates", () => {
    for (const width of widths(660, 676, 0.4)) {
      for (let i = 0; i < 60; i++) update(width);
      expect(mode(), `${width}`).toBe("full");
    }
  });

  it("the content box alone is ignored: a wrong content width does not change the decision", () => {
    fireToolbarWidth(700, 100);
    expect(mode()).toBe("full");
    fireToolbarWidth(600, 900);
    expect(mode()).toBe("icon");
  });
});

describe("why the content box could not be used (control of the test itself)", () => {
  // The old model: the decision read the content box, and the padding was 32 px in full, 24 px in icon.
  const OLD_PADDING = { full: 32, icon: 24 } as const;
  const oldNext = (border: number, current: "full" | "icon") =>
    toolbarLabelMode(border - OLD_PADDING[current]);

  it("the old content-box model never settles at 664-672 and moves the threshold; the settle check would catch it", () => {
    let flips = 0;
    let current: "full" | "icon" = "icon";
    for (let i = 0; i < 10; i++) {
      const next = oldNext(668, current);
      if (next !== current) flips += 1;
      current = next;
    }
    expect(flips).toBe(10);
    // 650 css is wider than the 640 limit and the old model still said icon.
    expect(oldNext(650, "icon")).toBe("icon");
  });
});
