import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { badResponseExtra as bad, sessionReason } from "@/shared/ipc/modbus-master.fake";
import type { ReadFunction } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow, TCP } from "../test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const at = new Date(2026, 9, 12, 14, 2, 11, 540).getTime();

/** Puts the window into polling for a definition, as if the user connected and started. */
async function polling(fn: ReadFunction = 3, quantity = 10, values?: number[]) {
  h = await renderWindow({
    prepare: ({ rt }) => {
      rt.stores.config.getState().setConnection(TCP);
      rt.stores.config.getState().setPoll({
        slaveId: 1,
        function: fn,
        startAddress: 0,
        quantity,
        scanRateMs: 1000,
      });
    },
  });
  h.state("connecting");
  h.state("connected");
  await waitFor(() => expect(h.ipc.callsOf("startPoll")).toHaveLength(1));
  h.state("polling");
  if (values) {
    h.emit(() => h.ipc.emitPollUpdate({ function: fn, startAddress: 0, values, at }));
  }
}

const grid = () => screen.getByRole("grid", { name: "Register values" });
const chip = () => document.querySelector<HTMLElement>("[data-slot=freshness-chip]");
const rows = () => within(grid()).getAllByRole("row");

describe("empty data texts (DES-001 2.4)", () => {
  it("idle", async () => {
    h = await renderWindow();
    expect(screen.getByTestId("data-empty")).toHaveTextContent(
      "Not connected. Configure a connection and press Connect (Ctrl+L).",
    );
    expect(screen.queryByRole("grid", { name: "Register values" })).not.toBeInTheDocument();
  });

  it("disconnected", async () => {
    h = await renderWindow();
    h.state("connecting");
    h.state("disconnected", { reason: sessionReason("refused", "x") });
    expect(screen.getByTestId("data-empty")).toHaveTextContent(
      "Connection lost. Press Reconnect to continue.",
    );
  });

  it("exception before any data", async () => {
    await polling();
    h.state("exception", { exceptionCode: 2 });
    expect(screen.getByTestId("data-empty")).toHaveTextContent(
      "No data: the device answered with exception 02 (Illegal data address).",
    );
  });
});

describe("loading, live and stale", () => {
  it("shows rows with dashes and the waiting chip while loading", async () => {
    await polling();
    expect(chip()).toHaveTextContent("Waiting for first response…");
    expect(chip()?.querySelector('[data-icon="loader"]')).toBeInTheDocument();
    expect(grid()).toHaveAttribute("aria-rowcount", "11");
    expect(within(grid()).getAllByText("—")).toHaveLength(10);
  });

  it("shows the values and the Updated chip when live", async () => {
    await polling(3, 3, [1234, 65535, 0]);
    expect(chip()).toHaveTextContent("Updated 14:02:11.540");
    expect(chip()?.querySelector('[data-icon="circle-check"]')).toBeInTheDocument();
    expect(within(grid()).getByText("1234")).toBeVisible();
    expect(within(grid()).getByText("65535")).toBeVisible();
    expect(screen.getByTestId("poll-summary")).toHaveTextContent(
      "Slave 1 · FC03 Read holding registers · 0-2 (3)",
    );
  });

  it("shows the stale chip with the time in timeout", async () => {
    await polling(3, 3, [1234, 65535, 0]);
    h.state("timeout");
    expect(chip()).toHaveTextContent("No response - values from 14:02:11.540");
    expect(chip()?.querySelector('[data-icon="clock"]')).toBeInTheDocument();
    expect(within(grid()).getByText("1234")).toBeVisible();
  });

  it.each([
    ["paused", undefined, "Paused - values from 14:02:11.540"],
    ["exception", { exceptionCode: 2 }, "Exception - values from 14:02:11.540"],
    ["badResponse", bad("crc"), "Bad response - values from 14:02:11.540"],
  ] as const)("shows the stale chip in %s", async (state, extra, text) => {
    await polling(3, 3, [1, 2, 3]);
    h.state(state, extra);
    expect(chip()).toHaveTextContent(text);
  });

  it("keeps the stale values after the link is lost", async () => {
    await polling(3, 3, [1, 2, 3]);
    h.state("disconnected", { reason: sessionReason("closedByPeer", "x") });
    expect(chip()).toHaveTextContent("Disconnected - values from 14:02:11.540");
    expect(within(grid()).getByText("3")).toBeVisible();
  });
});

