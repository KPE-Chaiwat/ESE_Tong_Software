// Regression tests for REV-002 and for DES-001 revision 2. Each describe names the finding.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IpcError } from "@/shared/ipc/modbus-master";
import { badResponseExtra as bad, sessionReason } from "@/shared/ipc/modbus-master.fake";
import type { Profile, TrafficFrame } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow, TCP } from "./test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const host = () => screen.getByLabelText("Host") as HTMLInputElement;
const banner = () => document.querySelector<HTMLElement>("[data-slot=state-banner]");
const connectButton = () => screen.getByRole("button", { name: "Connect" });

/** Connects a TCP window for real (so the session remembers it) and starts polling slave 1. */
async function pollingOnSlave1() {
  h = await renderWindow();
  await h.user.type(host(), "192.168.1.10");
  await h.user.click(connectButton());
  h.state("connecting");
  h.state("connected");
  await waitFor(() => expect(h.ipc.callsOf("startPoll")).toHaveLength(1));
  h.state("polling");
}

const setField = async (label: string, value: string) => {
  const el = screen.getByLabelText(label);
  await h.user.clear(el);
  await h.user.type(el, value);
};

describe("REV-002 M2: banner and live region describe the running setup, not the draft", () => {
  it("editing the Slave ID while in timeout does not change the banner", async () => {
    await pollingOnSlave1();
    h.state("timeout");
    h.state("timeout");
    const text =
      "Timeout: slave 1 did not respond within 1000 ms. Retrying every 1000 ms (2 in a row).";
    expect(banner()).toHaveTextContent(text);
    await setField("Slave ID", "7");
    expect(h.rt.stores.config.getState().poll.slaveId).toBe(7);
    expect(banner()).toHaveTextContent(text);
  });

  it("editing the start address and quantity does not change the exception range", async () => {
    await pollingOnSlave1();
    h.state("exception", { exceptionCode: 2 });
    const text = "from slave 1 for FC03 at 0-9.";
    expect(banner()).toHaveTextContent(text);
    await setField("Start address", "500");
    await setField("Quantity", "50");
    await setField("Scan rate (ms)", "250");
    expect(banner()).toHaveTextContent(text);
    expect(banner()).toHaveTextContent("Retrying every 1000 ms");
  });

  it("editing the host after a refused connection does not change the banner", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10");
    await h.user.click(connectButton());
    h.state("connecting");
    h.state("disconnected", { reason: sessionReason("refused", "x") });
    expect(banner()).toHaveTextContent("Connection refused by 192.168.1.10:502.");
    await setField("Host", "10.0.0.9");
    expect(banner()).toHaveTextContent("Connection refused by 192.168.1.10:502.");
  });

  it("the live region announces the running slave, not the draft", async () => {
    await pollingOnSlave1();
    await setField("Slave ID", "7");
    h.state("timeout");
    expect(screen.getByTestId("live-polite")).toHaveTextContent("slave 1 did not respond");
  });

  it("Apply makes the new definition the one that is described", async () => {
    await pollingOnSlave1();
    await setField("Slave ID", "7");
    await h.user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(h.ipc.callsOf("startPoll")).toHaveLength(2));
    h.state("polling");
    h.state("timeout");
    expect(banner()).toHaveTextContent("Timeout: slave 7 did not respond");
  });
});

