import { vi } from "vitest";
import {
  createShortcutHandler,
  type KeyEventLike,
  matchesCombo,
  parseCombo,
  SUPPRESSED_DEFAULTS,
} from "./shortcuts";

function key(k: string, mods: Partial<KeyEventLike> = {}, code?: string) {
  return {
    key: k,
    code,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...mods,
  };
}

describe("parseCombo / matchesCombo", () => {
  it("parses modifiers and keys", () => {
    expect(parseCombo("ctrl+shift+s")).toEqual({ ctrl: true, shift: true, alt: false, key: "s" });
    expect(parseCombo("ctrl+\\")).toEqual({ ctrl: true, shift: false, alt: false, key: "\\" });
    expect(parseCombo("F5")).toEqual({ ctrl: false, shift: false, alt: false, key: "f5" });
  });

  it("matches case-insensitively and treats Cmd as Ctrl", () => {
    expect(matchesCombo(key("L", { ctrlKey: true }), parseCombo("ctrl+l"))).toBe(true);
    expect(matchesCombo(key("l", { metaKey: true }), parseCombo("ctrl+l"))).toBe(true);
  });

  it("requires the exact modifiers", () => {
    expect(matchesCombo(key("s", { ctrlKey: true }), parseCombo("ctrl+shift+s"))).toBe(false);
    expect(matchesCombo(key("S", { ctrlKey: true, shiftKey: true }), parseCombo("ctrl+s"))).toBe(
      false,
    );
    expect(matchesCombo(key("l"), parseCombo("ctrl+l"))).toBe(false);
    expect(matchesCombo(key("l", { ctrlKey: true, altKey: true }), parseCombo("ctrl+l"))).toBe(
      false,
    );
  });
});

