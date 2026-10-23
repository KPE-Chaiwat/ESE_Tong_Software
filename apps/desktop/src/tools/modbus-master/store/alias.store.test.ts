import { pollConfigInput } from "@/shared/ipc/modbus-master.fake";
import type { AliasEntry, FormatOverride, PollConfig } from "@/shared/ipc/modbus-master.types";
import { createToastStore, type ToastStoreApi } from "@/shared/lib/toast.store";
import { type AliasStoreApi, createAliasStore, selectAliasAt } from "./alias.store";

let config: PollConfig;
let store: AliasStoreApi;
let toasts: ToastStoreApi;
let sent: Array<{ aliases: AliasEntry[] }>;
let setViewResult: boolean;

const makeConfig = (aliases: AliasEntry[] = [], start = 0, quantity = 10): PollConfig => ({
  ...pollConfigInput({
    name: "Tank",
    aliases,
    definition: { slaveId: 1, function: 3, startAddress: start, quantity, scanRateMs: 1000 },
  }),
  pollId: 1,
  active: true,
});

function make(aliases: AliasEntry[] = [], start = 0, quantity = 10) {
  config = makeConfig(aliases, start, quantity);
  sent = [];
  setViewResult = true;
  toasts = createToastStore({ setTimer: () => 0, clearTimer: () => {} });
  store = createAliasStore({
    getConfig: () => config,
    // Like pollStore.setView: the config is replaced at once, then the command is sent.
    setView: async (partial) => {
      sent.push(partial);
      config = { ...config, aliases: partial.aliases };
      store.getState().applyFromConfig(config);
      return setViewResult;
    },
    toasts,
  });
  store.getState().applyFromConfig(config);
}

const toastTexts = () => toasts.getState().items.map((t) => t.text);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => make());

describe("initial state and applyFromConfig", () => {
  it("starts without aliases and without an editor", () => {
    expect(store.getState().aliases.size).toBe(0);
    expect(store.getState()).toMatchObject({ editing: null, pending: false });
  });

  it("mirrors the aliases of the applied poll", () => {
    make([
      { address: 0, alias: "Tank top" },
      { address: 5, alias: "PT-201" },
    ]);
    expect(selectAliasAt(0)(store.getState())).toBe("Tank top");
    expect(selectAliasAt(5)(store.getState())).toBe("PT-201");
    expect(selectAliasAt(1)(store.getState())).toBeUndefined();
    expect(store.getState().aliases.size).toBe(2);
  });

  it("keeps the same Map when nothing changed", () => {
    make([{ address: 0, alias: "A" }]);
    const before = store.getState().aliases;
    store.getState().applyFromConfig({ ...config, name: "Renamed" });
    expect(store.getState().aliases).toBe(before);
  });

  it("aliases follow the address: a changed Start keeps every alias on its protocol address", () => {
    make([{ address: 0, alias: "Tank top" }]);
    store.getState().applyFromConfig({
      ...config,
      definition: { ...config.definition, startAddress: 5 },
    });
    expect(selectAliasAt(0)(store.getState())).toBe("Tank top");
  });
});

describe("editing: begin, setText, cancel", () => {
  it("beginEdit opens the editor with the current alias", () => {
    make([{ address: 3, alias: "Pump" }]);
    store.getState().beginEdit(3, "dblclick");
    expect(store.getState().editing).toEqual({
      address: 3,
      text: "Pump",
      error: null,
      startedBy: "dblclick",
    });
    store.getState().beginEdit(4, "f2");
    expect(store.getState().editing).toMatchObject({ address: 4, text: "", startedBy: "f2" });
  });

  it("beginEdit outside the poll range does nothing", () => {
    store.getState().beginEdit(10, "menu");
    store.getState().beginEdit(-1, "menu");
    expect(store.getState().editing).toBeNull();
  });

  it("setText validates on each keystroke", () => {
    store.getState().beginEdit(0, "f2");
    store.getState().setText("x".repeat(33));
    expect(store.getState().editing?.error).toBe("Alias must be at most 32 characters.");
    store.getState().setText("x".repeat(32));
    expect(store.getState().editing?.error).toBeNull();
    store.getState().setText(" a");
    expect(store.getState().editing?.error).toBe("Alias cannot start or end with a space.");
    store.getState().setText("a\tb");
    expect(store.getState().editing?.error).toBe("Alias cannot contain control characters.");
    store.getState().setText("   ");
    expect(store.getState().editing?.error).toBeNull();
  });

  it("setText without an editor does nothing", () => {
    store.getState().setText("x");
    expect(store.getState().editing).toBeNull();
  });

  it("cancel restores the previous text and ends editing without a command", () => {
    make([{ address: 0, alias: "Old" }]);
    store.getState().beginEdit(0, "f2");
    store.getState().setText("New");
    store.getState().cancel();
    expect(store.getState().editing).toBeNull();
    expect(selectAliasAt(0)(store.getState())).toBe("Old");
    expect(sent).toHaveLength(0);
  });
});

