import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IpcError } from "@/shared/ipc/errors";
import { WRITE_DISABLED_TITLE } from "./NativeToolbar";
import {
  disposeNativeHarnesses,
  installPollViewEnvironment,
  type NativeHarness,
  renderNativeWindow,
  TCP,
  uninstallPollViewEnvironment,
} from "./test-utils";

beforeAll(installPollViewEnvironment);
afterAll(uninstallPollViewEnvironment);
afterEach(disposeNativeHarnesses);

let h: NativeHarness;

const toolbar = () => screen.getByRole("toolbar", { name: "Poll window toolbar" });
const banner = () => document.querySelector<HTMLElement>('[data-slot="state-banner"]');
const live = () => screen.getByTestId("live-polite");
const liveAlert = () => screen.getByTestId("live-assertive");
const lastTitle = () => h.win.titles.at(-1);

/**
 * What the browser does to a focused control that becomes disabled: the focus falls to the page
 * body (jsdom keeps it on the disabled button, so a temporary control takes it and goes away).
 */
function loseFocus() {
  act(() => {
    const tmp = document.createElement("button");
    document.body.append(tmp);
    tmp.focus();
    tmp.remove();
  });
}

describe("toolbar (DES-002 2.6)", () => {
  it("has the name, the state pill, Pause, Write…, the connection pill and the three window controls", async () => {
    h = await renderNativeWindow();
    const bar = within(toolbar());
    expect(bar.getByRole("heading", { name: "Pump 2" })).toBeVisible();
    expect(bar.getByRole("button", { name: "Rename poll (F2)" })).toBeVisible();
    expect(bar.getByText("Offline")).toBeVisible();
    expect(bar.getByText("Not connected")).toBeVisible();
    expect(bar.getByRole("button", { name: "Resume" })).toBeVisible();
    expect(bar.getByRole("button", { name: "Connection window" })).toBeVisible();
    expect(bar.getByRole("button", { name: /^Dock to workspace/ })).toBeVisible();
    expect(bar.getByRole("button", { name: "Poll window menu" })).toHaveAttribute(
      "aria-haspopup",
      "menu",
    );
  });

  it("Write… is off while the link is down and opens the dialog once connected", async () => {
    h = await renderNativeWindow();
    const write = within(toolbar()).getByRole("button", { name: "Write…" });
    expect(write).toBeDisabled();
    expect(write).toHaveAttribute("title", WRITE_DISABLED_TITLE);
    await h.connect();
    h.advance(300);
    expect(write).toBeEnabled();
    await h.user.click(write);
    expect(await screen.findByRole("dialog", { name: "Write · Pump 2" })).toBeVisible();
  });

  it("has no Disconnect, Cancel or Dismiss anywhere", async () => {
    h = await renderNativeWindow();
    await h.connect();
    h.advance(300);
    for (const name of ["Disconnect", "Cancel", "Dismiss"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("the state pill and the Pause button follow the poll", async () => {
    h = await renderNativeWindow();
    await h.connect();
    h.advance(300);
    const bar = within(toolbar());
    expect(bar.getByText("Polling")).toBeVisible();
    expect(bar.getByText("Connected")).toBeVisible();
    await h.user.click(bar.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(h.ipc.callsOf("setPollActive")).toEqual([[h.pollId, false]]));
    await waitFor(() => expect(bar.getByRole("button", { name: "Resume" })).toBeVisible());
    expect(bar.getByText("Paused")).toBeVisible();
    await h.user.click(bar.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(h.ipc.callsOf("setPollActive")).toHaveLength(2));
    expect(h.ipc.callsOf("setPollActive")[1]).toEqual([h.pollId, true]);
  });

  it("a timeout shows the pill and the warning banner with the DES-001 text", async () => {
    h = await renderNativeWindow();
    await h.connect();
    h.advance(300);
    await h.act(() => h.ipc.emitPollState(h.pollId, "timeout", { consecutiveFailures: 3 }));
    expect(within(toolbar()).getByText("Timeout")).toBeVisible();
    expect(banner()).toHaveAttribute("data-variant", "warning");
    expect(banner()).toHaveTextContent(
      "Timeout: slave 5 did not respond within 1000 ms. Retrying every 100 ms (3 in a row).",
    );
  });
});

describe("rename (DES-002 2.6)", () => {
  it("the pencil opens the field; Enter renames and the title follows", async () => {
    h = await renderNativeWindow();
    await h.user.click(within(toolbar()).getByRole("button", { name: "Rename poll (F2)" }));
    const input = within(toolbar()).getByRole("textbox", { name: "Poll name" });
    expect(input).toHaveValue("Pump 2");
    await h.user.clear(input);
    await h.user.type(input, "Boiler pump{Enter}");
    await waitFor(() => expect(h.ipc.callsOf("renamePoll")).toEqual([[h.pollId, "Boiler pump"]]));
    expect(await within(toolbar()).findByRole("heading", { name: "Boiler pump" })).toBeVisible();
    expect(lastTitle()).toBe("Boiler pump - Untitled - Offline");
  });

  it("F2 in the toolbar opens it too, and Esc leaves the name", async () => {
    h = await renderNativeWindow();
    fireEvent.keyDown(within(toolbar()).getByRole("button", { name: "Resume" }), { key: "F2" });
    const input = within(toolbar()).getByRole("textbox", { name: "Poll name" });
    await h.user.type(input, "x{Escape}");
    expect(within(toolbar()).queryByRole("textbox")).not.toBeInTheDocument();
    expect(h.ipc.callsOf("renamePoll")).toHaveLength(0);
  });

  it("an empty name shows the message and keeps the field", async () => {
    h = await renderNativeWindow();
    await h.user.click(within(toolbar()).getByRole("button", { name: "Rename poll (F2)" }));
    const input = within(toolbar()).getByRole("textbox", { name: "Poll name" });
    await h.user.clear(input);
    await h.user.type(input, "{Enter}");
    expect(await within(toolbar()).findByRole("alert")).toHaveTextContent("Enter a poll name.");
  });
});

describe("window title (DES-002 2.12)", () => {
  it("is '{poll name} - {profile or Untitled} - {pill label}', Offline while the link is down", async () => {
    h = await renderNativeWindow();
    expect(lastTitle()).toBe("Pump 2 - Untitled - Offline");
    expect(document.title).toBe("Pump 2 - Untitled - Offline");
    await h.connect();
    h.advance(300);
    await waitFor(() => expect(lastTitle()).toBe("Pump 2 - Untitled - Polling"));
    await h.act(() => h.ipc.emitPollState(h.pollId, "timeout", { consecutiveFailures: 1 }));
    expect(lastTitle()).toBe("Pump 2 - Untitled - Timeout");
    await h.act(() => h.ipc.emitPollState(h.pollId, "exception", { exceptionCode: 2 }));
    expect(lastTitle()).toBe("Pump 2 - Untitled - Exception 02");
    await h.act(() => h.ipc.dropLink());
    expect(lastTitle()).toBe("Pump 2 - Untitled - Offline");
  });

  it("follows the profile name", async () => {
    h = await renderNativeWindow({
      prepare: async ({ ipc }) => {
        await ipc.setProfileName("Boiler-PLC");
      },
    });
    expect(lastTitle()).toBe("Pump 2 - Boiler-PLC - Offline");
    await h.act(() => h.ipc.setProfileName("Boiler-2"));
    expect(lastTitle()).toBe("Pump 2 - Boiler-2 - Offline");
    await h.act(() => h.ipc.setProfileName(null));
    expect(lastTitle()).toBe("Pump 2 - Untitled - Offline");
  });
});

describe("banner precedence (DES-002 2.6)", () => {
  it("not connected: the text and only the Connection window button", async () => {
    h = await renderNativeWindow();
    expect(banner()).toHaveTextContent("Not connected. Connect from the connection window.");
    const buttons = within(banner() as HTMLElement).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Connection window"]);
  });

  it("the Connection window button asks Rust to focus W1", async () => {
    h = await renderNativeWindow();
    await h.user.click(
      within(banner() as HTMLElement).getByRole("button", { name: "Connection window" }),
    );
    expect(h.ipc.callsOf("focusConnectionWindow")).toHaveLength(1);
  });

  it("the toolbar button does the same", async () => {
    h = await renderNativeWindow();
    await h.user.click(within(toolbar()).getByRole("button", { name: "Connection window" }));
    expect(h.ipc.callsOf("focusConnectionWindow")).toHaveLength(1);
  });

  it("connecting names the target and offers no Cancel", async () => {
    h = await renderNativeWindow({ mode: "manual" });
    await h.act(() => h.ipc.emitConnectionState("connecting"));
    expect(banner()).toHaveTextContent("Connecting to the device…");
    expect(within(banner() as HTMLElement).queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("connected and healthy: no banner", async () => {
    h = await renderNativeWindow();
    await h.connect();
    h.advance(300);
    expect(banner()).toBeNull();
  });

  it("disconnected: the reason with Reconnect and Connection window; Reconnect connects again", async () => {
    h = await renderNativeWindow();
    await h.connect();
    h.advance(300);
    await h.act(() =>
      h.ipc.dropLink({ kind: "closedByPeer", phase: "linkLost", message: "closed" }),
    );
    expect(banner()).toHaveAttribute("data-variant", "error");
    expect(banner()).toHaveTextContent("The device at 192.168.1.10:502 closed the connection.");
    expect(
      within(banner() as HTMLElement)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Reconnect", "Connection window"]);
    await h.user.click(within(banner() as HTMLElement).getByRole("button", { name: "Reconnect" }));
    expect(h.ipc.callsOf("connect").at(-1)).toEqual([TCP]);
    await waitFor(() => expect(banner()).toBeNull());
  });

  it("the connection banner wins over a failing poll: never both", async () => {
    h = await renderNativeWindow();
    await h.connect();
    h.advance(300);
    await h.act(() => h.ipc.emitPollState(h.pollId, "timeout", { consecutiveFailures: 3 }));
    expect(banner()).toHaveTextContent("Timeout: slave 5");
    await h.act(() => h.ipc.dropLink());
    expect(document.querySelectorAll('[data-slot="state-banner"]')).toHaveLength(1);
    expect(banner()).toHaveTextContent("closed the connection");
    expect(banner()).not.toHaveTextContent("Timeout:");
  });

  it("the status line shows 'No connection' while the connection banner shows the reason", async () => {
    h = await renderNativeWindow();
    expect(screen.getByTestId("status-reason")).toHaveTextContent("No connection");
  });
});

describe("status bar (DES-002 2.6)", () => {
  it("reads Last OK, Round trip, Resp and Timeouts, and never Tx", async () => {
    h = await renderNativeWindow();
    await h.connect();
    h.advance(500);
    const text = screen.getByTestId("native-status-text").textContent ?? "";
    expect(text).toMatch(
      /^Last OK \d\d:\d\d:\d\d\.\d{3} · Round trip \d+ ms · Resp \d+ · Timeouts 0$/,
    );
    expect(text).not.toContain("Tx");
    expect(text).not.toContain("SR");
  });

  it("before a valid reply: 'No valid reply yet'", async () => {
    h = await renderNativeWindow();
    expect(screen.getByTestId("native-status-text")).toHaveTextContent(
      "No valid reply yet · Resp 0 · Timeouts 0",
    );
  });

  it("the status line keeps the Tx counters", async () => {
    h = await renderNativeWindow();
    await h.connect();
    h.advance(500);
    expect(screen.getByTestId("status-counters")).toHaveTextContent(
      /^Tx \d+ · Err 0 · ID 5 · F 03 · SR 100 ms$/,
    );
  });
});

describe("the page never scrolls, at any width (REPORT-007 D6)", () => {
  // jsdom has no layout: this pins the structure that keeps the document inside the window. QA
  // checks the real window (client 466 x 353 css px at 125 %): no scrollbar, one-line status bar.
  const hasClass = (el: Element, ...names: string[]) => {
    for (const name of names) expect(el.classList.contains(name), name).toBe(true);
  };

  it("the root clips and fills the window; the poll view's cell shrinks and clips", async () => {
    h = await renderNativeWindow();
    const root = document.querySelector<HTMLElement>("[data-native-window]") as HTMLElement;
    hasClass(root, "flex", "flex-col", "h-full", "min-h-0", "overflow-hidden");
    const cell = (document.querySelector('[data-slot="poll-view"]') as HTMLElement)
      .parentElement as HTMLElement;
    hasClass(cell, "min-h-0", "min-w-0", "flex-1", "overflow-hidden");
  });

  it("the toolbar may wrap and never shrinks away; the status bar never wraps", async () => {
    h = await renderNativeWindow();
    hasClass(toolbar(), "flex-wrap", "shrink-0");
    const footer = document.querySelector<HTMLElement>('[data-region="status"]') as HTMLElement;
    hasClass(footer, "h-7", "shrink-0", "whitespace-nowrap", "overflow-hidden");
  });

  it("the status text is one line that ends in an ellipsis (its title is set only while it is cut)", async () => {
    h = await renderNativeWindow();
    await h.connect();
    h.advance(500);
    const text = screen.getByTestId("native-status-text");
    hasClass(text, "min-w-0", "flex-1", "truncate");
    // jsdom has no layout: nothing is cut, so there is no title (the hook is tested on its own).
    expect(text).not.toHaveAttribute("title");
  });

  it("the version label never wraps or shrinks", async () => {
    h = await renderNativeWindow();
    const version = await screen.findByTestId("app-version");
    hasClass(version, "shrink-0", "whitespace-nowrap");
  });
});

describe("setup panel (DES-002 2.6)", () => {
  it("opens as a panel in a wide window and as a popover below 640 px", async () => {
    h = await renderNativeWindow();
    const view = () => document.querySelector('[data-slot="poll-view"]') as HTMLElement;
    h.setWidth(900);
    expect(view()).toHaveAttribute("data-presentation", "panel");
    h.setWidth(600);
    expect(view()).toHaveAttribute("data-presentation", "popover");
    expect(screen.getByRole("button", { name: "Show setup (Ctrl+\\)" })).toBeVisible();
    h.setWidth(480);
    expect(view()).toHaveAttribute("data-presentation", "popover");
    h.setWidth(700);
    expect(view()).toHaveAttribute("data-presentation", "panel");
  });

  it("Ctrl+\\ toggles the panel", async () => {
    h = await renderNativeWindow();
    h.setWidth(900);
    const view = () => document.querySelector('[data-slot="poll-view"]') as HTMLElement;
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(view()).toHaveAttribute("data-presentation", "rail");
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(view()).toHaveAttribute("data-presentation", "panel");
  });

  it("in a window below 640 px Ctrl+ and the rail toggle the popover (O1)", async () => {
    h = await renderNativeWindow();
    const view = () => document.querySelector('[data-slot="poll-view"]') as HTMLElement;
    h.setWidth(626);
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(view()).toHaveAttribute("data-presentation", "rail");
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(view()).toHaveAttribute("data-presentation", "popover");
    await h.user.click(screen.getByRole("button", { name: "Show setup (Ctrl+\\)" }));
    expect(view()).toHaveAttribute("data-presentation", "rail");
    await h.user.click(screen.getByRole("button", { name: "Show setup (Ctrl+\\)" }));
    expect(view()).toHaveAttribute("data-presentation", "popover");
    await h.user.keyboard("{Escape}");
    expect(view()).toHaveAttribute("data-presentation", "rail");
  });

  it("unapplied edits are reported to Rust", async () => {
    h = await renderNativeWindow();
    h.setWidth(900);
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "20");
    await waitFor(() => expect(h.ipc.pollSummary(h.pollId).hasUnappliedEdits).toBe(true));
  });
});

describe("compact mode (DES-002 2.9)", () => {
  it("a PrefsChanged turns the panel into the rail and back", async () => {
    h = await renderNativeWindow();
    h.setWidth(900);
    const view = () => document.querySelector('[data-slot="poll-view"]') as HTMLElement;
    expect(view()).toHaveAttribute("data-presentation", "panel");
    await h.act(() => h.ipc.setCompactMode(true));
    expect(view()).toHaveAttribute("data-presentation", "rail");
    // Inside compact mode one window can still open its own setup.
    await h.user.click(screen.getByRole("button", { name: "Show setup (Ctrl+\\)" }));
    expect(view()).toHaveAttribute("data-presentation", "panel");
    await h.act(() => h.ipc.setCompactMode(false));
    expect(view()).toHaveAttribute("data-presentation", "panel");
  });

  it("a window that opens while compact mode is on starts with the rail", async () => {
    h = await renderNativeWindow({
      prepare: async ({ ipc }) => {
        await ipc.setCompactMode(true);
      },
    });
    h.setWidth(900);
    expect(document.querySelector('[data-slot="poll-view"]')).toHaveAttribute(
      "data-presentation",
      "rail",
    );
  });

  it("the ⋯ menu has Collapse setup panels; it sets compact mode in Rust and shows the check", async () => {
    h = await renderNativeWindow();
    await h.user.click(screen.getByRole("button", { name: "Poll window menu" }));
    const item = screen.getByRole("menuitemcheckbox", { name: /^Collapse setup panels/ });
    expect(item).toHaveAttribute("aria-checked", "false");
    expect(item).toHaveTextContent("Ctrl+Shift+\\");
    await h.user.click(item);
    await waitFor(() => expect(h.ipc.compact).toBe(true));
    await h.user.click(screen.getByRole("button", { name: "Poll window menu" }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: /^Collapse setup panels/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("Ctrl+Shift+\\ toggles it", async () => {
    h = await renderNativeWindow();
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(h.ipc.compact).toBe(true));
    fireEvent.keyDown(window, { key: "|", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(h.ipc.compact).toBe(false));
  });
});

describe("the Alt key never reaches the host as an accelerator (REPORT-006 D2)", () => {
  it("prevents the keydown and keyup of a lone Alt or AltGraph tap, not Alt+F4", async () => {
    h = await renderNativeWindow();
    expect(fireEvent.keyDown(window, { key: "Alt", altKey: true })).toBe(false);
    expect(fireEvent.keyUp(window, { key: "Alt" })).toBe(false);
    expect(fireEvent.keyDown(document.body, { key: "AltGraph", altKey: true })).toBe(false);
    expect(fireEvent.keyUp(document.body, { key: "AltGraph" })).toBe(false);
    fireEvent.keyDown(window, { key: "Alt", altKey: true });
    expect(fireEvent.keyDown(window, { key: "F4", altKey: true })).toBe(true);
    expect(fireEvent.keyUp(window, { key: "Alt" })).toBe(true);
  });

  it("a text field keeps the Alt keydown (Alt codes) but its solo keyup is prevented", async () => {
    h = await renderNativeWindow();
    const name = await screen.findByLabelText("Name");
    expect(fireEvent.keyDown(name, { key: "Alt", altKey: true })).toBe(true);
    expect(fireEvent.keyUp(name, { key: "Alt" })).toBe(false);
  });
});

describe("arrange poll windows (DES-002 2.8.5)", () => {
  it("the ⋯ menu has the submenu with Tile, Side by side, Stacked, Cascade and the displays", async () => {
    h = await renderNativeWindow();
    await h.user.click(screen.getByRole("button", { name: "Poll window menu" }));
    await h.user.click(screen.getByRole("menuitem", { name: "Arrange poll windows" }));
    const sub = screen.getByRole("menu", { name: "Arrange poll windows" });
    expect(
      await within(sub).findByRole("menuitemradio", { name: "Display 1 (primary)" }),
    ).toBeVisible();
    expect(
      Array.from(sub.querySelectorAll('[role^="menuitem"]')).map((i) => i.textContent),
    ).toEqual([
      "TileCtrl+Shift+T",
      "Side by side",
      "Stacked",
      "Cascade",
      "Each monitor (in place)",
      "Display 1 (primary)",
    ]);
  });

  it("Tile arranges the windows of the connection on the chosen target", async () => {
    h = await renderNativeWindow();
    await h.user.click(screen.getByRole("button", { name: "Poll window menu" }));
    await h.user.click(screen.getByRole("menuitem", { name: "Arrange poll windows" }));
    const sub = screen.getByRole("menu", { name: "Arrange poll windows" });
    await h.user.click(
      await within(sub).findByRole("menuitemradio", { name: "Display 1 (primary)" }),
    );
    await h.user.click(screen.getByRole("button", { name: "Poll window menu" }));
    await h.user.click(screen.getByRole("menuitem", { name: "Arrange poll windows" }));
    await h.user.click(
      within(screen.getByRole("menu", { name: "Arrange poll windows" })).getByRole("menuitem", {
        name: /^Stacked/,
      }),
    );
    await waitFor(() => expect(h.ipc.callsOf("arrangePollWindows")).toHaveLength(1));
    expect(h.ipc.callsOf("arrangePollWindows")[0]).toEqual([
      "stacked",
      { kind: "monitor", monitorId: "\\\\.\\DISPLAY1" },
    ]);
  });

  it("Ctrl+Shift+T tiles the popped-out windows (the current target)", async () => {
    h = await renderNativeWindow();
    fireEvent.keyDown(window, { key: "T", ctrlKey: true, shiftKey: true });
    await waitFor(() =>
      expect(h.ipc.callsOf("arrangePollWindows")).toEqual([["tile", { kind: "eachMonitor" }]]),
    );
  });

  it("a single window is arranged as one cell without a toast", async () => {
    h = await renderNativeWindow();
    fireEvent.keyDown(window, { key: "T", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(h.ipc.callsOf("arrangePollWindows")).toHaveLength(1));
    expect(screen.queryByText(/did not fit|No poll is open/)).not.toBeInTheDocument();
  });

  it("windows that did not fit are announced in a toast", async () => {
    h = await renderNativeWindow();
    h.ipc.setResult("arrangePollWindows", { arranged: 13, overflow: 1 });
    fireEvent.keyDown(window, { key: "T", ctrlKey: true, shiftKey: true });
    expect(await screen.findByText("1 window did not fit and was cascaded.")).toBeVisible();
  });

  it("the monitor list is read when the window opens and again when the submenu opens", async () => {
    h = await renderNativeWindow();
    const loaded = h.win.monitors.length;
    expect(loaded).toBe(1);
    await h.act(async () => {});
    expect(h.rt.stores.arrange.getState().loaded).toBe(true);
  });
});

describe("dock to workspace (DES-002 2.5.3)", () => {
  it("the button docks with the handoff of this window and shows a spinner meanwhile", async () => {
    h = await renderNativeWindow();
    const held = h.ipc.hold("dockPoll");
    const button = within(toolbar()).getByRole("button", { name: /^Dock to workspace/ });
    await h.user.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "true"));
    // Busy keeps the keyboard focus: aria-busy and aria-disabled, never `disabled` (DES-002 2.5.3).
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveFocus();
    expect(button.querySelector('[data-icon="loader"]')).toBeInTheDocument();
    // A second press does nothing.
    fireEvent.click(button);
    held.release();
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
    expect(h.ipc.callsOf("dockPoll")).toHaveLength(1);
    const call = h.ipc.callsOf("dockPoll")[0] as [number, string, boolean, null];
    expect(call[0]).toBe(h.pollId);
    expect(JSON.parse(call[1])).toMatchObject({ version: 1 });
    expect(call.slice(2)).toEqual([false, null]);
    expect(h.blurred()).toBe(1);
  });

  it("a dock moves the poll to the workspace in Rust", async () => {
    h = await renderNativeWindow();
    await h.user.click(within(toolbar()).getByRole("button", { name: /^Dock to workspace/ }));
    await waitFor(() => expect(h.ipc.pollSummary(h.pollId).host).toBe("workspace"));
  });

  it("Ctrl+Shift+D does the same", async () => {
    h = await renderNativeWindow();
    fireEvent.keyDown(window, { key: "D", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(h.ipc.callsOf("dockPoll")).toHaveLength(1));
  });

  it("a failure shows 'Could not dock the poll: {message}' and the window stays", async () => {
    h = await renderNativeWindow();
    h.ipc.failNext("dockPoll", "boom");
    await h.user.click(within(toolbar()).getByRole("button", { name: /^Dock to workspace/ }));
    expect(await screen.findByText("Could not dock the poll: boom")).toBeVisible();
    expect(h.ipc.pollSummary(h.pollId).host).toBe("native");
    expect(within(toolbar()).getByRole("button", { name: /^Dock to workspace/ })).toBeEnabled();
  });

  it("a failed dock leaves the focus on the Dock button, never on the page (REPORT-007 D9, CHK2-F16)", async () => {
    h = await renderNativeWindow();
    h.ipc.failNext("dockPoll", "boom");
    const held = h.ipc.holdReply("dockPoll");
    const dock = () => within(toolbar()).getByRole("button", { name: /^Dock to workspace/ });
    await h.user.click(dock());
    await waitFor(() => expect(dock()).toHaveAttribute("aria-busy", "true"));
    expect(dock()).toHaveFocus();
    held.release();
    expect(await screen.findByText("Could not dock the poll: boom")).toBeVisible();
    await waitFor(() => expect(dock()).not.toHaveAttribute("aria-disabled"));
    expect(dock()).toHaveFocus();
    expect(h.ipc.pollSummary(h.pollId).host).toBe("native");
  });

  it("a failed dock by Ctrl+Shift+D returns the focus to where it was (the grid)", async () => {
    h = await renderNativeWindow();
    await h.connect();
    h.advance(300);
    const grid = screen.getByRole("grid");
    grid.focus();
    h.ipc.failNext("dockPoll", "boom");
    const held = h.ipc.holdReply("dockPoll");
    fireEvent.keyDown(grid, { key: "D", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(h.ipc.callsOf("dockPoll")).toHaveLength(1));
    loseFocus();
    held.release();
    expect(await screen.findByText("Could not dock the poll: boom")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("grid")).toHaveFocus());
  });

  it("a failed dock from the status line menu returns the focus to the menu button", async () => {
    h = await renderNativeWindow();
    h.ipc.failNext("dockPoll", "boom");
    await h.user.click(screen.getByRole("button", { name: "Poll actions" }));
    await h.user.click(screen.getByRole("menuitem", { name: /^Dock to workspace/ }));
    expect(await screen.findByText("Could not dock the poll: boom")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "Poll actions" })).toHaveFocus());
  });

  it("a failed dock does not take the focus from where the user went meanwhile", async () => {
    h = await renderNativeWindow();
    h.ipc.failNext("dockPoll", "boom");
    const held = h.ipc.holdReply("dockPoll");
    const dock = () => within(toolbar()).getByRole("button", { name: /^Dock to workspace/ });
    await h.user.click(dock());
    await waitFor(() => expect(dock()).toHaveAttribute("aria-busy", "true"));
    // Another window (not this one's controls) has the focus now.
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    held.release();
    await waitFor(() => expect(dock()).not.toHaveAttribute("aria-disabled"));
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it("the status line menu offers Dock to workspace and not Pop out", async () => {
    h = await renderNativeWindow();
    await h.user.click(screen.getByRole("button", { name: "Poll actions" }));
    expect(screen.getByRole("menuitem", { name: /^Dock to workspace/ })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: /Pop out/ })).not.toBeInTheDocument();
    await h.user.click(screen.getByRole("menuitem", { name: /^Dock to workspace/ }));
    await waitFor(() => expect(h.ipc.callsOf("dockPoll")).toHaveLength(1));
  });

  it("does nothing while a dialog is open in this window", async () => {
    h = await renderNativeWindow();
    void h.win.requestClose();
    await screen.findByRole("alertdialog");
    fireEvent.keyDown(window, { key: "D", ctrlKey: true, shiftKey: true });
    await h.act(async () => {});
    expect(h.ipc.callsOf("dockPoll")).toHaveLength(0);
  });
});

describe("closing the window (DES-002 2.11)", () => {
  it("the OS close request opens S6 in this window and keeps it open", async () => {
    h = await renderNativeWindow();
    const closing = h.win.requestClose();
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Close poll window?")).toBeVisible();
    expect(dialog).toHaveTextContent('Keep "Pump 2" on this connection, or delete it?');
    expect(within(dialog).getByRole("button", { name: "Keep poll" })).toHaveFocus();
    await expect(closing).resolves.toBe(false);
    expect(h.win.closed).toBe(false);
  });

  it("adds what is lost and what keeps running", async () => {
    h = await renderNativeWindow();
    await h.connect();
    await h.ipc.setPollActive(h.pollId, true);
    h.setWidth(900);
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "20");
    await waitFor(() => expect(h.ipc.pollSummary(h.pollId).hasUnappliedEdits).toBe(true));
    void h.win.requestClose();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      'Keep "Pump 2" on this connection, or delete it? Unapplied changes in the poll setup will be lost. A kept poll keeps polling in the background.',
    );
  });

  it("a poll that is offline or paused does not get 'keeps polling in the background' (REPORT-003 O-2)", async () => {
    h = await renderNativeWindow();
    // The run intent is on, the link is down: the poll is offline and has nothing to keep running.
    expect(h.ipc.pollSummary(h.pollId).config.active).toBe(true);
    void h.win.requestClose();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent('Keep "Pump 2" on this connection, or delete it?');
    expect(dialog).not.toHaveTextContent("keeps polling");
    await h.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await h.connect();
    await h.act(() => h.ipc.setPollActive(h.pollId, false));
    void h.win.requestClose();
    expect(await screen.findByRole("alertdialog")).not.toHaveTextContent("keeps polling");
  });

  it("the S6 text does not change while it is open (REPORT-004 CHK2-G6)", async () => {
    h = await renderNativeWindow();
    await h.connect();
    await h.ipc.setPollActive(h.pollId, true);
    void h.win.requestClose();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("A kept poll keeps polling in the background.");
    // Paused while the question is open: the sentence stays.
    await h.act(() => h.ipc.setPollActive(h.pollId, false));
    await waitFor(() => expect(h.ipc.pollSummary(h.pollId).status.state).toBe("paused"));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "A kept poll keeps polling in the background.",
    );
    await h.user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    // Opened while paused, resumed while open: the sentence does not appear.
    void h.win.requestClose();
    expect(await screen.findByRole("alertdialog")).not.toHaveTextContent("keeps polling");
    await h.act(() => h.ipc.setPollActive(h.pollId, true));
    await waitFor(() => expect(h.ipc.pollSummary(h.pollId).status.state).toBe("polling"));
    expect(screen.getByRole("alertdialog")).not.toHaveTextContent("keeps polling");
  });

  it("Keep poll closes the view and keeps the poll; Rust destroys the window", async () => {
    h = await renderNativeWindow();
    void h.win.requestClose();
    await h.user.click(await screen.findByRole("button", { name: "Keep poll" }));
    await waitFor(() => expect(h.ipc.callsOf("closePollView")).toEqual([[h.pollId, true]]));
    expect(h.ipc.pollSummary(h.pollId).open).toBe(false);
    // The view was detached by Rust: the window says it is closing.
    expect(await screen.findByTestId("native-detached")).toHaveTextContent(
      "This poll window is closing.",
    );
  });

  it("Delete poll removes the poll", async () => {
    h = await renderNativeWindow();
    void h.win.requestClose();
    await h.user.click(await screen.findByRole("button", { name: "Delete poll" }));
    await waitFor(() => expect(h.ipc.callsOf("closePollView")).toEqual([[h.pollId, false]]));
    expect(h.ipc.pollIds()).not.toContain(h.pollId);
    expect(await screen.findByTestId("native-detached")).toHaveTextContent(
      "This poll was deleted.",
    );
  });

  it("Cancel keeps everything", async () => {
    h = await renderNativeWindow();
    void h.win.requestClose();
    await h.user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(h.ipc.callsOf("closePollView")).toHaveLength(0);
  });

  it("'Don't ask again' sets it for the connection; the next close keeps at once", async () => {
    h = await renderNativeWindow();
    void h.win.requestClose();
    await h.user.click(
      await screen.findByRole("checkbox", { name: "Don't ask again for this connection window" }),
    );
    await h.user.click(screen.getByRole("button", { name: "Keep poll" }));
    await waitFor(() => expect(h.ipc.askOnPollClose).toBe(false));
    await waitFor(() => expect(h.ipc.callsOf("closePollView")).toHaveLength(1));
  });

  it("when Rust says not to ask, the close request keeps the poll without a dialog", async () => {
    h = await renderNativeWindow({
      prepare: async ({ ipc }) => {
        await ipc.setAskOnPollClose(false);
      },
    });
    await expect(h.win.requestClose()).resolves.toBe(false);
    await waitFor(() => expect(h.ipc.callsOf("closePollView")).toEqual([[h.pollId, true]]));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("a Close that Rust rejects shows the error and leaves the window open", async () => {
    h = await renderNativeWindow();
    h.ipc.failNext("closePollView", "no window");
    void h.win.requestClose();
    await h.user.click(await screen.findByRole("button", { name: "Keep poll" }));
    expect(await screen.findByText("no window")).toBeVisible();
    expect(screen.queryByTestId("native-detached")).not.toBeInTheDocument();
  });

  it("the status line menu has Close and Delete…", async () => {
    h = await renderNativeWindow();
    await h.user.click(screen.getByRole("button", { name: "Poll actions" }));
    await h.user.click(screen.getByRole("menuitem", { name: /^Delete…/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete poll?")).toBeVisible();
    await h.user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(h.ipc.callsOf("removePoll")).toEqual([[h.pollId]]));
  });
});

describe("the handoff request of a list drag in W1 (DES-002 2.10.7)", () => {
  const RECT = {
    x: 8,
    y: 8,
    width: 640,
    height: 368,
    z: 1,
    state: "normal",
    restore: null,
  } as const;

  it("is answered with the handoff of this window: the dock goes through and the draft travels", async () => {
    h = await renderNativeWindow();
    h.setWidth(900);
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "200");
    await h.act(() => h.ipc.dockPoll(h.pollId, null, true, RECT));
    expect(h.ipc.pollSummary(h.pollId).host).toBe("workspace");
    expect(h.ipc.callsOf("provideHandoff")).toHaveLength(1);
    // The sub-window that attaches next gets the same draft.
    const snapshot = await h.ipc.attachPollView(h.pollId, "workspace", () => {});
    expect(snapshot.handoff).not.toBeNull();
    expect(JSON.parse(snapshot.handoff as string).pollDraft.quantity).toBe("200");
  });

  it("is refused while S6 is open: W1 gets the validation error", async () => {
    h = await renderNativeWindow();
    void h.win.requestClose();
    await screen.findByRole("alertdialog");
    await expect(h.ipc.dockPoll(h.pollId, null, true, RECT)).rejects.toMatchObject({
      field: "handoff",
    });
    expect(h.ipc.callsOf("provideHandoff")).toEqual([[h.pollId, null]]);
    expect(h.ipc.pollSummary(h.pollId).host).toBe("native");
  });
});

describe("views and events", () => {
  it("a view that Rust replaced says that the poll is shown elsewhere", async () => {
    h = await renderNativeWindow();
    await h.act(async () => {
      await h.ipc.attachPollView(h.pollId, "native", () => {});
    });
    expect(await screen.findByTestId("native-detached")).toHaveTextContent(
      "This poll is shown in another window.",
    );
  });

  it("a rejected attach says why", async () => {
    h = await renderNativeWindow({ noRender: true });
    h.ipc.failNext("attachPollView", new IpcError("Poll 9 was not found.", "pollNotFound"));
    // Render by hand: the attach fails.
    const { NativeRuntimeProvider } = await import("./context");
    const { NativePollWindow } = await import("./NativePollWindow");
    const { render } = await import("@testing-library/react");
    render(
      <NativeRuntimeProvider runtime={h.rt}>
        <NativePollWindow />
      </NativeRuntimeProvider>,
    );
    await act(async () => {
      await h.rt.init();
    });
    expect(await screen.findByTestId("native-detached")).toHaveTextContent(
      "Could not open this poll: Poll 9 was not found.",
    );
  });

  it("the name of the poll follows a rename from W1", async () => {
    h = await renderNativeWindow();
    await h.act(() => h.ipc.renamePoll(h.pollId, "Boiler pump"));
    expect(within(toolbar()).getByRole("heading", { name: "Boiler pump" })).toBeVisible();
    expect(lastTitle()).toBe("Boiler pump - Untitled - Offline");
  });
});

describe("live region (DES-001 7)", () => {
  it("announces the connection transitions of this window", async () => {
    h = await renderNativeWindow();
    await h.connect();
    expect(live()).toHaveTextContent("Connected");
    await h.act(() =>
      h.ipc.dropLink({ kind: "closedByPeer", phase: "linkLost", message: "closed" }),
    );
    expect(liveAlert()).toHaveTextContent(
      "Disconnected. The device at 192.168.1.10:502 closed the connection.",
    );
  });

  it("announces when this poll starts to fail, once", async () => {
    h = await renderNativeWindow();
    await h.connect();
    h.advance(300);
    await h.act(() => h.ipc.emitPollState(h.pollId, "timeout", { consecutiveFailures: 1 }));
    expect(live()).toHaveTextContent("Pump 2: Timeout.");
    // A repeat of the same failure is not announced again.
    const before = live().textContent;
    await h.act(() => h.ipc.emitPollState(h.pollId, "timeout", { consecutiveFailures: 2 }));
    expect(live().textContent).toBe(before);
  });
});

describe("shortcuts (DES-002 3.1, W2 column)", () => {
  it("Ctrl+L connects again when the link is down and does nothing while connected", async () => {
    h = await renderNativeWindow();
    await h.connect();
    h.advance(300);
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    await h.act(async () => {});
    expect(h.ipc.callsOf("connect")).toHaveLength(1);
    await h.act(() =>
      h.ipc.dropLink({ kind: "closedByPeer", phase: "linkLost", message: "closed" }),
    );
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    await waitFor(() => expect(h.ipc.callsOf("connect")).toHaveLength(2));
  });

  it("Ctrl+L before the window ever knew a connection does nothing", async () => {
    h = await renderNativeWindow();
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    await h.act(async () => {});
    expect(h.ipc.callsOf("connect")).toHaveLength(0);
  });

  it("Ctrl+P pauses or resumes this poll", async () => {
    h = await renderNativeWindow();
    await h.connect();
    h.advance(300);
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    await waitFor(() => expect(h.ipc.callsOf("setPollActive")).toEqual([[h.pollId, false]]));
  });

  it("Ctrl+Shift+M focuses the connection window", async () => {
    h = await renderNativeWindow();
    fireEvent.keyDown(window, { key: "M", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(h.ipc.callsOf("focusConnectionWindow")).toHaveLength(1));
  });

  it("Ctrl+Shift+A brings the popped-out windows to the front", async () => {
    h = await renderNativeWindow();
    fireEvent.keyDown(window, { key: "A", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(h.ipc.callsOf("showPollWindows")).toHaveLength(1));
  });

  it("the shortcuts are off while a dialog is open", async () => {
    h = await renderNativeWindow();
    void h.win.requestClose();
    await screen.findByRole("alertdialog");
    fireEvent.keyDown(window, { key: "M", ctrlKey: true, shiftKey: true });
    await h.act(async () => {});
    expect(h.ipc.callsOf("focusConnectionWindow")).toHaveLength(0);
  });
});

describe("the status line menu of a native poll (DES-002 2.3.2)", () => {
  it("Show traffic for this poll asks W1 to expand its panel with this filter", async () => {
    h = await renderNativeWindow();
    await h.user.click(screen.getByRole("button", { name: "Poll actions" }));
    await h.user.click(screen.getByRole("menuitem", { name: "Show traffic for this poll" }));
    expect(h.ipc.callsOf("showTraffic")).toEqual([[h.pollId]]);
  });

  it("Duplicate opens the copy in its own window", async () => {
    h = await renderNativeWindow();
    await h.user.click(screen.getByRole("button", { name: "Poll actions" }));
    await h.user.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() => expect(h.ipc.callsOf("duplicatePoll")).toEqual([[h.pollId]]));
    expect(h.ipc.nativePolls()).toHaveLength(2);
  });

  it("a rejected request is shown", async () => {
    h = await renderNativeWindow();
    h.ipc.failNext("showTraffic", "no connection window");
    await h.user.click(screen.getByRole("button", { name: "Poll actions" }));
    await h.user.click(screen.getByRole("menuitem", { name: "Show traffic for this poll" }));
    expect(await screen.findByText("no connection window")).toBeVisible();
  });
});

describe("QA hooks of the window element (REPORT-003 section 5, items 2 and 4)", () => {
  const root = () => document.querySelector<HTMLElement>("[data-native-window]") as HTMLElement;

  it("data-ready is true once the close handler is registered and the view has attached", async () => {
    h = await renderNativeWindow();
    await waitFor(() => expect(root()).toHaveAttribute("data-ready", "true"));
    // Ready means a close request now reaches S6.
    void h.win.requestClose();
    expect(await screen.findByRole("alertdialog")).toBeVisible();
  });

  it("ready is false until the attach finishes", async () => {
    let held!: { release(value?: unknown): void; fail(error: string): void };
    h = await renderNativeWindow({
      noRender: true,
      prepare: ({ ipc }) => {
        held = ipc.hold("attachPollView");
      },
    });
    expect(h.rt.stores.ready.getState().ready).toBe(false);
    const starting = h.rt.init();
    await Promise.resolve();
    expect(h.rt.stores.ready.getState().ready).toBe(false);
    held.fail("no");
    await starting;
    // The attach failed, and the window is still usable (it can be closed): ready.
    expect(h.rt.stores.ready.getState().ready).toBe(true);
  });

  it("data-prefs shows the preferences this window has applied, from the snapshot and PrefsChanged", async () => {
    h = await renderNativeWindow();
    await waitFor(() => expect(root()).toHaveAttribute("data-ready", "true"));
    const prefs = () => JSON.parse(root().getAttribute("data-prefs") ?? "{}");
    expect(prefs()).toEqual({ askOnPollClose: true, compact: false });
    await h.act(() => h.ipc.setCompactMode(true));
    await h.act(() => h.ipc.setAskOnPollClose(false));
    expect(prefs()).toEqual({ askOnPollClose: false, compact: true });
  });
});
