import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { sessionReason } from "@/shared/ipc/modbus-master.fake";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow } from "./test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const toolbar = () => screen.getByRole("toolbar", { name: "Toolbar" });
const pill = () => toolbar().querySelector<HTMLElement>('[data-slot="status-pill"]') as HTMLElement;
const chip = () => screen.queryByTestId("summary-chip");
const banner = () => document.querySelector<HTMLElement>("[data-slot=state-banner]");
const host = () => screen.getByLabelText("Host") as HTMLInputElement;
const status = () => screen.getByTestId("status-text");
const key = (k: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) =>
  act(() => {
    fireEvent.keyDown(window, {
      key: k,
      ctrlKey: mods.ctrl,
      shiftKey: mods.shift,
      altKey: mods.alt,
    });
  });

async function connectViaToolbar() {
  await h.user.type(host(), "192.168.1.10");
  await h.user.click(within(toolbar()).getByRole("button", { name: "Connect" }));
}

describe("the window shell (DES-002 2.2)", () => {
  it("renders the regions of W1 in the initial state (CHK2-A1)", async () => {
    h = await renderWindow();
    expect(toolbar()).toBeVisible();
    expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Workspace" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Traffic" })).toBeVisible();
    expect(screen.getByRole("contentinfo")).toBeVisible();
    expect(pill()).toHaveTextContent("Not connected");
    expect(pill().querySelector('[data-icon="plug"]')).toBeInTheDocument();
    expect(chip()).toBeNull();
    expect(screen.getByRole("heading", { name: "Polls · 0 of 16" })).toBeVisible();
    expect(document.title).toBe("Modbus Master - Untitled - Not connected");
    await waitFor(() => expect(h.win.titles.at(-1)).toBe(document.title));
    expect(screen.getByTestId("profile")).toHaveTextContent("Untitled");
  });

  it("shows the app version at the right end of the status bar", async () => {
    h = await renderWindow();
    expect(await screen.findByTestId("app-version")).toHaveTextContent(
      `ESEfact v${h.win.appInfo.version}`,
    );
    expect(screen.getByRole("contentinfo")).toContainElement(screen.getByTestId("app-version"));
  });

  it("the toolbar places the sidebar toggle immediately before New poll", async () => {
    h = await renderWindow();
    expect(
      within(toolbar())
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim()),
    ).toEqual(["File", "Connection", "Hide sidebar", "New poll", "Window", "Connect"]);
  });

  it("the File menu: Open, Save and Save as work, so do New window and Close window", async () => {
    h = await renderWindow();
    await h.user.click(screen.getByRole("button", { name: "File" }));
    for (const name of [/^Open profile/, /^SaveCtrl\+S/, /^Save as/]) {
      const item = screen.getByRole("menuitem", { name });
      expect(item).not.toHaveAttribute("aria-disabled", "true");
    }
    expect(screen.getByRole("menuitem", { name: /^Open profile/ })).toHaveTextContent("Ctrl+O");
    expect(screen.getByRole("menuitem", { name: /^Save as/ })).toHaveTextContent("Ctrl+Shift+S");
    await h.user.click(screen.getByRole("menuitem", { name: /^New connection window/ }));
    expect(h.win.openedTools).toEqual(["modbus-master"]);
    await h.user.click(screen.getByRole("button", { name: "File" }));
    await h.user.click(screen.getByRole("menuitem", { name: /^Close window/ }));
    await waitFor(() => expect(h.win.closed).toBe(true));
  });

  it("Ctrl+N opens a new connection window", async () => {
    h = await renderWindow();
    key("n", { ctrl: true });
    await waitFor(() => expect(h.win.openedTools).toEqual(["modbus-master"]));
  });
});

