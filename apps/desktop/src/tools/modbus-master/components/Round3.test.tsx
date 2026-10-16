// Round 3: QA findings F-1 to F-3, the QA test hooks and the REV-003 findings.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IpcError } from "@/shared/ipc/modbus-master";
import { sessionReason } from "@/shared/ipc/modbus-master.fake";
import type { Profile } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow, TCP } from "./test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const host = () => screen.getByLabelText("Host") as HTMLInputElement;
const dialogResult = (dialog: HTMLElement) => within(dialog).getByTestId("write-result");

/** A TCP window in `connected` with a valid setup and the poll at start address 100. */
async function connected(options: { autoStart?: boolean; fn?: 1 | 3 } = {}) {
  h = await renderWindow({
    prepare: ({ rt }) => {
      rt.stores.config.getState().setConnection(TCP);
      rt.stores.config.getState().setAutoStart(options.autoStart ?? false);
      rt.stores.config.getState().setPoll({
        slaveId: 1,
        function: options.fn ?? 3,
        startAddress: 100,
        quantity: 3,
        scanRateMs: 1000,
      });
    },
  });
  h.state("connecting");
  h.state("connected");
}

const grid = () => screen.getByRole("grid", { name: "Register values" });

describe("QA F-1: one item reads without a count", () => {
  async function send(fn: string, value: Record<string, string>, expected: string) {
    await connected();
    await h.user.click(screen.getByRole("button", { name: "Write…" }));
    const dialog = await screen.findByRole("dialog", { name: "Write" });
    await h.user.selectOptions(within(dialog).getByLabelText("Function"), fn);
    const address = within(dialog).getByLabelText("Start address");
    await h.user.clear(address);
    await h.user.type(address, "3");
    for (const [label, text] of Object.entries(value)) {
      const field = within(dialog).getByLabelText(label);
      await h.user.clear(field);
      await h.user.type(field, text);
    }
    await h.user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(dialogResult(dialog)).toHaveTextContent(expected));
  }

  it("FC06 reads: Write confirmed by slave 1: register at 3.", async () => {
    await send("6", { Value: "500" }, "Write confirmed by slave 1: register at 3.");
    expect(dialogResult(screen.getByRole("dialog"))).not.toHaveTextContent("1 register");
  });

  it("FC05 reads: Write confirmed by slave 1: coil at 3.", async () => {
    await send("5", {}, "Write confirmed by slave 1: coil at 3.");
  });

  it("several items keep the count and the range", async () => {
    await send("16", { "Values (0)": "1 2 3" }, "Write confirmed by slave 1: 3 registers at 3-5.");
  });
});

