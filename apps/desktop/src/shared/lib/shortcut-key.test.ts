import {
  comboKeyOf,
  isNativeTextEdit,
  keyInputOf,
  punctuationKey,
  type ShortcutKeyInput,
  shortcutKey,
  shortcutKeyOf,
} from "./shortcut-key";

type Mods = "ctrl" | "shift" | "alt" | "meta" | "composing" | "altGraph";

function input(key: string, code: string, ...mods: Mods[]): ShortcutKeyInput {
  return {
    key,
    code,
    ctrlKey: mods.includes("ctrl"),
    shiftKey: mods.includes("shift"),
    altKey: mods.includes("alt"),
    metaKey: mods.includes("meta"),
    isComposing: mods.includes("composing"),
    altGraph: mods.includes("altGraph"),
  };
}

describe("shortcutKey: the vectors of CHK2-R12", () => {
  const rows: ReadonlyArray<readonly [string, string, string, Mods[], string | null]> = [
    ["US p", "p", "KeyP", ["ctrl"], "p"],
    ["Thai", "ย", "KeyP", ["ctrl"], "p"],
    ["Russian", "з", "KeyP", ["ctrl"], "p"],
    ["Greek", "π", "KeyP", ["ctrl"], "p"],
    ["Hebrew", "פ", "KeyP", ["ctrl"], "p"],
    ["Arabic", "ح", "KeyP", ["ctrl"], "p"],
    ["Dvorak l on KeyP is Ctrl+L", "l", "KeyP", ["ctrl"], "l"],
    ["Dvorak p on KeyR", "p", "KeyR", ["ctrl"], "p"],
    ["Dvorak . on KeyE is nothing", ".", "KeyE", ["ctrl"], null],
    ["AZERTY & on Digit1", "&", "Digit1", ["ctrl"], "1"],
    ["AZERTY ' on Digit4", "'", "Digit4", ["ctrl"], "4"],
    ["numeric keypad 3", "3", "Numpad3", ["ctrl"], "3"],
    ["AltGr as Ctrl+Alt", "p", "KeyP", ["ctrl", "alt"], null],
    ["AltGraph modifier state", "p", "KeyP", ["ctrl", "altGraph"], null],
    ["IME key Process", "Process", "KeyP", ["ctrl"], null],
    ["Thai letter with Shift", "ฯ", "KeyN", ["ctrl", "shift"], "n"],
    ["Thai combining mark U+0E4C", "์", "KeyN", ["ctrl", "shift"], "n"],
    ["German ü on BracketLeft", "ü", "BracketLeft", ["ctrl"], null],
    ["F6", "F6", "F6", [], "F6"],
  ];
  it.each(rows)("%s", (_name, key, code, mods, expected) => {
    expect(shortcutKey(input(key, code, ...mods))).toBe(expected);
  });
});

