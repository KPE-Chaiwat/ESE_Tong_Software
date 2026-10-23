// The data table with the real scale math (DES-003 3.3, 3.4, FE-003 tasks 05 and 07).
import { act, fireEvent, screen, within } from "@testing-library/react";
import type {
  DisplaySettings,
  FormatOverride,
  PollConfigInput,
  ScaleOverride,
  ScaleSettings,
} from "@/shared/ipc/modbus-master.types";
import { presetDefaults } from "../../lib/scale-presets";
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

const mA: ScaleSettings = presetDefaults("current4to20");
const volt = (patch: Partial<ScaleSettings> = {}): ScaleSettings => ({
  ...presetDefaults("voltage0to10"),
  xMax: 4095,
  ...patch,
});
const divide = (divisor: number, patch: Partial<ScaleSettings> = {}): ScaleSettings => ({
  ...presetDefaults("divide"),
  divisor,
  ...patch,
});
const display = (patch: Partial<DisplaySettings> = {}): DisplaySettings => ({
  addressBase: 0,
  showAlias: true,
  copyAlias: false,
  ...patch,
});
/** A 16-bit format on the first `rows` registers (the old poll-wide format, now per row). */
const allRows = (format: FormatOverride["format"], rows: number): FormatOverride[] => [
  { start: 0, end: rows - 1, format, swapBytes: false, reverseWords: false },
];

