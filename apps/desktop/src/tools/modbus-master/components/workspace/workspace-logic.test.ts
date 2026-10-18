import { vi } from "vitest";
import type { MenuEntry } from "@/shared/ui/menu";
import { nextRegion } from "../shell/use-regions";
import { frameKeyAction, isTextEntry } from "./frame-keys";
import { MOVE_TO_ZONES, titleBarMenuEntries, zoneMenuLabel } from "./title-bar-menu.logic";

const base = () => ({
  state: "normal" as const,
  tileMode: false,
  snapEnabled: true,
  slotCount: 0,
  slotIndex: 0,
  canPopOut: false,
  onRestore: vi.fn(),
  onMove: vi.fn(),
  onSize: vi.fn(),
  onMinimize: vi.fn(),
  onMaximize: vi.fn(),
  onMoveToZone: vi.fn(),
  onMoveToSlot: vi.fn(),
  onPopOut: vi.fn(),
  onToggleSnap: vi.fn(),
  onClose: vi.fn(),
});

type Item = MenuEntry & {
  disabled?: boolean;
  checked?: boolean;
  label: string;
  onSelect: () => void;
};
/** An entry by id, also inside the "Move to" submenu. */
const item = (entries: MenuEntry[], id: string): Item => {
  for (const e of entries) {
    if (e.id === id) return e as Item;
    if (e.kind === "submenu") {
      const inner = e.entries.find((x) => x.id === id);
      if (inner) return inner as Item;
    }
  }
  return undefined as unknown as Item;
};
const moveTo = (entries: MenuEntry[]) =>
  (entries.find((e) => e.id === "move-to") as Extract<MenuEntry, { kind: "submenu" }>).entries;

