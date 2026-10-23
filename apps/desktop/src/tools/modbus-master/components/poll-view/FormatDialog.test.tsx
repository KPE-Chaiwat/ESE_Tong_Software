// The Format dialog D1 (DES-009 section 4, FE-009 task 07; redesigned by DES-010, FE-010 tasks 03 and
// 04), in both hosts.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IpcError } from "@/shared/ipc/errors";
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

const ov = (
  start: number,
  end: number,
  format: FormatOverride["format"],
  flags: Partial<FormatOverride> = {},
): FormatOverride => ({ start, end, format, swapBytes: false, reverseWords: false, ...flags });

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
const cellOf = (row: number, kind: string) =>
  rowOf(row).querySelector(`[data-cell="${kind}"]`) as HTMLElement;
const text = (el: HTMLElement) => el.textContent?.trim() ?? "";
const grid = () => screen.getByRole("grid", { name: "Register values" });
const dialog = () => screen.getByRole("dialog", { name: "Format / endian" });
const radio = (name: string) => within(dialog()).getByRole("radio", { name });
const apply = () => within(dialog()).getByRole("button", { name: /^Appl/ });
const messages = () => within(dialog()).getByTestId("format-messages");
/** The lines of every warning box in the message area, in order. */
const warningLines = () =>
  Array.from(messages().querySelectorAll("[data-kind='warning'] p")).map((p) => p.textContent);

/** The lines of every info box in the message area (the mixed note, the unchanged note), in order. */
const infoLines = () =>
  Array.from(messages().querySelectorAll("[data-kind='info'] p")).map((p) => p.textContent);

const summary = () => within(dialog()).getByTestId("format-summary");
const heading = (bits: 16 | 32 | 64) => within(dialog()).getByTestId(`width-heading-${bits}`);
const reason = (bits: 32 | 64) => within(dialog()).queryByTestId(`width-reason-${bits}`);
const previewSummary = () => within(dialog()).getByTestId("format-preview-summary");
const previewNotice = () => within(dialog()).queryByTestId("format-preview-notice");
/** The preview table as `address value` strings. */
const previewRows = () =>
  within(dialog())
    .getAllByTestId("format-preview-row")
    .map((tr) =>
      Array.from(tr.querySelectorAll("td"))
        .map((td) => td.textContent)
        .join(" "),
    );
const orderGroup = () => within(dialog()).queryByTestId("order-group");

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

/** Selects rows (by first address) and opens the dialog from the row menu, like the user. */
async function openFromMenu(h: PollViewHarness, from: number, to = from) {
  act(() => {
    h.rt.stores.ui.getState().click(from);
    if (to !== from) h.rt.stores.ui.getState().click(to, { shift: true });
  });
  const index = h.rt.rows().findIndex((r) => r.address === from);
  await h.user.pointer({ keys: "[MouseRight]", target: rowOf(index) });
  await h.user.click(screen.getByRole("menuitem", { name: "More formats…" }));
  return dialog();
}

