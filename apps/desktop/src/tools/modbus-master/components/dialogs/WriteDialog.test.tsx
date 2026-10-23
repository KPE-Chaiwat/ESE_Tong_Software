// The Write dialog from poll views (FE-002 task 22, DES-001 S2, DES-002 3.3): opened from a
// sub-window of W1 and from a native poll window, both against the IPC fake.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ConnectionConfig, PollConfigInput, PollId } from "@/shared/ipc/modbus-master.types";
import { clickWithLayoutShift } from "@/shared/lib/press-test-utils";
import {
  disposeNativeHarnesses,
  type NativeHarness,
  renderNativeWindow,
} from "../native/test-utils";
import { type Harness, renderWindow, TCP } from "../test-utils";

const RTU: ConnectionConfig = {
  mode: "rtu",
  port: "COM3",
  baud: 9600,
  dataBits: 8,
  parity: "even",
  stopBits: 1,
  timeoutMs: 1000,
};

let h: Harness;
let n: NativeHarness;

afterEach(() => {
  h?.rt.dispose();
  disposeNativeHarnesses();
});

const frame = (id: PollId) =>
  document.querySelector<HTMLElement>(`[data-subwindow="${id}"]`) as HTMLElement;
const grid = (id: PollId) => within(frame(id)).getByRole("grid");
const dialog = () => screen.getByRole("dialog");
const result = () => screen.getByTestId("write-result");

