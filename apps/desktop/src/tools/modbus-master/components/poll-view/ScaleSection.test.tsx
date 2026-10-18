import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { PollHostKind, ScaleSettings } from "@/shared/ipc/modbus-master.types";
import { clickWithLayoutShift } from "@/shared/lib/press-test-utils";
import { createPollViewRuntime } from "../../runtime/poll-view-runtime";
import { createConnectionStore } from "../../store/connection.store";
import { PollView } from "./PollView";
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

const NOT_APPLIED = "Scale not applied. Fix the highlighted fields.";

/** Renders a poll with its setup open (a native window opens it by itself). */
async function open(
  host: PollHostKind = "workspace",
  extra: Parameters<typeof renderPollView>[0] = {},
) {
  const h = await renderPollView({ host, connect: true, width: 900, ...extra });
  if (host === "workspace") act(() => h.rt.stores.ui.getState().setSetupOpen(true));
  h.advance(300);
  return h;
}

const section = () => screen.getByRole("region", { name: "Scale" });
const field = (label: string) => within(section()).getByLabelText(label) as HTMLInputElement;
const applied = () => screen.getByTestId("applied-scale");
const applyButton = () => within(section()).getByRole("button", { name: "Apply scale" });

/** The `mm_set_poll_view` calls that carry a scale. */
const scaleCalls = (h: PollViewHarness) =>
  h.ipc.callsOf("setPollView").filter(([, view]) => "scale" in (view as object));

async function choose(h: PollViewHarness, label: string) {
  await h.user.selectOptions(field("Preset"), label);
}