/** Closes the dialog with Esc and waits until it is gone. */
async function closeDialog() {
  fireEvent.keyDown(dialog(), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

describe.each(["workspace", "native"] as const)("Format dialog in %s", (host) => {
  it("AC 1: rows 2-5, Float 32-bit, Big-endian, Apply makes two Float32 rows and sends one patch", async () => {
    const h = await live(host, [0, 1, 0x3f80, 0, 0x4000, 0, 6, 7, 8, 9]);
    await openFromMenu(h, 2, 5);
    expect(summary()).toHaveTextContent("Selected 4 registers (2-5)");
    await h.user.click(radio("Float 32-bit"));
    expect(radio("Big-endian")).toBeChecked();
    expect(previewSummary()).toHaveTextContent("2 Float 32-bit values, Big-endian (ABCD)");
    // the preview is what the grid shows after Apply
    expect(previewRows()).toEqual(["2-3 1", "4-5 2"]);
    await h.user.click(apply());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.callsOf("setPollView")).toEqual([
      [h.pollId, { formatOverrides: [ov(2, 5, "float32")] }],
    ]);
    expect(text(cellOf(2, "address"))).toBe("2");
    expect(text(cellOf(3, "address"))).toBe("3");
    expect(text(cellOf(4, "address"))).toBe("4");
    expect(text(cellOf(2, "raw"))).toBe("1");
    expect(text(cellOf(3, "raw"))).toBe("--");
    expect(text(cellOf(4, "raw"))).toBe("2");
    expect([0, 1, 6, 7, 8, 9].map((i) => text(cellOf(i, "format")))).toEqual(Array(6).fill("U16"));
    expect(h.announced).toEqual(["Format applied: Float 32-bit, Big-endian (ABCD) to 2-5."]);
    // focus is back on the grid, on the row that now holds the origin
    expect(grid()).toHaveFocus();
    expect(grid().getAttribute("aria-activedescendant")).toBe(rowOf(2).id);
  });

  it("sends no Modbus request, keeps the poll state and marks nothing but the config", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    const requests = h.ipc.requestLog.length;
    await openFromMenu(h, 0, 1);
    await h.user.click(radio("Hex"));
    await h.user.click(apply());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.requestLog).toHaveLength(requests);
    expect(h.rt.stores.poll.getState().state).toBe("polling");
  });

  it("one selected register can form a 32-bit value with the next register", async () => {
    const h = await live(host, [100, 200, 400, 50]);
    await openFromMenu(h, 0);
    expect(summary()).toHaveTextContent("Selected 1 register (0)");
    expect(summary().querySelector(".font-mono")).toHaveTextContent("0");
    expect(radio("Unsigned 32-bit")).toBeEnabled();
    expect(radio("Float 64-bit (Double)")).toBeEnabled();
    expect(heading(32)).toHaveTextContent("32-bit · 1 value (2 registers each)");
    expect(reason(32)).toBeNull();
    await h.user.click(radio("Unsigned 32-bit"));
    expect(previewRows()).toEqual(["0-1 6553800"]);
    expect(infoLines()).toContain("Also includes register 1 to complete the selected values.");
    await h.user.click(apply());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([ov(0, 1, "unsigned32")]);
  });

  it("three selected registers form two 32-bit values by including the next register", async () => {
    const h = await live(host, [100, 200, 400, 50, 0, 0]);
    await openFromMenu(h, 0, 2);
    expect(heading(32)).toHaveTextContent("32-bit · 2 values (2 registers each)");
    expect(heading(64)).toHaveTextContent("64-bit · 1 value (4 registers each)");
    await h.user.click(radio("Unsigned 32-bit"));
    expect(previewRows()).toEqual(["0-1 6553800", "2-3 26214450"]);
    expect(infoLines()).toContain("Also includes register 3 to complete the selected values.");
    await h.user.click(apply());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([ov(0, 3, "unsigned32")]);
  });

  it("ten selected registers in a twelve-register poll include 10-11 for 64-bit", async () => {
    const h = await live(host, Array(12).fill(1), { definition: def(0, 12) });
    await openFromMenu(h, 0, 9);
    expect(heading(64)).toHaveTextContent("64-bit · 3 values (4 registers each)");
    await h.user.click(radio("Float 64-bit (Double)"));
    expect(infoLines()).toContain("Also includes registers 10-11 to complete the selected values.");
    await h.user.click(apply());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([ov(0, 11, "float64")]);
  });

  it("a selection at the poll end remains 16-bit when no complete value fits", async () => {
    const h = await live(host, [1, 2, 3, 4, 5, 6]);
    await openFromMenu(h, 5);
    expect(radio("Float 32-bit")).toBeEnabled();
    await h.user.click(radio("Float 32-bit"));
    expect(heading(32)).toHaveTextContent("32-bit · 0 values (2 registers each)");
    expect(infoLines()).toContain(
      "Register 5 stays Unsigned 16-bit: there are not enough following registers in this poll.",
    );
    await h.user.click(apply());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.callsOf("setPollView")).toEqual([]);
  });

  it("non-contiguous runs are completed with following poll registers", async () => {
    const h = await live(host, [1, 2, 3, 4, 5, 6, 7, 8]);
    act(() => {
      h.rt.stores.ui.getState().click(0);
      for (const a of [1, 4, 5, 6]) h.rt.stores.ui.getState().click(a, { ctrl: true });
    });
    act(() => h.rt.actions.openFormatDialog("header"));
    expect(summary()).toHaveTextContent("Selected 5 registers (0-1, 4-6)");
    expect(summary().querySelector(".font-mono")).toHaveTextContent("0-1, 4-6");
    expect(heading(32)).toHaveTextContent("32-bit · 3 values (2 registers each)");
    await h.user.click(radio("Signed 32-bit"));
    expect(infoLines()).toContain("Also includes register 7 to complete the selected values.");
    await h.user.click(apply());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([
      ov(0, 1, "signed32"),
      ov(4, 7, "signed32"),
    ]);
  });

  it("all format radios stay labelled and enabled for a short selection", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    await openFromMenu(h, 0);
    for (const bits of [16, 32, 64] as const) {
      const head = heading(bits);
      const group = head.closest("[role='group']") as HTMLElement;
      expect(group).toHaveAttribute("aria-labelledby", head.id);
    }
    for (const name of ["Unsigned", "Float 32-bit", "Float 64-bit (Double)"]) {
      expect(radio(name)).toBeEnabled();
      expect(radio(name).getAttribute("aria-describedby")).toContain(
        heading(name === "Unsigned" ? 16 : name === "Float 32-bit" ? 32 : 64).id,
      );
    }
    expect(reason(32)).toBeNull();
    expect(reason(64)).toBeNull();
  });

  it("non-contiguous blocks that are each a multiple apply as separate entries", async () => {
    const h = await live(host, Array(10).fill(1), { definition: def(0, 10) });
    act(() => {
      h.rt.stores.ui.getState().click(0);
      for (const a of [1, 2, 3, 6, 7, 8, 9]) h.rt.stores.ui.getState().click(a, { ctrl: true });
    });
    act(() => {
      h.rt.actions.openFormatDialog("header");
    });
    expect(heading(32)).toHaveTextContent("32-bit · 4 values (2 registers each)");
    expect(heading(64)).toHaveTextContent("64-bit · 2 values (4 registers each)");
    await h.user.click(radio("Float 64-bit (Double)"));
    await h.user.click(apply());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([
      ov(0, 3, "float64"),
      ov(6, 9, "float64"),
    ]);
  });

  it("arrow keys traverse every format and wrap", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    await openFromMenu(h, 0);
    expect(radio("Unsigned")).toHaveFocus();
    await h.user.keyboard("{ArrowUp}");
    expect(radio("Float 64-bit (Double)")).toBeChecked();
    expect(radio("Float 64-bit (Double)")).toHaveFocus();
    await h.user.keyboard("{ArrowDown}");
    expect(radio("Unsigned")).toBeChecked();
    expect(radio("Unsigned")).toHaveFocus();
    for (const name of ["Signed 32-bit", "Binary"]) {
      expect(radio(name)).not.toBeChecked();
    }
  });

  it("ArrowDown from Float 32-bit moves into the 64-bit group", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    await openFromMenu(h, 0, 1);
    await h.user.click(radio("Float 32-bit"));
    expect(radio("Float 32-bit")).toHaveFocus();
    await h.user.keyboard("{ArrowDown}");
    expect(radio("Signed 64-bit")).toBeChecked();
    expect(radio("Signed 64-bit")).toHaveFocus();
  });

  it("mixed formats open on Unsigned with the mixed note, never on a multi-register format (D-009-05)", async () => {
    const h = await live(host, Array(10).fill(1), {
      definition: def(0, 10),
      formatOverrides: [ov(0, 3, "float64"), ov(4, 4, "hex")],
    });
    await openFromMenu(h, 0, 9);
    expect(radio("Unsigned")).toBeChecked();
    expect(radio("Float 64-bit (Double)")).not.toBeChecked();
    expect(summary()).toHaveTextContent("Selected 10 registers (0-9) · mixed formats");
    expect(infoLines()).toEqual([
      "The selected rows use different formats. The format you apply replaces all of them.",
    ]);
    expect(apply()).not.toHaveAttribute("aria-disabled");
  });

  it("D-009-05: format and order names are never truncated", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    await openFromMenu(h, 0, 3);
    await h.user.click(radio("Float 32-bit"));
    const names = [
      "Unsigned",
      "Signed",
      "Hex",
      "Binary",
      "Signed 32-bit",
      "Unsigned 32-bit",
      "Float 32-bit",
      "Signed 64-bit",
      "Unsigned 64-bit",
      "Float 64-bit (Double)",
      "Big-endian",
      "Little-endian",
      "Big-endian byte swap",
      "Little-endian byte swap",
    ];
    for (const name of names) {
      const label = document.getElementById(radio(name).getAttribute("aria-labelledby") ?? "");
      expect(label?.textContent).toBe(name);
      // no ellipsis class: the label wraps instead (values may truncate, labels may not)
      expect(label?.className).not.toMatch(/truncate|text-ellipsis|overflow-hidden/);
    }
    // the headings and the reasons are complete too
    for (const bits of [16, 32, 64] as const) {
      expect(heading(bits).className).not.toMatch(/truncate|text-ellipsis|overflow-hidden/);
    }
  });

  it("AC 4: accessible name and description, focus inside, Tab trapped in the documented order", async () => {
    const h = await live(host, [0, 0, 0x3f80, 0, 0, 0], { formatOverrides: [ov(2, 5, "float32")] });
    await openFromMenu(h, 2, 5);
    const d = dialog();
    expect(d).toHaveAttribute("aria-modal", "true");
    const described = (d.getAttribute("aria-describedby") ?? "").split(" ");
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
      "Applies to the selected rows and following registers needed to complete values. Changes the display; nothing is sent to the device.",
      "Selected 4 registers (2-5)",
    ]);
    expect(radio("Float 32-bit")).toHaveFocus();
    await h.user.tab();
    expect(radio("Big-endian")).toHaveFocus();
    await h.user.tab();
    // the Preview region is part of the order (DES-010 12)
    expect(within(d).getByRole("region", { name: "Preview" })).toHaveFocus();
    await h.user.tab();
    expect(within(d).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await h.user.tab();
    expect(apply()).toHaveFocus();
    await h.user.tab();
    expect(within(d).getByRole("button", { name: "Close dialog" })).toHaveFocus();
    await h.user.tab();
    expect(radio("Float 32-bit")).toHaveFocus();
    await h.user.tab({ shift: true });
    expect(within(d).getByRole("button", { name: "Close dialog" })).toHaveFocus();
  });

  it("the Tab order skips the order group for a 16-bit format and Enter applies from the Preview region", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    await openFromMenu(h, 0, 1);
    await h.user.click(radio("Hex"));
    await h.user.tab();
    expect(within(dialog()).getByRole("region", { name: "Preview" })).toHaveFocus();
    await h.user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([ov(0, 1, "hex")]);
  });

  it("AC 4: arrow keys move and check the radios, Enter applies, focus returns to the grid row", async () => {
    const h = await live(host, [1, 2, 3, 4, 5, 6]);
    await openFromMenu(h, 2, 3);
    expect(radio("Unsigned")).toHaveFocus();
    await h.user.keyboard("{ArrowDown}");
    expect(radio("Signed")).toBeChecked();
    await h.user.keyboard("{ArrowDown}");
    expect(radio("Hex")).toBeChecked();
    expect(radio("Hex")).toHaveFocus();
    await h.user.keyboard("{ArrowUp}");
    expect(radio("Signed")).toBeChecked();
    await h.user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([ov(2, 3, "signed")]);
    expect(grid()).toHaveFocus();
    expect(grid().getAttribute("aria-activedescendant")).toBe(rowOf(2).id);
  });

  it("Esc cancels without applying, and Cancel and the overlay do the same", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    await openFromMenu(h, 1);
    await h.user.click(radio("Hex"));
    await h.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.callsOf("setPollView")).toEqual([]);
    expect(grid()).toHaveFocus();
    await openFromMenu(h, 1);
    await h.user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.ipc.callsOf("setPollView")).toEqual([]);
    await openFromMenu(h, 1);
    await h.user.click(within(dialog()).getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.rt.stores.formatDialog.getState().open).toBe(false);
  });

  it("the order group exists only for a 32/64-bit format and the last order is kept (REQ-010 acceptance 4)", async () => {
    const h = await live(host, [0x4148, 0, 0, 0, 5, 6]);
    await openFromMenu(h, 0, 3);
    // Unsigned: no group, no order radios, no help line, no 16-bit note
    expect(orderGroup()).toBeNull();
    expect(within(dialog()).queryByRole("radio", { name: "Big-endian" })).toBeNull();
    expect(within(dialog()).queryByText("A is the high byte of the first register.")).toBeNull();
    expect(within(dialog()).queryByText(/^Order applies/)).toBeNull();
    // Float 32-bit: the four orders, Big-endian checked, with their patterns
    await h.user.click(radio("Float 32-bit"));
    expect(orderGroup()).not.toBeNull();
    expect(radio("Big-endian")).toBeChecked();
    for (const pattern of ["ABCD", "DCBA", "BADC", "CDAB"]) {
      expect(within(dialog()).getByText(pattern)).toBeVisible();
    }
    expect(within(dialog()).getByText("A is the high byte of the first register.")).toBeVisible();
    await h.user.click(radio("Little-endian byte swap"));
    // Hex: hidden again (not greyed)
    await h.user.click(radio("Hex"));
    expect(orderGroup()).toBeNull();
    expect(within(dialog()).queryByRole("radio", { name: "Little-endian byte swap" })).toBeNull();
    // Signed 64-bit: back, with the order chosen before
    await h.user.click(radio("Signed 64-bit"));
    expect(orderGroup()).not.toBeNull();
    expect(radio("Little-endian byte swap")).toBeChecked();
    expect(within(dialog()).getByText("GHEFCDAB")).toBeVisible();
    await h.user.click(apply());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.callsOf("setPollView")).toEqual([
      [h.pollId, { formatOverrides: [ov(0, 3, "signed64", { reverseWords: true })] }],
    ]);
  });

  it("applying a 16-bit format after an order was chosen stores no order flags", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    await openFromMenu(h, 0, 3);
    await h.user.click(radio("Float 32-bit"));
    await h.user.click(radio("Little-endian"));
    await h.user.click(radio("Hex"));
    await h.user.click(apply());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([ov(0, 3, "hex")]);
  });

  it("a reopened dialog forgets the order of the last session", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    await openFromMenu(h, 0, 3);
    await h.user.click(radio("Float 32-bit"));
    await h.user.click(radio("Little-endian byte swap"));
    await closeDialog();
    await openFromMenu(h, 0, 3);
    await h.user.click(radio("Float 32-bit"));
    expect(radio("Big-endian")).toBeChecked();
  });

  it("showing and hiding the order group keeps the focus on the checked Format radio (keyboard only)", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    await openFromMenu(h, 0, 3);
    expect(radio("Unsigned")).toHaveFocus();
    // Unsigned → Signed → Hex → Binary: no order group
    await h.user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(radio("Binary")).toBeChecked();
    expect(orderGroup()).toBeNull();
    expect(document.activeElement).toBe(radio("Binary"));
    // → Signed 32-bit: the group appears, the focus stays on the Format radio
    await h.user.keyboard("{ArrowDown}");
    expect(radio("Signed 32-bit")).toBeChecked();
    expect(orderGroup()).not.toBeNull();
    expect(document.activeElement).toBe(radio("Signed 32-bit"));
    await h.user.keyboard("{ArrowDown}{ArrowDown}");
    expect(radio("Float 32-bit")).toBeChecked();
    expect(document.activeElement).toBe(radio("Float 32-bit"));
    // and back to Binary: the group goes, the focus stays
    await h.user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(radio("Binary")).toBeChecked();
    expect(orderGroup()).toBeNull();
    expect(document.activeElement).toBe(radio("Binary"));
  });

  it("shows the byte patterns for 32-bit and 64-bit formats", async () => {
    const h = await live(host, [1, 2, 3, 4, 5, 6, 7, 8]);
    await openFromMenu(h, 0, 3);
    await h.user.click(radio("Float 32-bit"));
    for (const pattern of ["ABCD", "DCBA", "BADC", "CDAB"]) {
      expect(within(dialog()).getByText(pattern)).toBeVisible();
    }
    await h.user.click(radio("Unsigned 64-bit"));
    for (const pattern of ["ABCDEFGH", "HGFEDCBA", "BADCFEHG", "GHEFCDAB"]) {
      expect(within(dialog()).getByText(pattern)).toBeVisible();
    }
    await h.user.click(radio("Little-endian"));
    expect(previewSummary()).toHaveTextContent("1 Unsigned 64-bit value, Little-endian (HGFEDCBA)");
    expect(previewRows().length).toBe(1);
    expect(previewRows()[0]).toMatch(/^0-3 /);
  });

  it("previews the real values of the latest snapshot, in the checked order, without a request", async () => {
    // registers 0-1 hold 0x3F80 0x0000: Float 32 big-endian is 1.0
    const h = await live(host, [0x3f80, 0, 0x4000, 0]);
    await openFromMenu(h, 0, 3);
    expect(within(dialog()).getByTestId("preview-unsigned")).toHaveTextContent("16256");
    expect(within(dialog()).getByTestId("preview-signed")).toHaveTextContent("16256");
    expect(within(dialog()).getByTestId("preview-hex")).toHaveTextContent("0x3F80");
    expect(within(dialog()).getByTestId("preview-binary")).toHaveTextContent("0011 1111 1000 0000");
    expect(within(dialog()).getByTestId("preview-float32")).toHaveTextContent("1");
    expect(within(dialog()).getByTestId("preview-unsigned32")).toHaveTextContent("1065353216");
    expect(within(dialog()).getByTestId("preview-unsigned64")).toHaveTextContent(
      "4575657222482165760",
    );
    await h.user.click(radio("Float 32-bit"));
    expect(within(dialog()).getByTestId("order-preview-big")).toHaveTextContent("1");
    expect(previewRows()).toEqual(["0-1 1", "2-3 2"]);
    // the preview moves with a new snapshot while the dialog is open
    act(() => h.ipc.emitPollUpdate(h.pollId, { values: [0x4000, 0, 0x4000, 0] }));
    expect(within(dialog()).getByTestId("preview-float32")).toHaveTextContent("2");
    expect(previewRows()).toEqual(["0-1 2", "2-3 2"]);
    expect(h.ipc.callsOf("setPollView")).toEqual([]);
  });

  it("REQ-010 acceptance 5: 12.5 and 0 before Apply, another order updates the preview with no request", async () => {
    const h = await live(host, [0x4148, 0, 0, 0, 1, 2]);
    await openFromMenu(h, 0, 3);
    await h.user.click(radio("Float 32-bit"));
    expect(previewSummary()).toHaveTextContent("2 Float 32-bit values, Big-endian (ABCD)");
    expect(previewRows()).toEqual(["0-1 12.5", "2-3 0"]);
    const calls = h.ipc.calls.length;
    const requests = h.ipc.requestLog.length;
    await h.user.click(radio("Little-endian byte swap"));
    expect(previewSummary()).toHaveTextContent(
      "2 Float 32-bit values, Little-endian byte swap (CDAB)",
    );
    const [first, second] = previewRows();
    expect(first).toMatch(/^0-1 .*e-41$/);
    expect(second).toBe("2-3 0");
    expect(h.ipc.calls).toHaveLength(calls);
    expect(h.ipc.requestLog).toHaveLength(requests);
    // after Apply the grid shows the same values
    await h.user.click(apply());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(`0-1 ${text(cellOf(0, "raw"))}`).toBe(first);
    expect(`2-3 ${text(cellOf(2, "raw"))}`).toBe(second);
  });

  it("the preview lists eight values and counts the rest (REQ-010 acceptance 5, DES-010 7.2)", async () => {
    const h = await live(host, [16712, 0, 0, 0, 16712, 0, 161, 65534, 9, 10]);
    await openFromMenu(h, 0, 9);
    expect(previewSummary()).toHaveTextContent("10 Unsigned values");
    expect(previewRows()).toEqual([
      "0 16712",
      "1 0",
      "2 0",
      "3 0",
      "4 16712",
      "5 0",
      "6 161",
      "7 65534",
    ]);
    expect(within(dialog()).getByTestId("format-preview-more")).toHaveTextContent(
      "… and 2 more values",
    );
    expect(within(dialog()).getByText("Address (0-based)")).toBeVisible();
    // a Float 32-bit preview of the same 10 rows has five values and no "more" line
    await h.user.click(radio("Float 32-bit"));
    expect(previewRows()).toHaveLength(5);
    expect(within(dialog()).queryByTestId("format-preview-more")).toBeNull();
  });

  it("preview rows carry the protocol address and the preview is not a live region", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    await openFromMenu(h, 2, 3);
    const rows = within(dialog()).getAllByTestId("format-preview-row");
    expect(rows.map((r) => r.getAttribute("data-address"))).toEqual(["2", "3"]);
    const region = within(dialog()).getByRole("region", { name: "Preview" });
    expect(region.closest("[aria-live]")).toBeNull();
    expect(region.querySelector("[aria-live]")).toBeNull();
    // mono type for the values and the addresses
    expect(rows[0]?.className).toMatch(/font-mono/);
  });

  it("the preview says stale for retained values", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    act(() => h.ipc.emitPollState(h.pollId, "paused"));
    await openFromMenu(h, 0, 1);
    expect(previewNotice()).toHaveAttribute("data-kind", "stale");
    expect(previewNotice()).toHaveTextContent("Preview uses the last values received (stale).");
    expect(previewNotice()?.querySelector("[data-icon='clock']")).not.toBeNull();
    expect(previewRows()).toEqual(["0 1", "1 2"]);
  });

  it.each([
    ["timeout", "timeout" as const],
    ["exception", "exception" as const],
    ["badResponse", "badResponse" as const],
  ])("the preview says stale for retained values after %s", async (_name, state) => {
    const h = await live(host, [1, 2, 3, 4]);
    act(() =>
      h.ipc.emitPollState(h.pollId, state, state === "exception" ? { exceptionCode: 2 } : {}),
    );
    await openFromMenu(h, 0, 1);
    expect(previewNotice()).toHaveAttribute("data-kind", "stale");
    expect(previewRows()).toEqual(["0 1", "1 2"]);
  });

  it("a notice appears and clears while the dialog is open, without a new request", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    await openFromMenu(h, 0, 1);
    expect(previewNotice()).toBeNull();
    const calls = h.ipc.calls.length;
    act(() => h.ipc.emitPollState(h.pollId, "paused"));
    expect(previewNotice()).toHaveAttribute("data-kind", "stale");
    act(() => {
      h.ipc.emitPollState(h.pollId, "polling");
      h.ipc.emitPollUpdate(h.pollId, { values: [5, 6, 7, 8] });
    });
    expect(previewNotice()).toBeNull();
    expect(previewRows()).toEqual(["0 5", "1 6"]);
    expect(h.ipc.calls).toHaveLength(calls);
  });

  describe("empty previews say why (DES-010 7.3)", () => {
    /** A view with no data yet, row 2-3 selected and the dialog open. */
    async function emptyView(prepare: (h: PollViewHarness) => void) {
      const h = await renderPollView({ host, mode: "manual", poll: { definition: def(0, 6) } });
      prepare(h);
      act(() => {
        h.rt.stores.ui.getState().click(2);
        h.rt.stores.ui.getState().click(3, { shift: true });
      });
      act(() => {
        h.rt.actions.openFormatDialog("header");
      });
      return h;
    }
    const expectNotice = (kind: string, icon: string, message: string) => {
      const n = previewNotice();
      expect(n).toHaveAttribute("data-kind", kind);
      expect(n?.querySelector(`[data-icon='${icon}']`)).not.toBeNull();
      expect(n).toHaveTextContent(message);
      // the table keeps the addresses with dashes, and the option previews show a dash
      expect(previewRows()).toEqual(["2 —", "3 —"]);
      expect(within(dialog()).getByTestId("preview-hex")).toHaveTextContent("—");
      // distinct from the width reasons: this poll can still use 32-bit
      expect(reason(32)).toBeNull();
    };

    it("N1 not connected", async () => {
      await emptyView(() => {});
      expectNotice(
        "notConnected",
        "plug",
        "No preview: not connected. Connect to read values. You can apply the format now.",
      );
      expect(apply()).not.toHaveAttribute("aria-disabled");
    });
    it("N2 connecting", async () => {
      await emptyView((h) => act(() => h.ipc.emitConnectionState("connecting")));
      expectNotice("connecting", "loader", "No preview yet: connecting to the device.");
      // static: the loader does not spin
      expect(previewNotice()?.querySelector("svg")?.getAttribute("class")).toMatch(/animate-none/);
    });
    it("N4 connected, no reply yet", async () => {
      await emptyView((h) =>
        act(() => {
          h.ipc.emitConnectionState("connected");
          h.ipc.emitPollState(h.pollId, "polling");
        }),
      );
      expectNotice("waiting", "loader", "No preview yet: waiting for the first reply.");
    });
    it("N11 paused without values", async () => {
      await emptyView((h) =>
        act(() => {
          h.ipc.emitConnectionState("connected");
          h.ipc.emitPollState(h.pollId, "paused");
        }),
      );
      expectNotice(
        "paused",
        "pause",
        "No preview: the poll is paused. Resume it (Ctrl+P) to read values.",
      );
    });
    it("N9 and N10 the last request got no valid reply", async () => {
      await emptyView((h) =>
        act(() => {
          h.ipc.emitConnectionState("connected");
          h.ipc.emitPollState(h.pollId, "exception", { exceptionCode: 2 });
        }),
      );
      expectNotice(
        "failed",
        "octagon-x",
        "No preview: the last request got no valid reply. Values appear after the next good reply.",
      );
    });
    it("N13 connection lost without values", async () => {
      await emptyView((h) =>
        act(() => {
          h.ipc.emitConnectionState("disconnected");
        }),
      );
      expectNotice(
        "connectionLost",
        "unplug",
        "No preview: the connection was lost. Reconnect to read values.",
      );
    });
  });

  it("a short selection previews the value using the following register", async () => {
    const h = await live(host, [0x3f80, 0, 5, 6]);
    await openFromMenu(h, 2);
    expect(within(dialog()).getByTestId("preview-float32")).not.toBeEmptyDOMElement();
    expect(within(dialog()).getByTestId("preview-unsigned")).toHaveTextContent("5");
  });

  it("M-C2: a selection that splits a group the poll's edge cuts says which registers it resets", async () => {
    const h = await live(host, [1, 2, 3, 4], {
      definition: def(101, 4),
      formatOverrides: [ov(100, 101, "float32")],
    });
    await openFromMenu(h, 101);
    // The edge-cut row keeps its current format and includes the next poll register.
    expect(radio("Float 32-bit")).toBeChecked();
    expect(radio("Float 32-bit")).toBeEnabled();
    const cut =
      "Also resets 100 to Unsigned: this change splits the Float 32-bit value 100-101. 100 is outside this poll.";
    expect(warningLines()).toEqual([cut]);
    expect(apply()).not.toHaveAttribute("aria-disabled");
    await h.user.click(radio("Hex"));
    expect(within(messages()).getByText(cut)).toBeVisible();
    expect(apply()).not.toHaveAttribute("aria-disabled");
    await h.user.click(apply());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([ov(101, 101, "hex")]);
  });

  it("M-T: too many overrides is an error and Apply stays off", async () => {
    const many = Array.from({ length: 255 }, (_, i) => ov(1000 + 2 * i, 1000 + 2 * i, "hex"));
    const h = await live(host, [1, 2, 3, 4], { formatOverrides: many });
    act(() => {
      h.rt.stores.ui.getState().click(0);
      h.rt.stores.ui.getState().click(2, { ctrl: true });
    });
    act(() => {
      h.rt.actions.openFormatDialog("header");
    });
    await h.user.click(radio("Hex"));
    const alert = within(dialog()).getByRole("alert");
    expect(alert).toHaveTextContent(
      "A poll can have at most 256 format overrides. This change would create 257. Select fewer separate blocks.",
    );
    expect(apply()).toHaveAttribute("aria-disabled", "true");
    expect(apply().getAttribute("aria-describedby")).toContain(
      alert.querySelector("p")?.id ?? "missing",
    );
  });

  it("M-R: a rule that does not fit the new formats is named, nothing is sent and the focus stays on Apply", async () => {
    const h = await live(host, [1, 2, 3, 4], {
      colorRules: [
        {
          name: "Flow",
          enabled: true,
          range: null,
          source: "raw",
          comparison: "greaterThan",
          threshold: "1.5",
          upperThreshold: null,
          highlight: "lime",
        },
      ],
    });
    await openFromMenu(h, 0, 3);
    await h.user.click(radio("Unsigned 64-bit"));
    await h.user.click(apply());
    const alert = await within(dialog()).findByTestId("format-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(
      'Format not applied. Rule "Flow": Enter a whole decimal number for a 64-bit integer comparison.',
    );
    expect(h.ipc.callsOf("setPollView")).toEqual([]);
    expect(dialog()).toBeVisible();
    // changing a radio clears the message
    await h.user.click(radio("Float 64-bit (Double)"));
    expect(within(dialog()).queryByTestId("format-error")).not.toBeInTheDocument();
  });

  it("M-F: a rejected change keeps the dialog, the choice and the draft, and a retry works", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    await openFromMenu(h, 0, 1);
    await h.user.click(radio("Signed 32-bit"));
    await h.user.click(radio("Little-endian"));
    h.ipc.failNext(
      "setPollView",
      new IpcError("Format override 0-1: boom.", "validation", "formatOverrides"),
    );
    await h.user.click(apply());
    const alert = await within(dialog()).findByTestId("format-error");
    expect(alert).toHaveTextContent("Could not apply the format. Format override 0-1: boom.");
    expect(radio("Signed 32-bit")).toBeChecked();
    expect(radio("Little-endian")).toBeChecked();
    expect(apply()).not.toHaveAttribute("aria-disabled");
    expect(apply()).not.toHaveAttribute("aria-busy");
    await h.user.click(apply());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([
      ov(0, 1, "signed32", { swapBytes: true, reverseWords: true }),
    ]);
  });

  it("shows a backend rule rejection verbatim and stays open (D-001-14)", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    await openFromMenu(h, 0, 3);
    await h.user.click(radio("Unsigned 64-bit"));
    h.ipc.failNext(
      "setPollView",
      new IpcError(
        'Format not applied. Rule "High" requires whole-number thresholds for 64-bit integers.',
        "validation",
        "colorRules",
      ),
    );
    await h.user.click(apply());
    const alert = await within(dialog()).findByTestId("format-error");
    // the backend's own text, without the "Could not apply the format." prefix (DES-009 11.8)
    expect(alert.querySelector("p")?.textContent).toBe(
      'Format not applied. Rule "High" requires whole-number thresholds for 64-bit integers.',
    );
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.querySelector("svg")).not.toBeNull();
    expect(dialog()).toBeVisible();
  });

  it("P: while applying the button says Applying…, the radios are off and Esc is ignored until the reply", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    await openFromMenu(h, 0, 1);
    await h.user.click(radio("Hex"));
    const held = h.ipc.hold("setPollView");
    await h.user.click(apply());
    expect(apply()).toHaveTextContent("Applying…");
    expect(apply()).toHaveAttribute("aria-busy", "true");
    expect(radio("Signed")).toBeDisabled();
    expect(within(dialog()).getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(dialog()).toBeVisible();
    // a second click sends nothing more
    await h.user.click(apply());
    expect(h.ipc.callsOf("setPollView")).toHaveLength(1);
    await h.act(async () => held.release());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("M-U: the same format closes without a request", async () => {
    const h = await live(host, [1, 2, 3, 4], { formatOverrides: [ov(0, 1, "hex")] });
    await openFromMenu(h, 0, 1);
    expect(radio("Hex")).toBeChecked();
    expect(
      within(messages()).getByText("The selected rows already use this format."),
    ).toBeVisible();
    await h.user.click(apply());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.ipc.callsOf("setPollView")).toEqual([]);
  });

  it("a mixed scope opens on Unsigned (not Hex), with the mixed note and Apply on (S8, D-009-05)", async () => {
    const h = await live(host, [1, 2, 3, 4], {
      formatOverrides: [
        ov(0, 1, "float32", { swapBytes: true, reverseWords: true }),
        ov(2, 2, "hex"),
      ],
    });
    await openFromMenu(h, 0, 2);
    expect(radio("Unsigned")).toBeChecked();
    expect(radio("Unsigned")).toHaveFocus();
    const note = within(messages()).getByText(
      "The selected rows use different formats. The format you apply replaces all of them.",
    );
    expect(note.closest("[data-kind='info']")).not.toBeNull();
    expect(note.closest("[data-kind='info']")?.querySelector("svg")).not.toBeNull();
    expect(warningLines()).toEqual([]);
    expect(apply()).not.toHaveAttribute("aria-disabled");
    await h.user.click(apply());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([]);
  });

  it("REQ-010 acceptance 7: Float 32-bit rows 0-1 and Hex rows 2-3 open mixed, 4 / 2 / 1 values", async () => {
    const h = await live(host, [1, 2, 3, 4], {
      formatOverrides: [ov(0, 1, "float32"), ov(2, 3, "hex")],
    });
    // rows: 0-1 (one group row), 2, 3
    await openFromMenu(h, 0, 3);
    expect(summary()).toHaveTextContent("Selected 4 registers (0-3) · mixed formats");
    expect(radio("Unsigned")).toBeChecked();
    expect(heading(16)).toHaveTextContent("16-bit · 4 values (1 register each)");
    expect(heading(32)).toHaveTextContent("32-bit · 2 values (2 registers each)");
    expect(heading(64)).toHaveTextContent("64-bit · 1 value (4 registers each)");
    expect(previewSummary()).toHaveTextContent("4 Unsigned values");
  });

  it("a mixed scope with several 16-bit formats opens on Unsigned (S9)", async () => {
    const h = await live(host, [1, 2, 3, 4], {
      formatOverrides: [ov(0, 0, "hex"), ov(1, 1, "binary"), ov(2, 3, "float32")],
    });
    await openFromMenu(h, 0, 3);
    expect(radio("Unsigned")).toBeChecked();
    expect(within(messages()).getByText(/The selected rows use different formats/)).toBeVisible();
    expect(apply()).not.toHaveAttribute("aria-disabled");
  });

  it("M-S: a poll that shows Scaled only says combined values have no scaled value", async () => {
    const h = await live(host, [1, 2, 3, 4], {
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
      valueColumns: "scaled",
    });
    await openFromMenu(h, 0, 1);
    await h.user.click(radio("Float 32-bit"));
    expect(
      within(messages()).getByText(
        "This poll shows Scaled values only. Combined values have no scaled value; choose Show Both or Raw to see them.",
      ),
    ).toBeVisible();
    await h.user.click(radio("Hex"));
    expect(within(messages()).queryByText(/Scaled values only/)).not.toBeInTheDocument();
  });

  it("Select all with 125 rows: the tail stays 16-bit; 124 rows give 62 and 31 values", async () => {
    const h = await live(host, Array(125).fill(1), { definition: def(0, 125) });
    act(() => h.rt.stores.ui.getState().selectAll());
    act(() => {
      h.rt.actions.openFormatDialog("header");
    });
    expect(summary()).toHaveTextContent("Selected 125 registers (0-124)");
    expect(heading(32)).toHaveTextContent("32-bit · 62 values (2 registers each)");
    expect(heading(64)).toHaveTextContent("64-bit · 31 values (4 registers each)");
    expect(radio("Float 32-bit")).toBeEnabled();
    expect(apply()).not.toHaveAttribute("aria-disabled");
    expect(previewRows()).toHaveLength(8);
    expect(within(dialog()).getByTestId("format-preview-more")).toHaveTextContent(
      "… and 117 more values",
    );
    await closeDialog();
    act(() => {
      h.rt.stores.ui.getState().click(0);
      h.rt.stores.ui.getState().click(123, { shift: true });
    });
    act(() => {
      h.rt.actions.openFormatDialog("header");
    });
    expect(heading(16)).toHaveTextContent("16-bit · 124 values (1 register each)");
    expect(heading(32)).toHaveTextContent("32-bit · 62 values (2 registers each)");
    expect(heading(64)).toHaveTextContent("64-bit · 31 values (4 registers each)");
    await h.user.click(radio("Float 32-bit"));
    await h.user.click(apply());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([ov(0, 123, "float32")]);
  });

  it("the dialog stays open and recomputes when the formats change underneath it", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    await openFromMenu(h, 0, 1);
    await h.user.click(radio("Hex"));
    expect(
      within(messages()).queryByText("The selected rows already use this format."),
    ).not.toBeInTheDocument();
    await h.act(() => h.ipc.setPollView(h.pollId, { formatOverrides: [ov(0, 1, "hex")] }));
    expect(
      within(messages()).getByText("The selected rows already use this format."),
    ).toBeVisible();
  });

  it("closes without applying when the poll is detached or removed", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    await openFromMenu(h, 0, 1);
    await h.user.click(radio("Hex"));
    act(() => h.rt.stores.formatDialog.getState().closeForRemoval());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.callsOf("setPollView")).toEqual([]);
  });
});