describe("commit", () => {
  it("commit of 'Tank top' at address 0 sends one setPollView with the alias and nothing else", async () => {
    store.getState().beginEdit(0, "dblclick");
    store.getState().setText("Tank top");
    expect(store.getState().commit("enter")).toBe("next");
    await flush();
    expect(sent).toEqual([{ aliases: [{ address: 0, alias: "Tank top" }] }]);
    expect(selectAliasAt(0)(store.getState())).toBe("Tank top");
  });

  it("Enter opens the next row's editor", () => {
    make([{ address: 1, alias: "Second" }]);
    store.getState().beginEdit(0, "f2");
    store.getState().setText("First");
    expect(store.getState().commit("enter")).toBe("next");
    expect(store.getState().editing).toEqual({
      address: 1,
      text: "Second",
      error: null,
      startedBy: "f2",
    });
  });

  it("Enter on the last row commits and ends editing", () => {
    store.getState().beginEdit(9, "f2");
    store.getState().setText("Last");
    expect(store.getState().commit("enter")).toBe("end");
    expect(store.getState().editing).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("Shift+Enter opens the previous row's editor; on the first row it ends", () => {
    store.getState().beginEdit(2, "f2");
    expect(store.getState().commit("shiftEnter")).toBe("prev");
    expect(store.getState().editing?.address).toBe(1);
    store.getState().beginEdit(0, "f2");
    expect(store.getState().commit("shiftEnter")).toBe("end");
    expect(store.getState().editing).toBeNull();
  });

  it("Tab commits and ends editing", () => {
    store.getState().beginEdit(0, "f2");
    store.getState().setText("A");
    expect(store.getState().commit("tab")).toBe("end");
    expect(store.getState().editing).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("blur commits when valid", () => {
    store.getState().beginEdit(0, "f2");
    store.getState().setText("A");
    expect(store.getState().commit("blur")).toBe("end");
    expect(sent).toEqual([{ aliases: [{ address: 0, alias: "A" }] }]);
  });

  it("blur reverts silently when invalid", () => {
    store.getState().beginEdit(0, "f2");
    store.getState().setText("x".repeat(40));
    expect(store.getState().commit("blur")).toBe("end");
    expect(store.getState().editing).toBeNull();
    expect(sent).toHaveLength(0);
    expect(toastTexts()).toEqual([]);
  });

  it("an invalid text returns 'invalid' for Enter, Shift+Enter and Tab and sends nothing", () => {
    store.getState().beginEdit(0, "f2");
    store.getState().setText("x".repeat(33));
    for (const key of ["enter", "shiftEnter", "tab"] as const) {
      expect(store.getState().commit(key)).toBe("invalid");
    }
    expect(store.getState().editing).toMatchObject({
      address: 0,
      error: "Alias must be at most 32 characters.",
    });
    expect(sent).toHaveLength(0);
  });

  it("spaces only removes the alias", () => {
    make([{ address: 0, alias: "Old" }]);
    store.getState().beginEdit(0, "f2");
    store.getState().setText("   ");
    store.getState().commit("tab");
    expect(sent).toEqual([{ aliases: [] }]);
    expect(selectAliasAt(0)(store.getState())).toBeUndefined();
  });

  it("an unchanged text sends nothing", () => {
    make([{ address: 0, alias: "Same" }]);
    store.getState().beginEdit(0, "f2");
    expect(store.getState().commit("enter")).toBe("next");
    expect(sent).toHaveLength(0);
    make();
    store.getState().beginEdit(0, "f2");
    store.getState().setText("");
    store.getState().commit("tab");
    expect(sent).toHaveLength(0);
  });

  it("Enter on consecutive rows keeps every earlier alias (spreadsheet style)", async () => {
    store.getState().beginEdit(0, "f2");
    store.getState().setText("A");
    store.getState().commit("enter");
    store.getState().setText("B");
    store.getState().commit("enter");
    store.getState().setText("C");
    store.getState().commit("tab");
    await flush();
    expect(sent.at(-1)?.aliases).toEqual([
      { address: 0, alias: "A" },
      { address: 1, alias: "B" },
      { address: 2, alias: "C" },
    ]);
  });

  it("without an editor it ends", () => {
    expect(store.getState().commit("enter")).toBe("end");
  });

  it("duplicate aliases are allowed", async () => {
    make([{ address: 0, alias: "PT-201" }]);
    store.getState().beginEdit(1, "f2");
    store.getState().setText("PT-201");
    expect(store.getState().commit("tab")).toBe("end");
    await flush();
    expect(sent.at(-1)?.aliases).toHaveLength(2);
  });

  it("at the cap of 2000 a new alias shows the limit message and sends nothing", () => {
    const full = Array.from({ length: 2000 }, (_, i) => ({ address: i, alias: `a${i}` }));
    make(full, 0, 2100);
    store.getState().beginEdit(2050, "f2");
    store.getState().setText("one more");
    expect(store.getState().commit("enter")).toBe("invalid");
    expect(store.getState().editing?.error).toBe("A poll can have at most 2000 aliases.");
    expect(sent).toHaveLength(0);
    // changing or removing an existing alias still works at the cap
    store.getState().beginEdit(5, "f2");
    store.getState().setText("changed");
    expect(store.getState().commit("tab")).toBe("end");
    expect(sent).toHaveLength(1);
  });

  it("sets pending while the command runs", async () => {
    let release: (ok: boolean) => void = () => {};
    store = createAliasStore({
      getConfig: () => config,
      setView: () => new Promise<boolean>((resolve) => (release = resolve)),
      toasts,
    });
    store.getState().beginEdit(0, "f2");
    store.getState().setText("A");
    store.getState().commit("tab");
    expect(store.getState().pending).toBe(true);
    release(true);
    await flush();
    expect(store.getState().pending).toBe(false);
  });

  it("a rejected command is rolled back by the config that comes back", async () => {
    setViewResult = false;
    store.getState().beginEdit(0, "f2");
    store.getState().setText("A");
    store.getState().commit("tab");
    await flush();
    expect(store.getState().pending).toBe(false);
    // pollStore restores the config after a rejection; the mirror follows it
    config = makeConfig();
    store.getState().applyFromConfig(config);
    expect(selectAliasAt(0)(store.getState())).toBeUndefined();
  });
});

describe("clear", () => {
  it("removes the aliases of the given addresses in one command", async () => {
    make([
      { address: 0, alias: "A" },
      { address: 1, alias: "B" },
      { address: 2, alias: "C" },
      { address: 5, alias: "F" },
    ]);
    await store.getState().clear([0, 1, 2]);
    expect(sent).toEqual([{ aliases: [{ address: 5, alias: "F" }] }]);
    expect(store.getState().aliases.size).toBe(1);
  });

  it("sends nothing when none of the rows has an alias", async () => {
    make([{ address: 5, alias: "F" }]);
    await store.getState().clear([0, 1]);
    expect(sent).toHaveLength(0);
  });
});

describe("paste", () => {
  it("pastes consecutive aliases from the start row and shows the toast", async () => {
    const result = await store.getState().paste("A\nB", 8);
    // the range is 0-9, so 8 and 9 are inside
    expect(sent).toEqual([
      {
        aliases: [
          { address: 8, alias: "A" },
          { address: 9, alias: "B" },
        ],
      },
    ]);
    expect(result).toEqual({ pasted: 2, skipped: 0, beyond: 0, capped: false });
    expect(toastTexts()).toEqual(["Pasted 2 aliases."]);
  });

  it("the toast for 3 pasted, 1 invalid and 2 beyond", async () => {
    const lines = ["A", "B", "x".repeat(40), "C", "D", "E"];
    // rows 6, 7 and 9 are pasted, row 8 is invalid, D and E are past the end of the range (0-9)
    const result = await store.getState().paste(lines.join(String.fromCharCode(10)), 6);
    expect(result).toEqual({ pasted: 3, skipped: 1, beyond: 2, capped: false });
    expect(toastTexts()).toEqual([
      "Pasted 3 aliases. Skipped 1 invalid lines. 2 lines were beyond the poll range.",
    ]);
  });

  it("empty lines clear aliases, and aliases outside the range are kept", async () => {
    make(
      [
        { address: 2, alias: "keep me out of range" },
        { address: 8, alias: "Old" },
      ],
      5,
      5,
    );
    await store.getState().paste("\nNew", 8);
    expect(sent.at(-1)?.aliases).toEqual([
      { address: 2, alias: "keep me out of range" },
      { address: 9, alias: "New" },
    ]);
  });

  it("at the cap it reports it and sends what fits", async () => {
    const full = Array.from({ length: 1999 }, (_, i) => ({ address: i, alias: `a${i}` }));
    make(full, 0, 2100);
    const result = await store.getState().paste("one\ntwo\nthree", 2000);
    expect(result).toMatchObject({ pasted: 1, capped: true });
    expect(sent.at(-1)?.aliases).toHaveLength(2000);
    expect(toastTexts()).toEqual(["Pasted 1 aliases. The poll has reached 2000 aliases."]);
  });

  it("an empty clipboard does nothing", async () => {
    expect(await store.getState().paste("", 0)).toBeNull();
    expect(sent).toHaveLength(0);
    expect(toastTexts()).toEqual([]);
  });

  it("a paste that changes nothing sends nothing but still reports", async () => {
    make([{ address: 0, alias: "A" }]);
    await store.getState().paste("A", 0);
    expect(sent).toHaveLength(0);
    expect(toastTexts()).toEqual(["Pasted 1 aliases."]);
  });
});

// ---- rows with 32/64-bit groups (DES-009 8.5, vectors L1) ----
describe("aliases on rows with groups", () => {
  const f32 = (start: number, end: number): FormatOverride => ({
    start,
    end,
    format: "float32",
    swapBytes: false,
    reverseWords: false,
  });
  /** L1: rows 0, 1, 2-3, 4-5, 6, 7, 8, 9. */
  function withGroups(aliases: AliasEntry[] = []) {
    make(aliases);
    config = { ...config, formatOverrides: [f32(2, 5)] };
    store.getState().applyFromConfig(config);
  }

  it("beginEdit on a continuation edits that register's own alias", () => {
    withGroups([{ address: 3, alias: "Flow low" }]);
    store.getState().beginEdit(3, "dblclick");
    expect(store.getState().editing).toMatchObject({ address: 3, text: "Flow low" });
  });

  it("Enter moves to the next visible register, including a continuation", () => {
    withGroups();
    store.getState().beginEdit(1, "f2");
    expect(store.getState().commit("enter")).toBe("next");
    expect(store.getState().editing?.address).toBe(2);
    expect(store.getState().commit("enter")).toBe("next");
    expect(store.getState().editing?.address).toBe(3);
  });

  it("Shift+Enter moves to the previous row, and ends on the first", () => {
    withGroups();
    store.getState().beginEdit(4, "f2");
    expect(store.getState().commit("shiftEnter")).toBe("prev");
    expect(store.getState().editing?.address).toBe(3);
    expect(store.getState().commit("shiftEnter")).toBe("prev");
    expect(store.getState().editing?.address).toBe(2);
    store.getState().cancel();
    store.getState().beginEdit(0, "f2");
    expect(store.getState().commit("shiftEnter")).toBe("end");
    expect(store.getState().editing).toBeNull();
  });

  it("Enter on the last row ends", () => {
    withGroups();
    store.getState().beginEdit(9, "f2");
    expect(store.getState().commit("enter")).toBe("end");
  });

  it("paste puts line i on register i: from row 1 three lines go to 1, 2 and 3", async () => {
    withGroups();
    await store.getState().paste(["A", "B", "C"].join(String.fromCharCode(10)), 1);
    expect(sent.at(-1)?.aliases).toEqual([
      { address: 1, alias: "A" },
      { address: 2, alias: "B" },
      { address: 3, alias: "C" },
    ]);
  });

  it("paste from a register inside a group starts at that group's row; lines past the last row are beyond", async () => {
    withGroups();
    await store.getState().paste(["A", "B", "C"].join(String.fromCharCode(10)), 7);
    expect(sent.at(-1)?.aliases).toEqual([
      { address: 7, alias: "A" },
      { address: 8, alias: "B" },
      { address: 9, alias: "C" },
    ]);
    expect(toastTexts().at(-1)).toBe("Pasted 3 aliases.");
    await store.getState().paste(["X", "Y", "Z"].join(String.fromCharCode(10)), 9);
    expect(toastTexts().at(-1)).toBe("Pasted 1 aliases. 2 lines were beyond the poll range.");
  });

  it("paste outside the poll does nothing", async () => {
    withGroups();
    expect(await store.getState().paste("A", 50)).toBeNull();
    expect(sent).toEqual([]);
  });

  it("clear removes the given addresses only (the other registers of a group keep theirs)", async () => {
    withGroups([
      { address: 2, alias: "Group" },
      { address: 3, alias: "Second" },
    ]);
    await store.getState().clear([2]);
    expect(sent.at(-1)?.aliases).toEqual([{ address: 3, alias: "Second" }]);
  });
});
