import { createAltGuard, createLoneAltTracker, installAltGuard } from "./alt-guard";

function event(type: "keydown" | "keyup", key: string, target: EventTarget | null = document.body) {
  let prevented = false;
  return {
    type,
    key,
    target,
    preventDefault() {
      prevented = true;
    },
    get prevented() {
      return prevented;
    },
  };
}

describe("the Alt guard (REPORT-006 D2)", () => {
  it("prevents the keydown and the keyup of a lone Alt tap", () => {
    const guard = createAltGuard();
    const down = event("keydown", "Alt");
    const up = event("keyup", "Alt");
    expect(guard.handle(down)).toBe(true);
    expect(guard.handle(up)).toBe(true);
    expect(down.prevented).toBe(true);
    expect(up.prevented).toBe(true);
  });

  it("does the same for AltGraph", () => {
    const guard = createAltGuard();
    expect(guard.handle(event("keydown", "AltGraph"))).toBe(true);
    expect(guard.handle(event("keyup", "AltGraph"))).toBe(true);
  });

  it("prevents the keyup after a long hold with auto repeat", () => {
    const guard = createAltGuard();
    for (let i = 0; i < 5; i++) expect(guard.handle(event("keydown", "Alt"))).toBe(true);
    expect(guard.handle(event("keyup", "Alt"))).toBe(true);
  });

  it("leaves the other key of an Alt combination alone and does not prevent the Alt keyup after it", () => {
    const guard = createAltGuard();
    guard.handle(event("keydown", "Alt"));
    const arrow = event("keydown", "ArrowLeft");
    const f4 = event("keydown", "F4");
    expect(guard.handle(arrow)).toBe(false);
    expect(guard.handle(f4)).toBe(false);
    expect(arrow.prevented).toBe(false);
    expect(f4.prevented).toBe(false);
    const up = event("keyup", "Alt");
    expect(guard.handle(up)).toBe(false);
    expect(up.prevented).toBe(false);
  });

  it("a modifier pressed in between counts as another key (Alt+Shift is not a lone tap)", () => {
    const guard = createAltGuard();
    guard.handle(event("keydown", "Alt"));
    guard.handle(event("keydown", "Shift"));
    expect(guard.handle(event("keyup", "Alt"))).toBe(false);
  });

  it("a new tap is solo again after a combination", () => {
    const guard = createAltGuard();
    guard.handle(event("keydown", "Alt"));
    guard.handle(event("keydown", "ArrowLeft"));
    guard.handle(event("keyup", "Alt"));
    expect(guard.handle(event("keydown", "Alt"))).toBe(true);
    expect(guard.handle(event("keyup", "Alt"))).toBe(true);
  });

  it("an Alt-drag (pointer input only, no key in between) ends with a prevented keyup", () => {
    const guard = createAltGuard();
    guard.handle(event("keydown", "Alt"));
    // Pointer events are not fed to the guard: they are not keys.
    expect(guard.handle(event("keyup", "Alt"))).toBe(true);
  });

  it("does not touch ordinary keys or a keyup without a keydown", () => {
    const guard = createAltGuard();
    expect(guard.handle(event("keydown", "a"))).toBe(false);
    expect(guard.handle(event("keyup", "a"))).toBe(false);
    expect(guard.handle(event("keyup", "Alt"))).toBe(false);
  });

  it.each(["input", "textarea", "select"])(
    "keeps the Alt keydown in a %s for Alt codes but still prevents the solo keyup",
    (tag) => {
      const field = document.createElement(tag);
      document.body.append(field);
      const guard = createAltGuard();
      const down = event("keydown", "Alt", field);
      const up = event("keyup", "Alt", field);
      expect(guard.handle(down)).toBe(false);
      expect(down.prevented).toBe(false);
      expect(guard.handle(up)).toBe(true);
      expect(up.prevented).toBe(true);
      field.remove();
    },
  );

  it("Alt codes typed in a field (Alt, then the numpad) are not touched at all", () => {
    const field = document.createElement("input");
    document.body.append(field);
    const guard = createAltGuard();
    guard.handle(event("keydown", "Alt", field));
    guard.handle(event("keydown", "Numpad6", field));
    const up = event("keyup", "Alt", field);
    expect(guard.handle(up)).toBe(false);
    expect(up.prevented).toBe(false);
    field.remove();
  });
});

describe("createLoneAltTracker (FE-002 31b vectors)", () => {
  const press = (keys: string[], up: string) => {
    const t = createLoneAltTracker();
    for (const key of keys) t.keyDown({ key });
    return t.keyUp({ key: up });
  };

  it("Alt down, Alt up -> true", () => expect(press(["Alt"], "Alt")).toBe(true));
  it("Alt down, ArrowRight down/up, Alt up -> false", () => {
    const t = createLoneAltTracker();
    t.keyDown({ key: "Alt" });
    t.keyDown({ key: "ArrowRight" });
    expect(t.keyUp({ key: "ArrowRight" })).toBe(false);
    expect(t.keyUp({ key: "Alt" })).toBe(false);
  });
  it("Alt down, Space down -> false (Alt+Space keeps the OS menu)", () =>
    expect(press(["Alt", " "], "Alt")).toBe(false));
  it("Alt down, window blur, Alt up -> false", () => {
    const t = createLoneAltTracker();
    t.keyDown({ key: "Alt" });
    t.blur();
    expect(t.keyUp({ key: "Alt" })).toBe(false);
  });
  it("pointer input is not seen, so Alt down, drag, Alt up -> true", () =>
    expect(press(["Alt"], "Alt")).toBe(true));
  it("AltGraph counts as Alt, and a second tap after a combination is a lone tap again", () => {
    const t = createLoneAltTracker();
    t.keyDown({ key: "AltGraph" });
    expect(t.keyUp({ key: "AltGraph" })).toBe(true);
    t.keyDown({ key: "Alt" });
    t.keyDown({ key: "F4" });
    expect(t.keyUp({ key: "Alt" })).toBe(false);
    t.keyDown({ key: "Alt" });
    expect(t.keyUp({ key: "Alt" })).toBe(true);
  });
  it("a keyup of another key and a repeated keyup are false", () => {
    const t = createLoneAltTracker();
    expect(t.keyUp({ key: "a" })).toBe(false);
    t.keyDown({ key: "Alt" });
    expect(t.keyUp({ key: "Alt" })).toBe(true);
    expect(t.keyUp({ key: "Alt" })).toBe(false);
  });
});

describe("installAltGuard", () => {
  it("prevents a lone Alt tap on the window, once, however many callers installed it", () => {
    const off1 = installAltGuard();
    const off2 = installAltGuard();
    expect(
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", cancelable: true })),
    ).toBe(false);
    expect(window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", cancelable: true }))).toBe(
      false,
    );
    // A blur forgets the press.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", cancelable: true }));
    window.dispatchEvent(new Event("blur"));
    expect(window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", cancelable: true }))).toBe(
      true,
    );
    off1();
    // Still installed for the second caller.
    expect(
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", cancelable: true })),
    ).toBe(false);
    off2();
    off2();
    expect(
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", cancelable: true })),
    ).toBe(true);
  });
});
