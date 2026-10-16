import { screen, waitFor, within } from "@testing-library/react";
import { sessionReason } from "@/shared/ipc/modbus-master.fake";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const host = () => screen.getByLabelText("Host") as HTMLInputElement;
const port = () => screen.getByLabelText("Port") as HTMLInputElement;

async function selectRtu() {
  await h.user.click(screen.getByRole("radio", { name: "RTU" }));
}

describe("connection form (task 09)", () => {
  it("starts with the DES-001 defaults", async () => {
    h = await renderWindow();
    expect(host().value).toBe("");
    expect(port().value).toBe("502");
    expect((screen.getByLabelText("Timeout (ms)") as HTMLInputElement).value).toBe("1000");
    expect(screen.getByRole("radio", { name: "TCP" })).toBeChecked();
    expect((screen.getByLabelText("Slave ID") as HTMLInputElement).value).toBe("1");
    expect((screen.getByLabelText("Function") as HTMLSelectElement).value).toBe("3");
    expect((screen.getByLabelText("Start address") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("Quantity") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("Scan rate (ms)") as HTMLInputElement).value).toBe("1000");
    expect(screen.getByLabelText("Start polling when connected")).toBeChecked();
  });

  it("shows the exact messages for an invalid host and port after leaving the fields", async () => {
    h = await renderWindow();
    await h.user.type(host(), "256.1.1.1");
    await h.user.tab();
    expect(
      screen.getByText("Enter a valid host name or IPv4 address, for example 192.168.1.10."),
    ).toBeVisible();
    expect(host()).toHaveAttribute("aria-invalid", "true");
    await h.user.clear(port());
    await h.user.type(port(), "70000");
    await h.user.tab();
    expect(screen.getByText("Port must be a whole number from 1 to 65535.")).toBeVisible();
  });

  it("revalidates on every change once an error is shown", async () => {
    h = await renderWindow();
    await h.user.type(host(), "bad host");
    await h.user.tab();
    expect(host()).toHaveAttribute("aria-invalid", "true");
    await h.user.clear(host());
    await h.user.type(host(), "plc-7");
    expect(host()).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(/Enter a valid host name/)).not.toBeInTheDocument();
  });

  it("RTU mode shows the serial settings with the defaults 9600 8 Even 1", async () => {
    h = await renderWindow();
    await selectRtu();
    expect((screen.getByLabelText("Baud") as HTMLSelectElement).value).toBe("9600");
    expect((screen.getByLabelText("Data bits") as HTMLSelectElement).value).toBe("8");
    expect((screen.getByLabelText("Parity") as HTMLSelectElement).value).toBe("even");
    expect((screen.getByLabelText("Stop bits") as HTMLSelectElement).value).toBe("1");
    expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Timeout (ms)")).toBeInTheDocument();
  });

  it("warns about 7 data bits without blocking", async () => {
    h = await renderWindow();
    await selectRtu();
    await h.user.selectOptions(screen.getByLabelText("Data bits"), "7");
    expect(
      screen.getByText("Modbus RTU uses 8 data bits. 7 may not work with most devices."),
    ).toBeVisible();
    await h.user.selectOptions(screen.getByLabelText("Data bits"), "8");
    expect(screen.queryByText(/Modbus RTU uses 8 data bits/)).not.toBeInTheDocument();
  });

  it("warns about parity None with 1 stop bit", async () => {
    h = await renderWindow();
    await selectRtu();
    await h.user.selectOptions(screen.getByLabelText("Parity"), "none");
    expect(
      screen.getByText("The Modbus specification uses 2 stop bits when parity is None."),
    ).toBeVisible();
  });

  it("lists the serial ports the first time RTU is chosen", async () => {
    h = await renderWindow();
    expect(h.ipc.callsOf("listSerialPorts")).toHaveLength(0);
    await selectRtu();
    await waitFor(() => expect(h.ipc.callsOf("listSerialPorts")).toHaveLength(1));
    expect(
      await screen.findByRole("option", { name: "COM3 - USB Serial Device" }),
    ).toBeInTheDocument();
    await h.user.click(screen.getByRole("radio", { name: "TCP" }));
    await selectRtu();
    expect(h.ipc.callsOf("listSerialPorts")).toHaveLength(1);
  });

  it("shows Loading ports… while the list is read", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.hold("listSerialPorts");
      },
    });
    await selectRtu();
    expect(await screen.findByRole("option", { name: "Loading ports…" })).toBeInTheDocument();
    expect(screen.getByLabelText("Serial port")).toBeDisabled();
  });

  it("shows the empty list message", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.ports = [];
      },
    });
    await selectRtu();
    expect(
      await screen.findByText("No serial ports found. Connect a device and press Refresh."),
    ).toBeVisible();
    expect(screen.getByRole("option", { name: "No serial ports found" })).toBeInTheDocument();
  });

  it("shows the list error and Refresh retries", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.failNext("listSerialPorts", "Access denied");
      },
    });
    await selectRtu();
    expect(await screen.findByText(/Could not list serial ports: Access denied/)).toBeVisible();
    await h.user.click(screen.getByRole("button", { name: "Refresh serial ports" }));
    await waitFor(() => expect(h.ipc.callsOf("listSerialPorts")).toHaveLength(2));
    await waitFor(() =>
      expect(screen.queryByText(/Could not list serial ports/)).not.toBeInTheDocument(),
    );
  });

  it("requires a serial port before connecting in RTU mode", async () => {
    h = await renderWindow();
    await selectRtu();
    await screen.findByRole("option", { name: "COM3 - USB Serial Device" });
    await h.user.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText("Select a serial port.")).toBeVisible();
    expect(h.ipc.callsOf("connect")).toHaveLength(0);
  });

  it("makes the connection fields read-only with a hint while polling", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10");
    h.state("connecting");
    h.state("connected");
    h.state("polling");
    expect(host()).toHaveAttribute("readonly");
    expect(port()).toHaveAttribute("readonly");
    expect(screen.getByText("Disconnect to change connection settings.")).toBeVisible();
    // The poll fields stay editable while polling.
    expect(screen.getByLabelText("Quantity")).not.toHaveAttribute("readonly");
  });

  it("makes everything read-only while connecting and editable again when idle", async () => {
    h = await renderWindow();
    h.state("connecting");
    expect(host()).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Quantity")).toHaveAttribute("readonly");
    h.state("idle");
    expect(host()).not.toHaveAttribute("readonly");
    expect(screen.queryByText("Disconnect to change connection settings.")).not.toBeInTheDocument();
  });

  it("is editable again after a disconnect", async () => {
    h = await renderWindow();
    h.state("connecting");
    h.state("disconnected", { reason: sessionReason("refused", "x") });
    expect(host()).not.toHaveAttribute("readonly");
  });
});

