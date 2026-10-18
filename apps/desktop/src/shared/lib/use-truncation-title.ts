import { type RefObject, useLayoutEffect } from "react";

/**
 * Sets `title` of the element to `fullText` while the text is cut (`scrollWidth > clientWidth`, an
 * ellipsis is showing) and removes it otherwise, so a tooltip only appears when it adds something.
 * The attribute is written to the DOM and re-checked when `fullText` changes (DES-002 2.2.6).
 */
export function useTruncationTitle(ref: RefObject<HTMLElement | null>, fullText: string): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollWidth > el.clientWidth) el.setAttribute("title", fullText);
    else el.removeAttribute("title");
  }, [ref, fullText]);
}
