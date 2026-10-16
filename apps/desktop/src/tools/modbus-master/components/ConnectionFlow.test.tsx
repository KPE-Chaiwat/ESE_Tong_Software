import { screen, waitFor, within } from "@testing-library/react";
import { IpcError } from "@/shared/ipc/modbus-master";
import { badResponseExtra as bad, sessionReason } from "@/shared/ipc/modbus-master.fake";
import { type Harness, renderWindow } from "./test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const host = () => screen.getByLabelText("Host") as HTMLInputElement;
const connectButton = () => screen.getByRole("button", { name: "Connect" });
const banner = () => document.querySelector<HTMLElement>("[data-slot=state-banner]");
const pill = () => document.querySelector<HTMLElement>("[data-slot=status-pill]");

async function typeHostAndConnect(autoStart = false) {
  await h.user.type(host(), "192.168.1.10");
  if (!autoStart) await h.user.click(screen.getByLabelText("Start polling when connected"));
  await h.user.click(connectButton());
}

describe("connect flow (task 10)", () => {
  it("an invalid host sends no connect call, shows the message and focuses the field", async () => {
    h = await renderWindow();
    await h.user.click(connectButton());
    expect(h.ipc.callsOf("connect")).toHaveLength(0);
    expect(screen.getByText("Enter a host name or IPv4 address.")).toBeVisible();
    expect(host()).toHaveFocus();
    expect(screen.getByTestId("attention")).toHaveTextContent("1 field needs attention");
  });

  it("counts every invalid field", async () => {
    h = await renderWindow();
    const port = screen.getByLabelText("Port");
    await h.user.clear(port);
    await h.user.type(port, "0");
    await h.user.click(connectButton());
    expect(screen.getByTestId("attention")).toHaveTextContent("2 fields need attention");
    expect(host()).toHaveFocus();
    await h.user.type(host(), "plc-7");
    await h.user.clear(port);
    await h.user.type(port, "502");
    expect(screen.queryByTestId("attention")).not.toBeInTheDocument();
  });

  it("a valid connection shows the connecting banner with Cancel", async () => {
    h = await renderWindow();
    await typeHostAndConnect();
    await waitFor(() => expect(h.ipc.callsOf("connect")).toHaveLength(1));
    expect(h.ipc.callsOf("connect")[0]).toEqual([
      { mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 },
    ]);
    h.state("connecting");
    expect(
      within(banner() as HTMLElement).getByText("Connecting to 192.168.1.10:502…"),
    ).toBeVisible();
    expect(screen.getAllByText("Connecting to 192.168.1.10:502…")).toHaveLength(2);
    expect(within(banner() as HTMLElement).getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(pill()).toHaveTextContent("Connecting…");
    expect(pill()?.querySelector('[data-icon="loader"]')).toBeInTheDocument();
  });

  it("Cancel while connecting calls cancelConnect and returns to idle", async () => {
    h = await renderWindow();
    await typeHostAndConnect();
    h.state("connecting");
    await h.user.click(within(banner() as HTMLElement).getByRole("button", { name: "Cancel" }));
    expect(h.ipc.callsOf("cancelConnect")).toHaveLength(1);
    h.state("idle");
    expect(pill()).toHaveTextContent("Not connected");
    expect(banner()).toBeNull();
  });

  it("shows the spinner on the Connect button while the command is pending", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10");
    await h.user.click(connectButton());
    expect(connectButton()).toBeDisabled();
    expect(connectButton().querySelector('[data-icon="loader"]')).toBeInTheDocument();
  });

  it("connected without auto start shows the Connected pill and the start text", async () => {
    h = await renderWindow();
    await typeHostAndConnect();
    h.state("connecting");
    h.state("connected");
    expect(pill()).toHaveTextContent("Connected");
    expect(h.ipc.callsOf("startPoll")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Start polling" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Write…" })).toBeVisible();
    expect(
      screen.getByText(
        "Connected. Press Start polling (Ctrl+P) to read 10 holding registers from slave 1.",
      ),
    ).toBeVisible();
  });

  it("connected with auto start begins polling and shows the Polling pill", async () => {
    h = await renderWindow();
    await typeHostAndConnect(true);
    h.state("connecting");
    h.state("connected");
    await waitFor(() => expect(h.ipc.callsOf("startPoll")).toHaveLength(1));
    h.state("polling");
    expect(pill()).toHaveTextContent("Polling");
    expect(pill()?.querySelector('[data-icon="activity"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeVisible();
    expect(banner()).toBeNull();
  });

  it("a refused connection shows Disconnected with the banner, Reconnect and Dismiss", async () => {
    h = await renderWindow();
    await typeHostAndConnect();
    h.state("connecting");
    h.state("disconnected", { reason: sessionReason("refused", "refused") });
    expect(pill()).toHaveTextContent("Disconnected");
    expect(pill()?.querySelector('[data-icon="unplug"]')).toBeInTheDocument();
    const b = banner() as HTMLElement;
    expect(within(b).getByText("Connection refused by 192.168.1.10:502.")).toBeVisible();
    expect(within(b).getByRole("button", { name: "Reconnect" })).toBeVisible();
    expect(within(b).getByRole("button", { name: "Dismiss" })).toBeVisible();
    expect(screen.getByText("Connection lost. Press Reconnect to continue.")).toBeVisible();
  });

  it("Reconnect calls connect again", async () => {
    h = await renderWindow();
    await typeHostAndConnect();
    h.state("connecting");
    h.state("disconnected", { reason: sessionReason("refused", "refused") });
    await h.user.click(within(banner() as HTMLElement).getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(h.ipc.callsOf("connect")).toHaveLength(2));
    h.state("connecting");
    expect(
      within(banner() as HTMLElement).getByText("Connecting to 192.168.1.10:502…"),
    ).toBeVisible();
    expect(screen.getAllByText("Connecting to 192.168.1.10:502…")).toHaveLength(2);
  });

  it("Dismiss clears the banner and shows the idle empty text", async () => {
    h = await renderWindow();
    await typeHostAndConnect();
    h.state("connecting");
    h.state("disconnected", { reason: sessionReason("closedByPeer", "bye") });
    await h.user.click(within(banner() as HTMLElement).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(h.ipc.callsOf("disconnect")).toHaveLength(1));
    h.state("idle");
    expect(banner()).toBeNull();
    expect(pill()).toHaveTextContent("Not connected");
    expect(
      screen.getByText("Not connected. Configure a connection and press Connect (Ctrl+L)."),
    ).toBeVisible();
  });

  it.each([
    ["connectTimeout", "No answer from 192.168.1.10:502 within 1000 ms."],
    ["hostNotFound", 'Host "192.168.1.10" could not be resolved.'],
    ["closedByPeer", "The device at 192.168.1.10:502 closed the connection."],
    ["ioError", "Connection error: broken pipe"],
  ] as const)("shows the banner text for reason %s", async (kind, text) => {
    h = await renderWindow();
    await typeHostAndConnect();
    h.state("connecting");
    h.state("disconnected", { reason: sessionReason(kind, "broken pipe") });
    expect(within(banner() as HTMLElement).getByText(text)).toBeVisible();
  });

  it("announces the disconnected text once in the assertive live region", async () => {
    h = await renderWindow();
    await typeHostAndConnect();
    h.state("connecting");
    expect(screen.getByTestId("live-polite")).toHaveTextContent(
      "Connecting…. Connecting to 192.168.1.10:502…",
    );
    h.state("disconnected", { reason: sessionReason("refused", "refused") });
    const assertive = screen.getByTestId("live-assertive");
    expect(assertive).toHaveTextContent("Disconnected. Connection refused by 192.168.1.10:502.");
    expect(screen.getByTestId("live-polite")).toBeEmptyDOMElement();
    // The same state again does not announce a new message.
    h.state("disconnected", { reason: sessionReason("refused", "refused") });
    expect(assertive).toHaveTextContent("Disconnected. Connection refused by 192.168.1.10:502.");
  });

  it("announces an exception once and not its repeats", async () => {
    h = await renderWindow();
    await typeHostAndConnect(true);
    h.state("connecting");
    h.state("connected");
    h.state("polling");
    h.state("exception", { exceptionCode: 2 });
    const polite = screen.getByTestId("live-polite");
    expect(polite).toHaveTextContent(/^Exception 02\. Exception 02 \(Illegal data address\)/);
    const first = polite.textContent;
    h.state("exception", { exceptionCode: 2 });
    expect(polite.textContent).toBe(first);
  });

  it("Ctrl+L connects when idle and disconnects when connected", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10");
    await h.user.click(screen.getByLabelText("Start polling when connected"));
    await h.user.keyboard("{Control>}l{/Control}");
    await waitFor(() => expect(h.ipc.callsOf("connect")).toHaveLength(1));
    h.state("connecting");
    h.state("connected");
    await h.user.keyboard("{Control>}l{/Control}");
    await waitFor(() => expect(h.ipc.callsOf("disconnect")).toHaveLength(1));
  });

  it("REV-002 M1: a rejected connect is shown as a toast and the button recovers", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.failNext("connect", "Invalid configuration");
      },
    });
    await h.user.type(host(), "192.168.1.10");
    await h.user.click(connectButton());
    expect(await screen.findByText("Invalid configuration")).toBeVisible();
    await waitFor(() => expect(connectButton()).toBeEnabled());
    expect(h.rt.stores.session.getState().commandError).toBeNull();
    expect(document.querySelector("[data-tone=error]")).toBeInTheDocument();
  });

  it("REV-002 M1: a backend validation error with a field shows under that input and focuses it", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.failNext("connect", new IpcError("The host name is not valid.", "validation", "host"));
      },
    });
    await h.user.type(host(), "192.168.1.10");
    await h.user.click(connectButton());
    expect(await screen.findAllByText("The host name is not valid.")).toHaveLength(2);
    expect(host()).toHaveAttribute("aria-invalid", "true");
    expect(host()).toHaveFocus();
  });

  it("REV-002 M1: failures of Start, Pause and Disconnect are shown too", async () => {
    h = await renderWindow();
    await typeHostAndConnect();
    h.state("connecting");
    h.state("connected");
    h.ipc.failNext("startPoll", "Start refused");
    await h.user.click(screen.getByRole("button", { name: "Start polling" }));
    expect(await screen.findByText("Start refused")).toBeVisible();
    h.ipc.failNext("disconnect", new IpcError("Not connected", "invalidState"));
    await h.user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText("Not connected")).toBeVisible();
  });

  it("REV-002 M1: a failed Reset counters is shown", async () => {
    h = await renderWindow();
    h.ipc.failNext("resetCounters", "No session");
    await h.user.click(screen.getByRole("button", { name: "Reset counters" }));
    expect(await screen.findByText("No session")).toBeVisible();
  });

  it("REV-002 M1: 192.168.1 is rejected before anything is sent", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1");
    await h.user.click(connectButton());
    expect(
      screen.getByText("Enter a valid host name or IPv4 address, for example 192.168.1.10."),
    ).toBeVisible();
    expect(h.ipc.callsOf("connect")).toHaveLength(0);
  });

  it("every state keeps both an icon and a text label in the pill", async () => {
    h = await renderWindow();
    await typeHostAndConnect(true);
    const sequence: [
      Parameters<Harness["state"]>[0],
      Parameters<Harness["state"]>[1],
      string,
      string,
    ][] = [
      ["connecting", undefined, "Connecting…", "loader"],
      ["connected", undefined, "Connected", "link"],
      ["polling", undefined, "Polling", "activity"],
      ["timeout", undefined, "Timeout", "timer-off"],
      ["exception", { exceptionCode: 2 }, "Exception 02", "octagon-x"],
      ["badResponse", bad("crc"), "Bad response", "triangle-alert"],
      ["paused", undefined, "Paused", "pause"],
      ["idle", undefined, "Not connected", "plug"],
    ];
    for (const [state, extra, label, icon] of sequence) {
      h.state(state, extra);
      expect(pill()).toHaveTextContent(label);
      expect(pill()?.querySelector(`[data-icon="${icon}"]`)).toBeInTheDocument();
    }
  });

  it("timeout and exception banners use the DES-001 texts", async () => {
    h = await renderWindow();
    await typeHostAndConnect(true);
    h.state("connecting");
    h.state("connected");
    h.state("polling");
    h.state("timeout");
    h.state("timeout");
    expect(banner()).toHaveTextContent(
      "Timeout: slave 1 did not respond within 1000 ms. Retrying every 1000 ms (2 in a row).",
    );
    expect(banner()).toHaveAttribute("data-variant", "warning");
    h.state("exception", { exceptionCode: 2 });
    expect(banner()).toHaveTextContent(
      "Exception 02 (Illegal data address) from slave 1 for FC03 at 0-9. Retrying every 1000 ms (1 in a row).",
    );
    expect(banner()).toHaveAttribute("data-variant", "error");
    h.state("badResponse", bad("crc"));
    expect(banner()).toHaveTextContent(
      "Bad response from slave 1: CRC mismatch. Retrying every 1000 ms (1 in a row).",
    );
  });
});