describe("format and base controls", () => {
  it("Ctrl+3 shows 0x04D2 for 1234", async () => {
    await polling(3, 3, [1234, 65535, 0]);
    fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    expect(await within(grid()).findByText("0x04D2")).toBeVisible();
    expect(within(grid()).getByText("0xFFFF")).toBeVisible();
    expect(screen.getByRole("radio", { name: "Hex" })).toBeChecked();
  });

  it.each([
    ["1", "Unsigned", "65535"],
    ["2", "Signed", "-1"],
    ["4", "Binary", "1111 1111 1111 1111"],
  ])("Ctrl+%s selects %s", async (key, label, shown) => {
    await polling(3, 1, [65535]);
    fireEvent.keyDown(window, { key, ctrlKey: true });
    expect(await within(grid()).findByText(shown)).toBeVisible();
    expect(screen.getByRole("radio", { name: label })).toBeChecked();
  });

  it("the Format radios work with the mouse", async () => {
    await polling(3, 1, [1234]);
    await h.user.click(screen.getByRole("radio", { name: "Hex" }));
    expect(within(grid()).getByText("0x04D2")).toBeVisible();
  });

  it("Ctrl+B switches the header to Address (1-based) and the addresses", async () => {
    await polling(3, 3, [1, 2, 3]);
    expect(within(grid()).getByText("Address (0-based)")).toBeVisible();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(await within(grid()).findByText("Address (1-based)")).toBeVisible();
    expect(rows()[1]).toHaveTextContent("1");
    expect(screen.getByTestId("poll-summary")).toHaveTextContent("1-3 (3)");
  });

  it("FC01 disables Format with the tooltip text and shows 0 or 1", async () => {
    await polling(1, 4, [1, 0, 1, 1]);
    expect(screen.getByRole("radiogroup", { name: "Format" })).toHaveAttribute(
      "title",
      "Coils and discrete inputs are shown as 0 or 1.",
    );
    expect(screen.getByRole("radio", { name: "Hex" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    expect(h.rt.stores.config.getState().display.format).toBe("unsigned");
    expect(screen.getByTestId("poll-summary")).toHaveTextContent("FC01 Read coils");
  });
});

describe("grid semantics (task 13)", () => {
  it("has role grid with aria-rowcount, aria-rowindex and aria-selected", async () => {
    await polling(3, 3, [1, 2, 3]);
    expect(grid()).toHaveAttribute("aria-rowcount", "4");
    const all = rows();
    expect(all.map((r) => r.getAttribute("aria-rowindex"))).toEqual(["1", "2", "3", "4"]);
    expect(all[1]).toHaveAttribute("aria-selected", "false");
    await h.user.click(all[1] as HTMLElement);
    expect(all[1]).toHaveAttribute("aria-selected", "true");
  });

  it("selection shows a dark left bar in addition to the tint", async () => {
    await polling(3, 3, [1, 2, 3]);
    await h.user.click(rows()[2] as HTMLElement);
    expect(rows()[2]?.className).toContain("border-dark");
    expect(rows()[2]?.className).toContain("bg-selected");
  });

  it("renders only the visible rows of a long poll", async () => {
    await polling(
      1,
      2000,
      Array.from({ length: 2000 }, (_, i) => i % 2),
    );
    expect(grid()).toHaveAttribute("aria-rowcount", "2001");
    expect(within(grid()).getAllByRole("row").length).toBeLessThan(100);
  });

  it("click, shift-click and ctrl-click select rows", async () => {
    await polling(3, 6, [0, 1, 2, 3, 4, 5]);
    await h.user.click(rows()[2] as HTMLElement);
    await h.user.keyboard("{Shift>}");
    await h.user.click(rows()[4] as HTMLElement);
    await h.user.keyboard("{/Shift}");
    expect(h.rt.stores.selection.getState().selectedRows()).toEqual([1, 2, 3]);
    await h.user.keyboard("{Control>}");
    await h.user.click(rows()[6] as HTMLElement);
    await h.user.keyboard("{/Control}");
    expect(h.rt.stores.selection.getState().selectedRows()).toEqual([1, 2, 3, 5]);
  });

  it("arrow keys, Home, End and Ctrl+A work on the focused grid", async () => {
    await polling(3, 6, [0, 1, 2, 3, 4, 5]);
    await h.user.click(rows()[1] as HTMLElement);
    await h.user.keyboard("{ArrowDown}{ArrowDown}");
    expect(h.rt.stores.selection.getState().selectedRows()).toEqual([2]);
    await h.user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(h.rt.stores.selection.getState().selectedRows()).toEqual([2, 3]);
    await h.user.keyboard("{End}");
    expect(h.rt.stores.selection.getState().selectedRows()).toEqual([5]);
    await h.user.keyboard("{Home}");
    expect(h.rt.stores.selection.getState().selectedRows()).toEqual([0]);
    await h.user.keyboard("{Control>}a{/Control}");
    expect(h.rt.stores.selection.getState().selectedRows()).toEqual([0, 1, 2, 3, 4, 5]);
    await h.user.keyboard("{Escape}");
    expect(h.rt.stores.selection.getState().selectedRows()).toEqual([]);
  });

  it("copying rows 0-1 in Hex gives address, tab and value, and a toast", async () => {
    await polling(3, 3, [1234, 65535, 0]);
    await h.user.click(screen.getByRole("radio", { name: "Hex" }));
    await h.user.click(rows()[1] as HTMLElement);
    await h.user.keyboard("{Shift>}");
    await h.user.click(rows()[2] as HTMLElement);
    await h.user.keyboard("{/Shift}{Control>}c{/Control}");
    await waitFor(() => expect(h.copied).toEqual(["0\t0x04D2\n1\t0xFFFF"]));
    expect(await screen.findByText("Copied 2 rows.")).toBeVisible();
  });

  it("double-click on an FC04 row shows the read-only toast", async () => {
    await polling(4, 3, [1, 2, 3]);
    await h.user.dblClick(rows()[1] as HTMLElement);
    expect(
      await screen.findByText("Discrete inputs and input registers are read-only."),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Enter and double-click on a holding register row open the Write dialog prefilled", async () => {
    await polling(3, 3, [1234, 65535, 7]);
    await h.user.click(rows()[2] as HTMLElement);
    await h.user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Write" });
    expect(within(dialog).getByLabelText("Function")).toHaveValue("6");
    expect(within(dialog).getByLabelText("Start address")).toHaveValue("1");
    expect(within(dialog).getByLabelText("Value")).toHaveValue("65535");
    await h.user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await h.user.dblClick(rows()[3] as HTMLElement);
    expect(await screen.findByRole("dialog", { name: "Write" })).toBeVisible();
  });

  it("interaction also works on stale values", async () => {
    await polling(3, 3, [1, 2, 3]);
    h.state("timeout");
    await h.user.click(rows()[1] as HTMLElement);
    expect(h.rt.stores.selection.getState().selectedRows()).toEqual([0]);
  });

  it("column resize handles are keyboard operable and respect the minimum", async () => {
    await polling(3, 3, [1, 2, 3]);
    const handle = screen.getByRole("separator", { name: "Resize Value column" });
    expect(handle).toHaveAttribute("aria-valuenow", "200");
    act(() => handle.focus());
    await h.user.keyboard("{ArrowRight}");
    expect(h.rt.stores.layout.getState().columnWidths["data.value"]).toBe(208);
    for (let i = 0; i < 40; i += 1) await h.user.keyboard("{ArrowLeft}");
    expect(h.rt.stores.layout.getState().columnWidths["data.value"]).toBe(96);
    await h.user.dblClick(handle);
    expect(h.rt.stores.layout.getState().columnWidths["data.value"]).toBeGreaterThanOrEqual(96);
  });
});