describe("connection states (DES-002 1.5)", () => {
  it("connect: the pill reads Connected with the target; the CONNECTION section collapses", async () => {
    h = await renderWindow();
    await connectViaToolbar();
    expect(h.ipc.callsOf("connect")[0]).toEqual([
      { mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 },
    ]);
    await waitFor(() => expect(pill()).toHaveTextContent("Connected · 192.168.1.10:502"));
    expect(pill().querySelector('[data-icon="link"]')).toBeInTheDocument();
    expect(within(toolbar()).getByRole("button", { name: "Disconnect" })).toBeVisible();
    // The section shows one summary line with Edit (CHK2-A3).
    expect(screen.getByTestId("connection-summary")).toHaveTextContent(
      "TCP 192.168.1.10:502 · timeout 1000 ms",
    );
    expect(host()).toHaveAttribute("readonly");
    expect(screen.getByText("Disconnect to change connection settings.")).toBeInTheDocument();
    expect(status()).toHaveTextContent("TCP 192.168.1.10:502 · 0 polls");
  });

  it("Edit expands the section and focuses the first field", async () => {
    h = await renderWindow();
    await connectViaToolbar();
    await waitFor(() => expect(screen.getByTestId("connection-summary")).toBeVisible());
    await h.user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByTestId("connection-summary")).not.toBeInTheDocument();
    await waitFor(() => expect(host()).toHaveFocus());
  });

  it("the Connection menu > Edit connection settings does the same", async () => {
    h = await renderWindow();
    await h.user.click(screen.getByRole("button", { name: "Collapse connection settings" }));
    expect(screen.getByTestId("connection-summary")).toBeVisible();
    await h.user.click(screen.getByRole("button", { name: "Connection" }));
    await h.user.click(screen.getByRole("menuitem", { name: /^Edit connection settings/ }));
    await waitFor(() => expect(host()).toHaveFocus());
  });

  it("connecting shows the banner with Cancel, and every pill and status text follows", async () => {
    h = await renderWindow({ mode: "manual" });
    await connectViaToolbar();
    h.ipc.emitConnectionState("connecting");
    await waitFor(() => expect(pill()).toHaveTextContent("Connecting…"));
    const b = banner() as HTMLElement;
    expect(b).toHaveTextContent("Connecting to 192.168.1.10:502…");
    expect(within(b).getByRole("button", { name: "Cancel" })).toBeVisible();
    await h.user.click(within(b).getByRole("button", { name: "Cancel" }));
    expect(h.ipc.callsOf("cancelConnect")).toHaveLength(1);
    h.ipc.emitConnectionState("idle");
    await waitFor(() => expect(banner()).toBeNull());
    expect(pill()).toHaveTextContent("Not connected");
  });

  it("a refused connect: Disconnected with Reconnect and Dismiss, and the section is expanded again", async () => {
    h = await renderWindow();
    h.ipc.scriptConnectFailure(sessionReason("refused"));
    await connectViaToolbar();
    await waitFor(() => expect(pill()).toHaveTextContent("Disconnected"));
    expect(pill().querySelector('[data-icon="unplug"]')).toBeInTheDocument();
    const b = banner() as HTMLElement;
    expect(within(b).getByText("Connection refused by 192.168.1.10:502.")).toBeVisible();
    expect(within(b).getByRole("button", { name: "Reconnect" })).toBeVisible();
    expect(within(b).getByRole("button", { name: "Dismiss" })).toBeVisible();
    expect(host()).toBeVisible();
    expect(screen.queryByTestId("connection-summary")).not.toBeInTheDocument();
    await h.user.click(within(b).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(pill()).toHaveTextContent("Not connected"));
    expect(banner()).toBeNull();
  });

  it("Reconnect connects again", async () => {
    h = await renderWindow();
    h.ipc.scriptConnectFailure(sessionReason("refused"));
    await connectViaToolbar();
    await waitFor(() => expect(banner()).not.toBeNull());
    await h.user.click(within(banner() as HTMLElement).getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(h.ipc.callsOf("connect")).toHaveLength(2));
    await waitFor(() => expect(pill()).toHaveTextContent("Connected"));
  });

  it("an invalid host sends nothing, shows the message and focuses the field", async () => {
    h = await renderWindow();
    await h.user.click(within(toolbar()).getByRole("button", { name: "Connect" }));
    expect(h.ipc.callsOf("connect")).toHaveLength(0);
    expect(screen.getByText("Enter a host name or IPv4 address.")).toBeVisible();
    await waitFor(() => expect(host()).toHaveFocus());
    expect(screen.getByTestId("attention")).toHaveTextContent("1 field needs attention");
  });

  it("Enter in a connection field connects", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10{Enter}");
    await waitFor(() => expect(h.ipc.callsOf("connect")).toHaveLength(1));
  });

  it("Ctrl+L connects, then disconnects", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10");
    key("l", { ctrl: true });
    await waitFor(() => expect(pill()).toHaveTextContent("Connected"));
    key("l", { ctrl: true });
    await waitFor(() => expect(h.ipc.callsOf("disconnect")).toHaveLength(1));
  });

  it("a link lost while connected: Disconnected and the polls are offline (CHK2-A5)", async () => {
    h = await renderWindow();
    await h.addPoll("A");
    await h.connect();
    h.advance(300);
    await h.act(() => h.ipc.dropLink(sessionReason("closedByPeer", "bye", "linkLost")));
    expect(pill()).toHaveTextContent("Disconnected");
    expect(chip()).toBeNull();
    expect(screen.getByRole("listitem", { name: /A, Offline/ })).toBeVisible();
  });

  it("the live region announces each connection transition once, the lost link assertively", async () => {
    h = await renderWindow({ mode: "manual" });
    await connectViaToolbar();
    h.ipc.emitConnectionState("connecting");
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "Connecting…. Connecting to 192.168.1.10:502…",
      ),
    );
    h.ipc.emitConnectionState("connected");
    await waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent("Connected"));
    h.ipc.emitConnectionState("disconnected", { reason: sessionReason("closedByPeer") });
    await waitFor(() =>
      expect(screen.getByTestId("live-assertive")).toHaveTextContent(
        "Disconnected. The device at 192.168.1.10:502 closed the connection.",
      ),
    );
  });
});

