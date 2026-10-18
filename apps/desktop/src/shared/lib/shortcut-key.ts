// The one place that turns a keydown into the key a shortcut is defined by (DES-002 3.1, "Shortcuts
// on every keyboard layout"; REPORT-007 D8). Pure: the callers pass what the event says.
//
// `KeyboardEvent.key` follows the active layout, so on a Thai, Cyrillic, Greek, Arabic or Hebrew
// layout hardware Ctrl+P arrives as `key = "ย"`, `code = "KeyP"`. `code` is the physical key. The
// rules, in order:
// - IME composition (`isComposing`, `key` "Process"), "Dead" and "Unidentified": no key.
// - `code` Digit0..Digit9 gives that digit on every layout (AZERTY types "&" there without Shift);
//   `key` "0".."9" gives the digit too (numeric keypad).
// - `key` is one ASCII letter: that letter, lowercased (Latin layouts keep their own letters, so
//   a Dvorak "p" is Ctrl+P wherever it sits).
// - `key` is one character that is not ASCII and not Latin script (Thai, Cyrillic, ...) and `code`
//   is KeyA..KeyZ: the letter of `code`.
// - Any other single character (ASCII punctuation, "ü", "é"): no letter or digit shortcut.
// - A named key (`F6`, `ArrowRight`): `key` itself.
// - A letter or digit never comes from AltGr (`altGraph`, or Ctrl+Alt on Windows).

export interface ShortcutKeyInput {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  /** `event.getModifierState("AltGraph")`. */
  altGraph: boolean;
}

const LATIN = /^\p{Script=Latin}$/u;
const isOneChar = (key: string) => [...key].length === 1;
const isAscii = (key: string) => key.charCodeAt(0) < 0x80;

function inert(e: ShortcutKeyInput): boolean {
  return e.isComposing || e.key === "Process" || e.key === "Dead" || e.key === "Unidentified";
}

const isAltGr = (e: ShortcutKeyInput) => e.altGraph || (e.ctrlKey && e.altKey);

/** The normalized key of the event for a letter, digit or named-key shortcut, or null. */
export function shortcutKey(e: ShortcutKeyInput): string | null {
  if (inert(e)) return null;
  const digit = /^Digit([0-9])$/.exec(e.code);
  if (digit) return isAltGr(e) ? null : (digit[1] as string);
  if (!isOneChar(e.key)) return e.key;
  if (/^[0-9]$/.test(e.key)) return isAltGr(e) ? null : e.key;
  if (/^[A-Za-z]$/.test(e.key)) return isAltGr(e) ? null : e.key.toLowerCase();
  if (!isAscii(e.key) && !LATIN.test(e.key)) {
    const letter = /^Key([A-Z])$/.exec(e.code);
    if (letter) return isAltGr(e) ? null : (letter[1] as string).toLowerCase();
  }
  return null;
}

/**
 * The key of a punctuation shortcut (`Ctrl+\`, `Ctrl+Shift+\`, `Ctrl+Shift+|`), DES-002 3.1 "Backslash
 * shortcuts" (D-002-38, REPORT-008 D8b, closes Q-002-19). Null otherwise. Rules, in this order:
 * 1. IME composition (`isComposing`, `key` "Process"), "Dead", "Unidentified": null.
 * 2. AltGr (`altGraph`, or Ctrl and Alt both held): null, on every `code`. German types `\` with
 *    AltGr+ss and AZERTY with AltGr+8; that must keep typing the character.
 * 3. `code` "Backslash": "\\" without Shift, "|" with Shift, WHATEVER `key` is. Thai Ctrl+\ arrives as
 *    "+" and Ctrl+Shift+\ as "ฅ"; German "#", AZERTY "*" or "µ", Russian "/" and "ё" all match. The
 *    rule comes before every letter rule (`comboKeyOf` asks it first): no common layout puts an
 *    ASCII letter on that key. Trade-off: a layout with a letter there (Spanish "ç") also matches.
 * 4. `key` "\\" or "|" on another key (the layout's own backslash typed without AltGr, for example UK
 *    `IntlBackslash`): that mark.
 * 5. Any other ASCII mark: the mark (unchanged from revision 11). ASCII letters and digits and every
 *    other character: null.
 */