describe.each(["workspace", "native"] as const)("opening the dialog elsewhere in %s", (host) => {
  it("the Format… button opens it for the selection and gives the focus back to the button", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    act(() => {
      h.rt.stores.ui.getState().click(1);
      h.rt.stores.ui.getState().click(2, { shift: true });
    });
    const button = screen.getByRole("button", { name: "Format…" });
    await h.user.click(button);
    expect(summary()).toHaveTextContent("Selected 2 registers (1-2)");
    await h.user.click(radio("Hex"));
    await h.user.click(apply());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(button).toHaveFocus();
    expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([ov(1, 2, "hex")]);
  });

  it("the narrow Show menu item opens it and returns to the Show button", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    h.setWidth(600);
    act(() => h.rt.stores.ui.getState().click(1));
    const show = screen.getByRole("button", { name: "Show Raw" });
    await h.user.click(show);
    expect(screen.queryByRole("menuitem", { name: /Format \/ endian/ })).toBeNull();
    await h.user.click(screen.getByRole("menuitem", { name: "More formats…" }));
    expect(dialog()).toBeVisible();
    fireEvent.keyDown(dialog(), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Format / endian" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Show Raw" })).toHaveFocus();
  });

  it("holds the window's modal lock while open and releases it on close", async () => {
    let held = 0;
    const h = await renderPollView({
      host,
      mode: "manual",
      lockModal: () => {
        held += 1;
        return () => {
          held -= 1;
        };
      },
    });
    act(() => h.rt.stores.ui.getState().click(1));
    expect(held).toBe(0);
    act(() => {
      h.rt.actions.openFormatDialog("grid", 1);
    });
    expect(held).toBe(1);
    await h.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(held).toBe(0);
  });
});

