// The width an element measurement reports (REPORT-008 D11). Pure, so it is unit-tested without layout.

/**
 * The BORDER-BOX width of the observed element of a `ResizeObserver` entry: `borderBoxSize[0].inlineSize`
 * (an array in Chromium and current engines, a single object in old Firefox), else the element's
 * `getBoundingClientRect().width`. Never `contentRect`: that is the content box, so a decision that
 * changes the padding of the element it measures (the W2 toolbar: `px-4` in one label mode, `px-3` in
 * the other) would feed its own padding back into its input, flip on every frame in a band of widths
 * and move its threshold by the padding (D11: 640 became 664-672 css px). The border box of a block
 * does not depend on its own padding, so the decision cannot depend on the mode it controls.
 * 0 when nothing can be measured (no layout).
 */
export function entryBorderWidth(entry: ResizeObserverEntry): number {
  const sizes = entry.borderBoxSize as
    | ReadonlyArray<ResizeObserverSize>
    | ResizeObserverSize
    | undefined;
  const first = Array.isArray(sizes) ? sizes[0] : (sizes as ResizeObserverSize | undefined);
  if (first && typeof first.inlineSize === "number" && first.inlineSize > 0) {
    return first.inlineSize;
  }
  const rect = entry.target?.getBoundingClientRect?.();
  return rect && rect.width > 0 ? rect.width : 0;
}