describe("createShortcutHandler", () => {
  it("runs the action and prevents the default", () => {
    const run = vi.fn();
    const handler = createShortcutHandler([{ combo: "ctrl+p", run }], () => false);
    const e = key("p", { ctrlKey: true });
    expect(handler.handle(e)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("does not run actions while a modal is open but still prevents the default", () => {
    const run = vi.fn();
    const handler = createShortcutHandler([{ combo: "ctrl+p", run }], () => true);
    const e = key("p", { ctrlKey: true });
    expect(handler.handle(e)).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("m-2: while a modal is open a bound key that the browser does not use goes on to the focused control", () => {
    const run = vi.fn();
    const handler = createShortcutHandler(
      [
        { combo: "ctrl+shift+v", run },
        { combo: "ctrl+shift+e", run },
        { combo: "ctrl+\\", run },
      ],
      () => true,
    );
    const paste = key("v", { ctrlKey: true, shiftKey: true });
    expect(handler.handle(paste)).toBe(false);
    expect(paste.preventDefault).not.toHaveBeenCalled();
    const slash = key("\\", { ctrlKey: true });
    expect(handler.handle(slash)).toBe(false);
    expect(slash.preventDefault).not.toHaveBeenCalled();
    // a browser default stays suppressed, with no action
    const scale = key("e", { ctrlKey: true, shiftKey: true });
    expect(handler.handle(scale)).toBe(true);
    expect(scale.preventDefault).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("honors the when() guard and keeps the default suppressed", () => {
    const run = vi.fn();
    const handler = createShortcutHandler(
      [{ combo: "ctrl+e", run, when: () => false }],
      () => false,
    );
    const e = key("e", { ctrlKey: true });
    handler.handle(e);
    expect(run).not.toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("lets a key whose when() is false go on to the focused control unless the browser uses it", () => {
    const run = vi.fn();
    const handler = createShortcutHandler(
      [
        { combo: "ctrl+shift+v", run, when: () => false },
        { combo: "ctrl+b", run, when: () => false },
      ],
      () => false,
    );
    const paste = key("v", { ctrlKey: true, shiftKey: true });
    expect(handler.handle(paste)).toBe(false);
    expect(paste.preventDefault).not.toHaveBeenCalled();
    const bold = key("b", { ctrlKey: true });
    expect(handler.handle(bold)).toBe(true);
    expect(bold.preventDefault).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("suppresses the browser keys of the DES-002 3.1 map", () => {
    for (const combo of [
      "ctrl+e",
      "ctrl+b",
      "ctrl+j",
      "ctrl+l",
      "ctrl+1",
      "ctrl+4",
      "ctrl+shift+n",
      "ctrl+shift+p",
      "ctrl+shift+k",
      "ctrl+shift+m",
    ]) {
      expect(SUPPRESSED_DEFAULTS).toContain(combo);
    }
  });

  it("suppresses browser defaults that have no binding", () => {
    const handler = createShortcutHandler([], () => false);
    for (const combo of SUPPRESSED_DEFAULTS) {
      const c = parseCombo(combo);
      const e = key(c.key, { ctrlKey: c.ctrl, shiftKey: c.shift, altKey: c.alt });
      expect(handler.handle(e)).toBe(true);
      expect(e.preventDefault).toHaveBeenCalled();
    }
  });

  it("lists the conflicting defaults from DES-001 5.1", () => {
    for (const combo of [
      "ctrl+p",
      "ctrl+o",
      "ctrl+s",
      "ctrl+n",
      "f5",
      "ctrl+r",
      "ctrl+shift+t",
      "ctrl+shift+c",
      "ctrl+shift+o",
      "ctrl+shift+a",
      "ctrl+shift+d",
      "ctrl+f4",
      "ctrl+f6",
      "alt+arrowleft",
      "alt+arrowright",
    ]) {
      expect(SUPPRESSED_DEFAULTS).toContain(combo);
    }
  });

  it("ignores unrelated keys", () => {
    const handler = createShortcutHandler([{ combo: "ctrl+l", run: vi.fn() }], () => false);
    const e = key("a", { ctrlKey: true });
    expect(handler.handle(e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("matches Ctrl+Shift+S before Ctrl+S", () => {
    const save = vi.fn();
    const saveAs = vi.fn();
    const handler = createShortcutHandler(
      [
        { combo: "ctrl+s", run: save },
        { combo: "ctrl+shift+s", run: saveAs },
      ],
      () => false,
    );
    handler.handle(key("S", { ctrlKey: true, shiftKey: true }));
    expect(saveAs).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("layout independent matching (REPORT-007 D8)", () => {
  it("Thai: hardware Ctrl+P, Ctrl+E, Ctrl+J, Ctrl+S match by the physical key", () => {
    expect(matchesCombo(key("ย", { ctrlKey: true }, "KeyP"), parseCombo("ctrl+p"))).toBe(true);
    expect(matchesCombo(key("ำ", { ctrlKey: true }, "KeyE"), parseCombo("ctrl+e"))).toBe(true);
    expect(matchesCombo(key("่", { ctrlKey: true }, "KeyJ"), parseCombo("ctrl+j"))).toBe(true);
    expect(matchesCombo(key("ห", { ctrlKey: true }, "KeyS"), parseCombo("ctrl+s"))).toBe(true);
    expect(
      matchesCombo(key("ณ", { ctrlKey: true, shiftKey: true }, "KeyN"), parseCombo("ctrl+shift+n")),
    ).toBe(true);
    expect(matchesCombo(key("ฃ", { ctrlKey: true }, "Backslash"), parseCombo("ctrl+\\"))).toBe(
      true,
    );
  });

  it("Cyrillic Ctrl+З is Ctrl+P, and not Ctrl+E", () => {
    expect(matchesCombo(key("з", { ctrlKey: true }, "KeyP"), parseCombo("ctrl+p"))).toBe(true);
    expect(matchesCombo(key("з", { ctrlKey: true }, "KeyP"), parseCombo("ctrl+e"))).toBe(false);
  });

  it("Dvorak keeps its own letters", () => {
    // Physical P key of Dvorak types "l": that is Ctrl+L, not Ctrl+P.
    expect(matchesCombo(key("l", { ctrlKey: true }, "KeyP"), parseCombo("ctrl+l"))).toBe(true);
    expect(matchesCombo(key("l", { ctrlKey: true }, "KeyP"), parseCombo("ctrl+p"))).toBe(false);
    expect(matchesCombo(key("p", { ctrlKey: true }, "KeyR"), parseCombo("ctrl+p"))).toBe(true);
    // Ctrl+. sits on the physical E key but is not Ctrl+E.
    expect(matchesCombo(key(".", { ctrlKey: true }, "KeyE"), parseCombo("ctrl+e"))).toBe(false);
  });

  it("AZERTY: Ctrl+& (unshifted digit row) is Ctrl+1, Ctrl+Shift+1 is not", () => {
    expect(matchesCombo(key("&", { ctrlKey: true }, "Digit1"), parseCombo("ctrl+1"))).toBe(true);
    expect(matchesCombo(key("é", { ctrlKey: true }, "Digit2"), parseCombo("ctrl+2"))).toBe(true);
    expect(
      matchesCombo(key("1", { ctrlKey: true, shiftKey: true }, "Digit1"), parseCombo("ctrl+1")),
    ).toBe(false);
  });

  it("AltGr never matches a Ctrl shortcut", () => {
    const altGr = { ctrlKey: true, altKey: true };
    expect(matchesCombo(key("p", altGr, "KeyP"), parseCombo("ctrl+p"))).toBe(false);
    expect(matchesCombo(key("ย", altGr, "KeyP"), parseCombo("ctrl+p"))).toBe(false);
    expect(matchesCombo(key("p", altGr, "KeyP"), parseCombo("ctrl+alt+p"))).toBe(false);
    const handler = createShortcutHandler([{ combo: "ctrl+p", run: vi.fn() }], () => false);
    const e = key("ł", altGr, "KeyL");
    expect(handler.handle(e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("the handler runs and suppresses with a Thai key", () => {
    const run = vi.fn();
    const handler = createShortcutHandler([{ combo: "ctrl+p", run }], () => false);
    const e = key("ย", { ctrlKey: true }, "KeyP");
    expect(handler.handle(e)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("a Thai character typed without Ctrl is not a shortcut", () => {
    const run = vi.fn();
    const handler = createShortcutHandler([{ combo: "ctrl+p", run }], () => false);
    const e = key("ย", {}, "KeyP");
    expect(handler.handle(e)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("Ctrl+C, V, X, A, Z are not bound, so they stay native in every layout", () => {
    const handler = createShortcutHandler([{ combo: "ctrl+p", run: vi.fn() }], () => false);
    for (const [k, code] of [
      ["แ", "KeyC"],
      ["อ", "KeyV"],
      ["ป", "KeyX"],
      ["ฟ", "KeyA"],
      ["ผ", "KeyZ"],
    ] as const) {
      const e = key(k, { ctrlKey: true }, code);
      expect(handler.handle(e), code).toBe(false);
      expect(e.preventDefault).not.toHaveBeenCalled();
    }
  });
});

describe("native editing keys of a text field (DES-002 3.1)", () => {
  function field(tag: "input" | "textarea") {
    const el = document.createElement(tag);
    document.body.append(el);
    return el;
  }
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("Ctrl+C, V, X, A, Z, Y and Ctrl+Shift+Z in a field are not handled and not prevented, on every layout", () => {
    // Bound on purpose, to prove the early return (Ctrl+A is not bound by the app windows).
    const run = vi.fn();
    const handler = createShortcutHandler(
      [
        { combo: "ctrl+a", run },
        { combo: "ctrl+c", run },
        { combo: "ctrl+shift+z", run },
      ],
      () => false,
    );
    const input = field("input");
    for (const [k, code] of [
      ["a", "KeyA"],
      ["ฟ", "KeyA"],
      ["ф", "KeyA"],
      ["c", "KeyC"],
      ["แ", "KeyC"],
      ["v", "KeyV"],
      ["x", "KeyX"],
      ["z", "KeyZ"],
      ["y", "KeyY"],
    ] as const) {
      const e = { ...key(k, { ctrlKey: true }, code), target: input };
      expect(handler.handle(e), `${k} ${code}`).toBe(false);
      expect(e.preventDefault).not.toHaveBeenCalled();
    }
    const redo = {
      ...key("Z", { ctrlKey: true, shiftKey: true }, "KeyZ"),
      target: field("textarea"),
    };
    expect(handler.handle(redo)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("outside a text field the same keys are the app's", () => {
    const run = vi.fn();
    const handler = createShortcutHandler([{ combo: "ctrl+c", run }], () => false);
    const button = document.createElement("button");
    document.body.append(button);
    const e = { ...key("แ", { ctrlKey: true }, "KeyC"), target: button };
    expect(handler.handle(e)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("the app's Ctrl+Shift letters still work from a field (Ctrl+Shift+N)", () => {
    const run = vi.fn();
    const handler = createShortcutHandler([{ combo: "ctrl+shift+n", run }], () => false);
    const e = { ...key("N", { ctrlKey: true, shiftKey: true }, "KeyN"), target: field("input") };
    expect(handler.handle(e)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+ and Ctrl+Shift+ also match by the physical Backslash key on a non-Latin layout", () => {
    const setup = vi.fn();
    const compact = vi.fn();
    const handler = createShortcutHandler(
      [
        { combo: "ctrl+\\", run: setup },
        // The windows bind both marks: Ctrl+Shift+Backslash is the bar (DES-002 3.1).
        { combo: "ctrl+shift+\\", run: compact },
        { combo: "ctrl+shift+|", run: compact },
      ],
      () => false,
    );
    handler.handle(key("ฃ", { ctrlKey: true }, "Backslash"));
    handler.handle(key("ฅ", { ctrlKey: true, shiftKey: true }, "Backslash"));
    expect(setup).toHaveBeenCalledTimes(1);
    expect(compact).toHaveBeenCalledTimes(1);
  });

  // REPORT-008 D8b: the physical Backslash key, whatever the layout types there, with the bindings
  // the windows really register.
  describe("Ctrl+\\ and Ctrl+Shift+\\ on the physical Backslash key", () => {
    function build() {
      const setup = vi.fn();
      const compact = vi.fn();
      const handler = createShortcutHandler(
        [
          { combo: "ctrl+\\", run: setup },
          { combo: "ctrl+shift+\\", run: compact },
          { combo: "ctrl+shift+|", run: compact },
        ],
        () => false,
      );
      return { handler, setup, compact };
    }

    const ctrl: ReadonlyArray<readonly [string, string]> = [
      ["US", "\\"],
      ["Thai (Ctrl+\\ arrives as +)", "+"],
      ["Cyrillic", "ё"],
      ["Russian", "\\"],
      ["AZERTY", "*"],
      ["German", "#"],
    ];
    it.each(ctrl)("%s: Ctrl+Backslash toggles the setup and is prevented", (_n, k) => {
      const { handler, setup, compact } = build();
      const e = key(k, { ctrlKey: true }, "Backslash");
      expect(handler.handle(e)).toBe(true);
      expect(setup).toHaveBeenCalledTimes(1);
      expect(compact).not.toHaveBeenCalled();
      expect(e.preventDefault).toHaveBeenCalled();
    });

    const shift: ReadonlyArray<readonly [string, string]> = [
      ["US", "|"],
      ["Thai", "ฅ"],
      ["Russian", "/"],
      ["AZERTY", "£"],
      ["German", "'"],
    ];
    it.each(shift)("%s: Ctrl+Shift+Backslash is compact mode, once", (_n, k) => {
      const { handler, setup, compact } = build();
      expect(handler.handle(key(k, { ctrlKey: true, shiftKey: true }, "Backslash"))).toBe(true);
      expect(compact).toHaveBeenCalledTimes(1);
      expect(setup).not.toHaveBeenCalled();
    });

    it("AltGr on the German or AZERTY backslash does nothing and is not prevented", () => {
      const { handler, setup, compact } = build();
      const german = key("\\", { ctrlKey: true, altKey: true }, "Minus");
      const azerty = key("\\", { ctrlKey: true, altKey: true }, "Digit8");
      const thaiAltGr = key("+", { ctrlKey: true, altKey: true }, "Backslash");
      for (const e of [german, azerty, thaiAltGr]) {
        expect(handler.handle(e)).toBe(false);
        expect(e.preventDefault).not.toHaveBeenCalled();
      }
      expect(setup).not.toHaveBeenCalled();
      expect(compact).not.toHaveBeenCalled();
    });

    it("without Ctrl the Backslash key types and does nothing", () => {
      const { handler, setup } = build();
      const e = key("+", {}, "Backslash");
      expect(handler.handle(e)).toBe(false);
      expect(setup).not.toHaveBeenCalled();
    });

    it("the physical key wins over the key value, also a letter (Spanish ç)", () => {
      const { handler, setup } = build();
      expect(handler.handle(key("ç", { ctrlKey: true }, "Backslash"))).toBe(true);
      expect(setup).toHaveBeenCalledTimes(1);
    });

    it("UK IntlBackslash: the layout's own backslash and bar still match, on any code", () => {
      const { handler, setup, compact } = build();
      expect(handler.handle(key("\\", { ctrlKey: true }, "IntlBackslash"))).toBe(true);
      expect(setup).toHaveBeenCalledTimes(1);
      expect(handler.handle(key("|", { ctrlKey: true, shiftKey: true }, "IntlBackslash"))).toBe(
        true,
      );
      expect(compact).toHaveBeenCalledTimes(1);
    });

    it("the AltGraph state (getModifierState) on the Backslash key does nothing", () => {
      const { handler, setup } = build();
      const e = {
        ...key("#", { ctrlKey: true }, "Backslash"),
        getModifierState: (n: string) => n === "AltGraph",
      };
      expect(handler.handle(e)).toBe(false);
      expect(setup).not.toHaveBeenCalled();
    });

    it("an IME that is composing does nothing, key Process or isComposing", () => {
      const { handler, setup } = build();
      expect(handler.handle(key("Process", { ctrlKey: true }, "Backslash"))).toBe(false);
      expect(
        handler.handle({ ...key("+", { ctrlKey: true }, "Backslash"), isComposing: true }),
      ).toBe(false);
      expect(setup).not.toHaveBeenCalled();
    });
  });
});