describe("REV-002 M4: the serial port select always shows the form value", () => {
  const ports = [
    { name: "COM1", description: "Port A" },
    { name: "COM3", description: "Port B" },
  ];

  async function rtu() {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.ports = ports;
      },
    });
    await h.user.click(screen.getByRole("radio", { name: "RTU" }));
    await screen.findByRole("option", { name: "COM3 - Port B" });
  }

  const select = () => screen.getByLabelText("Serial port") as HTMLSelectElement;

  it("Refresh keeps the selected port (COM3 stays COM3, not COM1)", async () => {
    await rtu();
    await h.user.selectOptions(select(), "COM3");
    expect(select().value).toBe("COM3");
    const held = h.ipc.hold("listSerialPorts");
    await h.user.click(screen.getByRole("button", { name: "Refresh serial ports" }));
    // While the list loads the select still shows the current port.
    expect(select().value).toBe("COM3");
    expect(select()).toBeDisabled();
    expect(screen.getByText("Loading ports…")).toBeVisible();
    await act(async () => held.release(ports));
    await waitFor(() => expect(select()).toBeEnabled());
    expect(select().value).toBe("COM3");
    await h.user.click(connectButton());
    await waitFor(() => expect(h.ipc.callsOf("connect")).toHaveLength(1));
    expect(h.ipc.callsOf("connect")[0]?.[0]).toMatchObject({ mode: "rtu", port: "COM3" });
  });

  it("a loaded profile's port stays selected when the list is read", async () => {
    await rtu();
    act(() =>
      h.rt.stores.config.getState().applyProfile({
        schemaVersion: 1,
        name: "P",
        connection: {
          mode: "rtu",
          port: "COM3",
          baud: 9600,
          dataBits: 8,
          parity: "even",
          stopBits: 1,
          timeoutMs: 1000,
        },
        poll: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 },
        display: { format: "unsigned", addressBase: 0 },
        autoStartPoll: true,
      }),
    );
    await waitFor(() => expect(select().value).toBe("COM3"));
    await h.user.click(screen.getByRole("button", { name: "Refresh serial ports" }));
    await waitFor(() => expect(select()).toBeEnabled());
    expect(select().value).toBe("COM3");
  });

  it("a port that vanished from the list stays selected and is what Connect opens", async () => {
    await rtu();
    await h.user.selectOptions(select(), "COM3");
    h.ipc.ports = [{ name: "COM1", description: "Port A" }];
    await h.user.click(screen.getByRole("button", { name: "Refresh serial ports" }));
    await waitFor(() => expect(select()).toBeEnabled());
    expect(select().value).toBe("COM3");
    expect(within(select()).getByRole("option", { name: "COM3" })).toBeInTheDocument();
    await h.user.click(connectButton());
    await waitFor(() => expect(h.ipc.callsOf("connect")).toHaveLength(1));
    expect(h.ipc.callsOf("connect")[0]?.[0]).toMatchObject({ port: "COM3" });
  });
});

describe("DES-001 3.1: RTU values outside the lists, from a loaded profile", () => {
  const profile = (over: Record<string, unknown>): Profile => ({
    schemaVersion: 1,
    name: "Hand edited",
    connection: {
      mode: "rtu",
      port: "COM3",
      baud: 250000,
      dataBits: 6,
      parity: "even",
      stopBits: 3,
      timeoutMs: 1000,
      ...over,
    } as never,
    poll: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 },
    display: { format: "unsigned", addressBase: 0 },
    autoStartPoll: true,
  });

  it("shows the stored value as not supported and the messages after the load", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profile({})]);
      },
    });
    await act(async () => {
      await h.rt.controller.loadProfile("Hand edited");
    });
    expect(h.rt.stores.session.getState().state).toBe("idle");
    expect(await screen.findByText("Choose a baud rate from the list.")).toBeVisible();
    expect(screen.getByText("Data bits must be 7 or 8.")).toBeVisible();
    expect(screen.getByText("Stop bits must be 1 or 2.")).toBeVisible();
    const baud = screen.getByLabelText("Baud") as HTMLSelectElement;
    expect(baud.value).toBe("250000");
    expect(
      within(baud).getByRole("option", { name: "250000 (not supported)" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Data bits")).getByRole("option", { name: "6 (not supported)" }),
    ).toBeInTheDocument();
    expect(baud).toHaveAttribute("aria-invalid", "true");
    // Connect sends nothing until the values are fixed.
    await h.user.click(connectButton());
    expect(h.ipc.callsOf("connect")).toHaveLength(0);
    await h.user.selectOptions(baud, "9600");
    await h.user.selectOptions(screen.getByLabelText("Data bits"), "8");
    await h.user.selectOptions(screen.getByLabelText("Stop bits"), "1");
    await h.user.click(connectButton());
    await waitFor(() => expect(h.ipc.callsOf("connect")).toHaveLength(1));
  });

  it("shows the parity message for an unknown parity", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profile({ baud: 9600, dataBits: 8, stopBits: 1, parity: "mark" })]);
      },
    });
    await act(async () => {
      await h.rt.controller.loadProfile("Hand edited");
    });
    expect(await screen.findByText("Choose a parity from the list.")).toBeVisible();
    expect(
      within(screen.getByLabelText("Parity")).getByRole("option", { name: "mark (not supported)" }),
    ).toBeInTheDocument();
  });
});

