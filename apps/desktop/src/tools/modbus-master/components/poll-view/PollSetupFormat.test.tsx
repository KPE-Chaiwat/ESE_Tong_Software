// What the poll setup says about per-row formats (FE-009 tasks 09 and 10): no Interpretation
// section, the note under Quantity when the draft range cuts a 32/64-bit value, and the Scale
// section's note about combined values.
import { act, screen, within } from "@testing-library/react";
import type { FormatOverride, PollConfigInput } from "@/shared/ipc/modbus-master.types";
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

const ov = (start: number, end: number, format: FormatOverride["format"]): FormatOverride => ({
  start,
  end,
  format,
  swapBytes: false,
  reverseWords: false,
});

async function setup(
  host: "workspace" | "native",
  poll: Partial<PollConfigInput> = {},
): Promise<PollViewHarness> {
  const h = await renderPollView({ host, mode: "manual", width: 900, poll });
  if (host === "workspace") act(() => h.rt.stores.ui.getState().setSetupOpen(true));
  return h;
}
const type = (h: PollViewHarness, field: "startAddress" | "quantity", text: string) =>
  act(() => h.rt.stores.ui.getState().patchPollDraft(field, text));
const info = () => screen.queryByTestId("cut-range-info");

describe.each(["workspace", "native"] as const)("Poll setup in %s", (host) => {
  it("AC 3: there is no Interpretation section", async () => {
    await setup(host);
    expect(screen.getByTestId("poll-setup")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Interpretation" })).not.toBeInTheDocument();
    expect(screen.queryByText("Interpretation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply interpretation/ })).not.toBeInTheDocument();
  });

  it("names the Float 32-bit value that a draft Start of 101 cuts, and goes away when it no longer cuts", async () => {
    const h = await setup(host, {
      definition: { slaveId: 1, function: 3, startAddress: 100, quantity: 5, scanRateMs: 100 },
      formatOverrides: [ov(100, 101, "float32")],
    });
    expect(info()).not.toBeInTheDocument();
    type(h, "startAddress", "101");
    type(h, "quantity", "4");
    expect(info()).toHaveTextContent(
      "This range cuts the Float 32-bit value 100-101; it will show as Incomplete.",
    );
    // the note is described from Quantity
    const quantity = within(screen.getByTestId("poll-setup")).getByLabelText("Quantity");
    expect(quantity.getAttribute("aria-describedby")).toContain(info()?.id ?? "missing");
    type(h, "startAddress", "100");
    type(h, "quantity", "5");
    expect(info()).not.toBeInTheDocument();
  });

  it("counts the other cut values: one more at the end of the range", async () => {
    const h = await setup(host, {
      definition: { slaveId: 1, function: 3, startAddress: 100, quantity: 6, scanRateMs: 100 },
      formatOverrides: [ov(100, 101, "float32"), ov(104, 105, "unsigned32")],
    });
    type(h, "startAddress", "101");
    type(h, "quantity", "4");
    expect(info()).toHaveTextContent(
      "This range cuts the Float 32-bit value 100-101; it will show as Incomplete. 1 more value is cut.",
    );
  });

  it("uses the display base for the addresses", async () => {
    const h = await setup(host, {
      definition: { slaveId: 1, function: 3, startAddress: 100, quantity: 5, scanRateMs: 100 },
      display: { addressBase: 1, showAlias: true, copyAlias: false },
      formatOverrides: [ov(100, 101, "float32")],
    });
    // 1-based: start text 102 is protocol address 101
    type(h, "startAddress", "102");
    type(h, "quantity", "4");
    expect(info()).toHaveTextContent("This range cuts the Float 32-bit value 101-102;");
  });

  it("is a note, not an error: Apply is not blocked and the range is applied", async () => {
    const h = await setup(host, {
      definition: { slaveId: 1, function: 3, startAddress: 100, quantity: 5, scanRateMs: 100 },
      formatOverrides: [ov(100, 101, "float32")],
    });
    type(h, "startAddress", "101");
    type(h, "quantity", "4");
    const setup_ = screen.getByTestId("poll-setup");
    expect(within(setup_).queryByRole("alert")).not.toBeInTheDocument();
    await h.act(async () => {
      expect((await h.rt.actions.applySetup()).ok).toBe(true);
    });
    expect(h.ipc.pollSummary(h.pollId).config.definition).toMatchObject({
      startAddress: 101,
      quantity: 4,
    });
    expect(info()).not.toBeInTheDocument();
    // the overrides are kept (keyed by address) and the first row is now Incomplete
    expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([ov(100, 101, "float32")]);
  });

  it("says nothing for a coil poll or an invalid draft", async () => {
    const h = await setup(host, {
      definition: { slaveId: 1, function: 1, startAddress: 100, quantity: 5, scanRateMs: 100 },
      formatOverrides: [ov(100, 101, "float32")],
    });
    type(h, "startAddress", "101");
    expect(info()).not.toBeInTheDocument();
    type(h, "quantity", "abc");
    expect(info()).not.toBeInTheDocument();
  });

  it("the Scale section says how many combined values are not scaled", async () => {
    const h = await setup(host, {
      formatOverrides: [ov(0, 1, "float32")],
    });
    expect(screen.getByTestId("scale-combined-note")).toHaveTextContent(
      "Scaling applies to 16-bit rows. 1 combined value in this poll is not scaled.",
    );
    // AC 1 of REQ-009: rows 2-5 as Float 32-bit are two combined values
    await h.act(() => h.ipc.setPollView(h.pollId, { formatOverrides: [ov(2, 5, "float32")] }));
    expect(screen.getByTestId("scale-combined-note")).toHaveTextContent(
      "Scaling applies to 16-bit rows. 2 combined values in this poll are not scaled.",
    );
    await h.act(() =>
      h.ipc.setPollView(h.pollId, {
        formatOverrides: [ov(0, 1, "float32"), ov(4, 7, "unsigned32")],
      }),
    );
    expect(screen.getByTestId("scale-combined-note")).toHaveTextContent(
      "Scaling applies to 16-bit rows. 3 combined values in this poll are not scaled.",
    );
    await h.act(() => h.ipc.setPollView(h.pollId, { formatOverrides: [] }));
    expect(screen.queryByTestId("scale-combined-note")).not.toBeInTheDocument();
  });

  it("the Scale section stays active with group rows (no combined-mode text)", async () => {
    await setup(host, { formatOverrides: [ov(0, 3, "float32")] });
    expect(screen.queryByTestId("scale-inactive")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Scaling is unavailable for combined values. Saved scales apply again/),
    ).not.toBeInTheDocument();
  });
});
