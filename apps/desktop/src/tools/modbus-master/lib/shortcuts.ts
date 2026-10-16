// Window-scoped keyboard shortcuts (DES-001 5.1) as pure functions, so they are testable without a DOM.

export interface Combo {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

/** Parses `ctrl+shift+s`, `ctrl+\`, `f5`. Keys are lowercase. */
export function parseCombo(combo: string): Combo {
  const parts = combo.toLowerCase().split("+");
  const key = parts.at(-1) ?? "";
  return {
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
    key,
  };
}

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function matchesCombo(e: KeyEventLike, combo: Combo): boolean {
  return (
    (e.ctrlKey || e.metaKey) === combo.ctrl &&
    e.shiftKey === combo.shift &&
    e.altKey === combo.alt &&
    e.key.toLowerCase() === combo.key
  );
}

/** Browser defaults that conflict with the tool and are always suppressed (DES-001 5.1). */
export const SUPPRESSED_DEFAULTS: readonly string[] = [
  "ctrl+p",
  "ctrl+o",
  "ctrl+s",
  "ctrl+shift+s",
  "ctrl+n",
  "ctrl+r",
  "ctrl+shift+r",
  "f5",
  "ctrl+f5",
];

export interface Binding {
  combo: string;
  run: () => void;
  /** When it returns false the shortcut does nothing (but its browser default stays suppressed). */
  when?: () => boolean;
}

interface Compiled extends Binding {
  parsed: Combo;
}

export interface ShortcutHandler {
  /** Returns true when the event was a shortcut or a suppressed browser default. */
  handle(e: KeyEventLike & { preventDefault(): void }): boolean;
}

/**
 * Builds the keydown handler of one window. While a modal is open the actions do not run (the
 * modal has its own keys), but the browser defaults stay suppressed.
 */
export function createShortcutHandler(
  bindings: readonly Binding[],
  isModalOpen: () => boolean,
): ShortcutHandler {
  const compiled: Compiled[] = bindings.map((b) => ({ ...b, parsed: parseCombo(b.combo) }));
  const suppressed = SUPPRESSED_DEFAULTS.map(parseCombo);

  return {
    handle(e) {
      const binding = compiled.find((b) => matchesCombo(e, b.parsed));
      if (binding) {
        e.preventDefault();
        if (!isModalOpen() && (binding.when?.() ?? true)) binding.run();
        return true;
      }
      if (suppressed.some((c) => matchesCombo(e, c))) {
        e.preventDefault();
        return true;
      }
      return false;
    },
  };
}