describe("REV-002 m1: loading a profile while connecting", () => {
  it("cancels the attempt (T4) instead of waiting five seconds for a disconnect", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([
          {
            schemaVersion: 1,
            name: "Pump",
            connection: { mode: "tcp", host: "10.0.0.5", port: 502, timeoutMs: 1000 },
            poll: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 },
            display: { format: "unsigned", addressBase: 0 },
            autoStartPoll: true,
          },
        ]);
      },
    });
    await h.user.type(host(), "192.168.1.10");
    await h.user.click(connectButton());
    h.state("connecting");
    // Re-baseline so only the connection state asks a question.
    act(() => h.rt.stores.config.getState().markSaved("Current"));
    let loaded: boolean | undefined;
    const pending = h.rt.controller.loadProfile("Pump").then((ok) => {
      loaded = ok;
    });
    const confirm = await screen.findByRole("alertdialog", { name: "Disconnect and load?" });
    expect(
      within(confirm).getByText('Loading "Pump" will disconnect from TCP 192.168.1.10:502.'),
    ).toBeVisible();
    await h.user.click(within(confirm).getByRole("button", { name: "Disconnect and load" }));
    await waitFor(() => expect(h.ipc.callsOf("cancelConnect")).toHaveLength(1));
    expect(h.ipc.callsOf("disconnect")).toHaveLength(0);
    h.state("idle");
    await pending;
    expect(loaded).toBe(true);
    expect(h.rt.stores.config.getState().profileName).toBe("Pump");
  });
});

describe("REV-002 m3: nested modals keep the window shortcuts locked", () => {
  it("cancelling the Replace confirm leaves Save as open and the shortcuts locked", async () => {
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
          },
        ]);
      },
    });
    await h.user.type(host(), "192.168.1.10");
    await h.user.click(screen.getByRole("button", { name: "Save as…" }));
    const dialog = await screen.findByRole("dialog", { name: "Save profile as" });
    await h.user.type(within(dialog).getByLabelText("Name"), "Taken");
    await h.user.click(within(dialog).getByRole("button", { name: "Save" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Replace profile?" });
    await h.user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Save profile as" })).toBeVisible();
    expect(h.rt.stores.layout.getState().modalOpen).toBe(true);
    // Ctrl+\ and Ctrl+L would act behind the dialog if the lock were released.
    act(() => {
      fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
      fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    });
    expect(h.rt.stores.layout.getState().setupOpen).toBe(true);
    expect(h.ipc.callsOf("connect")).toHaveLength(0);
    await h.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(h.rt.stores.layout.getState().modalOpen).toBe(false));
  });
});

describe("REV-002 m4: a full traffic log does not move under the reader", () => {
  const frame = (seq: number): TrafficFrame => ({
    seq,
    at: 0,
    direction: seq % 2 === 1 ? "tx" : "rx",
    bytes: [0, 1],
    slaveId: 1,
    function: 3,
    exceptionCode: null,
    note: null,
  });

  it("keeps the frame at the top of the view while Auto-scroll is off", async () => {
    h = await renderWindow();
    h.emit(() => h.ipc.emitFrames(Array.from({ length: 5000 }, (_, i) => frame(i + 1))));
    const list = within(screen.getByRole("region", { name: "Communication Traffic" })).getByRole(
      "grid",
      { name: "Frames" },
    );
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 110000 });
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 300 });
    await h.user.click(screen.getByRole("checkbox", { name: "Auto-scroll" }));
    // Row 100 (frame 101) is at the top of the view.
    list.scrollTop = 100 * 22;
    act(() => {
      fireEvent.scroll(list);
    });
    h.emit(() => h.ipc.emitFrames(Array.from({ length: 20 }, (_, i) => frame(5001 + i))));
    // The 20 oldest frames were dropped: the same frame is now 20 rows higher in the buffer.
    expect(list.scrollTop).toBe(80 * 22);
    h.emit(() => h.ipc.emitFrames(Array.from({ length: 5 }, (_, i) => frame(5021 + i))));
    expect(list.scrollTop).toBe(75 * 22);
  });

  it("does not touch the scroll position while Auto-scroll is on", async () => {
    h = await renderWindow();
    h.emit(() => h.ipc.emitFrames(Array.from({ length: 5000 }, (_, i) => frame(i + 1))));
    const list = within(screen.getByRole("region", { name: "Communication Traffic" })).getByRole(
      "grid",
      { name: "Frames" },
    );
    list.scrollTop = 1234;
    h.emit(() => h.ipc.emitFrames([frame(5001)]));
    expect(list.scrollTop).toBe(1234);
  });
});