describe("summary chip, pause and the title (DES-002 1.5, 2.2.1, 2.12)", () => {
  async function eight() {
    h = await renderWindow();
    const ids: PollId[] = [];
    for (let i = 1; i <= 4; i += 1) ids.push(await h.addPoll(`Poll ${i}`));
    await h.connect();
    h.advance(300);
    return ids;
  }

  it("all live: success chip 'N live'; with a timeout and an exception the worst state leads", async () => {
    const ids = await eight();
    expect(chip()).toHaveTextContent("4 live");
    expect(chip()?.querySelector('[data-icon="activity"]')).toBeInTheDocument();
    await h.act(() => h.ipc.emitPollState(ids[0] as PollId, "timeout", { consecutiveFailures: 1 }));
    expect(chip()).toHaveTextContent("1 timeout · 3 live");
    expect(chip()?.querySelector('[data-icon="timer-off"]')).toBeInTheDocument();
    await h.act(() =>
      h.ipc.emitPollState(ids[1] as PollId, "exception", {
        exceptionCode: 2,
        consecutiveFailures: 1,
      }),
    );
    expect(chip()).toHaveTextContent("1 exception · 1 timeout · 2 live");
    expect(chip()?.querySelector('[data-icon="octagon-x"]')).toBeInTheDocument();
    // The title carries the same summary.
    expect(document.title).toBe(
      "Modbus Master - Untitled * - Connected (1 exception · 1 timeout · 2 live)",
    );
    // A poll failure never changes the connection pill, and there is no connection banner.
    expect(pill()).toHaveTextContent("Connected");
    expect(banner()).toBeNull();
  });

  it("the chip is hidden while not connected", async () => {
    h = await renderWindow();
    await h.addPoll("A");
    expect(chip()).toBeNull();
  });

  it("Pause all pauses every running poll; the button turns into Resume all", async () => {
    await eight();
    await h.user.click(within(toolbar()).getByRole("button", { name: "Pause all" }));
    expect(h.ipc.callsOf("setAllPollsActive")).toEqual([[false]]);
    await waitFor(() => expect(chip()).toHaveTextContent("4 paused"));
    expect(chip()?.querySelector('[data-icon="pause"]')).toBeInTheDocument();
    await h.user.click(within(toolbar()).getByRole("button", { name: "Resume all" }));
    expect(h.ipc.callsOf("setAllPollsActive")).toEqual([[false], [true]]);
  });

  it("Ctrl+Shift+P does the same", async () => {
    await eight();
    key("P", { ctrl: true, shift: true });
    await waitFor(() => expect(h.ipc.callsOf("setAllPollsActive")).toEqual([[false]]));
  });

  it("below 1100 px the profile label is hidden and the chip is short with the full text as its name", async () => {
    const ids = await eight();
    await h.act(() => h.ipc.emitPollState(ids[0] as PollId, "timeout", { consecutiveFailures: 1 }));
    expect(screen.getByTestId("profile")).toBeVisible();
    await h.act(async () => {
      window.innerWidth = 900;
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.queryByTestId("profile")).not.toBeInTheDocument();
    expect(chip()).toHaveTextContent("1 timeout +3");
    // The full text is the accessible name; the short text is hidden from assistive technology.
    expect(chip()?.querySelector(".sr-only")).toHaveTextContent("1 timeout · 3 live");
    expect(chip()?.querySelector('[aria-hidden="true"]:not(svg)')).toHaveTextContent(
      "1 timeout +3",
    );
    await h.act(async () => {
      window.innerWidth = 1280;
      window.dispatchEvent(new Event("resize"));
    });
  });

  it("the Connection menu: Start polling when connected is a checkbox that follows the setting", async () => {
    h = await renderWindow();
    await h.user.click(screen.getByRole("button", { name: "Connection" }));
    const item = screen.getByRole("menuitemcheckbox", { name: /^Start polling when connected/ });
    expect(item).toHaveAttribute("aria-checked", "true");
    await h.user.click(item);
    expect(h.ipc.callsOf("setAutoStartPoll")).toEqual([[false]]);
    expect(h.rt.stores.connection.getState().autoStartPoll).toBe(false);
  });

  it("the sidebar checkbox sets 'Start polling when connected' too", async () => {
    h = await renderWindow();
    await h.user.click(screen.getByLabelText("Start polling when connected"));
    expect(h.ipc.callsOf("setAutoStartPoll")).toEqual([[false]]);
  });

  it("Connection menu > Reset all counters and Show traffic", async () => {
    h = await renderWindow();
    await h.user.click(screen.getByRole("button", { name: "Connection" }));
    await h.user.click(screen.getByRole("menuitem", { name: /^Reset all counters/ }));
    expect(h.ipc.callsOf("resetCounters")).toEqual([[null]]);
    await h.user.click(screen.getByRole("button", { name: "Connection" }));
    await h.user.click(screen.getByRole("menuitem", { name: /^Show traffic/ }));
    expect(screen.getByRole("region", { name: "Communication Traffic" })).toBeVisible();
  });

  it("the Connection menu offers Dismiss only while disconnected", async () => {
    h = await renderWindow();
    await h.user.click(screen.getByRole("button", { name: "Connection" }));
    expect(screen.queryByRole("menuitem", { name: /^Dismiss/ })).not.toBeInTheDocument();
  });
});

describe("New poll (DES-002 2.2.1)", () => {
  it("is disabled at 16 polls with the exact title, and Ctrl+Shift+N shows the toast", async () => {
    h = await renderWindow();
    for (let i = 1; i <= 16; i += 1) await h.addPoll(`P${i}`);
    const button = within(toolbar()).getByRole("button", { name: "New poll" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "A connection can have at most 16 polls.");
    key("N", { ctrl: true, shift: true });
    expect(await screen.findByText("A connection can have at most 16 polls.")).toBeVisible();
    expect(h.ipc.pollIds()).toHaveLength(16);
    expect(screen.getByRole("heading", { name: "Polls · 16 of 16" })).toBeVisible();
  });
});

describe("status bar (DES-002 2.2.6)", () => {
  it("counts the polls and the ones in their own windows", async () => {
    h = await renderWindow();
    expect(status()).toHaveTextContent("Not connected · 0 polls");
    await h.addPoll("A");
    expect(status()).toHaveTextContent("Not connected · 1 poll");
    await h.addPoll("B", {}, "native");
    expect(status()).toHaveTextContent("Not connected · 2 polls · 1 in its own window");
    await h.addPoll("C", {}, "native");
    expect(status()).toHaveTextContent("Not connected · 3 polls · 2 in their own windows");
  });
});

describe("traffic bar and panel (DES-002 2.2.5)", () => {
  const bar = () => screen.getByTestId("traffic-bar");

  it("the collapsed bar shows the counters and the link load", async () => {
    h = await renderWindow();
    h.ipc.emitCounters({
      total: { requests: 1204, responses: 1198, errors: 2, timeouts: 4 },
      linkLoadPct: 72,
    });
    await waitFor(() =>
      expect(bar()).toHaveTextContent(
        "Requests 1204 · Responses 1198 · Errors 2 · Timeouts 4 · link load 72%",
      ),
    );
    expect(bar().querySelector('[data-icon="gauge"]')).not.toBeInTheDocument();
  });

  it("at 90% or more it says the polls are slowed down and shows the gauge", async () => {
    h = await renderWindow();
    h.ipc.emitCounters({ linkLoadPct: 92 });
    await waitFor(() => expect(bar()).toHaveTextContent("link load 92% - polls are slowed down"));
    expect(bar().querySelector('[data-icon="gauge"]')).toBeInTheDocument();
  });

  it("Expand opens the panel, Collapse and Ctrl+J close it; the state is reported", async () => {
    h = await renderWindow();
    await h.user.click(screen.getByRole("button", { name: "Expand traffic panel" }));
    expect(screen.getByRole("region", { name: "Communication Traffic" })).toBeVisible();
    expect(h.ipc.callsOf("setWorkspaceLayout").at(-1)?.[0]).toMatchObject({
      trafficExpanded: true,
    });
    key("j", { ctrl: true });
    expect(screen.queryByRole("region", { name: "Communication Traffic" })).not.toBeInTheDocument();
    key("j", { ctrl: true });
    expect(screen.getByRole("region", { name: "Communication Traffic" })).toBeVisible();
  });

  it("the splitter works with the keyboard (16 px) and resets on double click", async () => {
    h = await renderWindow();
    h.rt.stores.workspace.getState().setTrafficExpanded(true);
    const splitter = await screen.findByRole("separator", { name: "Resize traffic panel" });
    const before = Number(splitter.getAttribute("aria-valuenow"));
    splitter.focus();
    await h.user.keyboard("{ArrowUp}");
    expect(Number(splitter.getAttribute("aria-valuenow"))).toBe(before + 16);
    await h.user.keyboard("{ArrowDown}{ArrowDown}");
    expect(Number(splitter.getAttribute("aria-valuenow"))).toBe(before - 16);
    await h.user.dblClick(splitter);
    expect(h.rt.stores.workspace.getState().traffic.height).toBeNull();
  });

  it("Ctrl+Shift+K clears the log", async () => {
    h = await renderWindow();
    h.ipc.emitFrames([
      {
        seq: 1,
        at: 1,
        direction: "tx",
        bytes: [1],
        slaveId: 1,
        function: 3,
        exceptionCode: null,
        note: null,
        origin: null,
      },
    ]);
    expect(h.rt.stores.traffic.getState().frames.size).toBe(1);
    key("K", { ctrl: true, shift: true });
    expect(h.rt.stores.traffic.getState().frames.size).toBe(0);
  });

  it("Show traffic for this poll in the ⋯ menu expands the panel with that filter", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    const frame = document.querySelector(`[data-subwindow="${a}"]`) as HTMLElement;
    await h.user.click(within(frame).getByRole("button", { name: "Poll actions" }));
    await h.user.click(screen.getByRole("menuitem", { name: /^Show traffic for this poll/ }));
    const select = screen.getByRole("combobox", { name: "Traffic filter" }) as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toBe("Pump 2");
  });

  it("deleting the filtered poll switches the filter back to All polls", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    h.rt.actions.showTrafficFor(a);
    await h.act(() => h.ipc.removePoll(a));
    expect(h.rt.stores.traffic.getState().filter).toEqual({ kind: "all" });
  });
});

