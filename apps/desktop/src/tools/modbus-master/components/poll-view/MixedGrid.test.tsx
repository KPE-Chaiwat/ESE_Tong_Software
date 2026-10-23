// The mixed grid: 16-bit rows and 32/64-bit group rows in one table (DES-009 section 3, FE-009
// task 06). Replaces the tests of the former combined grid; its decode vectors now run per group row.
import { act, fireEvent, screen, within } from "@testing-library/react";
import type { FormatOverride, PollConfigInput } from "@/shared/ipc/modbus-master.types";
import { createPollViewUiStore } from "../../store/poll-view-ui.store";
import {
  disposeHarnesses,
  installPollViewEnvironment,
  type PollViewHarness,
  renderPollView,
  uninstallPollViewEnvironment,
} from "./test-utils";

beforeAll(installPollViewEnvironment);
afterAll(uninstallPollViewEnvironment);
afterEach(disposeHarnesses);

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);

const ov = (
  start: number,
  end: number,
  format: FormatOverride["format"],
  flags: Partial<FormatOverride> = {},
): FormatOverride => ({ start, end, format, swapBytes: false, reverseWords: false, ...flags });
const LITTLE = { swapBytes: true, reverseWords: true };

const def = (start: number, quantity: number) => ({
  slaveId: 1,
  function: 3 as const,
  startAddress: start,
  quantity,
  scanRateMs: 100,
});

