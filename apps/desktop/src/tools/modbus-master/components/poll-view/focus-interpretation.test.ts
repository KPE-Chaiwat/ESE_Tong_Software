import { focusInterpretationFormat } from "./focus-interpretation";
import { scrollWithin } from "./scroll-within";

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom } as DOMRect;
}

it.each([
  ["setup-panel", 500, 600, 160],
  ["setup-dock", 80, 100, -20],
  ["setup-popover", 450, 500, 60],
] as const)("scrolls only %s to reveal the format control", (slot, top, bottom, amount) => {
  const outer = document.createElement("div");
  outer.dataset.slot = "poll-view";
  outer.scrollTop = 42;
  const setup = document.createElement("aside");
  setup.dataset.slot = slot;
  setup.scrollTop = 120;
  setup.getBoundingClientRect = () => rect(100, 440);
  const select = document.createElement("select");
  select.dataset.interpretationFormat = "";
  select.getBoundingClientRect = () => rect(top, bottom);
  const focus = vi.spyOn(select, "focus");
  setup.append(select);
  outer.append(setup);
  document.body.append(outer);
  const documentScroll = document.documentElement.scrollTop;

  try {
    focusInterpretationFormat(outer);
    expect(setup.scrollTop).toBe(120 + amount);
    expect(outer.scrollTop).toBe(42);
    expect(document.documentElement.scrollTop).toBe(documentScroll);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  } finally {
    outer.remove();
  }
});

it("reveals a combined row inside its grid without moving the poll frame", () => {
  const frame = document.createElement("section");
  frame.scrollTop = 50;
  const grid = document.createElement("div");
  grid.scrollTop = 20;
  grid.scrollLeft = 10;
  grid.getBoundingClientRect = () => ({ top: 100, bottom: 300, left: 100, right: 300 }) as DOMRect;
  const row = document.createElement("div");
  row.getBoundingClientRect = () => ({ top: 350, bottom: 374, left: 340, right: 440 }) as DOMRect;
  grid.append(row);
  frame.append(grid);
  document.body.append(frame);
  const documentScroll = document.documentElement.scrollTop;

  try {
    scrollWithin(grid, row);
    expect(grid.scrollTop).toBe(94);
    expect(grid.scrollLeft).toBe(150);
    expect(frame.scrollTop).toBe(50);
    expect(document.documentElement.scrollTop).toBe(documentScroll);
  } finally {
    frame.remove();
  }
});