describe("regions and keys (DES-002 9)", () => {
  it("F6 and Shift+F6 cycle toolbar, sidebar, workspace and traffic", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    within(toolbar()).getByRole("button", { name: "File" }).focus();
    const focusedRegion = () =>
      document.activeElement?.closest<HTMLElement>("[data-region]")?.dataset.region;
    key("F6");
    expect(focusedRegion()).toBe("sidebar");
    key("F6");
    expect(focusedRegion()).toBe("workspace");
    expect(
      document.activeElement?.closest("[data-subwindow]")?.getAttribute("data-subwindow"),
    ).toBe(String(a));
    key("F6");
    expect(focusedRegion()).toBe("traffic");
    key("F6");
    expect(focusedRegion()).toBe("toolbar");
    key("F6", { shift: true });
    expect(focusedRegion()).toBe("traffic");
  });

  it("F6 goes through the minimized bar when it is shown", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    await h.addPoll("B");
    await h.act(() => h.rt.stores.workspace.getState().minimize(a));
    (document.querySelector('[data-region="workspace"] [data-subwindow]') as HTMLElement | null)
      ?.querySelector<HTMLElement>('[data-slot="title-bar"]')
      ?.focus();
    key("F6");
    expect(document.activeElement?.closest<HTMLElement>("[data-region]")?.dataset.region).toBe(
      "minimized",
    );
  });

  it("the browser defaults Ctrl+P, Ctrl+S, Ctrl+O, Ctrl+R and F5 are prevented", async () => {
    h = await renderWindow();
    for (const k of ["p", "s", "o", "r"]) {
      expect(fireEvent.keyDown(window, { key: k, ctrlKey: true }), `Ctrl+${k}`).toBe(false);
    }
    expect(fireEvent.keyDown(window, { key: "F5" })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true })).toBe(false);
  });

  it("Ctrl+P pauses or resumes the selected poll of the sidebar", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    await h.connect();
    h.advance(300);
    await h.user.click(screen.getByRole("listitem", { name: /^A,/ }));
    key("p", { ctrl: true });
    await waitFor(() => expect(h.ipc.callsOf("setPollActive")).toEqual([[a, false]]));
  });

  it("Ctrl+\\ with the focus outside a sub-window collapses the sidebar to the rail", async () => {
    h = await renderWindow();
    await h.addPoll("A");
    key("\\", { ctrl: true });
    expect(screen.getByRole("navigation", { name: "Polls (rail)" })).toBeVisible();
    const aside = () => document.querySelector<HTMLElement>('[data-slot="sidebar"]') as HTMLElement;
    expect(aside().hidden).toBe(true);
    await h.user.click(
      within(screen.getByRole("navigation", { name: "Polls (rail)" })).getByRole("button", {
        name: "Show sidebar",
      }),
    );
    expect(aside().hidden).toBe(false);
    expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Polls (rail)" })).not.toBeInTheDocument();
  });

  it("Ctrl+\\ with the focus in a sub-window toggles that window's setup", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const frame = document.querySelector(`[data-subwindow="${a}"]`) as HTMLElement;
    (frame.querySelector('[data-slot="title-bar"]') as HTMLElement).focus();
    key("\\", { ctrl: true });
    expect(h.rt.views.get(a).stores.ui.getState().setupOpen).toBe(true);
  });
});