describe("shortcutKey: more vectors", () => {
  it("a shifted Latin letter is lowercased", () => {
    expect(shortcutKey(input("P", "KeyP", "ctrl", "shift"))).toBe("p");
  });

  it("a dead key and an unidentified key are nothing", () => {
    expect(shortcutKey(input("Dead", "KeyP", "ctrl"))).toBeNull();
    expect(shortcutKey(input("Unidentified", "KeyP", "ctrl"))).toBeNull();
  });

  it("an IME that is composing is nothing", () => {
    expect(shortcutKey(input("p", "KeyP", "ctrl", "composing"))).toBeNull();
    expect(shortcutKey(input("ย", "KeyP", "ctrl", "composing"))).toBeNull();
  });

  it("named keys keep Ctrl+Alt (Ctrl+Alt+Arrow resizes a sub-window)", () => {
    expect(shortcutKey(input("ArrowRight", "ArrowRight", "ctrl", "alt"))).toBe("ArrowRight");
    expect(shortcutKey(input("F4", "F4", "ctrl"))).toBe("F4");
    expect(shortcutKey(input("Enter", "Enter"))).toBe("Enter");
    expect(shortcutKey(input("Escape", "Escape"))).toBe("Escape");
  });

  it("AltGr never gives a letter or a digit", () => {
    expect(shortcutKey(input("&", "Digit1", "ctrl", "alt"))).toBeNull();
    expect(shortcutKey(input("1", "Digit1", "altGraph"))).toBeNull();
    expect(shortcutKey(input("ł", "KeyL", "ctrl", "alt"))).toBeNull();
    expect(shortcutKey(input("ย", "KeyP", "ctrl", "alt"))).toBeNull();
    expect(shortcutKey(input("3", "Numpad3", "ctrl", "alt"))).toBeNull();
  });

  it("every KeyA..KeyZ and Digit0..Digit9 of a non-Latin layout", () => {
    for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      expect(shortcutKey(input("ก", `Key${c}`, "ctrl"))).toBe(c.toLowerCase());
    }
    for (const d of "0123456789") expect(shortcutKey(input("ๅ", `Digit${d}`, "ctrl"))).toBe(d);
  });

  it("the digit row gives the digit on every layout, shifted or not", () => {
    expect(shortcutKey(input("1", "Digit1", "ctrl"))).toBe("1");
    expect(shortcutKey(input("!", "Digit1", "ctrl", "shift"))).toBe("1");
    expect(shortcutKey(input("é", "Digit2", "ctrl"))).toBe("2");
    expect(shortcutKey(input('"', "Digit3", "ctrl"))).toBe("3");
    expect(shortcutKey(input("(", "Digit5", "ctrl"))).toBe("5");
  });

  it("Latin layouts keep the letter they produce", () => {
    expect(shortcutKey(input("a", "KeyQ", "ctrl"))).toBe("a");
    expect(shortcutKey(input("z", "KeyY", "ctrl"))).toBe("z");
    expect(shortcutKey(input("j", "KeyC", "ctrl"))).toBe("j");
  });

  it("a Latin letter with a diacritic is nothing, wherever it sits", () => {
    expect(shortcutKey(input("ı", "KeyI", "ctrl"))).toBeNull();
    expect(shortcutKey(input("ł", "KeyL", "ctrl"))).toBeNull();
    expect(shortcutKey(input("é", "Quote", "ctrl"))).toBeNull();
  });

  it("ASCII punctuation is no letter shortcut; Dvorak punctuation never becomes a second shortcut", () => {
    expect(shortcutKey(input(",", "KeyW", "ctrl"))).toBeNull();
    expect(shortcutKey(input(";", "KeyZ", "ctrl"))).toBeNull();
    expect(shortcutKey(input("\\", "Backslash", "ctrl"))).toBeNull();
  });

  it("a non-Latin character on a key that is not a letter is nothing", () => {
    expect(shortcutKey(input("ฃ", "Backslash", "ctrl"))).toBeNull();
    expect(shortcutKey(input("ก", "Space", "ctrl"))).toBeNull();
    expect(shortcutKey(input("ก", "", "ctrl"))).toBeNull();
  });
});