const rowOf = (index: number): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-row="${index}"]`);
  if (!el) throw new Error(`row ${index} is not rendered`);
  return el;
};
const cellOf = (row: number, kind: "alias" | "address" | "format" | "raw" | "scaled") =>
  rowOf(row).querySelector(`[data-cell="${kind}"]`) as HTMLElement;
const text = (el: HTMLElement) => el.textContent?.trim() ?? "";
const grid = () => screen.getByRole("grid", { name: "Register values" });

async function live(
  host: "workspace" | "native",
  values: number[],
  poll: Partial<PollConfigInput> = {},
): Promise<PollViewHarness> {
  const h = await renderPollView({
    host,
    mode: "manual",
    poll: { definition: def(0, values.length), ...poll },
  });
  act(() => {
    h.ipc.emitConnectionState("connected");
    h.ipc.emitPollState(h.pollId, "polling");
    h.ipc.emitPollUpdate(h.pollId, { values });
  });
  return h;
}

describe.each(["workspace", "native"] as const)("mixed grid in %s", (host) => {
  it("L1: 16-bit rows and Float32 group rows in address order with their cell texts", async () => {
    await live(host, [10, 0x00a1, 0x3f80, 0, 0x4000, 0, 5, 6, 7, 8], {
      formatOverrides: [ov(2, 5, "float32"), ov(1, 1, "hex")],
    });
    expect(grid()).toHaveAttribute("aria-rowcount", "11"); // 10 registers and the header
    const table = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [
      text(cellOf(i, "address")),
      text(cellOf(i, "format")),
      text(cellOf(i, "raw")),
    ]);
    expect(table).toEqual([
      ["0", "U16", "10"],
      ["1", "HEX", "0x00A1"],
      ["2", "F32 ABCD", "1"],
      ["3", "--", "--"],
      ["4", "F32 ABCD", "2"],
      ["5", "--", "--"],
      ["6", "U16", "5"],
      ["7", "U16", "6"],
      ["8", "U16", "7"],
      ["9", "U16", "8"],
    ]);
    expect(screen.getAllByRole("row")).toHaveLength(11);
    expect(cellOf(3, "address")).toHaveAttribute(
      "aria-label",
      "Register 3; continuation of value at register 2",
    );
    expect(cellOf(2, "format")).toHaveAttribute("aria-label", "Float 32-bit, Big-endian (ABCD)");
    expect(cellOf(0, "format")).toHaveAttribute("aria-label", "Unsigned");
    expect(rowOf(2)).toHaveAttribute("aria-rowindex", "4");
  });

  it("the header names the columns, with no format suffix on Raw", async () => {
    await live(host, [1, 2], { formatOverrides: [ov(0, 1, "hex")] });
    expect(
      screen.getAllByRole("columnheader").map((c) => c.textContent?.replace(/\s+/g, " ").trim()),
    ).toEqual(["Alias", "Address (0-based)", "Format", "Raw"]);
  });

  it("L2: a migrated Float32 little-endian poll shows two values and an Incomplete row", async () => {
    await live(host, [0, 0x803f, 0, 0xc03f, 7], {
      definition: def(100, 5),
      formatOverrides: [ov(100, 105, "float32", LITTLE)],
    });
    expect(
      [0, 1, 2, 3, 4].map((i) => [text(cellOf(i, "address")), text(cellOf(i, "format"))]),
    ).toEqual([
      ["100", "F32 DCBA"],
      ["101", "--"],
      ["102", "F32 DCBA"],
      ["103", "--"],
      ["104", "F32 DCBA"],
    ]);
    expect(text(cellOf(0, "raw"))).toBe("1");
    expect(text(cellOf(1, "raw"))).toBe("--");
    expect(text(cellOf(2, "raw"))).toBe("1.5");
    expect(text(cellOf(4, "raw"))).toBe("Incomplete");
    expect(
      within(cellOf(4, "raw")).getByRole("img", { name: "Needs 2 registers; only 1 available." }),
    ).toBeInTheDocument();
  });

  it("REPORT-030 D1: an incomplete row says Incomplete without any snapshot (L2, L3), a complete group row still has no value", async () => {
    // A running poll that has not had its first reply draws the rows loading: no snapshot.
    const h = await renderPollView({
      host,
      mode: "manual",
      poll: {
        definition: def(100, 5),
        formatOverrides: [ov(100, 105, "float32", LITTLE)],
      },
    });
    act(() => {
      h.ipc.emitConnectionState("connected");
      h.ipc.emitPollState(h.pollId, "polling");
    });
    expect(h.rt.stores.data.getState().values).toBeNull();
    expect([0, 1, 2, 3, 4].map((i) => text(cellOf(i, "raw")))).toEqual([
      "—",
      "--",
      "—",
      "--",
      "Incomplete",
    ]);
    expect(
      within(cellOf(4, "raw")).getByRole("img", { name: "Needs 2 registers; only 1 available." }),
    ).toBeInTheDocument();
    // with a snapshot the same row says the same, the others have their values
    act(() => h.ipc.emitPollUpdate(h.pollId, { values: [0, 0x803f, 0, 0xc03f, 7] }));
    expect([0, 1, 2, 3, 4].map((i) => text(cellOf(i, "raw")))).toEqual([
      "1",
      "--",
      "1.5",
      "--",
      "Incomplete",
    ]);
    // L3: the definition changes so that the poll starts inside a group; loading again, no snapshot
    await h.act(() => h.ipc.setPollView(h.pollId, { formatOverrides: [ov(100, 101, "float32")] }));
    await h.act(() => h.ipc.updatePoll(h.pollId, { ...def(101, 4), scanRateMs: 500 }));
    expect(h.rt.stores.data.getState().values).toBeNull();
    expect(text(cellOf(0, "address"))).toBe("101");
    expect(text(cellOf(0, "raw"))).toBe("Incomplete");
    expect(
      within(cellOf(0, "raw")).getByRole("img", { name: "Needs 2 registers; only 1 available." }),
    ).toBeInTheDocument();
    expect(text(cellOf(1, "raw"))).toBe("—");
  });

  it("shows exact u64, the Incomplete remainder, and copies interpreted values and every raw word", async () => {
    const h = await live(host, [0xffff, 0xffff, 0xffff, 0xffff, 1], {
      definition: def(1, 5),
      formatOverrides: [ov(1, 8, "unsigned64")],
      aliases: [{ address: 2, alias: "Second" }],
    });
    expect(screen.getByText("18446744073709551615")).toBeInTheDocument();
    expect(screen.getByText("Incomplete")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Needs 4 registers; only 1 available." }),
    ).toBeInTheDocument();
    expect(cellOf(0, "raw")).toHaveAttribute("title", "Raw words: 0xFFFF 0xFFFF 0xFFFF 0xFFFF");
    act(() => h.rt.stores.ui.getState().click(1));
    await h.act(() => h.rt.actions.copyRows());
    expect(h.copied.at(-1)).toBe(
      [
        ["1", "18446744073709551615"],
        ["2", "--"],
        ["3", "--"],
        ["4", "--"],
      ]
        .map((line) => line.join(TAB))
        .join(LF),
    );
    await h.user.click(screen.getByRole("button", { name: "Inspect raw registers 1–4" }));
    const dialog = screen.getByRole("dialog", { name: "Raw registers · 1–4" });
    expect(within(dialog).getByText("Second")).toBeInTheDocument();
    expect(within(dialog).getAllByText("65535")).toHaveLength(4);
    await h.user.click(within(dialog).getByRole("button", { name: "Copy raw registers" }));
    expect(h.copied.at(-1)).toBe(["1", "2", "3", "4"].map((a) => [a, "65535"].join(TAB)).join(LF));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.rt.stores.ui.getState().focusAddress).toBe(1);
    // the row the poll edge cuts: its inspector lists what is inside and what is outside
    await h.user.click(screen.getByRole("button", { name: "Inspect raw registers 5" }));
    const cut = screen.getByRole("dialog", { name: "Raw registers · 5" });
    expect(within(cut).getAllByRole("row")).toHaveLength(2); // the header and one register
    expect(
      within(cut).getByText("Registers 6-8 of this value are outside this poll."),
    ).toBeInTheDocument();
  });

  it("the Scaled cell of a group row says n/a with its explanation", async () => {
    await live(host, [1, 2, 3, 4], {
      formatOverrides: [ov(0, 1, "unsigned32")],
      scale: {
        preset: "divide",
        rawSigned: false,
        xMin: 0,
        xMax: 65535,
        yMin: 0,
        yMax: 1,
        divisor: 10,
        decimals: 1,
        unit: "",
        outOfRange: "flag",
      },
      valueColumns: "both",
    });
    const cell = cellOf(0, "scaled");
    expect(text(cell)).toBe("n/a");
    expect(cell).toHaveAttribute("title", "Scaling is unavailable for combined values.");
    expect(cell).toHaveAttribute("aria-label", "Scaling is unavailable for combined values.");
    // the 16-bit rows around it are scaled as before
    expect(text(cellOf(1, "scaled"))).toBe("--");
    expect(text(cellOf(2, "scaled"))).toBe("0.3");
  });

  it("FC01 shows 0 or 1 with no Format column and no group rows", async () => {
    await live(host, [1, 0, 1, 1], {
      definition: { slaveId: 1, function: 1, startAddress: 0, quantity: 4, scanRateMs: 100 },
      formatOverrides: [ov(0, 3, "float32")],
    });
    expect(screen.queryByRole("columnheader", { name: /Format/ })).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-row-kind='group']")).toHaveLength(0);
    expect(grid()).toHaveAttribute("aria-rowcount", "5");
  });

  it("arrow keys move by row, Shift+arrow selects whole rows, End goes to the last row", async () => {
    const h = await live(host, [1, 2, 3, 4, 5, 6, 7, 8], {
      formatOverrides: [ov(2, 5, "float32")],
    });
    act(() => h.rt.stores.ui.getState().click(1));
    grid().focus();
    await h.user.keyboard("{ArrowDown}");
    expect(h.rt.stores.ui.getState().focusAddress).toBe(2);
    expect(rowOf(2)).toHaveAttribute("aria-selected", "true");
    await h.user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(h.rt.stores.ui.getState().selection).toEqual([{ start: 2, end: 5 }]);
    expect(grid().getAttribute("aria-activedescendant")).toBe(rowOf(4).id);
    await h.user.keyboard("{End}");
    expect(h.rt.stores.ui.getState().focusAddress).toBe(7);
    await h.user.keyboard("{Home}");
    expect(h.rt.stores.ui.getState().focusAddress).toBe(0);
    await h.user.keyboard("{Control>}a{/Control}");
    expect(h.rt.stores.ui.getState().selection).toEqual([{ start: 0, end: 7 }]);
  });

  it("clicking a group row selects its registers and focuses its first", async () => {
    const h = await live(host, [1, 2, 3, 4, 5, 6], { formatOverrides: [ov(2, 5, "float32")] });
    await h.user.click(cellOf(5, "raw"));
    expect(h.rt.stores.ui.getState()).toMatchObject({
      selection: [{ start: 4, end: 5 }],
      focusAddress: 4,
    });
  });

  it("alias editing works on a group row and Enter moves to the next row", async () => {
    const h = await live(host, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], {
      formatOverrides: [ov(0, 3, "unsigned32")],
    });
    await h.act(() => h.rt.actions.editAlias(0, "f2"));
    const editor = screen.getByRole("textbox", { name: "Alias for address 0" });
    expect(editor).toHaveFocus();
    await h.user.keyboard("Pressure{Enter}");
    expect(h.ipc.pollSummary(h.pollId).config.aliases).toEqual([{ address: 0, alias: "Pressure" }]);
    // the next editor is the continuation register 1, then Escape ends editing
    const next = screen.getByRole("textbox", { name: "Alias for address 1" });
    expect(next).toHaveFocus();
    fireEvent.keyDown(next, { key: "Escape" });
    expect(grid()).toHaveFocus();
  });

  it("the alias of each register in a group shows on its own line", async () => {
    await live(host, [1, 2, 3, 4], {
      formatOverrides: [ov(0, 1, "unsigned32")],
      aliases: [
        { address: 0, alias: "First" },
        { address: 1, alias: "Second register" },
      ],
    });
    expect(text(cellOf(0, "alias"))).toBe("First");
    expect(text(cellOf(1, "alias"))).toBe("Second register");
  });

  it("a stale grid mutes its rows and shows no rule markers", async () => {
    const h = await live(host, [1, 2, 3, 4], {
      formatOverrides: [ov(0, 1, "unsigned32")],
      colorRules: [
        {
          name: "Any",
          enabled: true,
          range: null,
          source: "displayed",
          comparison: "always",
          threshold: "",
          upperThreshold: null,
          highlight: "warning",
        },
      ],
    });
    expect(screen.getAllByRole("img", { name: /Rule: Any/ }).length).toBeGreaterThan(0);
    act(() => h.ipc.emitPollState(h.pollId, "paused"));
    expect(grid()).toHaveAttribute("data-status", "stale");
    expect(cellOf(0, "raw").className).toContain("text-text-muted");
    expect(screen.queryAllByRole("img", { name: /Rule: Any/ })).toHaveLength(0);
  });

  it("before the first reply every row shows a dash", async () => {
    const h = await renderPollView({
      host,
      mode: "manual",
      poll: { formatOverrides: [ov(0, 1, "float32")] },
    });
    act(() => {
      h.ipc.emitConnectionState("connected");
      h.ipc.emitPollState(h.pollId, "polling");
    });
    expect(text(cellOf(0, "raw"))).toBe("—");
    expect(text(cellOf(1, "raw"))).toBe("--");
  });
});

describe.each(["workspace", "native"] as const)("row menu of the mixed grid in %s", (host) => {
  async function menuFor(index: number, h: PollViewHarness) {
    await h.user.pointer({ keys: "[MouseRight]", target: cellOf(index, "raw") });
    return screen.getByRole("menu", { name: "Row actions" });
  }

  it("offers Inspect raw registers on a group row only, and Copy raw registers on both", async () => {
    const h = await live(host, [1, 2, 3, 4, 5, 6], { formatOverrides: [ov(2, 3, "float32")] });
    let menu = await menuFor(2, h);
    expect(within(menu).getByRole("menuitem", { name: "Inspect raw registers" })).toBeVisible();
    expect(within(menu).getByRole("menuitem", { name: "Copy raw registers" })).toBeVisible();
    fireEvent.keyDown(menu, { key: "Escape" });
    menu = await menuFor(0, h);
    expect(
      within(menu).queryByRole("menuitem", { name: "Inspect raw registers" }),
    ).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Copy raw registers" })).toBeVisible();
  });

  it("Inspect raw registers opens the inspector for that row", async () => {
    const h = await live(host, [1, 2, 3, 4, 5, 6], { formatOverrides: [ov(2, 3, "float32")] });
    const menu = await menuFor(2, h);
    await h.user.click(within(menu).getByRole("menuitem", { name: "Inspect raw registers" }));
    expect(screen.getByRole("dialog", { name: "Raw registers · 2–3" })).toBeInTheDocument();
  });

  it("Copy scaled and Set scale are off for a group-only selection, with their reasons", async () => {
    const scale = {
      preset: "divide" as const,
      rawSigned: false,
      xMin: 0,
      xMax: 65535,
      yMin: 0,
      yMax: 1,
      divisor: 10,
      decimals: 1,
      unit: "",
      outOfRange: "flag" as const,
    };
    const h = await live(host, [1, 2, 3, 4, 5, 6], {
      formatOverrides: [ov(2, 3, "float32")],
      scale,
      valueColumns: "both",
    });
    let menu = await menuFor(2, h);
    const copyScaled = within(menu).getByRole("menuitem", { name: "Copy scaled" });
    expect(copyScaled).toHaveAttribute("aria-disabled", "true");
    expect(copyScaled).toHaveAttribute("title", "Scaling is unavailable for combined values.");
    const setScale = within(menu).getByRole("menuitem", { name: /Set scale for selected rows/ });
    expect(setScale).toHaveAttribute("aria-disabled", "true");
    expect(setScale).toHaveAttribute("title", "Scaling is unavailable for combined values.");
    fireEvent.keyDown(menu, { key: "Escape" });
    menu = await menuFor(0, h);
    expect(within(menu).getByRole("menuitem", { name: "Copy scaled" })).not.toHaveAttribute(
      "aria-disabled",
    );
    expect(
      within(menu).getByRole("menuitem", { name: /Set scale for selected rows/ }),
    ).not.toHaveAttribute("aria-disabled");
  });

  it("More formats… opens the dialog for the row, not the Poll setup, and applies nothing", async () => {
    const h = await live(host, [1, 2, 3, 4], {});
    const before = h.ipc.callsOf("setPollView").length;
    const menu = await menuFor(1, h);
    expect(within(menu).queryByRole("menuitem", { name: /Format \/ endian/ })).toBeNull();
    await h.user.click(within(menu).getByRole("menuitem", { name: "More formats…" }));
    const dialog = screen.getByRole("dialog", { name: "Format / endian" });
    expect(within(dialog).getByRole("radio", { name: "Unsigned" })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: "Unsigned" })).toHaveFocus();
    expect(screen.queryByRole("region", { name: "Interpretation" })).not.toBeInTheDocument();
    expect(h.rt.stores.ui.getState().setupOpen).toBe(host === "native");
    expect(h.ipc.callsOf("setPollView")).toHaveLength(before);
  });

  it("is disabled on a coil poll with its tooltip", async () => {
    const h = await live(host, [1, 0, 1, 1], {
      definition: { slaveId: 1, function: 1, startAddress: 0, quantity: 4, scanRateMs: 100 },
    });
    const menu = await menuFor(0, h);
    const item = within(menu).getByRole("menuitem", { name: "More formats…" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAttribute("title", "Coils and discrete inputs are shown as 0 or 1.");
    // no quick formats and no heading on a bit poll (DES-010 10.5)
    for (const name of ["Unsigned", "Signed", "Hex", "Binary"]) {
      expect(
        within(menu).queryByRole("menuitemradio", { name: new RegExp(`^${name}`) }),
      ).toBeNull();
    }
    expect(within(menu).queryByText(/^Value format/)).toBeNull();
    expect(
      within(menu).queryByRole("menuitem", { name: "Copy raw registers" }),
    ).not.toBeInTheDocument();
  });
});

describe.each(["workspace", "native"] as const)("value color rules per row in %s", (host) => {
  const rawRule = (patch: object = {}) => ({
    name: "High",
    enabled: true,
    range: { start: 0, end: 9 },
    source: "raw" as const,
    comparison: "greaterThan" as const,
    threshold: "10",
    upperThreshold: null,
    highlight: "lime" as const,
    ...patch,
  });
  const marked = (index: number) =>
    within(cellOf(index, "raw")).queryByRole("img", { name: /Rule: High/ }) !== null;

  it("Raw > 10 on L1: 16-bit rows by their value, group rows by their Float32 value at their address", async () => {
    // rows: 0 U16 | 1 U16 | 2-3 F32 | 4-5 F32 | 6 .. 9
    await live(host, [20, 5, 0x4170, 0, 0x3f80, 0, 11, 3, 50, 10], {
      formatOverrides: [ov(2, 5, "float32")],
      colorRules: [rawRule()],
    });
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(marked)).toEqual([
      true, // 20
      false, // 5
      true, // float 15
      false, // continuation
      false, // float 1
      false, // continuation
      true, // 11
      false, // 3
      true, // 50
      false, // 10 is not > 10
    ]);
  });

  it("a rule starting inside a group matches only the row at that address", async () => {
    await live(host, [1, 1, 0x4170, 0, 0x4170, 0, 1, 1, 1, 1], {
      formatOverrides: [ov(2, 5, "float32")],
      colorRules: [rawRule({ range: { start: 4, end: 5 } })],
    });
    expect(marked(2)).toBe(false);
    expect(marked(4)).toBe(true);
    expect(marked(5)).toBe(false);
  });

  it("a Signed row with raw 0xFFFE matches Raw < 0", async () => {
    await live(host, [0xfffe, 0xfffe], {
      formatOverrides: [ov(0, 0, "signed")],
      colorRules: [rawRule({ comparison: "lessThan", threshold: "0", range: null })],
    });
    expect(marked(0)).toBe(true);
    expect(marked(1)).toBe(false);
  });

  it("a 64-bit integer rule matches an Unsigned64 group row exactly", async () => {
    await live(host, [0x20, 0, 0, 1], {
      formatOverrides: [ov(0, 3, "unsigned64")],
      colorRules: [
        rawRule({
          comparison: "equals",
          threshold: "9007199254740993",
          range: { start: 0, end: 3 },
        }),
      ],
    });
    expect(marked(0)).toBe(true);
  });

  it("Incomplete and missing rows never match", async () => {
    await live(host, [5, 0x4170, 0], {
      definition: def(1, 3),
      formatOverrides: [ov(0, 5, "float32")],
      colorRules: [rawRule({ comparison: "always", threshold: "", range: null })],
    });
    // rows: 1 (group 0-1 cut by the poll), 2-3 complete (15 > ... always matches),
    expect(marked(0)).toBe(false);
  });
});

describe("handoff with groups", () => {
  it("a transferred multi-selection is widened to whole rows when a new host mounts", async () => {
    const ui = createPollViewUiStore({ getConfig: () => null });
    ui.setState({ focusAddress: 0, selection: [{ start: 0, end: 4 }], anchorAddress: 0 });
    const h = await renderPollView({
      mode: "manual",
      host: "native",
      holdAttach: true,
      handoff: ui.getState().toHandoff(),
      poll: { formatOverrides: [ov(0, 9, "unsigned32")] },
    });
    await h.release();
    act(() => {
      h.ipc.emitConnectionState("connected");
      h.ipc.emitPollState(h.pollId, "polling");
      h.ipc.emitPollUpdate(h.pollId, { values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    });
    expect(h.rt.stores.ui.getState().selection).toEqual([{ start: 0, end: 5 }]);
  });

  it("keeps alias editing focus: the editor stays focused while typing in a group row", async () => {
    const h = await live("workspace", [1, 2, 3, 4], { formatOverrides: [ov(0, 3, "unsigned32")] });
    await h.act(() => h.rt.actions.editAlias(0, "f2"));
    const editor = screen.getByRole("textbox", { name: "Alias for address 0" });
    await h.user.type(editor, "Pressure");
    expect(editor).toHaveValue("Pressure");
    expect(editor).toHaveFocus();
  });
});