const rowOf = (index: number): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-row="${index}"]`);
  if (!el) throw new Error(`row ${index} is not rendered`);
  return el;
};
const cellOf = (row: number, kind: "alias" | "address" | "raw" | "scaled") =>
  rowOf(row).querySelector(`[data-cell="${kind}"]`) as HTMLElement;
const grid = () => screen.getByRole("grid", { name: "Register values" });

/** A poll with live raw values, driven by hand. */
async function live(
  values: number[],
  poll: Partial<PollConfigInput> = {},
  options: { width?: number } = {},
): Promise<PollViewHarness> {
  const h = await renderPollView({
    host: "workspace",
    mode: "manual",
    poll: {
      definition: {
        slaveId: 1,
        function: 3,
        startAddress: 0,
        quantity: values.length,
        scanRateMs: 100,
      },
      ...poll,
    },
    ...(options.width === undefined ? {} : { width: options.width }),
  });
  act(() => {
    h.ipc.emitConnectionState("connected");
    h.ipc.emitPollState(h.pollId, "polling");
    h.ipc.emitPollUpdate(h.pollId, { values });
  });
  return h;
}

const text = (el: HTMLElement) => el.textContent;

describe("columns and the Show control (DES-003 1.5, 3.3)", () => {
  it("Both: the header reads Alias, Address (0-based), Format, Raw, Scaled value", async () => {
    await live([0, 65535, 32768], { scale: mA, valueColumns: "both" });
    expect(
      within(grid())
        .getAllByRole("columnheader")
        .map((c) => c.textContent),
    ).toEqual(["Alias", "Address (0-based)", "Format", "Raw", "Scaled"]);
    expect(screen.getByRole("columnheader", { name: "Scaled value" })).toBeInTheDocument();
  });

  it("A1, A2, A3: the cells show 4.00 mA, 20.00 mA and 12.00 mA next to the raw values", async () => {
    await live([0, 65535, 32768], { scale: mA, valueColumns: "both" });
    expect([0, 1, 2].map((i) => text(cellOf(i, "raw")))).toEqual(["0", "65535", "32768"]);
    expect([0, 1, 2].map((i) => text(cellOf(i, "scaled")))).toEqual([
      "4.00mA",
      "20.00mA",
      "12.00mA",
    ]);
    expect(within(cellOf(2, "scaled")).getByText("mA")).toHaveClass("text-[11px]");
    // in range: no marker, no tint
    expect(cellOf(2, "scaled")).toHaveAttribute("data-marker", "none");
    expect(cellOf(2, "scaled")).not.toHaveClass("bg-warning-tint");
  });

  it("Raw only: the Raw header does not depend on the scale and there is no Scaled column", async () => {
    await live([0, 1, 2], { scale: mA, valueColumns: "raw" });
    expect(
      within(grid())
        .getAllByRole("columnheader")
        .map((c) => c.textContent),
    ).toEqual(["Alias", "Address (0-based)", "Format", "Raw"]);
  });

  it("Scaled only: no Raw column", async () => {
    await live([0, 1, 2], { scale: mA, valueColumns: "scaled" });
    expect(screen.queryByRole("columnheader", { name: /^Raw/ })).not.toBeInTheDocument();
    expect(cellOf(0, "scaled")).toBeInTheDocument();
  });

  it("without any scale the Show control is disabled with its title and the table shows Raw only (B6)", async () => {
    await live([1, 2, 3], { valueColumns: "raw" });
    const show = screen.getByRole("radiogroup", { name: "Show" });
    expect(show).toHaveAttribute("aria-disabled", "true");
    expect(show).toHaveAttribute("title", "Set a scale to show scaled values.");
    expect(screen.queryByRole("columnheader", { name: "Scaled value" })).not.toBeInTheDocument();
  });

  it.each(["scaled", "both"] as const)(
    "m-3: a stored %s without any scale still shows the raw values, and the control reads Raw",
    async (columns) => {
      const h = await live([1, 2, 3], { valueColumns: columns });
      expect(screen.getByRole("columnheader", { name: /^Raw/ })).toBeInTheDocument();
      expect(screen.queryByRole("columnheader", { name: "Scaled value" })).not.toBeInTheDocument();
      expect([0, 1, 2].map((i) => text(cellOf(i, "raw")))).toEqual(["1", "2", "3"]);
      const show = screen.getByRole("radiogroup", { name: "Show" });
      expect(show).toHaveAttribute("aria-disabled", "true");
      expect(within(show).getByRole("radio", { name: "Raw" })).toBeChecked();
      // Ctrl+C copies the raw values
      await h.user.click(rowOf(0));
      await h.user.keyboard("{Control>}c{/Control}");
      expect(h.copied.at(-1)).toBe(["0", "1"].join(TAB));
    },
  );

  it("m-3: the compact Show menu also reads Raw for a stored Scaled without a scale", async () => {
    await live([1, 2], { valueColumns: "scaled" }, { width: 500 });
    expect(screen.getByRole("button", { name: "Show Raw" })).toBeInTheDocument();
  });

  it("A column that has no scale shows a dash while others have one (D8)", async () => {
    const overrides: ScaleOverride[] = [
      { start: 0, end: 3, scale: divide(10, { unit: "°C" }) },
      { start: 8, end: 9, scale: divide(100, { decimals: 2, unit: "bar" }) },
    ];
    await live([253, 0, 0, 0, 0, 777, 0, 0, 1234, 1], {
      scaleOverrides: overrides,
      valueColumns: "both",
    });
    expect(text(cellOf(0, "scaled"))).toBe("25.3°C");
    expect(text(cellOf(8, "scaled"))).toBe("12.34bar");
    expect(text(cellOf(5, "scaled"))).toBe("—");
    // Poll scale None, so the row with no override is not scaled.
    expect(cellOf(5, "scaled")).toHaveClass("text-text-muted");
  });

  it("Show control with a scale: Raw, Scaled, Both change the columns and the poll's setting", async () => {
    const h = await live([0, 1], { scale: mA, valueColumns: "both" });
    await h.user.click(screen.getByRole("radio", { name: "Raw" }));
    expect(h.ipc.pollSummary(h.pollId).config.valueColumns).toBe("raw");
    expect(screen.queryByRole("columnheader", { name: "Scaled value" })).not.toBeInTheDocument();
    await h.user.click(screen.getByRole("radio", { name: "Scaled" }));
    expect(screen.queryByRole("columnheader", { name: /^Raw/ })).not.toBeInTheDocument();
  });

  it("the compact Show menu lists Raw, Scaled and Both", async () => {
    const h = await live([0, 1], { scale: mA, valueColumns: "both" }, { width: 500 });
    await h.user.click(screen.getByRole("button", { name: "Show Both" }));
    expect(screen.getByRole("menuitemradio", { name: "Both" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await h.user.click(screen.getByRole("menuitemradio", { name: "Scaled" }));
    expect(h.ipc.pollSummary(h.pollId).config.valueColumns).toBe("scaled");
  });
});

describe("format and scale together (CHK-003 B)", () => {
  it("B1: Hex raw next to a scaled value", async () => {
    await live([32768], { scale: mA, valueColumns: "both", formatOverrides: allRows("hex", 1) });
    expect(text(cellOf(0, "raw"))).toBe("0x8000");
    expect(text(cellOf(0, "scaled"))).toBe("12.00mA");
  });

  it("B2: Binary raw with Divide by 10, signed", async () => {
    await live([65535], {
      scale: divide(10, { rawSigned: true }),
      valueColumns: "both",
      formatOverrides: allRows("binary", 1),
    });
    expect(text(cellOf(0, "raw"))).toBe("1111 1111 1111 1111");
    expect(text(cellOf(0, "scaled"))).toBe("-0.1");
  });

  it("B3: the format Signed does not make the scale signed", async () => {
    await live([65535], {
      scale: divide(10),
      valueColumns: "both",
      formatOverrides: allRows("signed", 1),
    });
    expect(text(cellOf(0, "raw"))).toBe("-1");
    expect(text(cellOf(0, "scaled"))).toBe("6553.5");
  });
});

describe("out of range and clamp markers (DES-003 1.4, 6)", () => {
  it("A12: a flagged cell has the tint, the triangle icon, the tooltip and the name", async () => {
    await live([5000], { scale: volt(), valueColumns: "both" });
    const cell = cellOf(0, "scaled");
    expect(cell).toHaveAttribute("aria-label", "12.21 V, out of range");
    expect(cell).toHaveAttribute("title", "Raw 5000 is outside the raw range 0-4095.");
    expect(cell).toHaveClass("bg-warning-tint");
    expect(cell.querySelector('[data-icon="triangle-alert"]')).not.toBeNull();
    expect(screen.getByLabelText("12.21 V, out of range")).toBe(cell);
    // the tint covers the Scaled cell only (E6)
    expect(cellOf(0, "alias")).not.toHaveClass("bg-warning-tint");
    expect(cellOf(0, "raw")).not.toHaveClass("bg-warning-tint");
    expect(within(cell).getByText("V")).toBeInTheDocument();
  });

  it("A13: a clamped cell above the range has the arrow-up icon and no tint", async () => {
    await live([5000], { scale: volt({ outOfRange: "clamp" }), valueColumns: "both" });
    const cell = cellOf(0, "scaled");
    expect(cell).toHaveAttribute("aria-label", "10.00 V, clamped");
    expect(cell).toHaveAttribute(
      "title",
      "Raw 5000 is outside the raw range 0-4095; shown clamped.",
    );
    expect(cell.querySelector('[data-icon="arrow-up-to-line"]')).not.toBeNull();
    expect(cell.querySelector('[data-icon="triangle-alert"]')).toBeNull();
    expect(cell).not.toHaveClass("bg-warning-tint");
  });

  it("A8: a clamped cell below the range has the arrow-down icon", async () => {
    await live([0], {
      scale: { ...mA, xMin: 4000, xMax: 20000, outOfRange: "clamp" },
      valueColumns: "both",
    });
    const cell = cellOf(0, "scaled");
    expect(cell).toHaveAttribute("aria-label", "4.00 mA, clamped");
    expect(cell.querySelector('[data-icon="arrow-down-to-line"]')).not.toBeNull();
  });

  it("A43: too large is shown and flagged", async () => {
    await live([2], {
      scale: { ...presetDefaults("linear"), xMin: 0, xMax: 1, yMin: 0, yMax: 999999999999999 },
      valueColumns: "both",
    });
    expect(text(cellOf(0, "scaled"))).toBe("too large");
    expect(cellOf(0, "scaled")).toHaveAttribute("data-marker", "outOfRange");
  });
});

describe("override marker (DES-003 3.2)", () => {
  const overrides: ScaleOverride[] = [{ start: 0, end: 1, scale: divide(10) }];

  it("rows inside an override show the sliders icon after the address, with a title and a name", async () => {
    await live([253, 254, 255], { scaleOverrides: overrides, valueColumns: "both" });
    const marker = within(cellOf(0, "address")).getByRole("img", {
      name: "Scale override 0-1: Divide by 10, 1 dp",
    });
    expect(marker).toHaveAttribute("title", "Scale override 0-1: Divide by 10, 1 dp");
    expect(marker.querySelector('[data-icon="sliders-horizontal"]')).not.toBeNull();
    expect(within(cellOf(1, "address")).getByRole("img")).toBeInTheDocument();
    expect(within(cellOf(2, "address")).queryByRole("img")).not.toBeInTheDocument();
  });

  it("the marker text follows the display base", async () => {
    await live([253, 254, 255], {
      scaleOverrides: overrides,
      valueColumns: "both",
      display: display({ addressBase: 1 }),
    });
    expect(
      within(cellOf(0, "address")).getByRole("img", {
        name: "Scale override 1-2: Divide by 10, 1 dp",
      }),
    ).toBeInTheDocument();
  });

  it("an override wins over the poll scale, and falls back to it when removed (D6)", async () => {
    const h = await live([253, 253, 253], {
      scale: divide(100, { decimals: 2 }),
      scaleOverrides: overrides,
      valueColumns: "both",
    });
    expect(text(cellOf(0, "scaled"))).toBe("25.3");
    expect(text(cellOf(2, "scaled"))).toBe("2.53");
    await act(async () => {
      await h.rt.stores.scale.getState().removeOverrides([{ start: 0, end: 0 }]);
    });
    expect(text(cellOf(0, "scaled"))).toBe("2.53");
    expect(within(cellOf(0, "address")).queryByRole("img")).not.toBeInTheDocument();
  });

  it("the marker shows while the rows have no value yet", async () => {
    const h = await renderPollView({
      host: "workspace",
      mode: "manual",
      poll: { scaleOverrides: overrides, valueColumns: "both" },
    });
    act(() => {
      h.ipc.emitConnectionState("connected");
      h.ipc.emitPollState(h.pollId, "polling");
    });
    expect(h.rt.stores.data.getState().values).toBeNull();
    expect(within(cellOf(0, "address")).getByRole("img")).toBeInTheDocument();
    expect(text(cellOf(0, "scaled"))).toBe("—");
  });
});

describe("a scale change updates the rows at once", () => {
  it("applying a scale shows the Scaled column and values; the raw values stay", async () => {
    const h = await live([32768, 0]);
    expect(screen.queryByRole("columnheader", { name: "Scaled value" })).not.toBeInTheDocument();
    await act(async () => {
      await h.rt.stores.scale.getState().applyScale(mA);
    });
    expect(text(cellOf(0, "scaled"))).toBe("12.00mA");
    expect(text(cellOf(0, "raw"))).toBe("32768");
    // the next update is scaled without any new command
    const before = h.ipc.callsOf("setPollView").length;
    act(() => h.ipc.emitPollUpdate(h.pollId, { values: [65535, 0] }));
    expect(text(cellOf(0, "scaled"))).toBe("20.00mA");
    expect(h.ipc.callsOf("setPollView").length).toBe(before);
  });

  it("an update is not stale or loading for the scaled column: stale values are muted", async () => {
    const h = await live([32768], { scale: mA, valueColumns: "both" });
    expect(cellOf(0, "scaled")).not.toHaveClass("text-text-muted");
    act(() => h.ipc.emitPollState(h.pollId, "paused"));
    expect(cellOf(0, "scaled")).toHaveClass("text-text-muted");
  });
});

describe("copy (DES-003 3.4)", () => {
  async function selected(poll: Partial<PollConfigInput>, values = [0, 65535]) {
    const h = await live(values, poll);
    await h.user.click(rowOf(0));
    await h.user.keyboard("{Shift>}");
    await h.user.click(rowOf(values.length - 1));
    await h.user.keyboard("{/Shift}");
    return h;
  }

  it("E1: Both, Ctrl+C", async () => {
    const h = await selected({ scale: mA, valueColumns: "both" });
    await h.user.keyboard("{Control>}c{/Control}");
    expect(h.copied).toEqual([[`0${TAB}0${TAB}4.00`, `1${TAB}65535${TAB}20.00`].join(LF)]);
    expect(h.toasts.getState().items.map((t) => t.text)).toEqual(["Copied 2 rows."]);
  });

  it("E2: Scaled mode copies the scaled numbers, Raw mode the raw ones", async () => {
    const h = await selected({ scale: mA, valueColumns: "scaled" });
    await h.user.keyboard("{Control>}c{/Control}");
    expect(h.copied[0]?.split(LF)[0]).toBe(`0${TAB}4.00`);
    await h.act(() => h.rt.actions.setValueColumns("raw"));
    await h.user.keyboard("{Control>}c{/Control}");
    expect(h.copied[1]?.split(LF)[0]).toBe(`0${TAB}0`);
  });

  it("E3: Copy with header in Hex, Both", async () => {
    const h = await selected({
      scale: mA,
      valueColumns: "both",
      formatOverrides: allRows("hex", 2),
    });
    await h.user.pointer({ keys: "[MouseRight]", target: cellOf(0, "raw") });
    await h.user.click(screen.getByRole("menuitem", { name: "Copy with header" }));
    expect(h.copied[0]?.split(LF).slice(0, 2)).toEqual([
      ["Address (0-based)", "Raw (Hex)", "Scaled"].join(TAB),
      ["0", "0x0000", "4.00"].join(TAB),
    ]);
  });

  it("E4: an out-of-range value copies as shown (flag extrapolates, clamp clamps); no scale gives an empty field", async () => {
    const h = await selected({ scale: volt(), valueColumns: "both" }, [5000, 5000]);
    await h.user.keyboard("{Control>}c{/Control}");
    expect(h.copied[0]?.split(LF)[0]).toBe(`0${TAB}5000${TAB}12.21`);
    await act(async () => {
      await h.rt.stores.scale.getState().applyScale(volt({ outOfRange: "clamp" }));
    });
    await h.user.keyboard("{Control>}c{/Control}");
    expect(h.copied[1]?.split(LF)[0]).toBe(`0${TAB}5000${TAB}10.00`);
  });

  it("E4: a row without a scale copies an empty scaled field", async () => {
    const g = await selected(
      { scaleOverrides: [{ start: 0, end: 0, scale: divide(10) }], valueColumns: "both" },
      [5, 0],
    );
    await g.user.keyboard("{Control>}c{/Control}");
    expect(g.copied[0]).toBe([`0${TAB}5${TAB}0.5`, `1${TAB}0${TAB}`].join(LF));
  });

  it("E5: Copy raw, Copy scaled and Copy raw and scaled ignore the value columns", async () => {
    const h = await selected({ scale: mA, valueColumns: "raw" });
    await h.user.pointer({ keys: "[MouseRight]", target: cellOf(0, "raw") });
    await h.user.click(screen.getByRole("menuitem", { name: "Copy scaled" }));
    expect(h.copied[0]).toBe([`0${TAB}4.00`, `1${TAB}20.00`].join(LF));
    await h.user.pointer({ keys: "[MouseRight]", target: cellOf(0, "raw") });
    await h.user.click(screen.getByRole("menuitem", { name: "Copy raw and scaled" }));
    expect(h.copied[1]).toBe([`0${TAB}0${TAB}4.00`, `1${TAB}65535${TAB}20.00`].join(LF));
    await h.act(() => h.rt.actions.setValueColumns("scaled"));
    await h.user.pointer({ keys: "[MouseRight]", target: cellOf(0, "scaled") });
    await h.user.click(screen.getByRole("menuitem", { name: "Copy raw" }));
    expect(h.copied[2]).toBe([`0${TAB}0`, `1${TAB}65535`].join(LF));
  });

  it("E7: with the alias on, the alias is the first field", async () => {
    const h = await selected({
      scale: mA,
      valueColumns: "both",
      aliases: [{ address: 0, alias: "PT-201" }],
      display: display({ copyAlias: true }),
      formatOverrides: allRows("hex", 2),
    });
    await h.user.keyboard("{Control>}c{/Control}");
    expect(h.copied[0]).toBe(
      [`PT-201${TAB}0${TAB}0x0000${TAB}4.00`, `${TAB}1${TAB}0xFFFF${TAB}20.00`].join(LF),
    );
    await h.user.pointer({ keys: "[MouseRight]", target: cellOf(0, "raw") });
    await h.user.click(screen.getByRole("menuitem", { name: "Copy with header" }));
    expect(h.copied[1]?.split(LF)[0]).toBe(
      ["Alias", "Address (0-based)", "Raw (Hex)", "Scaled"].join(TAB),
    );
  });

  it("a coil poll copies only raw whatever a kept scale says", async () => {
    const h = await live([1, 0], {
      definition: { slaveId: 1, function: 1, startAddress: 0, quantity: 2, scanRateMs: 100 },
      scale: mA,
      valueColumns: "both",
    });
    await h.user.click(cellOf(0, "raw"));
    await h.user.keyboard("{Control>}c{/Control}");
    expect(h.copied[0]).toBe(`0${TAB}1`);
    // and the table has no Scaled column, the Show control is disabled with the reason
    expect(screen.queryByRole("columnheader", { name: "Scaled value" })).not.toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Show" })).toHaveAttribute(
      "title",
      "Scaling applies to registers (FC03 and FC04) only.",
    );
  });
});

describe("the context menu has the override entries", () => {
  it("'Set scale for selected rows…' opens the dialog for the selection", async () => {
    const h = await live([1, 2, 3, 4, 5, 6]);
    await h.user.click(cellOf(0, "raw"));
    await h.user.pointer({ keys: "[MouseRight]", target: cellOf(0, "raw") });
    const entry = screen.getByRole("menuitem", { name: /^Set scale for selected rows…/ });
    expect(entry).toHaveTextContent("Ctrl+Shift+E");
    await h.user.click(entry);
    const dialog = await screen.findByRole("dialog", { name: "Scale override" });
    expect(within(dialog).getByTestId("applies-to")).toHaveTextContent("Applies to 0");
  });

  it("'Remove scale override' is offered only on rows inside an override", async () => {
    const h = await live([1, 2, 3, 4, 5, 6], {
      scaleOverrides: [{ start: 1, end: 2, scale: divide(10) }],
    });
    await h.user.click(cellOf(4, "raw"));
    await h.user.pointer({ keys: "[MouseRight]", target: cellOf(4, "raw") });
    expect(
      screen.queryByRole("menuitem", { name: "Remove scale override" }),
    ).not.toBeInTheDocument();
    await h.user.keyboard("{Escape}");
    await h.user.click(cellOf(1, "raw"));
    await h.user.pointer({ keys: "[MouseRight]", target: cellOf(1, "raw") });
    await h.user.click(screen.getByRole("menuitem", { name: "Remove scale override" }));
    expect(h.ipc.pollSummary(h.pollId).config.scaleOverrides).toEqual([]);
  });

  it("the entries are disabled for a coil poll", async () => {
    const h = await live([1, 0], {
      definition: { slaveId: 1, function: 2, startAddress: 0, quantity: 2, scanRateMs: 100 },
    });
    await h.user.click(cellOf(0, "raw"));
    await h.user.pointer({ keys: "[MouseRight]", target: cellOf(0, "raw") });
    expect(screen.getByRole("menuitem", { name: /^Set scale for selected rows…/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    fireEvent.keyDown(grid(), { key: "Escape" });
  });
});
