import { vi } from "vitest";
import {
  createShortcutHandler,
  type KeyEventLike,
  matchesCombo,
  parseCombo,
  SUPPRESSED_DEFAULTS,
} from "./shortcuts";

function key(k: string, mods: Partial<KeyEventLike> = {}) {
  return {
    key: k,
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

  it("suppresses browser defaults that have no binding", () => {
    const handler = createShortcutHandler([], () => false);
    for (const combo of SUPPRESSED_DEFAULTS) {
      const c = parseCombo(combo);
      const e = key(c.key, { ctrlKey: c.ctrl, shiftKey: c.shift });
      expect(handler.handle(e)).toBe(true);
      expect(e.preventDefault).toHaveBeenCalled();
    }
  });

  it("lists the conflicting defaults from DES-001 5.1", () => {
    for (const combo of ["ctrl+p", "ctrl+o", "ctrl+s", "ctrl+n", "f5", "ctrl+r"]) {
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
