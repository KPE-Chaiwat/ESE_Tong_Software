import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IpcError } from "@/shared/ipc/modbus-master";
import { sessionReason } from "@/shared/ipc/modbus-master.fake";
import type { ReadFunction, WriteResult } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow, TCP } from "../test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

async function connected(fn: ReadFunction | "rtu" = 3, viaConnect = false) {
  h = await renderWindow({
    prepare: ({ rt }) => {
      rt.stores.config.getState().setConnection(
        fn === "rtu"
          ? {
              mode: "rtu",
              port: "COM3",
              baud: 9600,
              dataBits: 8,
              parity: "even",
              stopBits: 1,
              timeoutMs: 1000,
            }
          : TCP,
      );
      rt.stores.config.getState().setAutoStart(false);
      rt.stores.config.getState().setPoll({
        slaveId: 1,
        function: fn === "rtu" ? 3 : fn,
        startAddress: 100,
        quantity: 3,
        scanRateMs: 1000,
      });
    },
  });
  if (viaConnect) {
    // A real Connect, so the session remembers the connection it opened.
    await act(async () => {
      await h.rt.controller.connect();
    });
  }
  h.state("connecting");
  h.state("connected");
}

async function openDialog() {
  await h.user.click(screen.getByRole("button", { name: "Write…" }));
  return screen.findByRole("dialog", { name: "Write" });
}

const result = (dialog: HTMLElement) => within(dialog).getByTestId("write-result");

async function writeFc16(dialog: HTMLElement, values = "10 20 30") {
  await h.user.selectOptions(within(dialog).getByLabelText("Function"), "16");
  const box = within(dialog).getByLabelText(/^Values/);
  await h.user.clear(box);
  // Paste instead of typing: a 124 value list would take thousands of keystrokes.
  await h.user.click(box);
  await h.user.paste(values);
}