describe("REV-002 m7: a reloaded window", () => {
  it("is not Modified and keeps the session setup", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.snapshot = {
          ...ipc.snapshot,
          state: "polling",
          config: { mode: "tcp", host: "10.1.1.1", port: 1502, timeoutMs: 700 },
          poll: { slaveId: 4, function: 3, startAddress: 10, quantity: 3, scanRateMs: 500 },
        };
      },
    });
    expect(screen.queryByText("Modified")).not.toBeInTheDocument();
    expect(host()).toHaveValue("10.1.1.1");
    expect(document.title).toBe("Modbus Master - Untitled - Polling");
    await setField("Quantity", "4");
    expect(screen.getByText("Modified")).toBeVisible();
  });

  it("disables the session buttons until the snapshot is applied", async () => {
    h = await renderWindow({
      lazyInit: true,
      prepare: ({ ipc }) => {
        ipc.snapshot = { ...ipc.snapshot, state: "polling" };
      },
    });
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    await h.init();
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Connect" })).not.toBeInTheDocument();
  });
});

describe("REV-002 m8: failures nobody awaits are shown", () => {
  it("Ctrl+N shows why a new window could not be opened", async () => {
    h = await renderWindow();
    h.win.openError = "Unknown tool.";
    act(() => {
      fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    });
    expect(await screen.findByText("Could not open a new window: Unknown tool.")).toBeVisible();
  });
});

describe("DES-001 1 / 5.1 / T15: Enter connects, no Connect button in the setup panel", () => {
  const setup = () => screen.getByRole("complementary", { name: "Setup" });

  it("the setup panel has no Connect button", async () => {
    h = await renderWindow();
    expect(within(setup()).queryByRole("button", { name: /connect/i })).not.toBeInTheDocument();
  });

  it.each(["Host", "Port", "Timeout (ms)"])("Enter in %s connects when idle", async (label) => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10");
    await h.user.click(screen.getByLabelText(label));
    await h.user.keyboard("{Enter}");
    await waitFor(() => expect(h.ipc.callsOf("connect")).toHaveLength(1));
  });

  it("Enter with an invalid host sends nothing and shows the message", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1{Enter}");
    expect(
      screen.getByText("Enter a valid host name or IPv4 address, for example 192.168.1.10."),
    ).toBeVisible();
    expect(h.ipc.callsOf("connect")).toHaveLength(0);
  });

  it("Enter reconnects when disconnected", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10{Enter}");
    h.state("connecting");
    h.state("disconnected", { reason: sessionReason("refused", "x") });
    await h.user.click(host());
    await h.user.keyboard("{Enter}");
    await waitFor(() => expect(h.ipc.callsOf("connect")).toHaveLength(2));
  });

  it("Enter does nothing while polling (the connection fields are read-only)", async () => {
    await pollingOnSlave1();
    await h.user.click(host());
    await h.user.keyboard("{Enter}");
    expect(h.ipc.callsOf("connect")).toHaveLength(1);
  });

  it("Dismiss shows a spinner until the backend reports idle, with no local reset", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10{Enter}");
    h.state("connecting");
    h.state("disconnected", { reason: sessionReason("closedByPeer", "x") });
    const dismiss = within(banner() as HTMLElement).getByRole("button", { name: "Dismiss" });
    await h.user.click(dismiss);
    await waitFor(() => expect(h.ipc.callsOf("disconnect")).toHaveLength(1));
    expect(dismiss).toBeDisabled();
    expect(dismiss.querySelector('[data-icon="loader"]')).toBeInTheDocument();
    expect(banner()).not.toBeNull();
    h.state("idle");
    expect(banner()).toBeNull();
  });
});

