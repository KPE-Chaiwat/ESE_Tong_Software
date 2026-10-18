import { act, screen, waitFor } from "@testing-library/react";
import { IpcError } from "@/shared/ipc/errors";
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

describe("connection form (DES-001 3.1, DES-002 2.2.2)", () => {
  it("starts with the DES-001 defaults", async () => {
    h = await renderWindow();
    expect(host().value).toBe("");
    expect(port().value).toBe("502");
    expect((screen.getByLabelText("Timeout (ms)") as HTMLInputElement).value).toBe("1000");
    expect(screen.getByRole("radio", { name: "TCP" })).toBeChecked();
    expect(screen.getByLabelText("Start polling when connected")).toBeChecked();
  });

  it("has the CONNECTION header with a collapse button, and no setup of the poll", async () => {
    h = await renderWindow();
    expect(screen.getByRole("heading", { name: "Connection" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Collapse connection settings" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.queryByLabelText("Slave ID")).not.toBeInTheDocument();
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

  it("a three-part number is not a host (REV-002 M1, the backend rejects it)", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1");
    await h.user.tab();
    expect(host()).toHaveAttribute("aria-invalid", "true");
  });

  it("counts every invalid field", async () => {
    h = await renderWindow();
    await h.user.clear(port());
    await h.user.type(port(), "0");
    await h.user.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByTestId("attention")).toHaveTextContent("2 fields need attention");
    await waitFor(() => expect(host()).toHaveFocus());
    await h.user.type(host(), "plc-7");
    await h.user.clear(port());
    await h.user.type(port(), "502");
    expect(screen.queryByTestId("attention")).not.toBeInTheDocument();
  });

  it("the backend's field message (a validation error on host) shows under the field", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10");
    h.ipc.failNext("connect", new IpcError("Host not accepted.", "validation", "host"));
    await h.user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findAllByText("Host not accepted.")).not.toHaveLength(0);
    expect(host()).toHaveAttribute("aria-invalid", "true");
  });
});

describe("RTU (DES-001 3.1)", () => {
  it("shows the serial settings with the defaults 9600 8 Even 1", async () => {
    h = await renderWindow();
    await selectRtu();
    expect((screen.getByLabelText("Baud") as HTMLSelectElement).value).toBe("9600");
    expect((screen.getByLabelText("Data bits") as HTMLSelectElement).value).toBe("8");
    expect((screen.getByLabelText("Parity") as HTMLSelectElement).value).toBe("even");
    expect((screen.getByLabelText("Stop bits") as HTMLSelectElement).value).toBe("1");
    expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Timeout (ms)")).toBeInTheDocument();
  });

  it("warns about 7 data bits and about parity None with 1 stop bit, without blocking", async () => {
    h = await renderWindow();
    await selectRtu();
    await h.user.selectOptions(screen.getByLabelText("Data bits"), "7");
    expect(
      screen.getByText("Modbus RTU uses 8 data bits. 7 may not work with most devices."),
    ).toBeVisible();
    await h.user.selectOptions(screen.getByLabelText("Data bits"), "8");
    expect(screen.queryByText(/Modbus RTU uses 8 data bits/)).not.toBeInTheDocument();
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

  it("shows Loading ports… while the list is read, and the empty list message", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.hold("listSerialPorts");
      },
    });
    await selectRtu();
    expect(await screen.findByRole("option", { name: "Loading ports…" })).toBeInTheDocument();
    expect(screen.getByLabelText("Serial port")).toBeDisabled();
  });

  it("says when there are no serial ports", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.ports = [];
      },
    });
    await selectRtu();
    expect(
      await screen.findByText("No serial ports found. Connect a device and press Refresh."),
    ).toBeVisible();
  });

  it("Refresh keeps the selected port: the select shows what Connect sends (REV-002 M4)", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.ports = [
          { name: "COM1", description: null },
          { name: "COM3", description: null },
        ];
      },
    });
    await selectRtu();
    await screen.findByRole("option", { name: "COM3" });
    await h.user.selectOptions(screen.getByLabelText("Serial port"), "COM3");
    await h.user.click(screen.getByRole("button", { name: "Refresh serial ports" }));
    await waitFor(() => expect(h.ipc.callsOf("listSerialPorts")).toHaveLength(2));
    expect((screen.getByLabelText("Serial port") as HTMLSelectElement).value).toBe("COM3");
    await h.user.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(h.ipc.callsOf("connect")).toHaveLength(1));
    expect(h.ipc.callsOf("connect")[0]?.[0]).toMatchObject({ mode: "rtu", port: "COM3" });
  });

  it("a value that is not in the list stays selectable as '(not supported)'", async () => {
    h = await renderWindow();
    await h.act(() =>
      h.rt.form.current.adopt({
        mode: "rtu",
        port: "COM3",
        baud: 250000,
        dataBits: 8,
        parity: "even",
        stopBits: 1,
        timeoutMs: 1000,
      }),
    );
    expect((screen.getByLabelText("Baud") as HTMLSelectElement).value).toBe("250000");
    expect(screen.getByRole("option", { name: "250000 (not supported)" })).toBeInTheDocument();
  });
});

describe("collapsing and read-only (DES-002 2.2.2)", () => {
  it("the fields are read-only while connected, with the hint, and Mode is disabled", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10");
    await h.user.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(h.rt.stores.connection.getState().state).toBe("connected"));
    await h.user.click(screen.getByRole("button", { name: "Edit" }));
    expect(host()).toHaveAttribute("readonly");
    expect(port()).toHaveAttribute("readonly");
    expect(screen.getByRole("radiogroup", { name: "Mode", hidden: true })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByText("Disconnect to change connection settings.")).toBeVisible();
  });

  it("the chevron collapses to the summary line and expands again, keeping what was typed", async () => {
    h = await renderWindow();
    await h.user.type(host(), "plc-7");
    await h.user.click(screen.getByRole("button", { name: "Collapse connection settings" }));
    expect(screen.getByTestId("connection-summary")).toHaveTextContent(
      "TCP plc-7:502 · timeout 1000 ms",
    );
    await h.user.click(screen.getByRole("button", { name: "Expand connection settings" }));
    expect(host().value).toBe("plc-7");
  });

  it("a connection Rust has after a reload fills the form", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        void ipc.openSession(() => {});
        void ipc.connect({ mode: "tcp", host: "10.0.0.5", port: 1502, timeoutMs: 750 });
      },
    });
    await act(async () => {});
    await h.user.click(screen.getByRole("button", { name: "Edit" }));
    expect(host().value).toBe("10.0.0.5");
    expect(port().value).toBe("1502");
    expect((screen.getByLabelText("Timeout (ms)") as HTMLInputElement).value).toBe("750");
  });
});