describe("QA F-2: modals give the focus back to the control that opened them", () => {
  it("Open… -> Esc returns to the Open… button", async () => {
    h = await renderWindow();
    const opener = screen.getByRole("button", { name: "Open…" });
    await h.user.click(opener);
    await screen.findByRole("dialog", { name: "Open profile" });
    await h.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("Open… -> Cancel returns to the Open… button", async () => {
    h = await renderWindow();
    const opener = screen.getByRole("button", { name: "Open…" });
    await h.user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Open profile" });
    await h.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("Save as… -> Cancel returns to the Save as… button", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10");
    const opener = screen.getByRole("button", { name: "Save as…" });
    await h.user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Save profile as" });
    await h.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("Write… -> Close returns to the Write… button", async () => {
    await connected();
    const opener = screen.getByRole("button", { name: "Write…" });
    await h.user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Write" });
    await h.user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("Write… -> Esc returns to the Write… button", async () => {
    await connected();
    const opener = screen.getByRole("button", { name: "Write…" });
    await h.user.click(opener);
    await screen.findByRole("dialog", { name: "Write" });
    await h.user.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("a confirm opened from a dialog returns to the button inside that dialog", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([
          {
            schemaVersion: 1,
            name: "Taken",
            connection: { mode: "tcp", host: "h", port: 502, timeoutMs: 1000 },
            poll: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 },
            display: { format: "unsigned", addressBase: 0 },
            autoStartPoll: true,
          } satisfies Profile,
        ]);
      },
    });
    await h.user.type(host(), "192.168.1.10");
    await h.user.click(screen.getByRole("button", { name: "Save as…" }));
    const dialog = await screen.findByRole("dialog", { name: "Save profile as" });
    await h.user.type(within(dialog).getByLabelText("Name"), "Taken");
    const save = within(dialog).getByRole("button", { name: "Save" });
    await h.user.click(save);
    const confirm = await screen.findByRole("alertdialog", { name: "Replace profile?" });
    await h.user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(save).toHaveFocus());
  });

  it("Delete confirm returns to the Delete button", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([
          {
            schemaVersion: 1,
            name: "Old",
            connection: { mode: "tcp", host: "h", port: 502, timeoutMs: 1000 },
            poll: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 },
            display: { format: "unsigned", addressBase: 0 },
            autoStartPoll: true,
          } satisfies Profile,
        ]);
      },
    });
    await h.user.click(screen.getByRole("button", { name: "Open…" }));
    const dialog = await screen.findByRole("dialog", { name: "Open profile" });
    await h.user.click(await within(dialog).findByText("Old"));
    const del = within(dialog).getByRole("button", { name: "Delete" });
    await h.user.click(del);
    const confirm = await screen.findByRole("alertdialog", { name: "Delete profile?" });
    await h.user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(del).toHaveFocus());
  });

  describe("from the data grid, focus returns to the grid element", () => {
    async function polling() {
      await connected({ autoStart: true });
      await waitFor(() => expect(h.ipc.callsOf("startPoll")).toHaveLength(1));
      h.state("polling");
      h.emit(() => h.ipc.emitPollUpdate({ startAddress: 100, values: [1234, 65535, 7] }));
    }
    const rowsOf = () => within(grid()).getAllByRole("row");

    it("Enter on the focused row: Esc returns to the grid, still pointing at that row", async () => {
      await polling();
      await h.user.click(rowsOf()[2] as HTMLElement);
      expect(grid()).toHaveFocus();
      await h.user.keyboard("{Enter}");
      await screen.findByRole("dialog", { name: "Write" });
      await h.user.keyboard("{Escape}");
      await waitFor(() => expect(grid()).toHaveFocus());
      expect(grid()).toHaveAttribute("aria-activedescendant", "data-row-1");
      expect(document.getElementById("data-row-1")).toBeInTheDocument();
    });

    it("double-click on a row: Close returns to the grid with that row active", async () => {
      await polling();
      await h.user.dblClick(rowsOf()[3] as HTMLElement);
      const dialog = await screen.findByRole("dialog", { name: "Write" });
      await h.user.click(within(dialog).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(grid()).toHaveFocus());
      expect(grid()).toHaveAttribute("aria-activedescendant", "data-row-2");
    });

    it("Ctrl+E with the grid focused returns to the grid", async () => {
      await polling();
      await h.user.click(rowsOf()[1] as HTMLElement);
      act(() => {
        fireEvent.keyDown(grid(), { key: "e", ctrlKey: true });
      });
      await screen.findByRole("dialog", { name: "Write" });
      await h.user.keyboard("{Escape}");
      await waitFor(() => expect(grid()).toHaveFocus());
      expect(grid()).toHaveAttribute("aria-activedescendant", "data-row-0");
    });

    it("from the toolbar Write… button it goes back to that button, not to the grid", async () => {
      await polling();
      await h.user.click(rowsOf()[1] as HTMLElement);
      const opener = screen.getByRole("button", { name: "Write…" });
      await h.user.click(opener);
      await screen.findByRole("dialog", { name: "Write" });
      await h.user.keyboard("{Escape}");
      await waitFor(() => expect(opener).toHaveFocus());
      expect(grid()).not.toHaveFocus();
    });
  });
});