describe("DES-001 3.4: bad response texts in the banner", () => {
  it("shortFrame with both numbers", async () => {
    await pollingOnSlave1();
    h.state("badResponse", bad("shortFrame", { expected: 29, got: 20, message: "" }));
    expect(banner()).toHaveTextContent(
      "Bad response from slave 1: short frame (20 of 29 bytes). Retrying every 1000 ms (1 in a row).",
    );
  });

  it("wrongFunction with two-digit function codes, and the fallback without numbers", async () => {
    await pollingOnSlave1();
    h.state("badResponse", bad("wrongFunction", { expected: 3, got: 4, message: "" }));
    expect(banner()).toHaveTextContent("reply for FC04, expected FC03.");
    h.state("badResponse", bad("wrongFunction", { expected: null, got: null, message: "" }));
    expect(banner()).toHaveTextContent("reply for unexpected function.");
  });

  it("malformed with and without a message", async () => {
    await pollingOnSlave1();
    h.state("badResponse", bad("malformed", { expected: null, got: null, message: "byte count" }));
    expect(banner()).toHaveTextContent("malformed frame (byte count).");
    h.state("badResponse", bad("malformed", { expected: null, got: null, message: "" }));
    expect(banner()).toHaveTextContent("Bad response from slave 1: malformed frame. Retrying");
  });
});

describe("DES-001 3.5: saving with an invalid form", () => {
  it("Save as… is blocked: a 4 s error toast with the circle-x icon and no dialog", async () => {
    h = await renderWindow();
    await h.user.click(screen.getByRole("button", { name: "Save as…" }));
    const toast = await screen.findByText("Fix the highlighted fields before saving.");
    expect(toast).toBeVisible();
    expect(
      toast.closest("[data-tone=error]")?.querySelector('[data-icon="circle-x"]'),
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // All field messages show and the focus moves to the first invalid field.
    expect(screen.getByText("Enter a host name or IPv4 address.")).toBeVisible();
    expect(host()).toHaveFocus();
    expect(h.ipc.callsOf("profilesSave")).toHaveLength(0);
  });

  it("Ctrl+S and Ctrl+Shift+S are blocked the same way", async () => {
    h = await renderWindow();
    act(() => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    });
    await screen.findByText("Fix the highlighted fields before saving.");
    act(() => {
      fireEvent.keyDown(window, { key: "S", ctrlKey: true, shiftKey: true });
    });
    await waitFor(() =>
      expect(screen.getAllByText("Fix the highlighted fields before saving.")).toHaveLength(2),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Save in Save changes? with an invalid form shows the toast and the window stays open", async () => {
    h = await renderWindow();
    await setField("Quantity", "126");
    await h.user.type(host(), "192.168.1.10");
    const request = h.win.requestClose();
    const dialog = await screen.findByRole("alertdialog", { name: "Save changes?" });
    await h.user.click(within(dialog).getByRole("button", { name: "Save" }));
    await expect(request).resolves.toBe(false);
    expect(await screen.findByText("Fix the highlighted fields before saving.")).toBeVisible();
    expect(screen.getByText("Quantity for FC03 must be from 1 to 125.")).toBeVisible();
  });
});

describe("DES-001 3.4 profile names in the dialogs", () => {
  it.each([
    [".hidden", "Profile name cannot start with a dot."],
    ["bench.", "Profile name cannot end with a dot."],
    [" bench", "Profile name cannot start or end with a space."],
    ["con.backup", '"con.backup" is reserved by Windows and cannot be used as a profile name.'],
  ])("Save as shows the message for %j", async (name, message) => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10");
    await h.user.click(screen.getByRole("button", { name: "Save as…" }));
    const dialog = await screen.findByRole("dialog", { name: "Save profile as" });
    await h.user.type(within(dialog).getByLabelText("Name"), name);
    await h.user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText(message)).toBeVisible();
    expect(h.ipc.callsOf("profilesSave")).toHaveLength(0);
  });

  it("a backend invalidProfileName message shows under the name field", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.failNext(
          "profilesSave",
          new IpcError("The name is not allowed.", "invalidProfileName"),
        );
      },
    });
    await h.user.type(host(), "192.168.1.10");
    await h.user.click(screen.getByRole("button", { name: "Save as…" }));
    const dialog = await screen.findByRole("dialog", { name: "Save profile as" });
    await h.user.type(within(dialog).getByLabelText("Name"), "Odd name");
    await h.user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("The name is not allowed.")).toBeVisible();
    expect(within(dialog).getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
  });

  it("rename is case-insensitive for the loaded profile (REV-002 n3)", async () => {
    const stored: Profile = {
      schemaVersion: 1,
      name: "Boiler",
      connection: { mode: "tcp", host: "h", port: 502, timeoutMs: 1000 },
      poll: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 },
      display: { format: "unsigned", addressBase: 0 },
      autoStartPoll: true,
    };
    h = await renderWindow({
      prepare: ({ rt, ipc }) => {
        ipc.seedProfiles([stored]);
        rt.stores.config.getState().applyProfile({ ...stored, name: "boiler" });
      },
    });
    await h.user.click(screen.getByRole("button", { name: "Open…" }));
    const dialog = await screen.findByRole("dialog", { name: "Open profile" });
    await h.user.click(await within(dialog).findByText("Boiler"));
    await h.user.click(within(dialog).getByRole("button", { name: "Rename" }));
    const input = within(dialog).getByLabelText("New profile name");
    await h.user.clear(input);
    await h.user.type(input, "Boiler 2{Enter}");
    await waitFor(() => expect(h.rt.stores.config.getState().profileName).toBe("Boiler 2"));
  });

  it("the unreadable profile row has the exact text and a disabled Open", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.setResult("profilesList", [
          { name: "Old", modifiedAt: 1, connectionSummary: "schema 9", readable: false },
        ]);
      },
    });
    await h.user.click(screen.getByRole("button", { name: "Open…" }));
    const dialog = await screen.findByRole("dialog", { name: "Open profile" });
    const text = await within(dialog).findByText("Cannot be opened (newer or damaged file)");
    expect(text.closest("tr")?.querySelector('[data-icon="triangle-alert"]')).toBeTruthy();
    await h.user.click(within(dialog).getByText("Old"));
    expect(within(dialog).getByRole("button", { name: "Open" })).toBeDisabled();
  });
});