export function punctuationKey(e: ShortcutKeyInput): string | null {
  if (inert(e) || isAltGr(e)) return null;
  if (e.code === "Backslash") return e.shiftKey ? "|" : "\\";
  if (!isOneChar(e.key)) return null;
  if (e.key === "\\" || e.key === "|") return e.key;
  if (isAscii(e.key)) return /^[A-Za-z0-9]$/.test(e.key) ? null : e.key;
  return null;
}

/** What `keydown` events (DOM or React) provide; every field is optional so tests can be short. */
export interface KeyEventFields {
  key: string;
  code?: string | undefined;
  ctrlKey?: boolean | undefined;
  altKey?: boolean | undefined;
  shiftKey?: boolean | undefined;
  metaKey?: boolean | undefined;
  isComposing?: boolean | undefined;
  nativeEvent?: { isComposing?: boolean | undefined } | undefined;
  /** DOM and React events both have it (React types the name as a `ModifierKey`). */
  getModifierState?: ((name: never) => boolean) | undefined;
}

/** Reads the input of `shortcutKey` from an event. */
export function keyInputOf(e: KeyEventFields): ShortcutKeyInput {
  return {
    key: e.key,
    code: e.code ?? "",
    ctrlKey: e.ctrlKey === true,
    altKey: e.altKey === true,
    shiftKey: e.shiftKey === true,
    metaKey: e.metaKey === true,
    isComposing: e.isComposing === true || e.nativeEvent?.isComposing === true,
    altGraph:
      (e as unknown as { getModifierState?: (name: string) => boolean }).getModifierState?.(
        "AltGraph",
      ) === true,
  };
}

/** `shortcutKey` of an event. */
export const shortcutKeyOf = (e: KeyEventFields): string | null => shortcutKey(keyInputOf(e));

/** The key a combo (`ctrl+p`, `ctrl+\`, `f6`) is matched with, lowercase; null when there is none. */
export function comboKeyOf(e: KeyEventFields): string | null {
  const input = keyInputOf(e);
  // The physical Backslash key is decided before the letter rules (DES-002 3.1).
  const key =
    input.code === "Backslash"
      ? (punctuationKey(input) ?? shortcutKey(input))
      : (shortcutKey(input) ?? punctuationKey(input));
  return key === null ? null : key.toLowerCase();
}

const TEXT_INPUT_TYPES = new Set([
  "",
  "text",
  "number",
  "search",
  "email",
  "url",
  "tel",
  "password",
]);

/**
 * True when the event is a native editing key (Ctrl+C, V, X, A, Z, Y or Ctrl+Shift+Z) and the target
 * is a text input, a textarea or a contenteditable: the shortcut layer then does nothing and does not
 * `preventDefault`, so the browser copies, pastes, cuts, selects all, undoes and redoes (DES-002 3.1).
 */
export function isNativeTextEdit(
  target: { tagName: string; isContentEditable: boolean; type?: string },
  k: string | null,
  e: { ctrlKey: boolean; shiftKey: boolean },
): boolean {
  if (!e.ctrlKey || k === null) return false;
  const tag = target.tagName.toUpperCase();
  const textual =
    target.isContentEditable ||
    tag === "TEXTAREA" ||
    (tag === "INPUT" && TEXT_INPUT_TYPES.has((target.type ?? "").toLowerCase()));
  if (!textual) return false;
  const key = k.toLowerCase();
  if (e.shiftKey) return key === "z";
  return key === "c" || key === "v" || key === "x" || key === "a" || key === "z" || key === "y";
}