describe("compact mode (DES-002 2.9)", () => {
  it("Ctrl+Shift+\\ turns the sidebar into a rail with one state icon per poll; Show sidebar peeks", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Tank 1");
    await h.addPoll("Pump 2");
    key("|", { ctrl: true, shift: true });
    await waitFor(() => expect(h.ipc.compact).toBe(true));
    const rail = await screen.findByRole("navigation", { name: "Polls (rail)" });
    const icons = within(rail).getAllByRole("button", { name: /: Offline$/ });
    expect(icons.map((i) => i.getAttribute("aria-label"))).toEqual([
      "Tank 1: Offline",
      "Pump 2: Offline",
    ]);
    expect(icons[0]?.querySelector('[data-icon="wifi-off"]')).toBeInTheDocument();
    await h.user.click(within(rail).getByRole("button", { name: "Show sidebar" }));
    expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeVisible();
    // Toggling compact mode ends the peek.
    key("|", { ctrl: true, shift: true });
    await waitFor(() => expect(h.ipc.compact).toBe(false));
    expect(screen.queryByRole("navigation", { name: "Polls (rail)" })).not.toBeInTheDocument();
    expect(a).toBeGreaterThan(0);
  });

  it("clicking a rail icon shows that poll", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Tank 1");
    await h.addPoll("Pump 2");
    await h.ipc.setCompactMode(true);
    await h.act(async () => {});
    await h.user.click(screen.getByRole("button", { name: "Tank 1: Offline" }));
    const frame = document.querySelector(`[data-subwindow="${a}"]`) as HTMLElement;
    expect(frame).toHaveAttribute("aria-current", "true");
  });

  it("compact mode closes the setup of every sub-window; the gear of one opens only its own", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const b = await h.addPoll("B");
    const gear = (id: PollId) =>
      within(document.querySelector(`[data-subwindow="${id}"]`) as HTMLElement).getByRole(
        "button",
        {
          name: "Poll setup (Ctrl+\\)",
        },
      );
    await h.user.click(gear(a));
    await h.user.click(gear(b));
    await h.act(() => h.ipc.setCompactMode(true));
    expect(gear(a)).toHaveAttribute("aria-pressed", "false");
    expect(gear(b)).toHaveAttribute("aria-pressed", "false");
    await h.user.click(gear(a));
    expect(gear(a)).toHaveAttribute("aria-pressed", "true");
    expect(gear(b)).toHaveAttribute("aria-pressed", "false");
    await h.act(() => h.ipc.setCompactMode(false));
    // Both return to what they were before: A and B were open.
    expect(gear(b)).toHaveAttribute("aria-pressed", "true");
  });
});

describe("poll failures are announced by W1, not by the sub-windows (DES-002 1.5 rule 5)", () => {
  it("a single failure later is announced once as '{name}: Timeout.'", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      h = await renderWindow();
      const a = await h.addPoll("Pump 2");
      await h.connect();
      h.advance(300);
      await h.act(() => h.ipc.emitPollState(a, "timeout", { consecutiveFailures: 1 }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      expect(screen.getByTestId("live-polite")).toHaveTextContent("Pump 2: Timeout.");
      const frame = document.querySelector(`[data-subwindow="${a}"]`) as HTMLElement;
      expect(frame.querySelector("[aria-live]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
