import { scrollWithin } from "./scroll-within";

/** Reveal the format control without scrolling the poll frame or the document. */
export function focusInterpretationFormat(pollView: Element | null) {
  const format = pollView?.querySelector<HTMLSelectElement>("[data-interpretation-format]");
  const setup = format?.closest<HTMLElement>(
    '[data-slot="setup-dock"], [data-slot="setup-panel"], [data-slot="setup-popover"]',
  );
  if (!format || !setup) return;

  scrollWithin(setup, format);
  format.focus({ preventScroll: true });
}