describe.each(["workspace", "native"] as const)(
  "focus and scrolling in the dialog in %s",
  (host) => {
    const original = Element.prototype.scrollIntoView;
    let scrollIntoView: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView as unknown as typeof original;
    });
    afterEach(() => {
      Element.prototype.scrollIntoView = original;
    });

    /** The elements `scrollIntoView` was called on. */
    const scrolled = () => scrollIntoView.mock.contexts as Element[];

    it("REV-015 m2: opening the dialog never scrolls the grid or anything else behind the modal", async () => {
      const h = await live(host, [1, 2, 3, 4]);
      act(() => h.rt.stores.ui.getState().click(0));
      // the grid has the focus, as when the dialog is opened from the keyboard or the row menu
      const behind = grid();
      act(() => behind.focus());
      expect(behind).toHaveFocus();
      scrollIntoView.mockClear();
      act(() => {
        h.rt.actions.openFormatDialog("grid", 0);
      });
      expect(dialog()).toBeVisible();
      expect(radio("Unsigned")).toHaveFocus();
      const form = dialog().querySelector("form");
      expect(form).not.toBeNull();
      for (const el of scrolled()) expect(form?.contains(el)).toBe(true);
      expect(scrolled()).not.toContain(behind);
    });

    it("REV-015 m2: a format change scrolls only the focused radio inside the form", async () => {
      const h = await live(host, [1, 2, 3, 4]);
      await openFromMenu(h, 0, 3);
      scrollIntoView.mockClear();
      await h.user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
      expect(radio("Signed 32-bit")).toBeChecked();
      expect(scrolled().length).toBeGreaterThan(0);
      const form = dialog().querySelector("form");
      for (const el of scrolled()) expect(form?.contains(el)).toBe(true);
      expect(scrolled().at(-1)).toBe(radio("Signed 32-bit"));
    });

    it("REV-015 m3: focus inside the order group moves to the checked Format radio when the group goes", async () => {
      const h = await live(host, [1, 2, 3, 4]);
      await openFromMenu(h, 0, 3);
      await h.user.click(radio("Float 32-bit"));
      await h.user.click(radio("Little-endian"));
      act(() => radio("Big-endian").focus());
      expect(orderGroup()?.contains(document.activeElement)).toBe(true);
      // a 16-bit format removes the group, and the focus with it
      act(() => h.rt.stores.formatDialog.getState().setFormat("hex"));
      expect(orderGroup()).toBeNull();
      expect(radio("Hex")).toBeChecked();
      expect(radio("Hex")).toHaveFocus();
    });
  },
);
