import { useEffect } from "react";

/** The regions F6 cycles through in the connection window, in focus order (DES-002 9). */
export const REGION_ORDER = ["toolbar", "sidebar", "workspace", "minimized", "traffic"] as const;

/** The regions of a native poll window: toolbar, banner, setup, data card (DES-002 3.1, 9). */
export const NATIVE_REGION_ORDER = ["toolbar", "banner", "setup", "data"] as const;

/** The next region after `current` in `present`, wrapping; `dir` -1 goes backwards. */
export function nextRegion(
  present: readonly string[],
  current: string | null,
  dir: 1 | -1,
): string | null {
  if (present.length === 0) return null;
  const index = current === null ? -1 : present.indexOf(current);
  if (index === -1) return (dir === 1 ? present[0] : present[present.length - 1]) ?? null;
  return present[(index + dir + present.length) % present.length] ?? null;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [role="grid"], [role="option"][tabindex="0"], [tabindex="0"]';

function visible(el: HTMLElement): boolean {
  return !el.closest("[hidden]");
}

/** Moves the focus into a region: the active sub-window for the workspace, the grid for the data card, else its first control. */
export function focusRegion(name: string): boolean {
  const region = document.querySelector<HTMLElement>(`[data-region="${name}"]`);
  if (!region || !visible(region)) return false;
  const scope =
    name === "workspace"
      ? (region.querySelector<HTMLElement>('[data-subwindow][data-active="true"]') ?? region)
      : region;
  const target =
    name === "data"
      ? (scope.querySelector<HTMLElement>('[role="grid"]') ?? scope)
      : name === "workspace"
        ? (scope.querySelector<HTMLElement>('[role="grid"]') ??
          scope.querySelector<HTMLElement>('[data-slot="title-bar"]') ??
          region)
        : (Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).find(visible) ?? scope);
  if (target === region && !region.hasAttribute("tabindex")) return false;
  target.focus();
  return true;
}

/** F6 and Shift+F6 cycle the regions of the window (`order`), skipping the ones that are not there. */
export function useRegionCycle(order: readonly string[] = REGION_ORDER): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "F6" || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      const present = order.filter((name) => {
        const el = document.querySelector<HTMLElement>(`[data-region="${name}"]`);
        return el !== null && visible(el);
      });
      // The nearest region of this window's cycle (the poll list is inside the sidebar region).
      const selector = order.map((name) => `[data-region="${name}"]`).join(",");
      const current =
        document.activeElement instanceof HTMLElement
          ? (document.activeElement.closest<HTMLElement>(selector)?.dataset.region ?? null)
          : null;
      const dir = e.shiftKey ? -1 : 1;
      // A region without a focusable control is skipped.
      let name = nextRegion(present, current, dir);
      for (let i = 0; name !== null && i < present.length; i += 1) {
        if (focusRegion(name)) return;
        name = nextRegion(present, name, dir);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [order]);
}
