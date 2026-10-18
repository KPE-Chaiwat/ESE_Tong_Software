import { entryBorderWidth } from "./border-width";

function entry(parts: {
  borderBoxSize?: unknown;
  contentRect?: { width: number };
  rectWidth?: number;
}): ResizeObserverEntry {
  const target = {
    getBoundingClientRect: () => ({ width: parts.rectWidth ?? 0 }),
  } as unknown as Element;
  return {
    target,
    borderBoxSize: parts.borderBoxSize,
    contentRect: parts.contentRect ?? { width: 0 },
  } as unknown as ResizeObserverEntry;
}

describe("entryBorderWidth (REPORT-008 D11)", () => {
  it("reads borderBoxSize[0].inlineSize, never contentRect", () => {
    const e = entry({
      borderBoxSize: [{ inlineSize: 666.4, blockSize: 40 }],
      contentRect: { width: 642.4 },
      rectWidth: 100,
    });
    expect(entryBorderWidth(e)).toBe(666.4);
  });

  it("accepts the single-object borderBoxSize of an old engine", () => {
    expect(entryBorderWidth(entry({ borderBoxSize: { inlineSize: 700, blockSize: 1 } }))).toBe(700);
  });

  it.each([
    ["no borderBoxSize", undefined],
    ["an empty borderBoxSize", []],
    ["a zero inlineSize", [{ inlineSize: 0, blockSize: 0 }]],
  ])("falls back to getBoundingClientRect().width with %s", (_name, borderBoxSize) => {
    const e = entry({ borderBoxSize, contentRect: { width: 600 }, rectWidth: 640.8 });
    expect(entryBorderWidth(e)).toBe(640.8);
  });

  it("is 0 when nothing can be measured (no layout); the content box is never used", () => {
    expect(entryBorderWidth(entry({ contentRect: { width: 600 } }))).toBe(0);
  });
});