describe.each(["workspace", "native"] as const)("the scale section in the %s host", (host) => {
  it("shows SCALE and OVERRIDES below POLL, with no scale applied", async () => {
    await open(host);
    expect(section()).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Overrides (0)" })).toBeInTheDocument();
    expect(applied()).toHaveTextContent("Applied: Raw (no scale)");
    expect(field("Preset")).toHaveValue("none");
    expect(within(section()).queryByLabelText("Raw min")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scale-not-applied")).not.toBeInTheDocument();
  });

  it("selecting 4-20 mA fills mA, 2 decimals, and Y 4 and 20 read-only with the hint (C9)", async () => {
    const h = await open(host);
    await choose(h, "4-20 mA");
    expect(field("Unit")).toHaveValue("mA");
    expect(field("Decimals")).toHaveValue("2");
    expect(field("Eng. min")).toHaveValue("4");
    expect(field("Eng. max")).toHaveValue("20");
    expect(field("Eng. min")).toHaveAttribute("readonly");
    expect(field("Eng. max")).toHaveAttribute("readonly");
    expect(
      within(section()).getByText("Choose Custom linear to change the engineering range."),
    ).toBeInTheDocument();
    expect(field("Raw min")).toHaveValue("0");
    expect(field("Raw max")).toHaveValue("65535");
    // nothing is applied by choosing
    expect(applied()).toHaveTextContent("Applied: Raw (no scale)");
    expect(scaleCalls(h)).toHaveLength(0);
  });

  it("0-10 V fixes Y 0 to 10 and the unit V; Custom linear makes the engineering range editable", async () => {
    const h = await open(host);
    await choose(h, "0-10 V");
    expect(field("Unit")).toHaveValue("V");
    expect(field("Eng. max")).toHaveValue("10");
    await choose(h, "Custom linear");
    expect(field("Eng. min")).not.toHaveAttribute("readonly");
    expect(field("Eng. min")).toHaveValue("0");
    expect(field("Unit")).toHaveValue("");
    expect(
      within(section()).queryByText("Choose Custom linear to change the engineering range."),
    ).not.toBeInTheDocument();
    expect(within(section()).getByRole("radiogroup", { name: "Out of range" })).toBeInTheDocument();
  });

  it("the quick pick 4000-20000 fills the raw fields", async () => {
    const h = await open(host);
    await choose(h, "4-20 mA");
    await h.user.click(within(section()).getByRole("button", { name: "4000-20000" }));
    expect(field("Raw min")).toHaveValue("4000");
    expect(field("Raw max")).toHaveValue("20000");
    for (const pick of ["0-4095", "0-27648", "0-32767", "0-65535"]) {
      expect(within(section()).getByRole("button", { name: pick })).toBeInTheDocument();
    }
  });

  it("Divide offers 10, 100, 1000 and Custom, and 100 sets 2 decimals", async () => {
    const h = await open(host);
    await choose(h, "Divide");
    const divisor = within(section()).getByRole("radiogroup", { name: "Divisor" });
    expect(
      within(divisor)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["10", "100", "1000", "Custom"]);
    expect(field("Decimals")).toHaveValue("1");
    await h.user.click(within(divisor).getByRole("radio", { name: "100" }));
    expect(field("Decimals")).toHaveValue("2");
    await h.user.click(within(divisor).getByRole("radio", { name: "Custom" }));
    await h.user.type(field("Custom divisor"), "4");
    expect(field("Custom divisor")).toHaveValue("4");
    // Divide has no raw range and no engineering range
    expect(within(section()).queryByLabelText("Raw min")).not.toBeInTheDocument();
    expect(within(section()).queryByLabelText("Eng. min")).not.toBeInTheDocument();
    expect(within(section()).getByLabelText("Raw is signed")).toBeInTheDocument();
  });

  it("Apply scale sends the scale, shows 'Applied: ...' and switches the table to Both (C10)", async () => {
    const h = await open(host);
    await choose(h, "4-20 mA");
    await h.user.click(within(section()).getByRole("button", { name: "4000-20000" }));
    await h.user.click(applyButton());
    await waitFor(() => expect(applied()).toHaveTextContent("Applied: 4-20 mA (raw 4000-20000)"));
    expect(scaleCalls(h)).toHaveLength(1);
    expect(scaleCalls(h)[0]?.[1]).toMatchObject({
      scale: { preset: "current4to20", xMin: 4000, xMax: 20000, unit: "mA", decimals: 2 },
      valueColumns: "both",
    });
    expect(h.rt.stores.poll.getState().config?.valueColumns).toBe("both");
    expect(screen.queryByTestId("scale-unapplied")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Scaled value" })).toBeInTheDocument();
  });

  it("Enter in a scale field applies", async () => {
    const h = await open(host);
    await choose(h, "Divide");
    await h.user.type(field("Unit"), "°C{Enter}");
    await waitFor(() => expect(applied()).toHaveTextContent("Applied: Divide by 10"));
    expect(scaleCalls(h)[0]?.[1]).toMatchObject({
      scale: { preset: "divide", divisor: 10, unit: "°C" },
    });
  });

  it("Raw min = Raw max: the message is under Raw max, the header says so, Applied is unchanged (C3)", async () => {
    const h = await open(host);
    await choose(h, "4-20 mA");
    await h.user.click(applyButton());
    await waitFor(() => expect(applied()).toHaveTextContent("Applied: 4-20 mA (raw 0-65535)"));
    await h.user.clear(field("Raw min"));
    await h.user.type(field("Raw min"), "100");
    await h.user.clear(field("Raw max"));
    await h.user.type(field("Raw max"), "100");
    await h.user.click(applyButton());
    expect(screen.getByTestId("scale-not-applied")).toHaveTextContent(NOT_APPLIED);
    const rawMax = field("Raw max");
    expect(rawMax).toHaveAttribute("aria-invalid", "true");
    expect(rawMax.getAttribute("aria-describedby")).toBeTruthy();
    const message = within(section()).getByText("Raw min and raw max must be different.");
    expect(message.closest("[data-slot=field-message]")?.id).toBe(
      rawMax.getAttribute("aria-describedby"),
    );
    expect(applied()).toHaveTextContent("Applied: 4-20 mA (raw 0-65535)");
    expect(scaleCalls(h)).toHaveLength(1);
    expect(h.rt.stores.poll.getState().config?.scale?.xMax).toBe(65535);
    // the focus goes to the first invalid field
    expect(rawMax).toHaveFocus();
    // the unapplied edit counts for the close confirms
    expect(h.rt.stores.poll.getState().hasUnappliedEdits).toBe(true);
  });

  it("a message shows when a field is left, not while typing (C1)", async () => {
    const h = await open(host);
    await choose(h, "4-20 mA");
    await h.user.clear(field("Raw min"));
    await h.user.type(field("Raw min"), "-1");
    expect(within(section()).queryByText(/Raw min must be/)).not.toBeInTheDocument();
    await h.user.tab();
    expect(
      within(section()).getByText("Raw min must be a whole number from 0 to 65535."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("scale-not-applied")).not.toBeInTheDocument();
  });

  it("Raw is signed re-validates the raw fields at once (C2)", async () => {
    const h = await open(host);
    await choose(h, "4-20 mA");
    await h.user.click(within(section()).getByLabelText("Raw is signed"));
    expect(
      within(section()).getByText("Raw max must be a whole number from -32768 to 32767."),
    ).toBeInTheDocument();
    await h.user.click(within(section()).getByLabelText("Raw is signed"));
    expect(within(section()).queryByText(/Raw max must be/)).not.toBeInTheDocument();
  });

  it("the unit, decimals and engineering messages (C4, C7, C8)", async () => {
    const h = await open(host);
    await choose(h, "Custom linear");
    await h.user.clear(field("Eng. max"));
    await h.user.type(field("Eng. max"), "4,5");
    await h.user.clear(field("Decimals"));
    await h.user.type(field("Decimals"), "7");
    await h.user.type(field("Unit"), "x".repeat(13));
    await h.user.click(applyButton());
    expect(within(section()).getByText("Use a dot as the decimal separator.")).toBeInTheDocument();
    expect(
      within(section()).getByText("Decimals must be a whole number from 0 to 6."),
    ).toBeInTheDocument();
    expect(within(section()).getByText("Unit must be at most 12 characters.")).toBeInTheDocument();
    expect(screen.getByTestId("scale-not-applied")).toHaveTextContent(NOT_APPLIED);
    expect(field("Eng. max")).toHaveFocus();
  });

  it("one click on [Apply scale] works when the blur of Decimals shows a message and moves the button (D4)", async () => {
    const h = await open(host);
    await choose(h, "4-20 mA");
    await h.user.click(applyButton());
    await waitFor(() => expect(applied()).toHaveTextContent("Applied: 4-20 mA"));
    await h.user.clear(field("Decimals"));
    await h.user.type(field("Decimals"), "7");
    const message = "Decimals must be a whole number from 0 to 6.";
    expect(within(section()).queryByText(message)).not.toBeInTheDocument();
    // The blur caused by the press shows the message; the button moves away, the release lands elsewhere.
    await clickWithLayoutShift(
      h.user,
      applyButton(),
      () => within(section()).queryByText(message) !== null,
      () => within(section()).getByText(message),
    );
    expect(screen.getByTestId("scale-not-applied")).toHaveTextContent(NOT_APPLIED);
    expect(within(section()).getByText(message)).toBeInTheDocument();
    expect(field("Decimals")).toHaveFocus();
  });

  it("an applied scale shows its settings; Reset by choosing None applies no scale (scale: null)", async () => {
    const h = await open(host);
    await choose(h, "Divide");
    await h.user.click(applyButton());
    await waitFor(() => expect(applied()).toHaveTextContent("Applied: Divide by 10"));
    await choose(h, "None (raw)");
    await h.user.click(applyButton());
    await waitFor(() => expect(applied()).toHaveTextContent("Applied: Raw (no scale)"));
    expect(scaleCalls(h).at(-1)?.[1]).toMatchObject({ scale: null, valueColumns: "raw" });
    expect(h.rt.stores.poll.getState().config?.scale).toBeNull();
  });

  it("with FC01 the section is disabled with its text, and a kept scale gets the note (B5)", async () => {
    const h = await open(host, {
      poll: {
        definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
      },
    });
    await choose(h, "Divide");
    await h.user.click(applyButton());
    await waitFor(() => expect(applied()).toHaveTextContent("Applied: Divide by 10"));
    expect(screen.queryByTestId("scale-inactive")).not.toBeInTheDocument();
    await act(async () => {
      await h.ipc.updatePoll(h.pollId, {
        slaveId: 1,
        function: 1,
        startAddress: 0,
        quantity: 10,
        scanRateMs: 100,
      });
    });
    const text = screen.getByTestId("scale-inactive");
    expect(text).toHaveTextContent("Scaling applies to registers (FC03 and FC04) only.");
    expect(text).toHaveTextContent("The scale is kept and applies again with FC03 or FC04.");
    expect(field("Preset")).toBeDisabled();
    expect(applyButton()).toBeDisabled();
    // the scale is kept, and the table shows the raw column only
    expect(h.rt.stores.poll.getState().config?.scale?.preset).toBe("divide");
    expect(screen.queryByRole("columnheader", { name: "Scaled value" })).not.toBeInTheDocument();
    await act(async () => {
      await h.ipc.updatePoll(h.pollId, {
        slaveId: 1,
        function: 3,
        startAddress: 0,
        quantity: 10,
        scanRateMs: 100,
      });
    });
    expect(screen.queryByTestId("scale-inactive")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Scaled value" })).toBeInTheDocument();
  });

  it("without a kept scale the FC01 text has no note", async () => {
    await open(host, {
      poll: {
        definition: { slaveId: 1, function: 1, startAddress: 0, quantity: 8, scanRateMs: 100 },
      },
    });
    const text = screen.getByTestId("scale-inactive");
    expect(text).toHaveTextContent("Scaling applies to registers (FC03 and FC04) only.");
    expect(text).not.toHaveTextContent("The scale is kept");
  });

  it("a new scale starts 'Raw is signed' when the poll shows Signed (B4)", async () => {
    const h = await open(host);
    await act(async () => {
      await h.ipc.setPollView(h.pollId, {
        display: { format: "signed", addressBase: 0, showAlias: true, copyAlias: false },
      });
    });
    expect(within(section()).queryByLabelText("Raw is signed")).not.toBeInTheDocument();
    await choose(h, "Divide");
    expect(within(section()).getByLabelText("Raw is signed")).toBeChecked();
  });
});

describe.each(["workspace", "native"] as const)(
  "signed default range (C15) in the %s host",
  (host) => {
    it("4-20 mA on a Signed poll starts at raw 0-32767; 0-65535 is refused for a signed scale", async () => {
      const h = await renderPollView({
        host,
        mode: "manual",
        width: 900,
        poll: {
          definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 4, scanRateMs: 100 },
          display: { format: "signed", addressBase: 0, showAlias: true, copyAlias: false },
        },
      });
      act(() => {
        h.ipc.emitConnectionState("connected");
        h.ipc.emitPollState(h.pollId, "polling");
        h.ipc.emitPollUpdate(h.pollId, { values: [32767, 65535, 0, 1] });
        if (host === "workspace") h.rt.stores.ui.getState().setSetupOpen(true);
      });
      await choose(h, "4-20 mA");
      expect(within(section()).getByLabelText("Raw is signed")).toBeChecked();
      expect(field("Raw min")).toHaveValue("0");
      expect(field("Raw max")).toHaveValue("32767");
      await h.user.click(applyButton());
      const scaled = (row: number) =>
        document.querySelector(`[data-row="${row}"] [data-cell="scaled"]`) as HTMLElement;
      await waitFor(() => expect(scaled(0)).toHaveTextContent("20.00"));
      // 65535 reads as -1: below the range, 4 - 16/32767 shows as 4.00 with the marker
      expect(scaled(1)).toHaveTextContent("4.00");
      expect(scaled(1)).toHaveAttribute("data-marker", "outOfRange");
      // the quick pick 0-65535 does not fit a signed scale
      await h.user.click(within(section()).getByRole("button", { name: "0-65535" }));
      await h.user.click(applyButton());
      expect(
        within(section()).getByText("Raw max must be a whole number from -32768 to 32767."),
      ).toBeInTheDocument();
      expect(applied()).toHaveTextContent("Applied: 4-20 mA (raw 0-32767)");
    });
  },
);

describe("field pairs stack in a narrow container (DES-003 3.1)", () => {
  const stacked = () =>
    Array.from(section().querySelectorAll("[data-pair]")).map((p) =>
      p.hasAttribute("data-stacked"),
    );

  it("stay side by side at 300 px and stack at 260 px", async () => {
    const h = await open("workspace");
    await choose(h, "Custom linear");
    expect(stacked().length).toBeGreaterThanOrEqual(3);
    h.setScaleWidth(300);
    expect(stacked().every((s) => !s)).toBe(true);
    h.setScaleWidth(260);
    expect(stacked().every((s) => s)).toBe(true);
    h.setScaleWidth(334);
    expect(stacked().every((s) => !s)).toBe(true);
  });

  it("the whole-pixel limit uses the rounded width: 260.4 stacks, 260.6 does not", async () => {
    const h = await open("workspace");
    await choose(h, "Custom linear");
    h.setScaleWidth(300);
    h.setScaleWidth(260.4);
    expect(stacked().every((s) => s)).toBe(true);
    h.setScaleWidth(260.6);
    expect(stacked().every((s) => !s)).toBe(true);
  });
});

describe("the draft survives presentation changes and pop out (DES-003 3.1)", () => {
  it("closing and reopening the popover keeps the typed text and its message (C13)", async () => {
    const h = await renderPollView({ host: "workspace", connect: true, width: 600 });
    act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    expect(screen.getByRole("dialog", { name: "Poll setup" })).toBeInTheDocument();
    await choose(h, "4-20 mA");
    await h.user.click(applyButton());
    await waitFor(() => expect(applied()).toHaveTextContent("Applied: 4-20 mA (raw 0-65535)"));
    await h.user.clear(field("Raw max"));
    await h.user.type(field("Raw max"), "0");
    await h.user.click(applyButton());
    expect(
      within(section()).getByText("Raw min and raw max must be different."),
    ).toBeInTheDocument();
    // Esc closes the popover
    await h.user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Poll setup" })).not.toBeInTheDocument();
    act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    expect(field("Raw max")).toHaveValue("0");
    expect(
      within(section()).getByText("Raw min and raw max must be different."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("scale-not-applied")).toBeInTheDocument();
    expect(applied()).toHaveTextContent("Applied: 4-20 mA (raw 0-65535)");
    // widening the window turns the popover into the dock: the same draft
    h.setWidth(900);
    expect(screen.getByRole("complementary", { name: "Poll setup" })).toBeInTheDocument();
    expect(field("Raw max")).toHaveValue("0");
  });

  it("popped out: the native panel shows the same text and message; docked back, again", async () => {
    const h = await renderPollView({ host: "workspace", connect: true, width: 900 });
    act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    await choose(h, "4-20 mA");
    await h.user.clear(field("Raw max"));
    await h.user.type(field("Raw max"), "0");
    await h.user.click(applyButton());
    expect(
      within(section()).getByText("Raw min and raw max must be different."),
    ).toBeInTheDocument();

    const handoff = h.rt.stores.ui.getState().toHandoff();
    cleanup();
    await act(async () => {
      await h.ipc.popOutPoll(
        h.pollId,
        { kind: "rect", rect: { x: 0, y: 0, width: 640, height: 368 } },
        handoff,
      );
    });
    const connection = createConnectionStore({ ipc: h.ipc, role: "poll", warn: () => {} });
    const native = createPollViewRuntime({
      ipc: h.ipc,
      pollId: h.pollId,
      host: "native",
      connection,
      toasts: h.toasts,
      warn: () => {},
    });
    await act(async () => {
      await native.init();
    });
    render(<PollView runtime={native} host="native" />);
    expect(field("Preset")).toHaveValue("current4to20");
    expect(field("Raw max")).toHaveValue("0");
    expect(
      within(section()).getByText("Raw min and raw max must be different."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("scale-not-applied")).toBeInTheDocument();
    expect(applied()).toHaveTextContent("Applied: Raw (no scale)");
    // the unapplied edit still counts
    expect(native.stores.poll.getState().hasUnappliedEdits).toBe(true);

    // docked back
    const back = native.stores.ui.getState().toHandoff();
    cleanup();
    native.dispose();
    await act(async () => {
      await h.ipc.dockPoll(h.pollId, back, false, null);
    });
    const docked = createPollViewRuntime({
      ipc: h.ipc,
      pollId: h.pollId,
      host: "workspace",
      connection,
      toasts: h.toasts,
      warn: () => {},
    });
    await act(async () => {
      await docked.init();
    });
    act(() => docked.stores.ui.getState().setSetupOpen(true));
    render(<PollView runtime={docked} host="workspace" />);
    expect(field("Raw max")).toHaveValue("0");
    expect(
      within(section()).getByText("Raw min and raw max must be different."),
    ).toBeInTheDocument();
    docked.dispose();
  });
});

it("the scale editor covers the types of the generated bindings (a settings object round-trips)", async () => {
  const h = await open("workspace");
  const scale: ScaleSettings = {
    preset: "linear",
    rawSigned: true,
    xMin: -100,
    xMax: 100,
    yMin: -1.5,
    yMax: 1.5,
    divisor: 10,
    decimals: 3,
    unit: "bar",
    outOfRange: "clamp",
  };
  await act(async () => {
    await h.ipc.setPollView(h.pollId, { scale });
  });
  expect(field("Preset")).toHaveValue("linear");
  expect(field("Raw min")).toHaveValue("-100");
  expect(field("Eng. min")).toHaveValue("-1.5");
  expect(field("Decimals")).toHaveValue("3");
  expect(field("Unit")).toHaveValue("bar");
  expect(within(section()).getByLabelText("Raw is signed")).toBeChecked();
  expect(within(section()).getByRole("radio", { name: "Clamp" })).toBeChecked();
  expect(applied()).toHaveTextContent("Applied: Linear -100-100 to -1.5-1.5");
});