describe("QA F-3 and DES-001 2.5 (rev 3): [Reconnect] in the Write dialog", () => {
  const LOST =
    "Connection lost during the write. The write may or may not have been applied. Reconnect and check the value before sending again.";

  async function linkLostDialog(autoStart = false) {
    await connected({ autoStart });
    h.ipc.setResult("write", { status: "linkLost" });
    await h.user.click(screen.getByRole("button", { name: "Write…" }));
    const dialog = await screen.findByRole("dialog", { name: "Write" });
    await h.user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(dialogResult(dialog)).toHaveTextContent(LOST));
    // The backend moves the session to disconnected at the same time.
    h.state("disconnected", { reason: sessionReason("closedByPeer", "x", "linkLost") });
    return dialog;
  }

  it("shows a secondary [Reconnect] button at the end of the result area", async () => {
    const dialog = await linkLostDialog();
    const result = dialogResult(dialog);
    const button = within(result).getByRole("button", { name: "Reconnect" });
    expect(button).toBeVisible();
    expect(button).not.toHaveAttribute("aria-disabled", "true");
    expect(button.className).toContain("border-input");
    // It is the last element of the result area.
    expect(result.lastElementChild).toBe(button);
    expect(result).toHaveTextContent(LOST);
  });

  it("pressing it connects with the window's connection, keeps the dialog and the draft", async () => {
    const dialog = await linkLostDialog();
    await h.user.clear(within(dialog).getByLabelText("Start address"));
    await h.user.type(within(dialog).getByLabelText("Start address"), "3");
    await h.user.click(within(dialog).getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(h.ipc.callsOf("connect")).toHaveLength(1));
    expect(h.ipc.callsOf("connect")[0]?.[0]).toEqual(TCP);
    expect(screen.getByRole("dialog", { name: "Write" })).toBeVisible();
    expect(within(dialog).getByLabelText("Start address")).toHaveValue("3");
  });

  it("while the connect is pending: spinner, disabled, the text stays", async () => {
    const dialog = await linkLostDialog();
    await h.user.click(within(dialog).getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(h.ipc.callsOf("connect")).toHaveLength(1));
    h.state("connecting");
    const button = within(dialog).getByRole("button", { name: "Reconnect" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button.querySelector('[data-icon="loader"]')).toBeInTheDocument();
    expect(dialogResult(dialog)).toHaveTextContent(LOST);
    // A second press does nothing.
    await h.user.click(button);
    expect(h.ipc.callsOf("connect")).toHaveLength(1);
    expect(within(dialog).getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("back in L*: the result and the button clear, Send is enabled and has the focus", async () => {
    const dialog = await linkLostDialog();
    await h.user.click(within(dialog).getByRole("button", { name: "Reconnect" }));
    h.state("connecting");
    h.state("connected");
    expect(dialogResult(dialog)).toBeEmptyDOMElement();
    expect(within(dialog).queryByRole("button", { name: "Reconnect" })).not.toBeInTheDocument();
    const send = within(dialog).getByRole("button", { name: "Send" });
    expect(send).toBeEnabled();
    await waitFor(() => expect(send).toHaveFocus());
  });

  it("polling resumes through T2 when Start polling when connected is on", async () => {
    const dialog = await linkLostDialog(true);
    await h.user.click(within(dialog).getByRole("button", { name: "Reconnect" }));
    h.state("connecting");
    h.state("connected");
    await waitFor(() => expect(h.ipc.callsOf("startPoll")).toHaveLength(2));
    h.state("polling");
    expect(dialogResult(dialog)).toBeEmptyDOMElement();
    expect(within(dialog).getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("a failed reconnect reads Reconnect failed: {reason}, with [Reconnect] enabled and focused", async () => {
    const dialog = await linkLostDialog();
    const button = within(dialog).getByRole("button", { name: "Reconnect" });
    await h.user.click(button);
    h.state("connecting");
    h.state("disconnected", { reason: sessionReason("refused", "refused", "connectFailed") });
    expect(dialogResult(dialog)).toHaveTextContent(
      "Reconnect failed: Connection refused by 192.168.1.10:502.",
    );
    expect(dialogResult(dialog)).not.toHaveTextContent("Connection lost during the write");
    expect(dialogResult(dialog).querySelector('[data-icon="unplug"]')).toBeInTheDocument();
    const again = within(dialog).getByRole("button", { name: "Reconnect" });
    expect(again).not.toHaveAttribute("aria-disabled", "true");
    await waitFor(() => expect(again).toHaveFocus());
    expect(within(dialog).getByRole("button", { name: "Send" })).toBeDisabled();
    // Pressing it again tries again.
    await h.user.click(again);
    await waitFor(() => expect(h.ipc.callsOf("connect")).toHaveLength(2));
  });

  it("Ctrl+L does nothing while the dialog is open: no mm_connect", async () => {
    await linkLostDialog();
    act(() => {
      fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.ipc.callsOf("connect")).toHaveLength(0);
  });

  it("the button never appears for Not connected", async () => {
    await connected();
    h.ipc.setResult("write", { status: "notConnected" });
    await h.user.click(screen.getByRole("button", { name: "Write…" }));
    const dialog = await screen.findByRole("dialog", { name: "Write" });
    await h.user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(dialogResult(dialog)).toHaveTextContent("Not connected. Connect before writing."),
    );
    expect(within(dialog).queryByRole("button", { name: "Reconnect" })).not.toBeInTheDocument();
    h.state("disconnected", { reason: sessionReason("closedByPeer", "x", "linkLost") });
    expect(within(dialog).queryByRole("button", { name: "Reconnect" })).not.toBeInTheDocument();
  });

  it("closing the dialog empties the result and the button for the next time", async () => {
    const dialog = await linkLostDialog();
    await h.user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    h.state("connecting");
    h.state("connected");
    await h.user.click(screen.getByRole("button", { name: "Write…" }));
    const reopened = await screen.findByRole("dialog", { name: "Write" });
    expect(dialogResult(reopened)).toBeEmptyDOMElement();
  });
});

describe("QA test hooks", () => {
  it("the four traffic counters have test ids with their value", async () => {
    h = await renderWindow();
    h.emit(() => h.ipc.emitCounters({ requests: 1204, responses: 1198, errors: 2, timeouts: 4 }));
    expect(screen.getByTestId("traffic-counter-requests")).toHaveTextContent("1204");
    expect(screen.getByTestId("traffic-counter-responses")).toHaveTextContent("1198");
    expect(screen.getByTestId("traffic-counter-errors")).toHaveTextContent("2");
    expect(screen.getByTestId("traffic-counter-timeouts")).toHaveTextContent("4");
  });

  it("the data grid says live, stale or loading", async () => {
    await connected({ autoStart: true });
    await waitFor(() => expect(h.ipc.callsOf("startPoll")).toHaveLength(1));
    h.state("polling");
    expect(grid()).toHaveAttribute("data-status", "loading");
    h.emit(() => h.ipc.emitPollUpdate({ startAddress: 100, values: [1, 2, 3] }));
    expect(grid()).toHaveAttribute("data-status", "live");
    h.state("timeout");
    expect(grid()).toHaveAttribute("data-status", "stale");
    h.state("polling");
    h.emit(() => h.ipc.emitPollUpdate({ startAddress: 100, values: [1, 2, 4] }));
    expect(grid()).toHaveAttribute("data-status", "live");
  });

  it("the window root carries the session state", async () => {
    h = await renderWindow();
    const root = () => document.querySelector("[data-session-state]");
    expect(root()).toHaveAttribute("data-session-state", "idle");
    for (const state of ["connecting", "connected", "polling", "timeout", "paused"] as const) {
      h.state(state);
      expect(root()).toHaveAttribute("data-session-state", state);
    }
  });

  it("the stable hooks are still there: row ids, frame ids, data-slot, data-icon, data-variant", async () => {
    await connected({ autoStart: true });
    await waitFor(() => expect(h.ipc.callsOf("startPoll")).toHaveLength(1));
    h.state("polling");
    h.emit(() => h.ipc.emitPollUpdate({ startAddress: 100, values: [1, 2, 3] }));
    h.emit(() =>
      h.ipc.emitFrames([
        {
          seq: 7,
          at: 0,
          direction: "tx",
          bytes: [1],
          slaveId: 1,
          function: 3,
          exceptionCode: null,
          note: null,
        },
      ]),
    );
    expect(document.getElementById("data-row-0")).toBeInTheDocument();
    expect(document.getElementById("frame-7")).toBeInTheDocument();
    expect(document.querySelector("[data-slot=status-pill][data-variant=polling]")).toBeTruthy();
    expect(document.querySelector("[data-slot=freshness-chip]")).toBeTruthy();
    expect(document.querySelector('[data-icon="activity"]')).toBeTruthy();
    h.state("timeout");
    expect(document.querySelector("[data-slot=state-banner][data-variant=warning]")).toBeTruthy();
  });
});

describe("REV-003 m-2: a blocked Save shows the Poll errors too", () => {
  it("with an empty host and Quantity 126, both messages show and the focus goes to the first", async () => {
    h = await renderWindow();
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "126");
    await h.user.click(screen.getByRole("button", { name: "Save as…" }));
    expect(await screen.findByText("Fix the highlighted fields before saving.")).toBeVisible();
    expect(screen.getByText("Enter a host name or IPv4 address.")).toBeVisible();
    expect(screen.getByText("Quantity for FC03 must be from 1 to 125.")).toBeVisible();
    expect(host()).toHaveFocus();
    expect(screen.getByTestId("attention")).toHaveTextContent("2 fields need attention");
  });

  it("the same for Ctrl+S and for Save in Save changes?", async () => {
    h = await renderWindow();
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "126");
    act(() => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    });
    expect(await screen.findByText("Quantity for FC03 must be from 1 to 125.")).toBeVisible();
    expect(screen.getByText("Enter a host name or IPv4 address.")).toBeVisible();
  });
});

describe("REV-003 n-2: Reconnect is disabled while Dismiss is pending", () => {
  it("the toolbar and the banner Reconnect cannot be pressed while the dismiss runs", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10{Enter}");
    h.state("connecting");
    h.state("disconnected", { reason: sessionReason("closedByPeer", "x") });
    const banner = document.querySelector("[data-slot=state-banner]") as HTMLElement;
    await h.user.click(within(banner).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(h.rt.stores.session.getState().pending).toBe("dismiss"));
    expect(within(banner).getByRole("button", { name: "Reconnect" })).toBeDisabled();
    const toolbar = screen.getByRole("toolbar", { name: "Toolbar" });
    expect(within(toolbar).getByRole("button", { name: "Reconnect" })).toBeDisabled();
    h.state("idle");
    expect(within(toolbar).getByRole("button", { name: "Connect" })).toBeEnabled();
  });
});

describe("REV-003 n-3: a refused clipboard write is shown", () => {
  it("shows Could not copy to the clipboard. for rows, a frame and bytes", async () => {
    h = await renderWindow();
    // Make the harness clipboard refuse.
    const refusing = {
      writeText: async () => {
        throw new Error("denied");
      },
    };
    h.rt.dispose();
    const { createModbusMasterRuntime } = await import("../runtime");
    const { createFakeWindowIpc } = await import("@/shared/ipc/window");
    const ipc = h.ipc;
    const rt = createModbusMasterRuntime(ipc, createFakeWindowIpc(), {
      scheduler: (cb) => {
        cb();
        return () => {};
      },
      clipboard: refusing,
      warn: () => {},
    });
    await rt.init();
    rt.stores.config.getState().setConnection(TCP);
    ipc.emitState("connecting");
    ipc.emitState("connected");
    ipc.emitState("polling");
    rt.stores.pollData.getState().begin({
      slaveId: 1,
      function: 3,
      startAddress: 0,
      quantity: 2,
      scanRateMs: 1000,
    });
    ipc.emitPollUpdate({ values: [1, 2] });
    ipc.emitFrames([
      {
        seq: 1,
        at: 0,
        direction: "tx",
        bytes: [1, 2],
        slaveId: 1,
        function: 3,
        exceptionCode: null,
        note: null,
      },
    ]);
    rt.stores.selection.getState().selectAll();
    rt.stores.traffic.getState().select(1);

    await rt.controller.copyRows();
    await rt.controller.copyFrames();
    await rt.controller.copyFrameBytes();
    const texts = rt.stores.toasts.getState().items.map((t) => `${t.tone}:${t.text}`);
    expect(texts).toEqual([
      "error:Could not copy to the clipboard.",
      "error:Could not copy to the clipboard.",
      "error:Could not copy to the clipboard.",
    ]);
    rt.dispose();
  });

  it("a missing clipboard (it throws before returning a promise) is shown too", async () => {
    h = await renderWindow();
    h.rt.dispose();
    const { createModbusMasterRuntime } = await import("../runtime");
    const { createFakeWindowIpc } = await import("@/shared/ipc/window");
    const rt = createModbusMasterRuntime(h.ipc, createFakeWindowIpc(), {
      clipboard: {
        writeText: () => {
          throw new TypeError("navigator.clipboard is undefined");
        },
      },
      warn: () => {},
    });
    await rt.init();
    h.ipc.emitFrames([
      {
        seq: 1,
        at: 0,
        direction: "rx",
        bytes: [1],
        slaveId: 1,
        function: 3,
        exceptionCode: null,
        note: null,
      },
    ]);
    await new Promise((r) => setTimeout(r, 40));
    rt.stores.traffic.getState().select(1);
    await rt.controller.copyFrames();
    expect(rt.stores.toasts.getState().items.map((t) => t.text)).toEqual([
      "Could not copy to the clipboard.",
    ]);
    rt.dispose();
  });
});

describe("REV-003 m-3: loading a profile reads the file before disconnecting", () => {
  it("an unreadable file leaves the running session alone", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10{Enter}");
    h.state("connecting");
    h.state("connected");
    h.state("polling");
    act(() => h.rt.stores.config.getState().markSaved("Current"));
    h.ipc.failNext("profilesGet", new IpcError("The file is damaged.", "invalidProfile"));
    await expect(h.rt.controller.loadProfile("Broken")).resolves.toBe(false);
    expect(h.ipc.callsOf("disconnect")).toHaveLength(0);
    expect(h.ipc.callsOf("cancelConnect")).toHaveLength(0);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(h.rt.stores.session.getState().state).toBe("polling");
    expect(h.rt.stores.config.getState().profileName).toBe("Current");
    expect(await screen.findByText("Could not open profile: The file is damaged.")).toBeVisible();
  });
});
