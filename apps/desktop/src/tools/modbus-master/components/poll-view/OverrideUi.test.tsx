// The overrides: the S8 dialog, the list in the setup and the removal (DES-003 3.2, FE-003 task 06).
import { act, screen, waitFor, within } from "@testing-library/react";
import type {
  PollConfigInput,
  ScaleOverride,
  ScaleSettings,
} from "@/shared/ipc/modbus-master.types";
import { clickWithLayoutShift } from "@/shared/lib/press-test-utils";
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

const divide = (divisor: number, patch: Partial<ScaleSettings> = {}): ScaleSettings => ({
  ...presetDefaults("divide"),
  divisor,
  ...patch,
});

const rowOf = (index: number): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-row="${index}"]`);
  if (!el) throw new Error(`row ${index} is not rendered`);
  return el;
};
const rawCell = (index: number) => rowOf(index).querySelector('[data-cell="raw"]') as HTMLElement;
const scaledCell = (index: number) =>
  rowOf(index).querySelector('[data-cell="scaled"]') as HTMLElement;
const setup = () => screen.getByRole("complementary", { name: "Poll setup" });
const overridesOf = (h: PollViewHarness) => h.ipc.pollSummary(h.pollId).config.scaleOverrides;

async function live(
  poll: Partial<PollConfigInput> = {},
  values = Array.from({ length: 20 }, (_, i) => i * 10),
  options: { setupOpen?: boolean } = {},
) {
  const h = await renderPollView({
    host: "workspace",
    mode: "manual",
    width: 900,
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
  });
  act(() => {
    h.ipc.emitConnectionState("connected");
    h.ipc.emitPollState(h.pollId, "polling");
    h.ipc.emitPollUpdate(h.pollId, { values });
    if (options.setupOpen) h.rt.stores.ui.getState().setSetupOpen(true);
  });
  return h;
}

/** Selects rows 0, 1, 5 and 9 to 12 with Ctrl+click and Shift+click. */
async function selectRows(h: PollViewHarness, rows: readonly number[]) {
  const [first, ...rest] = rows;
  await h.user.click(rowOf(first as number));
  for (const r of rest) {
    await h.user.keyboard("{Control>}");
    await h.user.click(rowOf(r));
    await h.user.keyboard("{/Control}");
  }
}

describe("from the selected rows", () => {
  it("D1: rows 0, 1, 5, 9-12 give 'Applies to 0-1, 5, 9-12' and three overrides with their markers", async () => {
    const h = await live({ scale: divide(100, { decimals: 2 }), valueColumns: "both" });
    await selectRows(h, [0, 1, 5, 9, 10, 11, 12]);
    expect(h.rt.stores.ui.getState().selection).toEqual([
      { start: 0, end: 1 },
      { start: 5, end: 5 },
      { start: 9, end: 12 },
    ]);
    expect(h.rt.actions.openOverrideForSelection()).toBe(true);
    const d = await screen.findByRole("dialog", { name: "Scale override" });
    expect(within(d).getByTestId("applies-to")).toHaveTextContent("Applies to 0-1, 5, 9-12");
    // the dialog starts from the poll scale, here Divide by 100
    expect(within(d).getByLabelText("Preset")).toHaveValue("divide");
    await h.user.click(within(d).getByRole("radio", { name: "10" }));
    await h.user.click(within(d).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(overridesOf(h).map((o) => [o.start, o.end])).toEqual([
      [0, 1],
      [5, 5],
      [9, 12],
    ]);
    expect(
      h.ipc.callsOf("setPollView").filter(([, v]) => "scaleOverrides" in (v as object)),
    ).toHaveLength(1);
    // the rows: scaled by 10, with the sliders icon and the title; the others keep the poll scale
    expect(
      within(rowOf(0)).getByRole("img", { name: "Scale override 0-1: Divide by 10, 1 dp" }),
    ).toBeInTheDocument();
    expect(
      within(rowOf(9)).getByRole("img", { name: "Scale override 9-12: Divide by 10, 1 dp" }),
    ).toBeInTheDocument();
    expect(
      within(rowOf(5)).getByRole("img", { name: "Scale override 5: Divide by 10, 1 dp" }),
    ).toBeInTheDocument();
    expect(scaledCell(9)).toHaveTextContent("9.0");
    expect(
      within(rowOf(2).querySelector('[data-cell="address"]') as HTMLElement).queryByRole("img"),
    ).not.toBeInTheDocument();
    expect(scaledCell(2)).toHaveTextContent("0.20");
  });

  it("nothing selected opens nothing", async () => {
    const h = await live();
    expect(h.rt.actions.openOverrideForSelection()).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("the dialog is 480 px wide, modal in the window, and holds a modal lock while open", async () => {
    const h = await live();
    let locks = 0;
    let releases = 0;
    const lock = h.rt.lockModal;
    h.rt.lockModal = () => {
      locks += 1;
      const release = lock();
      return () => {
        releases += 1;
        release();
      };
    };
    await selectRows(h, [0]);
    act(() => void h.rt.actions.openOverrideForSelection());
    const d = await screen.findByRole("dialog", { name: "Scale override" });
    expect(d.className).toContain("w-[480px]");
    expect(locks).toBe(1);
    await h.user.click(within(d).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(releases).toBe(1);
  });

  it("Esc closes it without saving; nothing was sent", async () => {
    const h = await live();
    await selectRows(h, [0, 1]);
    act(() => void h.rt.actions.openOverrideForSelection());
    await screen.findByRole("dialog");
    await h.user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(overridesOf(h)).toEqual([]);
  });

  it("events inside the dialog do not bubble to the sub-window frame behind it (React portal)", async () => {
    const keys = vi.fn();
    const presses = vi.fn();
    const h = await renderPollView({
      host: "workspace",
      mode: "manual",
      width: 900,
      wrapper: (view) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: a test spy for the events a frame would see.
        <div onKeyDown={keys} onPointerDown={presses}>
          {view}
        </div>
      ),
    });
    act(() => h.rt.stores.ui.getState().click(0));
    act(() => void h.rt.actions.openOverrideForSelection());
    const d = await screen.findByRole("dialog");
    await h.user.type(within(d).getByLabelText("Unit"), "x");
    await h.user.click(within(d).getByLabelText("Unit"));
    expect(keys).not.toHaveBeenCalled();
    expect(presses).not.toHaveBeenCalled();
  });

  it("D13: an override that holds None shows a dash, no marker, and 'Raw (no scale)' in the list", async () => {
    const h = await live(
      {
        scale: presetDefaults("current4to20"),
        scaleOverrides: [{ start: 5, end: 6, scale: presetDefaults("none") }],
        valueColumns: "both",
      },
      Array.from({ length: 10 }, () => 32768),
      { setupOpen: true },
    );
    expect(scaledCell(5)).toHaveTextContent("—");
    expect(scaledCell(6)).toHaveTextContent("—");
    expect(within(rowOf(5)).queryByRole("img", { name: /Scale override/ })).not.toBeInTheDocument();
    expect(within(rowOf(6)).queryByRole("img", { name: /Scale override/ })).not.toBeInTheDocument();
    expect(scaledCell(4)).toHaveTextContent("12.00");
    expect(within(setup()).getAllByTestId("override-row")[0]).toHaveTextContent("5-6");
    expect(within(setup()).getAllByTestId("override-row")[0]).toHaveTextContent("Raw (no scale)");
    expect(h.ipc.pollSummary(h.pollId).config.scaleOverrides).toHaveLength(1);
  });

  it("D2: a selection that touches an existing override reports the overlap and saves nothing", async () => {
    const h = await live({ scaleOverrides: [{ start: 8, end: 12, scale: divide(10) }] });
    await selectRows(h, [9, 10]);
    act(() => void h.rt.actions.openOverrideForSelection());
    const d = await screen.findByRole("dialog");
    await h.user.click(within(d).getByRole("button", { name: "Save" }));
    expect(within(d).getByTestId("override-range-error")).toHaveTextContent(
      "This range overlaps the override for 8-12.",
    );
    expect(overridesOf(h)).toHaveLength(1);
  });

  it("an invalid scale is reported in the dialog and the focus goes there", async () => {
    const h = await live();
    await selectRows(h, [0]);
    act(() => void h.rt.actions.openOverrideForSelection());
    const d = await screen.findByRole("dialog");
    await h.user.click(within(d).getByRole("radio", { name: "Custom" }));
    await h.user.type(within(d).getByLabelText("Custom divisor"), "0");
    await h.user.click(within(d).getByRole("button", { name: "Save" }));
    expect(within(d).getByText("Divisor must be a number other than 0.")).toBeInTheDocument();
    expect(within(d).getByLabelText("Custom divisor")).toHaveFocus();
    expect(overridesOf(h)).toEqual([]);
  });

  it("D9: the example line shows the draft scale on the first address's raw value", async () => {
    const h = await live({}, [253, 254, 255, 256]);
    await selectRows(h, [0, 1]);
    act(() => void h.rt.actions.openOverrideForSelection());
    const d = await screen.findByRole("dialog");
    await h.user.type(within(d).getByLabelText("Unit"), "°C");
    expect(within(d).getByTestId("override-example")).toHaveTextContent(
      "Example: raw 253 shows 25.3 °C. Overrides win over the poll scale.",
    );
    await h.user.click(within(d).getByRole("radio", { name: "Custom" }));
    await h.user.type(within(d).getByLabelText("Custom divisor"), "0");
    expect(within(d).getByTestId("override-example")).toHaveTextContent(
      /^Overrides win over the poll scale\.$/,
    );
  });

  it("the example uses 1000 when the first address has no value yet", async () => {
    const h = await renderPollView({ host: "workspace", mode: "manual", width: 900 });
    act(() => h.rt.stores.ui.getState().click(3));
    act(() => void h.rt.actions.openOverrideForSelection());
    const d = await screen.findByRole("dialog");
    expect(within(d).getByTestId("override-example")).toHaveTextContent(
      "Example: raw 1000 shows 100.0. Overrides win over the poll scale.",
    );
  });
});

describe("from the list: Add override", () => {
  it("opens with Start and End in the display base and the protocol helper", async () => {
    const h = await live(
      {
        display: {
          format: "unsigned",
          addressBase: 1,
          showAlias: true,
          copyAlias: false,
          swapBytes: false,
          reverseWords: false,
        },
      },
      undefined,
      { setupOpen: true },
    );
    expect(within(setup()).getByRole("region", { name: "Overrides (0)" })).toBeInTheDocument();
    await h.user.click(within(setup()).getByRole("button", { name: "Add override" }));
    const d = await screen.findByRole("dialog");
    const start = within(d).getByLabelText("Start");
    expect(start).toHaveFocus();
    expect(start).toHaveValue("1");
    expect(within(d).getByText("Protocol address 0")).toBeInTheDocument();
    await h.user.clear(start);
    await h.user.type(start, "6");
    expect(within(d).getByText("Protocol address 5")).toBeInTheDocument();
    expect(within(d).queryByTestId("applies-to")).not.toBeInTheDocument();
  });

  it("D3: an end before the start", async () => {
    const h = await live({}, undefined, { setupOpen: true });
    await h.user.click(within(setup()).getByRole("button", { name: "Add override" }));
    const d = await screen.findByRole("dialog");
    await h.user.clear(within(d).getByLabelText("Start"));
    await h.user.type(within(d).getByLabelText("Start"), "5");
    await h.user.clear(within(d).getByLabelText("End"));
    await h.user.type(within(d).getByLabelText("End"), "3");
    await h.user.click(within(d).getByRole("button", { name: "Save" }));
    expect(
      within(d).getByText("End address must not be before the start address."),
    ).toBeInTheDocument();
    expect(within(d).getByLabelText("End")).toHaveFocus();
  });

  it("one click on [Save] works when the blur of Decimals shows a message and moves the button (D4)", async () => {
    const h = await live({}, undefined, { setupOpen: true });
    await h.user.click(within(setup()).getByRole("button", { name: "Add override" }));
    const d = await screen.findByRole("dialog");
    await h.user.selectOptions(within(d).getByLabelText("Preset"), "4-20 mA");
    const decimals = within(d).getByLabelText("Decimals");
    await h.user.clear(decimals);
    await h.user.type(decimals, "7");
    const message = "Decimals must be a whole number from 0 to 6.";
    expect(within(d).queryByText(message)).not.toBeInTheDocument();
    await clickWithLayoutShift(
      h.user,
      within(d).getByRole("button", { name: "Save" }),
      () => within(d).queryByText(message) !== null,
      () => within(d).getByText(message),
    );
    expect(within(d).getByText(message)).toBeInTheDocument();
    expect(decimals).toHaveFocus();
    expect(overridesOf(h)).toHaveLength(0);
  });

  it("D4: in 1-based mode a start of 0 is refused", async () => {
    const h = await live(
      {
        display: {
          format: "unsigned",
          addressBase: 1,
          showAlias: true,
          copyAlias: false,
          swapBytes: false,
          reverseWords: false,
        },
      },
      undefined,
      { setupOpen: true },
    );
    await h.user.click(within(setup()).getByRole("button", { name: "Add override" }));
    const d = await screen.findByRole("dialog");
    await h.user.clear(within(d).getByLabelText("Start"));
    await h.user.type(within(d).getByLabelText("Start"), "0");
    await h.user.tab();
    expect(
      within(d).getByText("Start address must be a whole number from 1 to 65536."),
    ).toBeInTheDocument();
  });

  it("D2: 5-9 against an existing 8-12", async () => {
    const h = await live(
      { scaleOverrides: [{ start: 8, end: 12, scale: divide(10) }] },
      undefined,
      { setupOpen: true },
    );
    await h.user.click(within(setup()).getByRole("button", { name: "Add override" }));
    const d = await screen.findByRole("dialog");
    await h.user.clear(within(d).getByLabelText("Start"));
    await h.user.type(within(d).getByLabelText("Start"), "5");
    await h.user.clear(within(d).getByLabelText("End"));
    await h.user.type(within(d).getByLabelText("End"), "9");
    await h.user.click(within(d).getByRole("button", { name: "Save" }));
    expect(within(d).getByTestId("override-range-error")).toHaveTextContent(
      "This range overlaps the override for 8-12.",
    );
    // Enter in a field saves as well; a valid range closes the dialog
    await h.user.clear(within(d).getByLabelText("End"));
    await h.user.type(within(d).getByLabelText("End"), "6{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(overridesOf(h).map((o) => [o.start, o.end])).toEqual([
      [5, 6],
      [8, 12],
    ]);
  });

  it("D5: the 65th override is refused", async () => {
    const many: ScaleOverride[] = Array.from({ length: 64 }, (_, i) => ({
      start: i * 2,
      end: i * 2,
      scale: divide(10),
    }));
    const h = await live({ scaleOverrides: many }, undefined, { setupOpen: true });
    expect(within(setup()).getByRole("region", { name: "Overrides (64)" })).toBeInTheDocument();
    await h.user.click(within(setup()).getByRole("button", { name: "Add override" }));
    const d = await screen.findByRole("dialog");
    await h.user.clear(within(d).getByLabelText("Start"));
    await h.user.type(within(d).getByLabelText("Start"), "1001");
    await h.user.clear(within(d).getByLabelText("End"));
    await h.user.type(within(d).getByLabelText("End"), "1001");
    await h.user.click(within(d).getByRole("button", { name: "Save" }));
    expect(within(d).getByTestId("override-range-error")).toHaveTextContent(
      "A poll can have at most 64 scale overrides.",
    );
    expect(overridesOf(h)).toHaveLength(64);
  });
});

describe("the override list", () => {
  const two: ScaleOverride[] = [
    { start: 0, end: 3, scale: divide(10, { unit: "°C" }) },
    { start: 8, end: 9, scale: divide(100, { decimals: 2, unit: "bar" }) },
  ];

  it("lists each override with its range and full summary, in the display base", async () => {
    await live({ scaleOverrides: two }, undefined, { setupOpen: true });
    expect(within(setup()).getByRole("region", { name: "Overrides (2)" })).toBeInTheDocument();
    const rows = within(setup()).getAllByTestId("override-row");
    expect(rows[0]).toHaveTextContent("0-3");
    expect(rows[0]).toHaveTextContent("Divide by 10, 1 dp, °C");
    expect(rows[1]).toHaveTextContent("8-9");
    expect(rows[1]).toHaveTextContent("Divide by 100, 2 dp, bar");
    expect(
      within(rows[0] as HTMLElement).getByRole("button", { name: "Edit" }),
    ).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByRole("button", { name: "Remove" }),
    ).toBeInTheDocument();
  });

  it("Remove drops that override at once, without a confirm", async () => {
    const h = await live({ scaleOverrides: two, valueColumns: "both" }, undefined, {
      setupOpen: true,
    });
    const rows = within(setup()).getAllByTestId("override-row");
    await h.user.click(within(rows[0] as HTMLElement).getByRole("button", { name: "Remove" }));
    expect(overridesOf(h).map((o) => [o.start, o.end])).toEqual([[8, 9]]);
    expect(within(setup()).getAllByTestId("override-row")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Edit opens the dialog with the range and the scale; saving replaces it", async () => {
    const h = await live({ scaleOverrides: two, valueColumns: "both" }, undefined, {
      setupOpen: true,
    });
    const rows = within(setup()).getAllByTestId("override-row");
    await h.user.click(within(rows[1] as HTMLElement).getByRole("button", { name: "Edit" }));
    const d = await screen.findByRole("dialog", { name: "Edit scale override" });
    expect(within(d).getByLabelText("Start")).toHaveValue("8");
    expect(within(d).getByLabelText("End")).toHaveValue("9");
    expect(within(d).getByLabelText("Unit")).toHaveValue("bar");
    await h.user.clear(within(d).getByLabelText("Unit"));
    await h.user.type(within(d).getByLabelText("Unit"), "mbar");
    await h.user.click(within(d).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(overridesOf(h)[1]).toMatchObject({
      start: 8,
      end: 9,
      scale: { unit: "mbar", divisor: 100 },
    });
  });

  it("D6: 'Remove scale override' on a selection crossing two overrides removes both; the rows fall back", async () => {
    const h = await live(
      { scale: divide(1000, { decimals: 3 }), scaleOverrides: two, valueColumns: "both" },
      Array.from({ length: 12 }, () => 253),
    );
    expect(scaledCell(0)).toHaveTextContent("25.3");
    expect(scaledCell(8)).toHaveTextContent("2.53");
    await h.user.click(rowOf(2));
    await h.user.keyboard("{Shift>}");
    await h.user.click(rowOf(8));
    await h.user.keyboard("{/Shift}");
    await h.user.pointer({ keys: "[MouseRight]", target: rawCell(5) });
    await h.user.click(screen.getByRole("menuitem", { name: "Remove scale override" }));
    expect(overridesOf(h)).toEqual([]);
    expect(scaledCell(0)).toHaveTextContent("0.253");
    expect(scaledCell(8)).toHaveTextContent("0.253");
    expect(within(rowOf(0)).queryByRole("img")).not.toBeInTheDocument();
  });

  it("D7: an override outside the poll range is listed as such, and applies again when the range covers it", async () => {
    const h = await live({ scaleOverrides: two, valueColumns: "both" }, undefined, {
      setupOpen: true,
    });
    expect(screen.queryByText("Not in the current poll range")).not.toBeInTheDocument();
    await act(async () => {
      await h.ipc.updatePoll(h.pollId, {
        slaveId: 1,
        function: 3,
        startAddress: 0,
        quantity: 5,
        scanRateMs: 100,
      });
    });
    const rows = within(setup()).getAllByTestId("override-row");
    expect(rows).toHaveLength(2);
    expect(
      within(rows[0] as HTMLElement).queryByText("Not in the current poll range"),
    ).not.toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByText("Not in the current poll range"),
    ).toBeInTheDocument();
    expect(overridesOf(h)).toHaveLength(2);
    await act(async () => {
      await h.ipc.updatePoll(h.pollId, {
        slaveId: 1,
        function: 3,
        startAddress: 0,
        quantity: 20,
        scanRateMs: 100,
      });
    });
    expect(screen.queryByText("Not in the current poll range")).not.toBeInTheDocument();
  });

  it("overrides are shown in the display base", async () => {
    await live(
      {
        scaleOverrides: two,
        display: {
          format: "unsigned",
          addressBase: 1,
          showAlias: true,
          copyAlias: false,
          swapBytes: false,
          reverseWords: false,
        },
      },
      undefined,
      { setupOpen: true },
    );
    const rows = within(setup()).getAllByTestId("override-row");
    expect(rows[0]).toHaveTextContent("1-4");
    expect(rows[1]).toHaveTextContent("9-10");
  });
});

it("the section is disabled for a coil poll: no Add override", async () => {
  const h = await renderPollView({
    host: "workspace",
    mode: "manual",
    width: 900,
    poll: {
      definition: { slaveId: 1, function: 1, startAddress: 0, quantity: 8, scanRateMs: 100 },
    },
  });
  act(() => h.rt.stores.ui.getState().setSetupOpen(true));
  expect(within(setup()).getByRole("button", { name: "Add override" })).toBeDisabled();
});
