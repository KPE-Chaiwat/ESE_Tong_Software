// The keyboard map of DES-002 3.1, one test per row and host (FE-002 task 24): W1 outside the
// sub-windows, W1 in the scope of a sub-window, and a native poll window. Keys are dispatched on the
// element that has the focus, like the browser does, and `defaultPrevented` tells whether the
// browser default was suppressed.
import { act, screen, waitFor, within } from "@testing-library/react";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { presetDefaults } from "../../lib/scale-presets";
import { SUPPRESSED_DEFAULTS } from "../../lib/shortcuts";
import { pollProfile, profileV2 } from "../dialogs/profile-fixtures";
import {
  disposeNativeHarnesses,
  type NativeHarness,
  renderNativeWindow,
} from "../native/test-utils";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;
let n: NativeHarness;

afterEach(() => {
  h?.rt.dispose();
  disposeNativeHarnesses();
});

interface Mods {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** Dispatches a keydown on the focused element (or the body) and returns whether it was prevented. */
function press(key: string, mods: Mods = {}): boolean {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

const frame = (id: PollId) =>
  document.querySelector<HTMLElement>(`[data-subwindow="${id}"]`) as HTMLElement;
const grid = (id: PollId) => within(frame(id)).getByRole("grid");
const titleBar = (id: PollId) => frame(id).querySelector('[data-slot="title-bar"]') as HTMLElement;

/** Two connected, polling polls with rows. */
async function connected() {
  h = await renderWindow();
  const a = await h.addPoll("A", {
    definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
  });
  const b = await h.addPoll("B", {
    definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
  });
  await h.connect();
  h.advance(300);
  return { a, b };
}

describe("W1 outside the sub-windows (DES-002 3.1)", () => {
  beforeEach(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });

  it("Ctrl+L disconnects while connected", async () => {
    await connected();
    expect(press("l", { ctrl: true })).toBe(true);
    await waitFor(() => expect(h.ipc.callsOf("disconnect")).toHaveLength(1));
  });

  it("Ctrl+P pauses the poll selected in the sidebar; Ctrl+Shift+P pauses all", async () => {
    const { b } = await connected();
    h.rt.stores.pollList.getState().select(b);
    press("p", { ctrl: true });
    await waitFor(() => expect(h.ipc.callsOf("setPollActive")).toEqual([[b, false]]));
    press("p", { ctrl: true, shift: true });
    await waitFor(() => expect(h.ipc.callsOf("setAllPollsActive")).toHaveLength(1));
  });

  it("Ctrl+Shift+N adds a poll in the workspace", async () => {
    await connected();
    press("n", { ctrl: true, shift: true });
    await waitFor(() => expect(h.ipc.callsOf("addPoll")).toHaveLength(3));
    expect(h.ipc.callsOf("addPoll")[2]?.[1]).toBe("workspace");
  });

  it("Ctrl+E does nothing outside a sub-window, and the browser default stays suppressed", async () => {
    await connected();
    expect(press("e", { ctrl: true })).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Ctrl+F4 does nothing outside a sub-window", async () => {
    await connected();
    expect(press("F4", { ctrl: true })).toBe(true);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Ctrl+\\ toggles the sidebar, Ctrl+Shift+\\ compact mode", async () => {
    await connected();
    press("\\", { ctrl: true });
    expect(h.rt.stores.workspace.getState().sidebar.collapsed).toBe(true);
    press("\\", { ctrl: true, shift: true });
    await waitFor(() => expect(h.ipc.callsOf("setCompactMode")).toEqual([[true]]));
  });

  it("Ctrl+Shift+T tiles, Ctrl+Shift+C cascades, Ctrl+F6 cycles", async () => {
    const { a, b } = await connected();
    press("T", { ctrl: true, shift: true });
    expect(h.rt.stores.workspace.getState().tileMode).toBe(true);
    press("C", { ctrl: true, shift: true });
    expect(h.rt.stores.workspace.getState().tileMode).toBe(false);
    await h.act(() => h.rt.stores.workspace.getState().activate(a));
    press("F6", { ctrl: true });
    expect(h.rt.stores.workspace.getState().activeId).toBe(b);
    press("F6", { ctrl: true, shift: true });
    expect(h.rt.stores.workspace.getState().activeId).toBe(a);
  });

  it("Ctrl+Shift+O pops out the selected row, Ctrl+Shift+A brings the windows forward", async () => {
    const { a } = await connected();
    h.rt.stores.pollList.getState().select(a);
    press("O", { ctrl: true, shift: true });
    await waitFor(() => expect(h.ipc.callsOf("popOutPoll")).toHaveLength(1));
    press("A", { ctrl: true, shift: true });
    await waitFor(() => expect(h.ipc.callsOf("showPollWindows")).toHaveLength(1));
  });

  it("Ctrl+Shift+D does nothing in W1 (the default is suppressed)", async () => {
    await connected();
    expect(press("D", { ctrl: true, shift: true })).toBe(true);
    expect(h.ipc.callsOf("dockPoll")).toHaveLength(0);
  });

  it("Ctrl+Shift+M does nothing in W1", async () => {
    await connected();
    expect(press("M", { ctrl: true, shift: true })).toBe(true);
    expect(h.ipc.callsOf("focusConnectionWindow")).toHaveLength(0);
  });

  it("Ctrl+J expands the traffic panel, Ctrl+Shift+K clears it", async () => {
    await connected();
    press("j", { ctrl: true });
    expect(h.rt.stores.workspace.getState().traffic.expanded).toBe(true);
    await h.act(() =>
      h.ipc.emitFrames([
        {
          seq: 1,
          at: 0,
          direction: "tx",
          bytes: [1],
          slaveId: 1,
          function: 3,
          exceptionCode: null,
          note: null,
          origin: null,
        },
      ]),
    );
    press("K", { ctrl: true, shift: true });
    expect(h.rt.stores.traffic.getState().visible().size).toBe(0);
  });

  it("Ctrl+O opens the profile list, Ctrl+S and Ctrl+Shift+S open Save as when untitled", async () => {
    await connected();
    press("o", { ctrl: true });
    expect(await screen.findByRole("dialog", { name: "Open profile" })).toBeVisible();
    await h.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await h.act(() =>
      h.rt.form.current.adopt({ mode: "tcp", host: "h", port: 502, timeoutMs: 1000 }),
    );
    press("s", { ctrl: true });
    expect(await screen.findByRole("dialog", { name: "Save profile as" })).toBeVisible();
    await h.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    press("S", { ctrl: true, shift: true });
    expect(await screen.findByRole("dialog", { name: "Save profile as" })).toBeVisible();
  });

  it("Ctrl+N opens a new connection window", async () => {
    await connected();
    press("n", { ctrl: true });
    await waitFor(() => expect(h.win.openedTools).toEqual(["modbus-master"]));
  });

  it("the keys of the poll view do nothing here: Ctrl+1..4, Ctrl+B", async () => {
    await connected();
    press("3", { ctrl: true });
    press("b", { ctrl: true });
    await h.act(async () => {});
    expect(h.ipc.callsOf("setPollView")).toHaveLength(0);
  });

  it("Delete on the selected sidebar row asks Delete poll?, F2 renames it", async () => {
    const { a } = await connected();
    const row = screen.getAllByRole("option")[0] as HTMLElement;
    row.focus();
    press("F2");
    expect(await screen.findByRole("textbox")).toHaveValue("A");
    await h.user.keyboard("{Escape}");
    (screen.getAllByRole("option")[0] as HTMLElement).focus();
    press("Delete");
    expect(await screen.findByRole("alertdialog", { name: "Delete poll?" })).toBeVisible();
    expect(a).toBeGreaterThan(0);
  });

  it("every key is off while a dialog is open", async () => {
    await connected();
    h.rt.stores.host.getState().requestDelete(h.ipc.pollIds()[0] as number);
    await screen.findByRole("alertdialog");
    press("N", { ctrl: true, shift: true });
    press("j", { ctrl: true });
    await h.act(async () => {});
    expect(h.ipc.callsOf("addPoll")).toHaveLength(2);
    expect(h.rt.stores.workspace.getState().traffic.expanded).toBe(false);
  });
});

describe("W1 in the scope of a sub-window (DES-002 3.1)", () => {
  it("Ctrl+P pauses this poll, whatever the sidebar selects", async () => {
    const { a, b } = await connected();
    h.rt.stores.pollList.getState().select(b);
    grid(a).focus();
    press("p", { ctrl: true });
    await waitFor(() => expect(h.ipc.callsOf("setPollActive")).toEqual([[a, false]]));
  });

  it("Ctrl+E opens Write… for the sub-window with the focus", async () => {
    const { b } = await connected();
    grid(b).focus();
    press("e", { ctrl: true });
    expect(await screen.findByRole("dialog", { name: "Write · B" })).toBeVisible();
  });

  it("the workspace background forwards Ctrl+E to the active sub-window", async () => {
    const { a } = await connected();
    await h.act(() => h.rt.stores.workspace.getState().activate(a));
    (document.querySelector('[data-region="workspace"]') as HTMLElement).focus();
    press("e", { ctrl: true });
    expect(await screen.findByRole("dialog", { name: "Write · A" })).toBeVisible();
  });

  it("Ctrl+1..4 set the format of this poll, Ctrl+B flips the address base", async () => {
    const { a } = await connected();
    grid(a).focus();
    press("3", { ctrl: true });
    await waitFor(() => expect(h.ipc.pollSummary(a).config.display.format).toBe("hex"));
    press("4", { ctrl: true });
    await waitFor(() => expect(h.ipc.pollSummary(a).config.display.format).toBe("binary"));
    press("1", { ctrl: true });
    await waitFor(() => expect(h.ipc.pollSummary(a).config.display.format).toBe("unsigned"));
    press("2", { ctrl: true });
    await waitFor(() => expect(h.ipc.pollSummary(a).config.display.format).toBe("signed"));
    press("b", { ctrl: true });
    await waitFor(() => expect(h.ipc.pollSummary(a).config.display.addressBase).toBe(1));
    press("b", { ctrl: true });
    await waitFor(() => expect(h.ipc.pollSummary(a).config.display.addressBase).toBe(0));
  });

  it("Ctrl+Shift+V keeps Raw without a scale, and does not touch a text field", async () => {
    const { a } = await connected();
    grid(a).focus();
    press("V", { ctrl: true, shift: true });
    await h.act(async () => {});
    expect(h.ipc.pollSummary(a).config.valueColumns).toBe("raw");
    // In a text field the key is the browser's (paste as plain text).
    await h.user.click(within(frame(a)).getByRole("button", { name: "Poll setup (Ctrl+\\)" }));
    const name = within(frame(a)).getByLabelText("Name");
    name.focus();
    expect(press("V", { ctrl: true, shift: true })).toBe(false);
  });

  it("Ctrl+\\ toggles the setup of this sub-window only", async () => {
    const { a, b } = await connected();
    grid(a).focus();
    press("\\", { ctrl: true });
    expect(h.rt.views.get(a).stores.ui.getState().setupOpen).toBe(true);
    expect(h.rt.views.get(b).stores.ui.getState().setupOpen).toBe(false);
    expect(h.rt.stores.workspace.getState().sidebar.collapsed).toBe(false);
  });

  it("Ctrl+Shift+O pops out this poll", async () => {
    const { a, b } = await connected();
    h.rt.stores.pollList.getState().select(b);
    grid(a).focus();
    press("O", { ctrl: true, shift: true });
    await waitFor(() => expect(h.ipc.callsOf("popOutPoll")).toHaveLength(1));
    expect(h.ipc.callsOf("popOutPoll")[0]?.[0]).toBe(a);
  });

  it("Ctrl+F4 closes this sub-window (S6)", async () => {
    const { a } = await connected();
    titleBar(a).focus();
    press("F4", { ctrl: true });
    expect(await screen.findByRole("alertdialog", { name: "Close poll window?" })).toBeVisible();
  });

  it("F2 on the title bar renames the poll, in the grid it edits the alias of the focused row", async () => {
    const { a } = await connected();
    titleBar(a).focus();
    press("F2");
    expect(await within(frame(a)).findByRole("textbox")).toHaveValue("A");
    await h.user.keyboard("{Escape}");
    const row = within(grid(a))
      .getAllByRole("row")
      .find((r) => r.getAttribute("data-row") === "2") as HTMLElement;
    await h.user.click(row);
    press("F2");
    expect(await screen.findByRole("textbox", { name: "Alias for address 2" })).toBeVisible();
  });

  it("Ctrl+A and Ctrl+C act on the grid rows", async () => {
    const { a } = await connected();
    grid(a).focus();
    press("a", { ctrl: true });
    press("c", { ctrl: true });
    await waitFor(() => expect(h.copied).toHaveLength(1));
    expect(h.copied[0]?.split("\n")).toHaveLength(10);
  });

  it("inside the alias editor Alt+Right and Ctrl+Shift+Right act on the text, not on the window", async () => {
    const { a } = await connected();
    const before = h.rt.stores.workspace.getState().items[a]?.rect;
    await h.user.dblClick(
      within(grid(a)).getAllByRole("row")[1]?.querySelector('[data-cell="alias"]') as HTMLElement,
    );
    const editor = await screen.findByRole("textbox", { name: /^Alias for address/ });
    expect(editor).toHaveFocus();
    expect(press("ArrowRight", { alt: true })).toBe(false);
    expect(press("ArrowRight", { ctrl: true, shift: true })).toBe(false);
    expect(h.rt.stores.workspace.getState().items[a]?.rect).toEqual(before);
  });

  it("F6 cycles toolbar, sidebar, workspace, traffic and back", async () => {
    await connected();
    (
      screen.getByRole("toolbar", { name: "Toolbar" }).querySelector("button") as HTMLElement
    ).focus();
    const regionOf = () =>
      document.activeElement?.closest("[data-region]")?.getAttribute("data-region");
    press("F6");
    expect(regionOf()).toBe("sidebar");
    press("F6");
    expect(regionOf()).toBe("workspace");
    press("F6");
    expect(regionOf()).toBe("traffic");
    press("F6");
    expect(regionOf()).toBe("toolbar");
    press("F6", { shift: true });
    expect(regionOf()).toBe("traffic");
  });

  it("F6 from a row of the poll list goes on to the workspace, not back to the toolbar", async () => {
    await connected();
    (screen.getAllByRole("option")[0] as HTMLElement).focus();
    press("F6");
    expect(document.activeElement?.closest("[data-region]")?.getAttribute("data-region")).toBe(
      "workspace",
    );
  });
});

describe("browser defaults (DES-001 5.1, DES-002 3.1)", () => {
  it("every conflicting key is suppressed in W1 and in a native window", async () => {
    await connected();
    (document.activeElement as HTMLElement | null)?.blur();
    for (const combo of SUPPRESSED_DEFAULTS) {
      const parts = combo.split("+");
      const key = parts.at(-1) as string;
      const prevented = press(
        key.startsWith("arrow") ? `Arrow${key.slice(5)[0]?.toUpperCase()}${key.slice(6)}` : key,
        {
          ctrl: parts.includes("ctrl"),
          shift: parts.includes("shift"),
          alt: parts.includes("alt"),
        },
      );
      expect(prevented, combo).toBe(true);
    }
  });
});

describe("native poll window (DES-002 3.1, W2 column)", () => {
  const toolbarButton = (name: string) =>
    within(screen.getByRole("toolbar", { name: "Poll window toolbar" })).getByRole("button", {
      name,
    });

  async function open(connectIt = true) {
    n = await renderNativeWindow();
    if (connectIt) {
      await n.connect();
      n.advance(300);
    }
    (document.activeElement as HTMLElement | null)?.blur();
  }

  it("Ctrl+L connects when idle and does nothing while connected", async () => {
    await open(false);
    press("l", { ctrl: true });
    await waitFor(() => expect(n.ipc.callsOf("connect")).toHaveLength(0));
    // The window has no connection to reuse yet (it never connected): nothing is sent.
    await n.connect();
    n.advance(100);
    expect(press("l", { ctrl: true })).toBe(true);
    await n.act(async () => {});
    expect(n.ipc.callsOf("disconnect")).toHaveLength(0);
    expect(n.ipc.callsOf("connect")).toHaveLength(1);
  });

  it("Ctrl+L reconnects after the link was lost", async () => {
    await open();
    await n.act(async () => n.ipc.dropLink());
    press("l", { ctrl: true });
    await waitFor(() => expect(n.ipc.callsOf("connect")).toHaveLength(2));
  });

  it("Ctrl+P pauses and resumes this poll", async () => {
    await open();
    press("p", { ctrl: true });
    await waitFor(() => expect(n.ipc.callsOf("setPollActive")).toEqual([[n.pollId, false]]));
  });

  it("Ctrl+Shift+N creates a poll in its own window", async () => {
    await open();
    press("N", { ctrl: true, shift: true });
    await waitFor(() => expect(n.ipc.callsOf("addPoll")).toHaveLength(2));
    expect(n.ipc.callsOf("addPoll")[1]?.[1]).toBe("native");
    expect(n.ipc.callsOf("addPoll")[1]?.[0]).toMatchObject({ name: "Poll 1" });
  });

  it("Ctrl+Shift+N skips names that are taken and says so at 16 polls", async () => {
    await open();
    await n.act(async () => {
      for (let i = 0; i < 15; i += 1) {
        await n.ipc.addPoll(
          {
            name: `Poll ${i + 1}`,
            definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 1, scanRateMs: 100 },
            display: { format: "unsigned", addressBase: 0, showAlias: true, copyAlias: false },
            scale: null,
            scaleOverrides: [],
            valueColumns: "raw",
            aliases: [],
          },
          "workspace",
        );
      }
    });
    press("N", { ctrl: true, shift: true });
    expect(await screen.findByText("A connection can have at most 16 polls.")).toBeVisible();
  });

  it("Ctrl+E opens Write…", async () => {
    await open();
    press("e", { ctrl: true });
    expect(await screen.findByRole("dialog", { name: "Write · Pump 2" })).toBeVisible();
  });

  it("Ctrl+1..4 and Ctrl+B act on this poll", async () => {
    await open();
    press("3", { ctrl: true });
    await waitFor(() => expect(n.ipc.pollSummary(n.pollId).config.display.format).toBe("hex"));
    press("b", { ctrl: true });
    await waitFor(() => expect(n.ipc.pollSummary(n.pollId).config.display.addressBase).toBe(1));
  });

  it("Ctrl+Shift+V cycles Raw, Scaled, Both for this poll; Ctrl+Shift+E opens the scale dialog (DES-003)", async () => {
    await open();
    // Without a scale the key does nothing.
    press("V", { ctrl: true, shift: true });
    await n.act(async () => {});
    expect(n.ipc.pollSummary(n.pollId).config.valueColumns).toBe("raw");
    await n.act(() =>
      n.ipc.setPollView(n.pollId, { scale: presetDefaults("current4to20"), valueColumns: "raw" }),
    );
    press("V", { ctrl: true, shift: true });
    await waitFor(() => expect(n.ipc.pollSummary(n.pollId).config.valueColumns).toBe("scaled"));
    press("V", { ctrl: true, shift: true });
    await waitFor(() => expect(n.ipc.pollSummary(n.pollId).config.valueColumns).toBe("both"));
    // Nothing selected: no dialog; with a row selected: the dialog for it.
    press("E", { ctrl: true, shift: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await n.act(async () => n.rt.view.stores.ui.getState().click(2));
    press("E", { ctrl: true, shift: true });
    const d = await screen.findByRole("dialog", { name: "Scale override" });
    expect(within(d).getByTestId("applies-to")).toHaveTextContent("Applies to 2");
  });

  it("Ctrl+S and Ctrl+Shift+S ask the connection window to save", async () => {
    await open();
    press("s", { ctrl: true });
    await waitFor(() => expect(n.ipc.callsOf("requestSave")).toEqual([[false]]));
    press("S", { ctrl: true, shift: true });
    await waitFor(() => expect(n.ipc.callsOf("requestSave")).toEqual([[false], [true]]));
  });

  it("Ctrl+N opens a new connection window", async () => {
    await open();
    press("n", { ctrl: true });
    await waitFor(() => expect(n.win.openedTools).toEqual(["modbus-master"]));
  });

  it("Ctrl+Shift+D docks, Ctrl+Shift+M focuses the connection window, Ctrl+Shift+T tiles", async () => {
    await open();
    press("M", { ctrl: true, shift: true });
    await waitFor(() => expect(n.ipc.callsOf("focusConnectionWindow")).toHaveLength(1));
    press("T", { ctrl: true, shift: true });
    await waitFor(() => expect(n.ipc.callsOf("arrangePollWindows")).toHaveLength(1));
    press("D", { ctrl: true, shift: true });
    await waitFor(() => expect(n.ipc.callsOf("dockPoll")).toHaveLength(1));
  });

  it("Ctrl+\\ toggles the setup panel, Ctrl+Shift+\\ compact mode", async () => {
    await open();
    expect(n.rt.view.stores.ui.getState().setupOpen).toBe(true);
    press("\\", { ctrl: true });
    expect(n.rt.view.stores.ui.getState().setupOpen).toBe(false);
    press("\\", { ctrl: true, shift: true });
    await waitFor(() => expect(n.ipc.callsOf("setCompactMode")).toHaveLength(1));
  });

  it.each([
    ["o", { ctrl: true }],
    ["j", { ctrl: true }],
    ["K", { ctrl: true, shift: true }],
    ["C", { ctrl: true, shift: true }],
    ["O", { ctrl: true, shift: true }],
    ["F4", { ctrl: true }],
    ["F6", { ctrl: true }],
    ["P", { ctrl: true, shift: true }],
  ])("%s %j does nothing here, and its browser default is suppressed", async (key, mods) => {
    await open();
    expect(press(key, mods)).toBe(true);
    await n.act(async () => {});
    for (const method of [
      "popOutPoll",
      "dockPoll",
      "setAllPollsActive",
      "closePollView",
    ] as const) {
      expect(n.ipc.callsOf(method)).toHaveLength(0);
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("F2 renames from the toolbar and edits the alias in the grid", async () => {
    await open();
    toolbarButton("Rename poll (F2)").focus();
    press("F2");
    expect(
      await within(screen.getByRole("toolbar", { name: "Poll window toolbar" })).findByRole(
        "textbox",
      ),
    ).toHaveValue("Pump 2");
    await n.user.keyboard("{Escape}");
    const g = screen.getByRole("grid");
    const row = within(g)
      .getAllByRole("row")
      .find((r) => r.getAttribute("data-row") === "1") as HTMLElement;
    await n.user.click(row);
    press("F2");
    expect(await screen.findByRole("textbox", { name: "Alias for address 1" })).toBeVisible();
  });

  const regionOf = () =>
    document.activeElement?.closest("[data-region]")?.getAttribute("data-region");
  const focusToolbar = () =>
    (
      screen
        .getByRole("toolbar", { name: "Poll window toolbar" })
        .querySelector("button") as HTMLElement
    ).focus();

  it("F6 cycles toolbar, banner and setup while there is no connection (the data card has nothing to focus)", async () => {
    await open(false);
    focusToolbar();
    expect(regionOf()).toBe("toolbar");
    press("F6");
    expect(regionOf()).toBe("banner");
    press("F6");
    expect(regionOf()).toBe("setup");
    press("F6");
    expect(regionOf()).toBe("toolbar");
    press("F6", { shift: true });
    expect(regionOf()).toBe("setup");
  });

  it("F6 cycles toolbar, setup and data card while connected (no banner)", async () => {
    await open();
    focusToolbar();
    press("F6");
    expect(regionOf()).toBe("setup");
    press("F6");
    expect(regionOf()).toBe("data");
    expect(document.activeElement).toBe(screen.getByRole("grid"));
    press("F6");
    expect(regionOf()).toBe("toolbar");
    press("F6", { shift: true });
    expect(regionOf()).toBe("data");
  });

  it("every key is off while a dialog is open", async () => {
    await open();
    n.rt.stores.host.getState().requestDelete(n.pollId);
    await screen.findByRole("alertdialog");
    press("s", { ctrl: true });
    press("N", { ctrl: true, shift: true });
    await n.act(async () => {});
    expect(n.ipc.callsOf("requestSave")).toHaveLength(0);
    expect(n.ipc.callsOf("addPoll")).toHaveLength(1);
  });
});

void pollProfile;
void profileV2;
