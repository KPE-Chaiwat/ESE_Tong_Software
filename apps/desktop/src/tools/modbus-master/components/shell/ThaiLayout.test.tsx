// Shortcuts with a non-Latin layout active (REPORT-007 D8). Hardware Ctrl+P on the Thai layout is
// `key = "ย"`, `code = "KeyP"`: every key of the map of DES-002 3.1 must fire from the physical key,
// in W1 and in a native poll window. Mirrors ShortcutMaps.test.tsx.
import { act, screen, waitFor, within } from "@testing-library/react";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import {
  disposeNativeHarnesses,
  type NativeHarness,
  renderNativeWindow,
} from "../native/test-utils";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;
let n: NativeHarness;

afterEach(() => {
  h?.rt.dispose();
  disposeNativeHarnesses();
});

/** Thai Kedmanee characters of the physical keys the tool uses (unshifted, shifted). */
const THAI: Readonly<Record<string, readonly [string, string]>> = {
  KeyL: ["ส", "ศ"],
  KeyN: ["ท", "ณ"],
  KeyO: ["น", "ฯ"],
  KeyP: ["ย", "ญ"],
  KeyS: ["ห", "ฆ"],
  KeyJ: ["่", "๋"],
  KeyE: ["ำ", "ฎ"],
  KeyB: ["ิ", "ฺ"],
  KeyK: ["า", "ษ"],
  KeyT: ["ภ", "ธ"],
  KeyC: ["แ", "ฉ"],
  KeyA: ["ฟ", "ฤ"],
  KeyD: ["ก", "โ"],
  KeyM: ["ท", "?"],
  KeyV: ["อ", "ฮ"],
  Digit1: ["ๅ", "+"],
  Digit2: ["/", "๑"],
  Digit3: ["-", "๒"],
  Digit4: ["ภ", "๓"],
  // Hardware Ctrl+\ on the Thai layout arrives as "+" (REPORT-008 D8b), Ctrl+Shift+\ as "ฅ".
  Backslash: ["+", "ฅ"],
};

