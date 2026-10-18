// Window-scoped keyboard shortcuts (DES-001 5.1) as pure functions, so they are testable without a DOM.
import {
  comboKeyOf,
  isNativeTextEdit,
  type KeyEventFields,
  shortcutKeyOf,
} from "@/shared/lib/shortcut-key";

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

export interface KeyEventLike extends KeyEventFields {
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
    comboKeyOf(e) === combo.key
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
  // DES-002 3.1: the workspace shortcuts that browsers use for something else.
  "ctrl+shift+t",
  "ctrl+shift+c",
  "ctrl+shift+o",
  "ctrl+shift+a",
  "ctrl+shift+d",
  "ctrl+f4",
  "ctrl+f6",
  "ctrl+shift+f6",
  "alt+arrowleft",
  "alt+arrowright",
  // The keys of the tool that browsers use too: search, bookmarks, tab switching, downloads,
  // the address bar and private windows. They stay suppressed even where the tool does nothing.
  "ctrl+e",
  "ctrl+b",
  "ctrl+j",
  "ctrl+l",
  "ctrl+1",
  "ctrl+2",
  "ctrl+3",
  "ctrl+4",
  "ctrl+shift+n",
  "ctrl+shift+p",
  "ctrl+shift+k",
  "ctrl+shift+m",
  "ctrl+shift+e",
];

export interface Binding {
  combo: string;
  run: () => void;
  /**
   * When it returns false the shortcut does nothing. Its browser default stays suppressed only for
   * the combos of `SUPPRESSED_DEFAULTS`; any other key goes on to the focused control (for example
   * `Ctrl+Shift+V` pastes plain text into a field).
   */
  when?: () => boolean;
}

interface Compiled extends Binding {
  parsed: Combo;
}

export interface ShortcutHandler {
  /** Returns true when the event was a shortcut or a suppressed browser default. */
  handle(e: KeyEventLike & { preventDefault(): void; target?: EventTarget | null }): boolean;
}

function isTextEdit(e: KeyEventLike & { target?: EventTarget | null }): boolean {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  return isNativeTextEdit(
    {
      tagName: t.tagName,
      isContentEditable: t.isContentEditable === true,
      type: (t as HTMLInputElement).type,
    },
    shortcutKeyOf(e),
    { ctrlKey: e.ctrlKey || e.metaKey, shiftKey: e.shiftKey },
  );
}

/**
 * Builds the keydown handler of one window. While a modal is open the actions do not run (the
 * modal has its own keys), the browser defaults stay suppressed and every other key is left alone.
 */
export function createShortcutHandler(
  bindings: readonly Binding[],
  isModalOpen: () => boolean,
): ShortcutHandler {
  const compiled: Compiled[] = bindings.map((b) => ({ ...b, parsed: parseCombo(b.combo) }));
  const suppressed = SUPPRESSED_DEFAULTS.map(parseCombo);

  return {
    handle(e) {
      // Native editing keys of a text field (Ctrl+C, V, X, A, Z, Y, Ctrl+Shift+Z) are the browser's,
      // on every layout: no handler, no preventDefault (DES-002 3.1).
      if (isTextEdit(e)) return false;
      const binding = compiled.find((b) => matchesCombo(e, b.parsed));
      if (binding) {
        if (isModalOpen()) {
          // The browser defaults stay suppressed, but any other key (Ctrl+Shift+V pastes plain
          // text into a field of the dialog) goes on to the focused control (REV-007 m-2).
          if (suppressed.some((c) => matchesCombo(e, c))) {
            e.preventDefault();
            return true;
          }
          return false;
        }
        if (binding.when?.() ?? true) {
          e.preventDefault();
          binding.run();
          return true;
        }
        if (suppressed.some((c) => matchesCombo(e, c))) {
          e.preventDefault();
          return true;
        }
        return false;
      }
      if (suppressed.some((c) => matchesCombo(e, c))) {
        e.preventDefault();
        return true;
      }
      return false;
    },
  };
}