describe("punctuationKey (Backslash shortcuts, DES-002 3.1, D-002-38, REPORT-008 D8b)", () => {
  // [layout, key, code, modifiers, expected]: the 18 backslash vectors of CHK2-R12.
  const rows: ReadonlyArray<readonly [string, string, string, Mods[], string | null]> = [
    ["US Ctrl+\\", "\\", "Backslash", ["ctrl"], "\\"],
    ["US Ctrl+Shift+\\", "|", "Backslash", ["ctrl", "shift"], "|"],
    ["Thai Ctrl+ arrives as +", "+", "Backslash", ["ctrl"], "\\"],
    ["Thai Ctrl+ (the character without Ctrl)", "ฃ", "Backslash", ["ctrl"], "\\"],
    ["Thai Ctrl+Shift+ arrives as ฅ", "ฅ", "Backslash", ["ctrl", "shift"], "|"],
    ["German Ctrl+# (physical Backslash)", "#", "Backslash", ["ctrl"], "\\"],
    ["German Ctrl+Shift+'", "'", "Backslash", ["ctrl", "shift"], "|"],
    ["German AltGr+ss as Ctrl+Alt", "\\", "Minus", ["ctrl", "alt"], null],
    ["German AltGr+ss as the AltGraph state", "\\", "Minus", ["ctrl", "altGraph"], null],
    ["AZERTY Ctrl+*", "*", "Backslash", ["ctrl"], "\\"],
    ["AZERTY Ctrl+Shift+µ", "µ", "Backslash", ["ctrl", "shift"], "|"],
    ["AZERTY AltGr+8", "\\", "Digit8", ["ctrl", "alt"], null],
    ["Russian Ctrl+\\", "\\", "Backslash", ["ctrl"], "\\"],
    ["Russian Ctrl+Shift+/", "/", "Backslash", ["ctrl", "shift"], "|"],
    ["UK IntlBackslash Ctrl+\\", "\\", "IntlBackslash", ["ctrl"], "\\"],
    ["UK IntlBackslash Ctrl+Shift+|", "|", "IntlBackslash", ["ctrl", "shift"], "|"],
    ["Ctrl+Alt on Backslash", "\\", "Backslash", ["ctrl", "alt"], null],
    ["IME key Process on Backslash", "Process", "Backslash", ["ctrl"], null],
  ];
  it.each(rows)("%s", (_name, key, code, mods, expected) => {
    expect(punctuationKey(input(key, code, ...mods))).toBe(expected);
  });

  it("comes before the letter rules: a letter, a digit or a diacritic on the Backslash key", () => {
    expect(punctuationKey(input("ü", "Backslash", "ctrl"))).toBe("\\");
    expect(punctuationKey(input("ç", "Backslash", "ctrl"))).toBe("\\");
    expect(punctuationKey(input("p", "Backslash", "ctrl"))).toBe("\\");
    expect(punctuationKey(input("3", "Backslash", "ctrl"))).toBe("\\");
    expect(comboKeyOf({ key: "p", code: "Backslash", ctrlKey: true })).toBe("\\");
  });

  it("AltGr and IME win over the physical key, whatever the key says", () => {
    expect(punctuationKey(input("+", "Backslash", "ctrl", "alt"))).toBeNull();
    expect(punctuationKey(input("#", "Backslash", "altGraph"))).toBeNull();
    expect(punctuationKey(input("\\", "Backslash", "ctrl", "composing"))).toBeNull();
    expect(punctuationKey(input("Dead", "Backslash", "ctrl"))).toBeNull();
    expect(punctuationKey(input("Unidentified", "Backslash", "ctrl"))).toBeNull();
  });

  it("the layout's own backslash or bar on another key is that mark; other marks are unchanged", () => {
    expect(punctuationKey(input("\\", "KeyQ", "ctrl"))).toBe("\\");
    expect(punctuationKey(input("|", "Digit1", "ctrl", "shift"))).toBe("|");
    expect(punctuationKey(input("+", "Equal", "ctrl"))).toBe("+");
    expect(punctuationKey(input("*", "BracketRight", "ctrl"))).toBe("*");
  });

  it("not for another key with a non-ASCII character, letters, digits or named keys", () => {
    expect(punctuationKey(input("ฃ", "Slash", "ctrl"))).toBeNull();
    expect(punctuationKey(input("ё", "Backquote", "ctrl"))).toBeNull();
    expect(punctuationKey(input("p", "KeyP", "ctrl"))).toBeNull();
    expect(punctuationKey(input("3", "Digit3", "ctrl"))).toBeNull();
    expect(punctuationKey(input("F6", "F6"))).toBeNull();
  });

  it("the letter and digit vectors are unchanged when the key is not the Backslash key", () => {
    expect(comboKeyOf({ key: "ย", code: "KeyP", ctrlKey: true })).toBe("p");
    expect(comboKeyOf({ key: "&", code: "Digit1", ctrlKey: true })).toBe("1");
  });
});