describe("poll form (task 12)", () => {
  async function fillHostAndConnect() {
    await h.user.type(host(), "192.168.1.10");
    await h.user.click(screen.getByLabelText("Start polling when connected"));
    await h.user.click(screen.getByRole("button", { name: "Connect" }));
    h.state("connecting");
    h.state("connected");
  }

  it("rejects FC03 quantity 126 and does not start", async () => {
    h = await renderWindow();
    await fillHostAndConnect();
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "126");
    await h.user.click(screen.getByRole("button", { name: "Start polling" }));
    expect(screen.getByText("Quantity for FC03 must be from 1 to 125.")).toBeVisible();
    expect(h.ipc.callsOf("startPoll")).toHaveLength(0);
  });

  it("shows the protocol address and the quantity range as helpers", async () => {
    h = await renderWindow();
    expect(screen.getByText("Protocol address 0")).toBeVisible();
    expect(screen.getByText("1-125")).toBeVisible();
    await h.user.selectOptions(screen.getByLabelText("Function"), "1");
    expect(screen.getByText("1-2000")).toBeVisible();
  });

  it("in 1-based mode start 1 shows protocol address 0 and sends protocol 0", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10");
    await h.user.click(screen.getByLabelText("Start polling when connected"));
    await h.user.click(screen.getByRole("radio", { name: "1" }));
    const start = screen.getByLabelText("Start address") as HTMLInputElement;
    expect(start.value).toBe("1");
    expect(screen.getByText("Protocol address 0")).toBeVisible();
    await h.user.click(screen.getByRole("button", { name: "Connect" }));
    h.state("connecting");
    h.state("connected");
    await h.user.click(screen.getByRole("button", { name: "Start polling" }));
    expect(h.ipc.callsOf("startPoll")).toEqual([
      [{ slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 }],
    ]);
  });

  it("converts the start address field when the base changes and keeps the protocol address", async () => {
    h = await renderWindow();
    const start = screen.getByLabelText("Start address") as HTMLInputElement;
    await h.user.clear(start);
    await h.user.type(start, "100");
    await h.user.click(screen.getByRole("radio", { name: "1" }));
    expect(start.value).toBe("101");
    expect(screen.getByText("Protocol address 100")).toBeVisible();
    await h.user.click(screen.getByRole("radio", { name: "0" }));
    expect(start.value).toBe("100");
    expect(h.rt.stores.config.getState().poll.startAddress).toBe(100);
  });

  it("shows the range message when start and quantity run past the last address", async () => {
    h = await renderWindow();
    const start = screen.getByLabelText("Start address");
    await h.user.clear(start);
    await h.user.type(start, "65530");
    await h.user.tab();
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "10");
    await h.user.tab();
    expect(
      screen.getByText(
        "This range ends after the last address (65535). The maximum quantity from 65530 is 6.",
      ),
    ).toBeVisible();
  });

  it("Ctrl+P calls stopPoll while polling and startPoll when paused", async () => {
    h = await renderWindow();
    await fillHostAndConnect();
    h.state("polling");
    await h.user.keyboard("{Control>}p{/Control}");
    expect(h.ipc.callsOf("stopPoll")).toHaveLength(1);
    h.state("paused");
    await h.user.keyboard("{Control>}p{/Control}");
    await waitFor(() => expect(h.ipc.callsOf("startPoll")).toHaveLength(1));
  });

  it("Apply while polling restarts the poll with the new definition and the data view is loading", async () => {
    h = await renderWindow();
    await fillHostAndConnect();
    h.state("polling");
    h.emit(() => h.ipc.emitPollUpdate({ values: Array.from({ length: 10 }, (_, i) => i) }));
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "20");
    await h.user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(h.ipc.callsOf("startPoll")).toHaveLength(1));
    expect(h.ipc.callsOf("startPoll")[0]).toEqual([
      { slaveId: 1, function: 3, startAddress: 0, quantity: 20, scanRateMs: 1000 },
    ]);
    h.state("polling");
    expect(screen.getByText("Waiting for first response…")).toBeVisible();
    const grid = screen.getByRole("grid", { name: "Register values" });
    expect(within(grid).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("Apply in paused calls nothing and shows the settings changed text", async () => {
    h = await renderWindow();
    await fillHostAndConnect();
    h.state("polling");
    h.emit(() => h.ipc.emitPollUpdate({ values: Array.from({ length: 10 }, (_, i) => i) }));
    h.state("paused");
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "20");
    await h.user.click(screen.getByRole("button", { name: "Apply" }));
    expect(h.ipc.callsOf("startPoll")).toHaveLength(0);
    expect(
      await screen.findByText(
        "Poll settings changed. Press Resume (Ctrl+P) to read with the new settings.",
      ),
    ).toBeVisible();
  });

  it("Apply when only connected stores the definition", async () => {
    h = await renderWindow();
    await fillHostAndConnect();
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "20");
    await h.user.click(screen.getByRole("button", { name: "Apply" }));
    expect(h.ipc.callsOf("startPoll")).toHaveLength(0);
    expect(h.rt.stores.config.getState().poll.quantity).toBe(20);
    expect(
      screen.getByText(
        "Connected. Press Start polling (Ctrl+P) to read 20 holding registers from slave 1.",
      ),
    ).toBeVisible();
  });

  it("connected with an invalid poll says to fix the settings", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10");
    await h.user.click(screen.getByLabelText("Start polling when connected"));
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "999");
    await h.user.click(screen.getByRole("button", { name: "Connect" }));
    h.state("connecting");
    h.state("connected");
    expect(screen.getByText("Fix the poll settings to start polling.")).toBeVisible();
  });

  it("a loaded profile fills the form", async () => {
    h = await renderWindow();
    h.emit(() =>
      h.rt.stores.config.getState().applyProfile({
        schemaVersion: 1,
        name: "Pump",
        connection: { mode: "tcp", host: "10.0.0.5", port: 1502, timeoutMs: 500 },
        poll: { slaveId: 7, function: 4, startAddress: 9, quantity: 3, scanRateMs: 250 },
        display: { format: "hex", addressBase: 1 },
        autoStartPoll: false,
      }),
    );
    await waitFor(() => expect(host().value).toBe("10.0.0.5"));
    expect(port().value).toBe("1502");
    expect((screen.getByLabelText("Slave ID") as HTMLInputElement).value).toBe("7");
    expect((screen.getByLabelText("Function") as HTMLSelectElement).value).toBe("4");
    expect((screen.getByLabelText("Start address") as HTMLInputElement).value).toBe("10");
    expect(screen.getByLabelText("Start polling when connected")).not.toBeChecked();
    expect(document.title).toContain("Pump");
  });
});