describe("DES-001 5.2: the copy toast for one row", () => {
  it("reads Copied 1 row.", async () => {
    h = await renderWindow({
      prepare: ({ rt }) => {
        rt.stores.config.getState().setConnection(TCP);
      },
    });
    h.state("connecting");
    h.state("connected");
    await waitFor(() => expect(h.ipc.callsOf("startPoll")).toHaveLength(1));
    h.state("polling");
    h.emit(() => h.ipc.emitPollUpdate({ values: Array.from({ length: 10 }, (_, i) => i) }));
    const grid = screen.getByRole("grid", { name: "Register values" });
    await h.user.click(within(grid).getAllByRole("row")[1] as HTMLElement);
    await h.user.keyboard("{Control>}c{/Control}");
    expect(await screen.findByText("Copied 1 row.")).toBeVisible();
  });
});

describe("AppError.field in RTU mode", () => {
  it("the backend field port is the serial port select", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.ports = [{ name: "COM3", description: null }];
      },
    });
    await h.user.click(screen.getByRole("radio", { name: "RTU" }));
    await h.user.selectOptions(await screen.findByLabelText("Serial port"), "COM3");
    h.ipc.failNext(
      "connect",
      new IpcError("Select a serial port from the list.", "validation", "port"),
    );
    await h.user.click(connectButton());
    expect(await screen.findAllByText("Select a serial port from the list.")).toHaveLength(2);
    expect(screen.getByLabelText("Serial port")).toHaveFocus();
    expect(screen.getByLabelText("Serial port")).toHaveAttribute("aria-invalid", "true");
  });

  it("an unknown field only shows the toast", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10");
    h.ipc.failNext("connect", new IpcError("Something else.", "validation", "nonsense"));
    await h.user.click(connectButton());
    expect(await screen.findByText("Something else.")).toBeVisible();
    expect(host()).not.toHaveAttribute("aria-invalid");
  });
});