const POLL: Partial<PollConfigInput> = {
  definition: { slaveId: 5, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
};

/** A connected window with one polling poll "Pump 2" whose rows have values. */
async function connected(patch: Partial<PollConfigInput> = POLL): Promise<PollId> {
  h = await renderWindow();
  const id = await h.addPoll("Pump 2", patch);
  await h.connect();
  h.advance(300);
  return id;
}

/** Ctrl+E with the keyboard focus in the grid of the sub-window. */
function ctrlE(id: PollId) {
  grid(id).focus();
  fireEvent.keyDown(grid(id), { key: "e", ctrlKey: true });
}

/** Clicks the grid row of `address` so it is the focused row. */
async function focusRow(id: PollId, address: number) {
  const row = within(grid(id))
    .getAllByRole("row")
    .find((r) => r.getAttribute("data-row") === String(address));
  if (!row) throw new Error(`no row ${address}`);
  await h.user.click(row);
}

describe("opening from a sub-window (DES-002 3.3)", () => {
  it("Enter on the focused row opens 'Write · {poll name}', prefilled from the poll and the row", async () => {
    const id = await connected();
    await focusRow(id, 3);
    const raw = within(grid(id))
      .getAllByRole("row")
      .find((r) => r.getAttribute("data-row") === "3")
      ?.querySelector('[data-cell="raw"]')?.textContent;
    expect(raw).toMatch(/^[0-9]+$/);
    fireEvent.keyDown(grid(id), { key: "Enter" });
    const d = await screen.findByRole("dialog", { name: "Write · Pump 2" });
    expect(within(d).getByLabelText("Function")).toHaveValue("6");
    expect(within(d).getByLabelText("Slave ID")).toHaveValue("5");
    expect(within(d).getByLabelText("Start address")).toHaveValue("3");
    expect(within(d).getByLabelText("Value")).toHaveValue(raw);
  });

  it("a double click on a row opens it, on the alias cell it edits the alias instead", async () => {
    const id = await connected();
    const row = within(grid(id))
      .getAllByRole("row")
      .find((r) => r.getAttribute("data-row") === "2") as HTMLElement;
    fireEvent.doubleClick(row.querySelector('[data-cell="raw"]') as HTMLElement);
    expect(await screen.findByRole("dialog", { name: "Write · Pump 2" })).toBeVisible();
  });

  it("an FC01 row prefills function 05 with the coil state", async () => {
    const id = await connected({
      definition: { slaveId: 1, function: 1, startAddress: 0, quantity: 8, scanRateMs: 100 },
    });
    await focusRow(id, 1);
    fireEvent.keyDown(grid(id), { key: "Enter" });
    const d = await screen.findByRole("dialog");
    expect(within(d).getByLabelText("Function")).toHaveValue("5");
  });

  it("Ctrl+E with the focus in the sub-window opens it prefilled from the focused row", async () => {
    const id = await connected();
    await focusRow(id, 4);
    ctrlE(id);
    const d = await screen.findByRole("dialog", { name: "Write · Pump 2" });
    expect(within(d).getByLabelText("Start address")).toHaveValue("4");
  });

  it("without a focused row it uses the start of the poll", async () => {
    const id = await connected({
      definition: { slaveId: 5, function: 3, startAddress: 20, quantity: 10, scanRateMs: 100 },
    });
    await h.act(() => h.rt.views.get(id).hostActions.write?.(null));
    const d = await screen.findByRole("dialog");
    expect(within(d).getByLabelText("Start address")).toHaveValue("20");
  });

  it("the status line menu has Write… with Ctrl+E", async () => {
    const id = await connected();
    await h.user.click(within(frame(id)).getByRole("button", { name: "Poll actions" }));
    const item = screen.getByRole("menuitem", { name: /^Write/ });
    expect(item).toHaveTextContent("Ctrl+E");
    await h.user.click(item);
    expect(await screen.findByRole("dialog", { name: "Write · Pump 2" })).toBeVisible();
  });

  it("an FC04 poll opens with Ctrl+E (function 06) but Enter on a row shows the read-only toast", async () => {
    const id = await connected({
      definition: { slaveId: 1, function: 4, startAddress: 0, quantity: 10, scanRateMs: 100 },
    });
    await focusRow(id, 1);
    fireEvent.keyDown(grid(id), { key: "Enter" });
    expect(
      await screen.findByText("Discrete inputs and input registers are read-only."),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    ctrlE(id);
    const d = await screen.findByRole("dialog");
    expect(within(d).getByLabelText("Function")).toHaveValue("6");
  });

  it("does not open while the link is down", async () => {
    h = await renderWindow();
    const id = await h.addPoll("Pump 2", POLL);
    await h.act(async () => h.rt.views.get(id).hostActions.write?.(null));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Ctrl+E does nothing when the focus is outside every sub-window", async () => {
    await connected();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: "e", ctrlKey: true });
    await h.act(async () => {});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("focus returns to the grid of the sub-window after Esc", async () => {
    const id = await connected();
    await focusRow(id, 1);
    grid(id).focus();
    fireEvent.keyDown(grid(id), { key: "Enter" });
    await screen.findByRole("dialog");
    await h.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(grid(id)).toHaveFocus();
  });
});

describe("sending (DES-001 2.5)", () => {
  it("sends the request with the poll id and shows the confirmed text", async () => {
    const id = await connected();
    await focusRow(id, 3);
    fireEvent.keyDown(grid(id), { key: "Enter" });
    const d = await screen.findByRole("dialog");
    const value = within(d).getByLabelText("Value");
    await h.user.clear(value);
    await h.user.type(value, "77");
    await h.user.click(within(d).getByRole("button", { name: "Send" }));
    expect(within(result()).getByText("Writing…")).toBeVisible();
    h.advance(50);
    await waitFor(() =>
      expect(result()).toHaveTextContent("Write confirmed by slave 5: register at 3."),
    );
    expect(h.ipc.callsOf("write")).toEqual([
      [{ slaveId: 5, function: 6, address: 3, values: [77] }, id],
    ]);
    // The dialog stays open so the same write can be repeated.
    expect(dialog()).toBeVisible();
  });

  it("the traffic of the write is tagged with the poll: 'Write: Pump 2'", async () => {
    const id = await connected();
    await focusRow(id, 3);
    fireEvent.keyDown(grid(id), { key: "Enter" });
    const d = await screen.findByRole("dialog");
    await h.user.click(within(d).getByRole("button", { name: "Send" }));
    h.advance(50);
    await waitFor(() => expect(result()).toHaveTextContent("Write confirmed"));
    const frames = h.rt.stores.traffic.getState().visible();
    const labels = Array.from({ length: frames.size }, (_, i) => frames.get(i)).flatMap((f) =>
      f?.origin?.kind === "write" ? [f.origin.pollId] : [],
    );
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((p) => p === id)).toBe(true);
    expect(h.rt.stores.traffic.getState().pollNames[id]).toBe("Pump 2");
  });

  it("an invalid value shows its message and sends nothing", async () => {
    const id = await connected();
    ctrlE(id);
    const d = await screen.findByRole("dialog");
    const value = within(d).getByLabelText("Value");
    await h.user.clear(value);
    await h.user.type(value, "70000");
    await h.user.click(within(d).getByRole("button", { name: "Send" }));
    expect(within(d).getByText("Value must be from 0 to 65535.")).toBeVisible();
    expect(h.ipc.callsOf("write")).toHaveLength(0);
  });

  it("an exception result has its text", async () => {
    const id = await connected();
    h.ipc.setResult("write", { status: "exception", code: 2 });
    ctrlE(id);
    const d = await screen.findByRole("dialog");
    await h.user.click(within(d).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(result()).toHaveTextContent(
        "Exception 02 (Illegal data address). Nothing was confirmed.",
      ),
    );
  });

  it("FC16 in Binary: a pasted run of nibbles is four values, and the label says so", async () => {
    const id = await connected();
    ctrlE(id);
    const d = await screen.findByRole("dialog");
    await h.user.selectOptions(within(d).getByLabelText("Function"), "16");
    await h.user.click(within(d).getByRole("radio", { name: "Binary" }));
    const box = within(d).getByLabelText(/^Values/);
    await h.user.clear(box);
    await h.user.click(box);
    await h.user.paste("0000 0100 1101 0010");
    expect(within(d).getByText("Values (4)")).toBeVisible();
    expect(within(d).getByText("Writes addresses 0-3.")).toBeVisible();
    await h.user.click(within(d).getByRole("button", { name: "Send" }));
    h.advance(50);
    await waitFor(() => expect(h.ipc.callsOf("write")).toHaveLength(1));
    expect((h.ipc.callsOf("write")[0] as unknown[])[0]).toMatchObject({
      function: 16,
      values: [0, 4, 13, 2],
    });
  });
});

describe("alias line (DES-003 3.5 revision 6)", () => {
  it("shows 'Alias: PT-201' for the target address and follows the typed address", async () => {
    const id = await connected({
      ...POLL,
      aliases: [
        { address: 0, alias: "PT-201" },
        { address: 2, alias: "PT-203" },
      ],
    });
    await focusRow(id, 0);
    fireEvent.keyDown(grid(id), { key: "Enter" });
    const d = await screen.findByRole("dialog");
    expect(within(d).getByTestId("write-alias")).toHaveTextContent("Alias: PT-201");
    const address = within(d).getByLabelText("Start address");
    await h.user.clear(address);
    await h.user.type(address, "1");
    expect(within(d).queryByTestId("write-alias")).not.toBeInTheDocument();
    await h.user.clear(address);
    await h.user.type(address, "x");
    expect(within(d).queryByTestId("write-alias")).not.toBeInTheDocument();
  });

  it("FC16 adds how many more addresses of the range have aliases", async () => {
    const id = await connected({
      ...POLL,
      aliases: [
        { address: 0, alias: "PT-201" },
        { address: 2, alias: "PT-203" },
      ],
    });
    ctrlE(id);
    const d = await screen.findByRole("dialog");
    await h.user.selectOptions(within(d).getByLabelText("Function"), "16");
    const box = within(d).getByLabelText(/^Values/);
    await h.user.clear(box);
    await h.user.type(box, "1 2 3");
    expect(within(d).getByTestId("write-alias")).toHaveTextContent(
      "Alias: PT-201 (+1 more with aliases)",
    );
  });
});

describe("one click while a blur shows a message (D4)", () => {
  it("[Send] works when the blur of Slave ID shows a message and moves the button", async () => {
    const id = await connected();
    ctrlE(id);
    const d = await screen.findByRole("dialog");
    const slave = within(d).getByLabelText("Slave ID");
    await h.user.clear(slave);
    await h.user.type(slave, "300");
    const message = "Slave ID must be a whole number from 0 to 247.";
    expect(within(d).queryByText(message)).not.toBeInTheDocument();
    await clickWithLayoutShift(
      h.user,
      within(d).getByRole("button", { name: "Send" }),
      () => within(d).queryByText(message) !== null,
      () => within(d).getByText(message),
    );
    expect(within(d).getByText(message)).toBeInTheDocument();
    expect(h.ipc.callsOf("write")).toHaveLength(0);
    expect(slave).toHaveFocus();
  });
});

describe("slave ID 0 (DES-001 3.3)", () => {
  it("on RTU it is a broadcast: a warning, and Send stays enabled", async () => {
    h = await renderWindow();
    const id = await h.addPoll("Pump 2", POLL);
    await h.act(() => h.rt.stores.connection.getState().connect(RTU));
    h.advance(300);
    ctrlE(id);
    const d = await screen.findByRole("dialog");
    const slave = within(d).getByLabelText("Slave ID");
    await h.user.clear(slave);
    await h.user.type(slave, "0");
    expect(
      within(d).getByText("Broadcast: devices do not reply, so the result cannot be confirmed."),
    ).toBeVisible();
    expect(within(d).getByRole("button", { name: "Send" })).toBeEnabled();
    await h.user.click(within(d).getByRole("button", { name: "Send" }));
    h.advance(50);
    await waitFor(() =>
      expect(result()).toHaveTextContent(
        "Broadcast sent. Devices do not reply to slave ID 0, so the write cannot be confirmed.",
      ),
    );
  });

  it("on TCP it is a normal unit: no warning, and the write is confirmed", async () => {
    const id = await connected();
    ctrlE(id);
    const d = await screen.findByRole("dialog");
    const slave = within(d).getByLabelText("Slave ID");
    await h.user.clear(slave);
    await h.user.type(slave, "0");
    expect(within(d).queryByText(/^Broadcast:/)).not.toBeInTheDocument();
    await h.user.click(within(d).getByRole("button", { name: "Send" }));
    h.advance(50);
    await waitFor(() => expect(result()).toHaveTextContent("Write confirmed by slave 0"));
  });
});

describe("link lost (DES-001 2.5)", () => {
  async function linkLost(): Promise<PollId> {
    const id = await connected();
    // The form holds the connection that Reconnect uses.
    await h.act(() => h.rt.form.current.adopt(TCP));
    ctrlE(id);
    const d = await screen.findByRole("dialog");
    const held = h.ipc.hold("write");
    await h.user.click(within(d).getByRole("button", { name: "Send" }));
    await h.act(async () => {
      h.ipc.dropLink();
      held.release({ status: "linkLost" });
    });
    return id;
  }

  it("shows the link-lost text with [Reconnect], keeps the draft, and disables Send", async () => {
    await linkLost();
    expect(result()).toHaveTextContent(
      "Connection lost during the write. The write may or may not have been applied. Reconnect and check the value before sending again.",
    );
    expect(within(result()).getByRole("button", { name: "Reconnect" })).toBeVisible();
    expect(within(dialog()).getByRole("button", { name: "Send" })).toBeDisabled();
    expect(within(dialog()).getByLabelText("Value")).toHaveValue("0");
  });

  it("[Reconnect] connects again, the result area clears, and Send gets the focus", async () => {
    await linkLost();
    await h.user.click(within(result()).getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(h.ipc.callsOf("connect")).toHaveLength(2));
    await waitFor(() =>
      expect(within(result()).queryByRole("button", { name: "Reconnect" })).not.toBeInTheDocument(),
    );
    expect(result()).toHaveTextContent("");
    expect(within(dialog()).getByRole("button", { name: "Send" })).toBeEnabled();
    expect(within(dialog()).getByRole("button", { name: "Send" })).toHaveFocus();
    // The dialog stayed open and the draft is unchanged.
    expect(within(dialog()).getByLabelText("Value")).toHaveValue("0");
  });

  it("a failed reconnect says why, keeps [Reconnect] and its focus", async () => {
    await linkLost();
    h.ipc.scriptConnectFailure({
      kind: "refused",
      phase: "connectFailed",
      message: "refused",
    });
    await h.user.click(within(result()).getByRole("button", { name: "Reconnect" }));
    await waitFor(() =>
      expect(result()).toHaveTextContent(
        "Reconnect failed: Connection refused by 192.168.1.10:502.",
      ),
    );
    const again = within(result()).getByRole("button", { name: "Reconnect" });
    expect(again).not.toHaveAttribute("aria-disabled", "true");
    await waitFor(() => expect(again).toHaveFocus());
  });

  it("'Not connected' (a write that never left) has no [Reconnect]", async () => {
    const id = await connected();
    ctrlE(id);
    await screen.findByRole("dialog");
    await h.act(async () => h.ipc.dropLink());
    expect(result()).toHaveTextContent("Not connected. Connect before writing.");
    expect(within(result()).queryByRole("button", { name: "Reconnect" })).not.toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Send" })).toBeDisabled();
  });
});

describe("modal of the window (DES-002 2.5.4)", () => {
  it("holds the lock: the shortcuts are off and pop out refuses while it is open", async () => {
    const id = await connected();
    ctrlE(id);
    await screen.findByRole("dialog");
    expect(h.rt.stores.layout.getState().modalOpen).toBe(true);
    fireEvent.keyDown(window, { key: "O", ctrlKey: true, shiftKey: true });
    await h.act(async () => {
      await h.rt.actions.popOutPoll(id);
    });
    expect(h.ipc.callsOf("popOutPoll")).toHaveLength(0);
    await h.user.keyboard("{Escape}");
    await waitFor(() => expect(h.rt.stores.layout.getState().modalOpen).toBe(false));
    await h.act(async () => {
      await h.rt.actions.popOutPoll(id);
    });
    expect(h.ipc.callsOf("popOutPoll")).toHaveLength(1);
  });

  it("a native poll cannot be docked from the list while the dialog is open in its window", async () => {
    // The dialog of a native window answers the handoff request with a refusal (see the W2 tests).
    const id = await connected();
    ctrlE(id);
    await screen.findByRole("dialog");
    await h.act(async () => {
      await h.rt.stores.host.getState().dock(id);
    });
    expect(h.ipc.callsOf("dockPoll")).toHaveLength(0);
  });

  it("closes by itself when its poll is deleted", async () => {
    const id = await connected();
    ctrlE(id);
    await screen.findByRole("dialog");
    await h.act(async () => {
      await h.ipc.removePoll(id);
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.rt.stores.layout.getState().modalOpen).toBe(false);
  });
});

describe("scaled preview seam (DES-003 3.5): a poll without a scale has none", () => {
  it("shows no preview line without a scale provider", async () => {
    const id = await connected();
    ctrlE(id);
    await screen.findByRole("dialog");
    expect(screen.queryByTestId("write-preview")).not.toBeInTheDocument();
  });

  it("shows the line when a provider supplies a scale (a test provider replaces the real one)", async () => {
    h = await renderWindow({
      runtimeOptions: {
        createScaled: () => (raw) => ({
          text: (raw / 10).toFixed(2),
          unit: "mA",
          marker: "none",
          tooltip: null,
          label: "",
          override: null,
        }),
      },
    });
    const id = await h.addPoll("Pump 2", POLL);
    await h.connect();
    h.advance(300);
    ctrlE(id);
    const d = await screen.findByRole("dialog");
    const value = within(d).getByLabelText("Value");
    await h.user.clear(value);
    await h.user.type(value, "125");
    expect(within(d).getByTestId("write-preview")).toHaveTextContent("Scaled: 12.50 mA");
    await h.user.clear(value);
    await h.user.type(value, "abc");
    expect(within(d).queryByTestId("write-preview")).not.toBeInTheDocument();
  });
});

describe("native poll window", () => {
  it("opens from the grid with the same title and prefill, and sends the poll id", async () => {
    n = await renderNativeWindow();
    await n.connect();
    n.advance(300);
    const g = screen.getByRole("grid");
    const row = within(g)
      .getAllByRole("row")
      .find((r) => r.getAttribute("data-row") === "2") as HTMLElement;
    await n.user.click(row);
    fireEvent.keyDown(g, { key: "Enter" });
    const d = await screen.findByRole("dialog", { name: "Write · Pump 2" });
    expect(within(d).getByLabelText("Slave ID")).toHaveValue("5");
    expect(within(d).getByLabelText("Start address")).toHaveValue("2");
    await n.user.click(within(d).getByRole("button", { name: "Send" }));
    n.advance(50);
    await waitFor(() =>
      expect(within(d).getByTestId("write-result")).toHaveTextContent(
        "Write confirmed by slave 5: register at 2.",
      ),
    );
    expect(n.ipc.callsOf("write")[0]?.[1]).toBe(n.pollId);
  });

  it("a dialog in the window refuses a dock and answers the handoff request with a refusal", async () => {
    n = await renderNativeWindow();
    await n.connect();
    n.advance(300);
    await n.user.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Write…" }));
    await screen.findByRole("dialog");
    expect(n.rt.stores.layout.getState().modalOpen).toBe(true);
    await n.act(() => n.rt.stores.host.getState().dock(n.pollId));
    expect(n.ipc.callsOf("dockPoll")).toHaveLength(0);
    await n.act(() => n.rt.stores.host.getState().answerHandoffRequest(n.pollId));
    expect(n.ipc.callsOf("provideHandoff")).toEqual([[n.pollId, null]]);
  });

  it("link lost in a native window: [Reconnect] connects again", async () => {
    n = await renderNativeWindow();
    await n.connect();
    n.advance(300);
    await n.user.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Write…" }));
    const d = await screen.findByRole("dialog");
    const held = n.ipc.hold("write");
    await n.user.click(within(d).getByRole("button", { name: "Send" }));
    await n.act(async () => {
      n.ipc.dropLink();
      held.release({ status: "linkLost" });
    });
    const button = within(within(d).getByTestId("write-result")).getByRole("button", {
      name: "Reconnect",
    });
    await n.user.click(button);
    await waitFor(() => expect(n.ipc.callsOf("connect")).toHaveLength(2));
    await waitFor(() =>
      expect(
        within(within(d).getByTestId("write-result")).queryByRole("button", { name: "Reconnect" }),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("per-row formats (DES-009 8.4)", () => {
  const over = (
    start: number,
    end: number,
    format: "hex" | "float32",
  ): NonNullable<PollConfigInput["formatOverrides"]>[number] => ({
    start,
    end,
    format,
    swapBytes: false,
    reverseWords: false,
  });

  async function withValues(patch: Partial<PollConfigInput>, values: number[]): Promise<PollId> {
    const id = await connected({ ...POLL, ...patch });
    h.ipc.emitPollUpdate(id, { values });
    return id;
  }

  it("Write from a Hex row prefills 0x00A1 in the format Hex; a neighbouring row stays Unsigned", async () => {
    const id = await withValues(
      { formatOverrides: [over(1, 1, "hex")] },
      [0, 0xa1, 0xa1, 0, 0, 0, 0, 0, 0, 0],
    );
    await focusRow(id, 1);
    fireEvent.keyDown(grid(id), { key: "Enter" });
    let d = await screen.findByRole("dialog", { name: "Write · Pump 2" });
    expect(within(d).getByLabelText("Value")).toHaveValue("0x00A1");
    fireEvent.keyDown(d, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await focusRow(id, 2);
    fireEvent.keyDown(grid(id), { key: "Enter" });
    d = await screen.findByRole("dialog", { name: "Write · Pump 2" });
    expect(within(d).getByLabelText("Value")).toHaveValue("161");
  });

  it("Write from the group row 2-3 targets register 2 with its raw word as Unsigned, labelled as a raw register", async () => {
    const id = await withValues(
      { formatOverrides: [over(2, 5, "float32")] },
      [0, 0, 0x3f80, 0, 0, 0, 0, 0, 0, 0],
    );
    // data-row 2 is the group row 2-3
    await focusRow(id, 2);
    fireEvent.keyDown(grid(id), { key: "Enter" });
    const d = await screen.findByRole("dialog", { name: "Write · Pump 2" });
    expect(within(d).getByLabelText("Start address")).toHaveValue("2");
    expect(within(d).getByLabelText("Raw register value (16-bit)")).toHaveValue("16256");
    expect(
      within(d).getByText(
        "Writes send individual 16-bit registers. Combined values are not encoded.",
      ),
    ).toBeVisible();
    // The dialog sends the raw word, nothing is encoded.
    await h.user.click(within(d).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(h.ipc.callsOf("write")).toHaveLength(1));
    expect(h.ipc.callsOf("write")[0]?.[0]).toMatchObject({
      function: 6,
      address: 2,
      values: [16256],
    });
  });

  it("the label and the note follow the address in the dialog, not the poll", async () => {
    const id = await withValues({ formatOverrides: [over(2, 5, "float32")] }, Array(10).fill(1));
    await focusRow(id, 1);
    fireEvent.keyDown(grid(id), { key: "Enter" });
    const d = await screen.findByRole("dialog", { name: "Write · Pump 2" });
    expect(within(d).getByLabelText("Value")).toBeVisible();
    expect(within(d).queryByText(/Combined values are not encoded/)).not.toBeInTheDocument();
    fireEvent.change(within(d).getByLabelText("Start address"), { target: { value: "4" } });
    expect(within(d).getByLabelText("Raw register value (16-bit)")).toBeVisible();
    expect(within(d).getByText(/Combined values are not encoded/)).toBeVisible();
    fireEvent.change(within(d).getByLabelText("Start address"), { target: { value: "6" } });
    expect(within(d).getByLabelText("Value")).toBeVisible();
  });

  it("the first row of a poll that starts inside a group targets its own address (L3)", async () => {
    const id = await withValues(
      {
        definition: { slaveId: 5, function: 3, startAddress: 101, quantity: 4, scanRateMs: 100 },
        formatOverrides: [over(100, 101, "float32")],
      },
      [7, 0, 0, 0],
    );
    await focusRow(id, 0);
    fireEvent.keyDown(grid(id), { key: "Enter" });
    const d = await screen.findByRole("dialog", { name: "Write · Pump 2" });
    expect(within(d).getByLabelText("Start address")).toHaveValue("101");
    expect(within(d).getByLabelText("Raw register value (16-bit)")).toHaveValue("7");
  });
});