describe("frame keys (DES-002 2.10.8)", () => {
  const key = (k: string, mods: Partial<{ alt: boolean; ctrl: boolean; shift: boolean }> = {}) =>
    frameKeyAction({
      key: k,
      altKey: mods.alt ?? false,
      ctrlKey: mods.ctrl ?? false,
      shiftKey: mods.shift ?? false,
    });

  it("Alt+Arrow moves, Shift makes it 1 px", () => {
    expect(key("ArrowRight", { alt: true })).toEqual({ kind: "move", dir: "right", fine: false });
    expect(key("ArrowUp", { alt: true, shift: true })).toEqual({
      kind: "move",
      dir: "up",
      fine: true,
    });
  });

  it("Ctrl+Alt+Arrow resizes", () => {
    expect(key("ArrowDown", { alt: true, ctrl: true })).toEqual({
      kind: "size",
      dir: "down",
      fine: false,
    });
  });

  it("Ctrl+Shift+Arrow swaps", () => {
    expect(key("ArrowLeft", { ctrl: true, shift: true })).toEqual({ kind: "swap", dir: "left" });
  });

  it("plain arrows and other combinations are not window keys", () => {
    expect(key("ArrowRight")).toBeNull();
    expect(key("ArrowRight", { shift: true })).toBeNull();
    expect(key("ArrowRight", { ctrl: true })).toBeNull();
    expect(key("a", { alt: true })).toBeNull();
    expect(
      frameKeyAction({
        key: "ArrowRight",
        altKey: true,
        ctrlKey: false,
        shiftKey: false,
        metaKey: true,
      }),
    ).toBeNull();
  });

  it("text fields keep their keys", () => {
    expect(isTextEntry(document.createElement("input"))).toBe(true);
    expect(isTextEntry(document.createElement("textarea"))).toBe(true);
    expect(isTextEntry(document.createElement("select"))).toBe(true);
    expect(isTextEntry(document.createElement("button"))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

describe("title bar menu (DES-002 2.3.1, 2.10.8)", () => {
  it("lists Restore, Move, Size, Minimize, Maximize, Move to, Snap while moving and Close", () => {
    const entries = titleBarMenuEntries(base());
    expect(
      entries.filter((e) => e.kind !== "separator").map((e) => ("label" in e ? e.label : "")),
    ).toEqual([
      "Restore",
      "Move",
      "Size",
      "Minimize",
      "Maximize",
      "Move to",
      "Snap while moving",
      "Close",
    ]);
    // "Move to" is a real submenu (DES-002 2.10.8).
    expect(entries.find((e) => e.id === "move-to")?.kind).toBe("submenu");
    expect(
      moveTo(entries)
        .filter((e) => e.kind !== "separator")
        .map((e) => ("label" in e ? e.label : "")),
    ).toEqual([
      "Left half",
      "Right half",
      "Top-left quarter",
      "Top-right quarter",
      "Bottom-left quarter",
      "Bottom-right quarter",
      "Full workspace",
    ]);
    expect(item(entries, "close")).toMatchObject({ shortcut: "Ctrl+F4" });
  });

  it("a normal window can move, size, minimize and maximize but not restore", () => {
    const e = titleBarMenuEntries(base());
    expect(item(e, "restore").disabled).toBe(true);
    for (const id of ["move", "size", "maximize", "minimize"])
      expect(item(e, id).disabled).toBeFalsy();
  });

  it("a maximized window can restore but not move, size or maximize", () => {
    const e = titleBarMenuEntries({ ...base(), state: "maximized" });
    expect(item(e, "restore").disabled).toBe(false);
    for (const id of ["move", "size", "maximize"]) expect(item(e, id).disabled).toBe(true);
  });

  it("in tile mode Move and Size are off and the zones become Slot 1 to n", () => {
    const e = titleBarMenuEntries({ ...base(), tileMode: true, slotCount: 3, slotIndex: 1 });
    expect(item(e, "move").disabled).toBe(true);
    expect(item(e, "size").disabled).toBe(true);
    expect(moveTo(e).some((x) => x.id.startsWith("zone-"))).toBe(false);
    expect(item(e, "slot-0").label).toBe("Slot 1");
    expect(item(e, "slot-1").disabled).toBe(true);
    expect(item(e, "slot-2").label).toBe("Slot 3");
  });

  it("Snap while moving is a checkbox", () => {
    expect(item(titleBarMenuEntries(base()), "snap")).toMatchObject({
      kind: "check",
      checked: true,
    });
    expect(item(titleBarMenuEntries({ ...base(), snapEnabled: false }), "snap").checked).toBe(
      false,
    );
  });

  it("the pop out entries (top level and in Move to) appear only when the host provides them", () => {
    const without = titleBarMenuEntries(base());
    expect(without.some((e) => e.id === "pop-out")).toBe(false);
    expect(moveTo(without).some((e) => e.id === "own-window")).toBe(false);
    const withIt = titleBarMenuEntries({ ...base(), canPopOut: true });
    expect(withIt.find((e) => e.id === "pop-out")).toMatchObject({
      label: "Pop out to own window",
      shortcut: "Ctrl+Shift+O",
    });
    expect(moveTo(withIt).find((e) => e.id === "own-window")).toMatchObject({
      label: "Own window (pop out)",
    });
  });

  it("the entries call their handlers", () => {
    const input = base();
    const e = titleBarMenuEntries(input);
    item(e, "zone-left").onSelect();
    expect(input.onMoveToZone).toHaveBeenCalledWith("left");
    item(e, "move").onSelect();
    item(e, "close").onSelect();
    item(e, "snap").onSelect();
    expect(input.onMove).toHaveBeenCalled();
    expect(input.onClose).toHaveBeenCalled();
    expect(input.onToggleSnap).toHaveBeenCalled();
  });

  it("zone labels are capitalized", () => {
    expect(MOVE_TO_ZONES).toHaveLength(7);
    expect(zoneMenuLabel("topLeft")).toBe("Top-left quarter");
  });
});

describe("region cycle (F6)", () => {
  const present = ["toolbar", "sidebar", "workspace", "traffic"];

  it("moves forward and backward and wraps", () => {
    expect(nextRegion(present, "toolbar", 1)).toBe("sidebar");
    expect(nextRegion(present, "traffic", 1)).toBe("toolbar");
    expect(nextRegion(present, "toolbar", -1)).toBe("traffic");
  });

  it("starts at the first or the last region when the focus is in none", () => {
    expect(nextRegion(present, null, 1)).toBe("toolbar");
    expect(nextRegion(present, "status", -1)).toBe("traffic");
    expect(nextRegion([], null, 1)).toBeNull();
  });
});
