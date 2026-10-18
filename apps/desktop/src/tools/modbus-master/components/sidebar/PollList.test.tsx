import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const list = () => screen.getByRole("listbox", { name: "Polls" });
const rows = () => within(list()).getAllByRole("option");
const row = (name: RegExp | string) => within(list()).getByRole("option", { name });
const frame = (id: PollId) => document.querySelector(`[data-subwindow="${id}"]`) as HTMLElement;

describe("POLLS list (DES-002 2.2.3)", () => {
  it("the empty list shows the text and the hint", async () => {
    h = await renderWindow();
    expect(screen.getByRole("heading", { name: "Polls · 0 of 16" })).toBeVisible();
    expect(
      screen.getAllByText(
        "No polls yet. Press New poll (Ctrl+Shift+N) to read registers from this connection.",
      ),
    ).toHaveLength(2);
    expect(
      screen.getByText(
        "Click a poll to bring it to the front. Drag a poll into the workspace to place it. Pop out (Ctrl+Shift+O) opens it in its own window, for another monitor.",
      ),
    ).toBeVisible();
  });

  it("a row has the name, the state chip, and slave · FC · range in the display base", async () => {
    h = await renderWindow();
    await h.addPoll("Tank 1 temperatures", {
      definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
    });
    const r = row(/^Tank 1 temperatures,/);
    expect(r).toHaveTextContent("Tank 1 temperatures");
    expect(r).toHaveTextContent("1 · FC03 · 0-9");
    expect(within(r).getByTitle("Offline")).toHaveTextContent("Offline");
    expect(r.querySelector('[data-icon="wifi-off"]')).toBeInTheDocument();
    expect(r).toHaveAttribute("aria-label", "Tank 1 temperatures, Offline, in workspace");
  });

  it("the chip and the name show Live, Timeout n and Exc cc", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const b = await h.addPoll("B");
    const c = await h.addPoll("C");
    await h.connect();
    h.advance(300);
    await h.act(() => h.ipc.emitPollState(b, "timeout", { consecutiveFailures: 3 }));
    await h.act(() =>
      h.ipc.emitPollState(c, "exception", { exceptionCode: 2, consecutiveFailures: 1 }),
    );
    expect(within(row(/^A,/)).getByTitle("Polling")).toHaveTextContent("Live");
    expect(within(row(/^B,/)).getByTitle("Timeout")).toHaveTextContent("Timeout 3");
    expect(within(row(/^C,/)).getByTitle("Exception 02")).toHaveTextContent("Exc 02");
    expect(row(/^C,/)).toHaveAttribute("aria-label", "C, Exception 02, in workspace");
    expect(a).toBeGreaterThan(0);
  });

  it("the host marker shows minimized, own window and closed, with an icon and text", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const b = await h.addPoll("B", {}, "native");
    const c = await h.addPoll("C");
    await h.act(() => h.rt.stores.workspace.getState().minimize(a));
    await h.act(() => h.ipc.closePollView(c, true));
    expect(row(/^A,/)).toHaveTextContent("minimized");
    expect(row(/^A,/).querySelector('[data-icon="minus"]')).toBeInTheDocument();
    expect(row(/^B,/)).toHaveTextContent("own window");
    expect(row(/^B,/).querySelector('[data-icon="square-arrow-out-up-right"]')).toBeInTheDocument();
    expect(row(/^C,/)).toHaveTextContent("closed");
    expect(row(/^C,/).querySelector('[data-icon="eye-off"]')).toBeInTheDocument();
    expect(row(/^A,/)).toHaveAttribute("aria-label", "A, Offline, minimized");
    expect(row(/^B,/)).toHaveAttribute("aria-label", "B, Offline, own window");
    expect(b).toBeGreaterThan(0);
  });

  it("the tooltip has name, slave, FC, range, scan rate, last update and errors", async () => {
    h = await renderWindow();
    await h.addPoll("Pump 2");
    // The counters and the last update are read when the pointer arrives, not at every cycle.
    expect(row(/^Pump 2,/)).toHaveAttribute("title", "Pump 2");
    await h.user.hover(row(/^Pump 2,/));
    expect(row(/^Pump 2,/)).toHaveAttribute(
      "title",
      "Pump 2 · Slave 1 · FC03 · 0-9 (10) · 1000 ms · Last update — · Errors 0",
    );
  });

  it("the selected row is the active sub-window's and has a dark bar and aria-selected", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    await h.addPoll("B");
    expect(row(/^B,/)).toHaveAttribute("aria-selected", "true");
    expect(row(/^A,/)).toHaveAttribute("aria-selected", "false");
    await h.act(() => h.rt.stores.workspace.getState().activate(a));
    expect(row(/^A,/)).toHaveAttribute("aria-selected", "true");
    expect(row(/^A,/).querySelector("span.bg-dark")).toBeInTheDocument();
  });

  it("a click brings the sub-window to the front; Enter does the same", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    await h.addPoll("B");
    await h.user.click(row(/^A,/));
    expect(frame(a)).toHaveAttribute("aria-current", "true");
    expect(h.ipc.callsOf("showPoll")).toHaveLength(0);
    const b = h.ipc.pollIds()[1] as PollId;
    row(/^B,/).focus();
    await h.user.keyboard("{Enter}");
    expect(frame(b)).toHaveAttribute("aria-current", "true");
  });

  it("a click on a minimized poll restores it; on a closed poll Rust reopens it", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const b = await h.addPoll("B");
    await h.act(() => h.rt.stores.workspace.getState().minimize(a));
    await h.user.click(row(/^A,/));
    expect(frame(a)).toBeVisible();
    await h.act(() => h.ipc.closePollView(b, true));
    expect(document.querySelector(`[data-subwindow="${b}"]`)).toBeNull();
    await h.user.click(row(/^B,/));
    await waitFor(() => expect(frame(b)).toBeVisible());
  });

  it("Show moves the keyboard focus into the sub-window", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    await h.addPoll("B");
    await h.user.click(row(/^A,/));
    await waitFor(() => expect(frame(a).contains(document.activeElement)).toBe(true));
  });

  it("the arrow keys move the selection and Delete asks before deleting (S7)", async () => {
    h = await renderWindow();
    await h.addPoll("A");
    const b = await h.addPoll("B");
    row(/^B,/).focus();
    fireEvent.keyDown(row(/^B,/), { key: "ArrowUp" });
    expect(row(/^A,/)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(row(/^A,/), { key: "ArrowDown" });
    await waitFor(() => expect(row(/^B,/)).toHaveAttribute("aria-selected", "true"));
    fireEvent.keyDown(row(/^B,/), { key: "Delete" });
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete poll?")).toBeVisible();
    expect(dialog).toHaveTextContent(
      'Delete "B"? Its window closes and its settings are removed from this connection.',
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await h.user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(h.ipc.pollIds()).not.toContain(b));
    expect(rows()).toHaveLength(1);
  });

  it("Cancel in the Delete dialog keeps the poll", async () => {
    h = await renderWindow();
    await h.addPoll("A");
    fireEvent.keyDown(row(/^A,/), { key: "Delete" });
    await h.user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(h.ipc.pollIds()).toHaveLength(1);
  });

  it("the row actions menu: Show, Pop out, Pause or Resume, Rename, Duplicate, Move, traffic, Delete…", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    await h.connect();
    h.advance(300);
    await h.user.click(screen.getByRole("button", { name: "Actions for A" }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Show",
      "Pop out to own windowCtrl+Shift+O",
      "PauseCtrl+P",
      "RenameF2",
      "Duplicate",
      "Move upAlt+Up",
      "Move downAlt+Down",
      "Show traffic for this poll",
      "Delete…Delete",
    ]);
    await h.user.click(screen.getByRole("menuitem", { name: /^Pause/ }));
    await waitFor(() => expect(h.ipc.callsOf("setPollActive")).toEqual([[a, false]]));
    await h.user.click(screen.getByRole("button", { name: "Actions for A" }));
    expect(screen.getByRole("menuitem", { name: /^Resume/ })).toBeVisible();
  });

  it("right click opens the same menu; Delete… from it opens the dialog", async () => {
    h = await renderWindow();
    await h.addPoll("A");
    fireEvent.contextMenu(row(/^A,/), { clientX: 20, clientY: 20 });
    await h.user.click(await screen.findByRole("menuitem", { name: /^Delete…/ }));
    expect(await screen.findByRole("alertdialog")).toBeVisible();
  });

  it("only one row is in the tab order", async () => {
    h = await renderWindow();
    await h.addPoll("A");
    await h.addPoll("B");
    expect(rows().filter((r) => r.tabIndex === 0)).toHaveLength(1);
  });

  it("the header counts the polls", async () => {
    h = await renderWindow();
    await h.addPoll("A");
    await h.addPoll("B");
    expect(screen.getByRole("heading", { name: "Polls · 2 of 16" })).toBeVisible();
  });
});

describe("keyboard access of the row (REV-006 n-9)", () => {
  it("the ⋯ button is a mouse shortcut: it is not a tab stop, the row menu has Shift+F10", async () => {
    h = await renderWindow();
    await h.addPoll("A");
    expect(screen.getByRole("button", { name: "Actions for A" })).toHaveAttribute("tabindex", "-1");
    row(/^A,/).focus();
    fireEvent.keyDown(row(/^A,/), { key: "F10", shiftKey: true });
    expect(await screen.findByRole("menu", { name: "Actions for A" })).toBeVisible();
  });
});