interface Mods {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** A Thai-layout keydown on the focused element: `key` is a Thai character, `code` the physical key. */
function thai(code: string, mods: Mods = {}): boolean {
  const chars = THAI[code] ?? ["ก", "ข"];
  return press(chars[mods.shift ? 1 : 0] as string, code, mods);
}

function press(key: string, code: string, mods: Mods = {}): boolean {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent("keydown", {
    key,
    code,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

const frame = (id: PollId) =>
  document.querySelector<HTMLElement>(`[data-subwindow="${id}"]`) as HTMLElement;
const grid = (id: PollId) => within(frame(id)).getByRole("grid");

async function connected() {
  h = await renderWindow();
  const a = await h.addPoll("A", {
    definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
  });
  const b = await h.addPoll("B", {
    definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
  });
  await h.connect();
  h.advance(300);
  return { a, b };
}

describe("W1 with the Thai layout", () => {
  beforeEach(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });

  it("the harness really sends a non-Latin key", () => {
    expect(THAI.KeyP?.[0]).toBe("ย");
  });

  it("Ctrl+P pauses the selected poll, Ctrl+Shift+P pauses all", async () => {
    const { b } = await connected();
    h.rt.stores.pollList.getState().select(b);
    expect(thai("KeyP", { ctrl: true })).toBe(true);
    await waitFor(() => expect(h.ipc.callsOf("setPollActive")).toEqual([[b, false]]));
    thai("KeyP", { ctrl: true, shift: true });
    await waitFor(() => expect(h.ipc.callsOf("setAllPollsActive")).toHaveLength(1));
  });

  it("Ctrl+L, Ctrl+N and Ctrl+Shift+N", async () => {
    await connected();
    thai("KeyL", { ctrl: true });
    await waitFor(() => expect(h.ipc.callsOf("disconnect")).toHaveLength(1));
    thai("KeyN", { ctrl: true });
    await waitFor(() => expect(h.win.openedTools).toEqual(["modbus-master"]));
    thai("KeyN", { ctrl: true, shift: true });
    await waitFor(() => expect(h.ipc.callsOf("addPoll")).toHaveLength(3));
  });

  it("Ctrl+J expands the traffic panel", async () => {
    await connected();
    thai("KeyJ", { ctrl: true });
    expect(h.rt.stores.workspace.getState().traffic.expanded).toBe(true);
  });

  it("Ctrl+O and Ctrl+S open the dialogs", async () => {
    await connected();
    thai("KeyO", { ctrl: true });
    expect(await screen.findByRole("dialog", { name: "Open profile" })).toBeVisible();
    await h.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await h.act(() =>
      h.rt.form.current.adopt({ mode: "tcp", host: "h", port: 502, timeoutMs: 1000 }),
    );
    thai("KeyS", { ctrl: true });
    expect(await screen.findByRole("dialog", { name: "Save profile as" })).toBeVisible();
  });

  it("Ctrl+\\ toggles the sidebar, Ctrl+Shift+\\ compact mode", async () => {
    await connected();
    thai("Backslash", { ctrl: true });
    expect(h.rt.stores.workspace.getState().sidebar.collapsed).toBe(true);
    thai("Backslash", { ctrl: true, shift: true });
    await waitFor(() => expect(h.ipc.callsOf("setCompactMode")).toEqual([[true]]));
  });

  // REPORT-008 D8b: the physical Backslash key, whatever key the layout reports.
  it("Ctrl with key + on code Backslash (Thai hardware) collapses the sidebar, Ctrl+Shift with ฅ is compact mode", async () => {
    await connected();
    (screen.getByRole("listbox") as HTMLElement).focus();
    expect(press("+", "Backslash", { ctrl: true })).toBe(true);
    expect(h.rt.stores.workspace.getState().sidebar.collapsed).toBe(true);
    press("ฅ", "Backslash", { ctrl: true, shift: true });
    await waitFor(() => expect(h.ipc.callsOf("setCompactMode")).toEqual([[true]]));
  });

  it("Ctrl+Backslash with focus in a sub-window toggles that sub-window's setup (Thai +, German #, AZERTY *)", async () => {
    const { a } = await connected();
    const ui = () =>
      (h.rt.views.peek(a) as NonNullable<ReturnType<typeof h.rt.views.peek>>).stores.ui;
    const before = ui().getState().setupOpen;
    grid(a).focus();
    for (const [i, key] of ["+", "#", "*"].entries()) {
      expect(press(key, "Backslash", { ctrl: true }), key).toBe(true);
      expect(ui().getState().setupOpen, key).toBe(i % 2 === 0 ? !before : before);
    }
    // The sidebar was not touched.
    expect(h.rt.stores.workspace.getState().sidebar.collapsed).toBe(false);
  });

  it("AltGr on the Backslash key, Ctrl+Alt, and the German AltGr+ss do nothing", async () => {
    await connected();
    (screen.getByRole("listbox") as HTMLElement).focus();
    expect(press("+", "Backslash", { ctrl: true, alt: true })).toBe(false);
    expect(press("\\", "Minus", { ctrl: true, alt: true })).toBe(false);
    expect(h.rt.stores.workspace.getState().sidebar.collapsed).toBe(false);
    expect(h.ipc.callsOf("setCompactMode")).toEqual([]);
  });

  it("Ctrl+Shift+T tiles, Ctrl+Shift+C cascades, Ctrl+Shift+O pops out, F6 cycles the regions", async () => {
    const { a } = await connected();
    thai("KeyT", { ctrl: true, shift: true });
    expect(h.rt.stores.workspace.getState().tileMode).toBe(true);
    thai("KeyC", { ctrl: true, shift: true });
    expect(h.rt.stores.workspace.getState().tileMode).toBe(false);
    h.rt.stores.pollList.getState().select(a);
    thai("KeyO", { ctrl: true, shift: true });
    await waitFor(() => expect(h.ipc.callsOf("popOutPoll")).toHaveLength(1));
    (
      screen.getByRole("toolbar", { name: "Toolbar" }).querySelector("button") as HTMLElement
    ).focus();
    press("F6", "F6");
    expect(document.activeElement?.closest("[data-region]")?.getAttribute("data-region")).toBe(
      "sidebar",
    );
  });

  it("the keys of a sub-window: Ctrl+E, Ctrl+1..4, Ctrl+B, Ctrl+A and Ctrl+C", async () => {
    const { a } = await connected();
    grid(a).focus();
    thai("KeyE", { ctrl: true });
    expect(await screen.findByRole("dialog", { name: "Write · A" })).toBeVisible();
    await h.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    grid(a).focus();
    thai("Digit3", { ctrl: true });
    await waitFor(() => expect(h.ipc.pollSummary(a).config.display.format).toBe("hex"));
    thai("KeyB", { ctrl: true });
    await waitFor(() => expect(h.ipc.pollSummary(a).config.display.addressBase).toBe(1));
    thai("KeyA", { ctrl: true });
    thai("KeyC", { ctrl: true });
    await waitFor(() => expect(h.copied).toHaveLength(1));
    expect(h.copied[0]?.split("\n")).toHaveLength(10);
  });

  it("Ctrl+C on a sidebar row copies the poll", async () => {
    await connected();
    const row = screen.getAllByRole("option")[0] as HTMLElement;
    row.focus();
    thai("KeyC", { ctrl: true });
    await waitFor(() => expect(h.copied.length).toBeGreaterThan(0));
  });

  it("a Thai character typed into a text field is text, not a shortcut", async () => {
    const { a } = await connected();
    grid(a).focus();
    await h.user.click(within(frame(a)).getByRole("button", { name: "Poll setup (Ctrl+\\)" }));
    const name = within(frame(a)).getByLabelText("Name");
    name.focus();
    expect(thai("KeyP")).toBe(false);
    expect(thai("KeyP", { shift: true })).toBe(false);
    // Ctrl+V / C / X / A / Z stay with the field; Ctrl+Shift+V (plain paste) too.
    for (const code of ["KeyV", "KeyC", "KeyX", "KeyA", "KeyZ"]) {
      expect(thai(code, { ctrl: true }), code).toBe(false);
    }
    expect(thai("KeyV", { ctrl: true, shift: true })).toBe(false);
    await h.act(async () => {});
    expect(h.ipc.callsOf("setPollActive")).toHaveLength(0);
  });

  it("AltGr (Ctrl+Alt) with a Thai or a Latin character does not fire Ctrl shortcuts", async () => {
    const { b } = await connected();
    h.rt.stores.pollList.getState().select(b);
    expect(thai("KeyP", { ctrl: true, alt: true })).toBe(false);
    expect(press("p", "KeyP", { ctrl: true, alt: true })).toBe(false);
    expect(press("ł", "KeyL", { ctrl: true, alt: true })).toBe(false);
    await h.act(async () => {});
    expect(h.ipc.callsOf("setPollActive")).toHaveLength(0);
  });

  it("every key is off while a dialog is open", async () => {
    await connected();
    h.rt.stores.host.getState().requestDelete(h.ipc.pollIds()[0] as number);
    await screen.findByRole("alertdialog");
    thai("KeyN", { ctrl: true, shift: true });
    thai("KeyJ", { ctrl: true });
    await h.act(async () => {});
    expect(h.ipc.callsOf("addPoll")).toHaveLength(2);
    expect(h.rt.stores.workspace.getState().traffic.expanded).toBe(false);
  });

  it("Latin layouts are untouched: a French AZERTY Ctrl+& is Ctrl+1", async () => {
    const { a } = await connected();
    grid(a).focus();
    press("&", "Digit1", { ctrl: true });
    await waitFor(() => expect(h.ipc.pollSummary(a).config.display.format).toBe("unsigned"));
    press('"', "Digit3", { ctrl: true });
    await waitFor(() => expect(h.ipc.pollSummary(a).config.display.format).toBe("hex"));
  });
});

describe("other layouts in W1 (CHK2-R9, R10, R12)", () => {
  beforeEach(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });

  it("Russian Ctrl+З pauses the focused sub-window poll", async () => {
    const { a } = await connected();
    grid(a).focus();
    press("з", "KeyP", { ctrl: true });
    await waitFor(() => expect(h.ipc.callsOf("setPollActive")).toEqual([[a, false]]));
  });

  it("Dvorak: the physical P key types l, so it is Ctrl+L and does not pause; the key labelled p does", async () => {
    const { a } = await connected();
    grid(a).focus();
    press("p", "KeyR", { ctrl: true });
    await waitFor(() => expect(h.ipc.callsOf("setPollActive")).toEqual([[a, false]]));
    press("l", "KeyP", { ctrl: true });
    await waitFor(() => expect(h.ipc.callsOf("disconnect")).toHaveLength(1));
    expect(h.ipc.callsOf("setPollActive")).toHaveLength(1);
  });

  it("Dvorak: Ctrl+. on the physical E key does not open Write; the key labelled e does", async () => {
    const { a } = await connected();
    grid(a).focus();
    press(".", "KeyE", { ctrl: true });
    await h.act(async () => {});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    press("e", "KeyD", { ctrl: true });
    expect(await screen.findByRole("dialog", { name: "Write · A" })).toBeVisible();
  });

  it("AZERTY: Ctrl with the digit row selects the formats without Shift", async () => {
    const { a } = await connected();
    grid(a).focus();
    for (const [key, code, format] of [
      ["é", "Digit2", "signed"],
      ["'", "Digit4", "binary"],
      ['"', "Digit3", "hex"],
      ["&", "Digit1", "unsigned"],
    ] as const) {
      press(key, code, { ctrl: true });
      await waitFor(() => expect(h.ipc.pollSummary(a).config.display.format).toBe(format));
    }
  });

  it("AZERTY: Ctrl+A is the key labelled A (physical Q) and selects all rows", async () => {
    const { a } = await connected();
    grid(a).focus();
    press("a", "KeyQ", { ctrl: true });
    press("c", "KeyC", { ctrl: true });
    await waitFor(() => expect(h.copied).toHaveLength(1));
    expect(h.copied[0]?.split("\n")).toHaveLength(10);
  });

  it("IME composition and a dead key fire nothing", async () => {
    const { b } = await connected();
    h.rt.stores.pollList.getState().select(b);
    expect(press("Process", "KeyP", { ctrl: true })).toBe(false);
    expect(press("Dead", "KeyP", { ctrl: true })).toBe(false);
    await h.act(async () => {});
    expect(h.ipc.callsOf("setPollActive")).toHaveLength(0);
  });
});

describe("a native poll window with the Thai layout", () => {
  async function open() {
    n = await renderNativeWindow();
    await n.connect();
    n.advance(300);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  it("Ctrl+P pauses, Ctrl+S saves, Ctrl+Shift+N adds, Ctrl+Shift+D docks", async () => {
    await open();
    expect(thai("KeyP", { ctrl: true })).toBe(true);
    await waitFor(() => expect(n.ipc.callsOf("setPollActive")).toEqual([[n.pollId, false]]));
    thai("KeyS", { ctrl: true });
    await waitFor(() => expect(n.ipc.callsOf("requestSave")).toEqual([[false]]));
    thai("KeyS", { ctrl: true, shift: true });
    await waitFor(() => expect(n.ipc.callsOf("requestSave")).toEqual([[false], [true]]));
    thai("KeyN", { ctrl: true, shift: true });
    await waitFor(() => expect(n.ipc.callsOf("addPoll")).toHaveLength(2));
    thai("KeyD", { ctrl: true, shift: true });
    await waitFor(() => expect(n.ipc.callsOf("dockPoll")).toHaveLength(1));
  });

  it("Ctrl+E opens Write, Ctrl+3 and Ctrl+B set the view", async () => {
    await open();
    thai("KeyE", { ctrl: true });
    expect(await screen.findByRole("dialog", { name: "Write · Pump 2" })).toBeVisible();
    await n.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    thai("Digit3", { ctrl: true });
    await waitFor(() => expect(n.ipc.pollSummary(n.pollId).config.display.format).toBe("hex"));
    thai("KeyB", { ctrl: true });
    await waitFor(() => expect(n.ipc.pollSummary(n.pollId).config.display.addressBase).toBe(1));
  });

  it("Ctrl+\\ toggles the setup panel, Ctrl+Shift+\\ compact mode, Ctrl+Shift+T tiles", async () => {
    await open();
    expect(n.rt.view.stores.ui.getState().setupOpen).toBe(true);
    thai("Backslash", { ctrl: true });
    expect(n.rt.view.stores.ui.getState().setupOpen).toBe(false);
    thai("Backslash", { ctrl: true, shift: true });
    await waitFor(() => expect(n.ipc.callsOf("setCompactMode")).toHaveLength(1));
    thai("KeyT", { ctrl: true, shift: true });
    await waitFor(() => expect(n.ipc.callsOf("arrangePollWindows")).toHaveLength(1));
  });

  it("Ctrl with key + on code Backslash toggles the setup, Ctrl+Shift with ฅ is compact mode; AltGr does nothing", async () => {
    await open();
    expect(n.rt.view.stores.ui.getState().setupOpen).toBe(true);
    expect(press("+", "Backslash", { ctrl: true })).toBe(true);
    expect(n.rt.view.stores.ui.getState().setupOpen).toBe(false);
    expect(press("#", "Backslash", { ctrl: true, alt: true })).toBe(false);
    expect(n.rt.view.stores.ui.getState().setupOpen).toBe(false);
    press("ฅ", "Backslash", { ctrl: true, shift: true });
    await waitFor(() => expect(n.ipc.callsOf("setCompactMode")).toHaveLength(1));
  });

  it("F6 cycles the regions", async () => {
    await open();
    (
      screen
        .getByRole("toolbar", { name: "Poll window toolbar" })
        .querySelector("button") as HTMLElement
    ).focus();
    press("F6", "F6");
    expect(document.activeElement?.closest("[data-region]")?.getAttribute("data-region")).toBe(
      "setup",
    );
  });

  it("the keys of the connection window stay suppressed and do nothing here", async () => {
    await open();
    expect(thai("KeyO", { ctrl: true })).toBe(true);
    expect(thai("KeyJ", { ctrl: true })).toBe(true);
    await n.act(async () => {});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("AltGr with a Thai character is not a shortcut", async () => {
    await open();
    expect(thai("KeyP", { ctrl: true, alt: true })).toBe(false);
    await n.act(async () => {});
    expect(n.ipc.callsOf("setPollActive")).toHaveLength(0);
  });
});