describe("events", () => {
  it("keyInputOf fills the gaps of a short event", () => {
    expect(keyInputOf({ key: "p", ctrlKey: true })).toEqual({
      key: "p",
      code: "",
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      isComposing: false,
      altGraph: false,
    });
  });

  it("reads isComposing from a React synthetic event and AltGraph from getModifierState", () => {
    expect(keyInputOf({ key: "p", nativeEvent: { isComposing: true } }).isComposing).toBe(true);
    const altGraph = (name: string) => name === "AltGraph";
    expect(keyInputOf({ key: "p", getModifierState: altGraph }).altGraph).toBe(true);
    expect(
      shortcutKeyOf({ key: "p", code: "KeyP", ctrlKey: true, getModifierState: altGraph }),
    ).toBe(null);
  });

  it("comboKeyOf: the letter, else the punctuation, lowercase, else null", () => {
    expect(comboKeyOf({ key: "S", code: "KeyS", ctrlKey: true, shiftKey: true })).toBe("s");
    expect(comboKeyOf({ key: "ห", code: "KeyS", ctrlKey: true })).toBe("s");
    expect(comboKeyOf({ key: "\\", ctrlKey: true })).toBe("\\");
    expect(comboKeyOf({ key: "ฃ", code: "Backslash", ctrlKey: true })).toBe("\\");
    expect(comboKeyOf({ key: "+", code: "Backslash", ctrlKey: true })).toBe("\\");
    expect(comboKeyOf({ key: "ฅ", code: "Backslash", ctrlKey: true, shiftKey: true })).toBe("|");
    expect(comboKeyOf({ key: "F6", code: "F6" })).toBe("f6");
    expect(comboKeyOf({ key: "ArrowLeft", altKey: true })).toBe("arrowleft");
    expect(comboKeyOf({ key: "Dead", code: "KeyE" })).toBeNull();
    expect(comboKeyOf({ key: "p", code: "KeyP", ctrlKey: true, altKey: true })).toBeNull();
  });

  it("a synthetic event without a code still matches by key", () => {
    expect(comboKeyOf({ key: "L" })).toBe("l");
    expect(comboKeyOf({ key: "3" })).toBe("3");
    expect(comboKeyOf({ key: "ย" })).toBeNull();
  });
});

describe("isNativeTextEdit", () => {
  const field = (tagName: string, type?: string, isContentEditable = false) => ({
    tagName,
    isContentEditable,
    ...(type === undefined ? {} : { type }),
  });
  const ctrl = { ctrlKey: true, shiftKey: false };

  it("true for the editing keys in an input, a textarea and a contenteditable", () => {
    for (const k of ["c", "v", "x", "a", "z", "y"]) {
      expect(isNativeTextEdit(field("INPUT", "text"), k, ctrl), k).toBe(true);
      expect(isNativeTextEdit(field("TEXTAREA"), k, ctrl), k).toBe(true);
      expect(isNativeTextEdit(field("DIV", undefined, true), k, ctrl), k).toBe(true);
    }
    expect(isNativeTextEdit(field("input", "text"), "a", ctrl)).toBe(true);
  });

  it("covers text, number, search and an input with no type", () => {
    for (const type of ["text", "number", "search", ""]) {
      expect(isNativeTextEdit(field("INPUT", type), "v", ctrl), type).toBe(true);
    }
    expect(isNativeTextEdit({ tagName: "INPUT", isContentEditable: false }, "v", ctrl)).toBe(true);
  });

  it("Ctrl+Shift+Z is redo; the other Ctrl+Shift keys are the app's", () => {
    const shift = { ctrlKey: true, shiftKey: true };
    expect(isNativeTextEdit(field("INPUT", "text"), "z", shift)).toBe(true);
    for (const k of ["c", "v", "x", "a", "y", "n", "p"]) {
      expect(isNativeTextEdit(field("INPUT", "text"), k, shift), k).toBe(false);
    }
  });

  it("false for the grid, a button, a checkbox, a radio and other keys", () => {
    expect(isNativeTextEdit(field("DIV"), "c", ctrl)).toBe(false);
    expect(isNativeTextEdit(field("BUTTON"), "c", ctrl)).toBe(false);
    expect(isNativeTextEdit(field("INPUT", "checkbox"), "a", ctrl)).toBe(false);
    expect(isNativeTextEdit(field("INPUT", "radio"), "a", ctrl)).toBe(false);
    expect(isNativeTextEdit(field("INPUT", "text"), "p", ctrl)).toBe(false);
    expect(isNativeTextEdit(field("INPUT", "text"), "e", ctrl)).toBe(false);
    expect(isNativeTextEdit(field("INPUT", "text"), null, ctrl)).toBe(false);
  });

  it("false without Ctrl", () => {
    expect(isNativeTextEdit(field("INPUT", "text"), "a", { ctrlKey: false, shiftKey: false })).toBe(
      false,
    );
  });
});