describe("Write dialog (task 15)", () => {
  it("opens from the toolbar with the poll slave and the last used function", async () => {
    await connected();
    const dialog = await openDialog();
    expect(within(dialog).getByLabelText("Function")).toHaveValue("6");
    expect(within(dialog).getByLabelText("Slave ID")).toHaveValue("1");
    expect(within(dialog).getByLabelText("Start address")).toHaveValue("100");
    expect(within(dialog).getByText("(protocol address 100)")).toBeVisible();
  });

  it("Ctrl+E opens it and the first field has the focus", async () => {
    await connected();
    act(() => {
      fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    });
    const dialog = await screen.findByRole("dialog", { name: "Write" });
    await waitFor(() => expect(within(dialog).getByLabelText("Function")).toHaveFocus());
  });

  it("is not available without a link", async () => {
    h = await renderWindow();
    expect(screen.queryByRole("button", { name: "Write…" })).not.toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the fields for each function", async () => {
    await connected();
    const dialog = await openDialog();
    const fn = within(dialog).getByLabelText("Function");
    expect(within(dialog).getByLabelText("Value")).toBeVisible();
    await h.user.selectOptions(fn, "5");
    expect(within(dialog).getByRole("radio", { name: "ON" })).toBeChecked();
    expect(
      within(dialog).queryByRole("radiogroup", { name: "Value format" }),
    ).not.toBeInTheDocument();
    await h.user.selectOptions(fn, "15");
    expect(within(dialog).getByText(/^Values \(/)).toBeVisible();
    expect(
      within(dialog).queryByRole("radiogroup", { name: "Value format" }),
    ).not.toBeInTheDocument();
    await h.user.selectOptions(fn, "16");
    expect(within(dialog).getByRole("radiogroup", { name: "Value format" })).toBeVisible();
  });

  it("shows the live value count and the written address range", async () => {
    await connected();
    const dialog = await openDialog();
    await writeFc16(dialog, "10 20 30");
    expect(within(dialog).getByText("Values (3)")).toBeVisible();
    expect(within(dialog).getByText("Writes addresses 100-102.")).toBeVisible();
    expect(
      within(dialog).getByText("Separate values with spaces, commas, tabs or new lines."),
    ).toBeVisible();
  });

  it("124 values show the count message and send nothing", async () => {
    await connected();
    const dialog = await openDialog();
    await writeFc16(dialog, Array.from({ length: 124 }, () => "1").join(" "));
    await h.user.click(within(dialog).getByRole("button", { name: "Send" }));
    expect(within(dialog).getByText("Enter from 1 to 123 values (you entered 124).")).toBeVisible();
    expect(h.ipc.callsOf("write")).toHaveLength(0);
  });

  it("shows the first bad item with its message", async () => {
    await connected();
    const dialog = await openDialog();
    await writeFc16(dialog, "1 70000 3");
    await h.user.click(within(dialog).getByRole("button", { name: "Send" }));
    expect(
      within(dialog).getByText('Value 2 ("70000") is not valid: Value must be from 0 to 65535.'),
    ).toBeVisible();
  });

  it("an invalid single value is reported on blur", async () => {
    await connected();
    const dialog = await openDialog();
    const value = within(dialog).getByLabelText("Value");
    await h.user.clear(value);
    await h.user.type(value, "99999");
    await h.user.tab();
    expect(within(dialog).getByText("Value must be from 0 to 65535.")).toBeVisible();
    expect(value).toHaveAttribute("aria-invalid", "true");
  });

  it("sends a confirmed write and shows the success text, staying open", async () => {
    await connected();
    const dialog = await openDialog();
    await writeFc16(dialog);
    await h.user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(result(dialog)).toHaveTextContent(
        "Write confirmed by slave 1: 3 registers at 100-102.",
      ),
    );
    expect(h.ipc.callsOf("write")).toEqual([
      [{ slaveId: 1, function: 16, address: 100, values: [10, 20, 30] }],
    ]);
    expect(screen.getByRole("dialog", { name: "Write" })).toBeVisible();
    expect(result(dialog).querySelector('[data-icon="circle-check"]')).toBeInTheDocument();
  });

  it("Enter sends from a single line field; Ctrl+Enter sends from the values box", async () => {
    await connected();
    const dialog = await openDialog();
    const value = within(dialog).getByLabelText("Value");
    await h.user.clear(value);
    await h.user.type(value, "7{Enter}");
    await waitFor(() => expect(h.ipc.callsOf("write")).toHaveLength(1));
    await h.user.selectOptions(within(dialog).getByLabelText("Function"), "16");
    const box = within(dialog).getByLabelText(/^Values/);
    await h.user.type(box, "1 2{Enter}");
    expect(h.ipc.callsOf("write")).toHaveLength(1);
    expect(box).toHaveValue("1 2\n");
    await h.user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(h.ipc.callsOf("write")).toHaveLength(2));
  });

  it("Esc closes the dialog", async () => {
    await connected();
    await openDialog();
    await h.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows Writing… while sending and disables Send", async () => {
    await connected();
    const held = h.ipc.hold("write");
    const dialog = await openDialog();
    await h.user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(result(dialog)).toHaveTextContent("Writing…"));
    expect(within(dialog).getByRole("button", { name: "Send" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeEnabled();
    await act(async () => held.release({ status: "ok" }));
    await waitFor(() => expect(result(dialog)).toHaveTextContent("Write confirmed"));
  });

  it("closing while sending drops the late result", async () => {
    await connected();
    const held = h.ipc.hold("write");
    const dialog = await openDialog();
    await h.user.click(within(dialog).getByRole("button", { name: "Send" }));
    await h.user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await act(async () => held.release({ status: "ok" }));
    const reopened = await openDialog();
    expect(result(reopened)).toBeEmptyDOMElement();
  });

  it.each<[WriteResult, string, string]>([
    [
      { status: "broadcastSent" },
      "Broadcast sent. Devices do not reply to slave ID 0, so the write cannot be confirmed.",
      "circle-check",
    ],
    [
      { status: "exception", code: 2 },
      "Exception 02 (Illegal data address). Nothing was confirmed.",
      "octagon-x",
    ],
    [
      { status: "timeout" },
      "No response within 1000 ms. The write may or may not have been applied.",
      "timer-off",
    ],
    [
      { status: "badResponse", kind: "crc", detail: { expected: null, got: null, message: "" } },
      "Bad response: CRC mismatch. The write may or may not have been applied.",
      "triangle-alert",
    ],
  ])("shows the result %j", async (backendResult, text, icon) => {
    await connected();
    h.ipc.setResult("write", backendResult);
    const dialog = await openDialog();
    await h.user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(result(dialog)).toHaveTextContent(text));
    expect(result(dialog).querySelector(`[data-icon="${icon}"]`)).toBeInTheDocument();
  });

  it("error results do not use text on a solid error fill", async () => {
    await connected();
    h.ipc.setResult("write", { status: "exception", code: 2 });
    const dialog = await openDialog();
    await h.user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(result(dialog)).toHaveTextContent("Exception 02"));
    const chip = result(dialog).querySelector("p") as HTMLElement;
    expect(chip.className).toContain("bg-error-tint");
    expect(chip.className).not.toMatch(/\bbg-error(?![-\w])/);
  });

  const BROADCAST = "Broadcast: devices do not reply, so the result cannot be confirmed.";
  const setSlave = async (dialog: HTMLElement, value: string) => {
    const slave = within(dialog).getByLabelText("Slave ID");
    await h.user.clear(slave);
    await h.user.type(slave, value);
  };

  it("RTU: slave ID 0 shows the broadcast warning and Send stays enabled", async () => {
    await connected("rtu");
    h.ipc.setResult("write", { status: "broadcastSent" });
    const dialog = await openDialog();
    await setSlave(dialog, "0");
    expect(within(dialog).getByText(BROADCAST)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Send" })).toBeEnabled();
    await h.user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(result(dialog)).toHaveTextContent("Broadcast sent."));
  });

  it("TCP: unit 0 is a normal unit, with no warning and a normal confirmation", async () => {
    await connected();
    const dialog = await openDialog();
    await h.user.clear(within(dialog).getByLabelText("Start address"));
    await h.user.type(within(dialog).getByLabelText("Start address"), "3");
    await setSlave(dialog, "0");
    expect(within(dialog).queryByText(BROADCAST)).not.toBeInTheDocument();
    await h.user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(result(dialog)).toHaveTextContent("Write confirmed by slave 0: register at 3."),
    );
    expect(result(dialog)).not.toHaveTextContent("Broadcast");
  });

  it("the broadcast warning follows the connection the session has, not the draft", async () => {
    await connected(3, true);
    const dialog = await openDialog();
    // The draft is switched to RTU after connecting over TCP.
    act(() => {
      h.rt.stores.config.getState().setConnection({
        mode: "rtu",
        port: "COM3",
        baud: 9600,
        dataBits: 8,
        parity: "even",
        stopBits: 1,
        timeoutMs: 1000,
      });
    });
    await setSlave(dialog, "0");
    expect(within(dialog).queryByText(BROADCAST)).not.toBeInTheDocument();
  });

  it("link lost: the exact text with the unplug icon, the draft kept and Send disabled", async () => {
    await connected();
    h.ipc.setResult("write", { status: "linkLost" });
    const dialog = await openDialog();
    await h.user.clear(within(dialog).getByLabelText("Start address"));
    await h.user.type(within(dialog).getByLabelText("Start address"), "3");
    const value = within(dialog).getByLabelText("Value");
    await h.user.clear(value);
    await h.user.type(value, "9");
    await h.user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(result(dialog)).toHaveTextContent(
        "Connection lost during the write. The write may or may not have been applied. Reconnect and check the value before sending again.",
      ),
    );
    // The backend moves the session to disconnected at the same time.
    h.state("disconnected", { reason: sessionReason("closedByPeer", "x", "linkLost") });
    expect(result(dialog).querySelector('[data-icon="unplug"]')).toBeInTheDocument();
    expect(result(dialog)).not.toHaveTextContent("Not connected. Connect before writing.");
    expect(within(dialog).getByRole("button", { name: "Send" })).toBeDisabled();
    expect(within(dialog).getByLabelText("Start address")).toHaveValue("3");
    expect(within(dialog).getByLabelText("Value")).toHaveValue("9");
    // Reconnect and polling again: Send is enabled and the result area is empty.
    h.state("connecting");
    h.state("connected");
    h.state("polling");
    expect(within(dialog).getByRole("button", { name: "Send" })).toBeEnabled();
    expect(result(dialog)).toBeEmptyDOMElement();
  });

  it("a link-lost result stays while the draft is edited", async () => {
    await connected();
    h.ipc.setResult("write", { status: "linkLost" });
    const dialog = await openDialog();
    await h.user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(result(dialog)).toHaveTextContent("Connection lost during the write"),
    );
    h.state("disconnected", { reason: sessionReason("closedByPeer", "x", "linkLost") });
    await h.user.type(within(dialog).getByLabelText("Value"), "1");
    expect(result(dialog)).toHaveTextContent("Connection lost during the write");
  });

  it("a write queued when the link drops reads Not connected, never link lost", async () => {
    await connected();
    h.ipc.setResult("write", { status: "notConnected" });
    const dialog = await openDialog();
    await h.user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(result(dialog)).toHaveTextContent("Not connected. Connect before writing."),
    );
  });

  it("a bad response shows the short-frame text from the detail", async () => {
    await connected();
    h.ipc.setResult("write", {
      status: "badResponse",
      kind: "shortFrame",
      detail: { expected: 8, got: 5, message: "" },
    });
    const dialog = await openDialog();
    await h.user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(result(dialog)).toHaveTextContent(
        "Bad response: short frame (5 of 8 bytes). The write may or may not have been applied.",
      ),
    );
  });

  it("a backend validation error names the input and the dialog focuses it", async () => {
    await connected();
    h.ipc.failNext("write", new IpcError("Slave ID is out of range.", "validation", "slaveId"));
    const dialog = await openDialog();
    await h.user.click(within(dialog).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(within(dialog).getByLabelText("Slave ID")).toHaveFocus());
    expect(result(dialog)).toHaveTextContent("Could not send the write: Slave ID is out of range.");
  });

  it("when the session leaves the link-up states, Send is disabled and the result area says so", async () => {
    await connected();
    const dialog = await openDialog();
    h.state("disconnected", { reason: sessionReason("closedByPeer", "x") });
    expect(within(dialog).getByRole("button", { name: "Send" })).toBeDisabled();
    expect(result(dialog)).toHaveTextContent("Not connected. Connect before writing.");
    expect(result(dialog).querySelector('[data-icon="unplug"]')).toBeInTheDocument();
  });

  it("prefills function 05 for a coil poll", async () => {
    await connected(1);
    h.emit(() => h.ipc.emitPollUpdate({ function: 1, startAddress: 100, values: [0, 1, 0] }));
    const dialog = await openDialog();
    expect(within(dialog).getByLabelText("Function")).toHaveValue("5");
    expect(within(dialog).getByRole("radio", { name: "ON" })).toBeChecked();
  });
});
