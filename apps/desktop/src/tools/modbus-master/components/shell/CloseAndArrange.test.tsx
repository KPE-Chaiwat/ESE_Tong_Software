import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import { IpcError } from "@/shared/ipc/errors";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

async function openFileMenu() {
  await h.user.click(screen.getByRole("button", { name: "File" }));
}
async function closeWindowFromMenu() {
  await openFileMenu();
  await h.user.click(screen.getByRole("menuitem", { name: /^Close window/ }));
}
const dialog = () => screen.findByRole("alertdialog");

describe("closing the connection window (DES-002 2.11)", () => {
  it("File > Close window closes at once when nothing is unsaved: no dialog", async () => {
    h = await renderWindow();
    await h.addPoll("Pump 2");
    h.clean();
    await closeWindowFromMenu();
    await waitFor(() => expect(h.win.closed).toBe(true));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("an unsaved profile asks 'Save changes?' with the three buttons; Cancel keeps the window", async () => {
    h = await renderWindow();
    await h.act(() => h.rt.stores.profile.getState().setName("Boiler-PLC"));
    await h.act(() => h.rt.stores.profile.getState().setModified(true));
    await closeWindowFromMenu();
    const d = await dialog();
    expect(within(d).getByText("Save changes?")).toBeVisible();
    expect(d).toHaveTextContent('Save changes to "Boiler-PLC" before closing?');
    expect(within(d).getByRole("button", { name: "Save" })).toBeVisible();
    expect(within(d).getByRole("button", { name: "Don't save" })).toBeVisible();
    await h.user.click(within(d).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(h.win.closed).toBe(false);
  });

  it("an unnamed setup asks to save it as a profile", async () => {
    h = await renderWindow();
    await h.act(() => h.rt.stores.profile.getState().setModified(true));
    await closeWindowFromMenu();
    expect(await dialog()).toHaveTextContent("Save this setup as a profile before closing?");
  });

  it("Don't save closes the window", async () => {
    h = await renderWindow();
    await h.act(() => h.rt.stores.profile.getState().setModified(true));
    await closeWindowFromMenu();
    await h.user.click(within(await dialog()).getByRole("button", { name: "Don't save" }));
    await waitFor(() => expect(h.win.closed).toBe(true));
  });

  it("Save is the default button, enabled, and saves the profile (FE-002 task 23)", async () => {
    h = await renderWindow();
    await h.act(() => h.rt.stores.profile.getState().setModified(true));
    await closeWindowFromMenu();
    const d = await dialog();
    const save = within(d).getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    expect(save).toHaveFocus();
  });

  it("with a profile save, Save is the default button, saves, and then closes", async () => {
    const save = vi.fn(async () => true);
    h = await renderWindow({ runtimeOptions: { saveProfile: save } });
    await h.act(() => h.rt.stores.profile.getState().setModified(true));
    await closeWindowFromMenu();
    const d = await dialog();
    expect(within(d).getByRole("button", { name: "Save" })).toHaveFocus();
    await h.user.click(within(d).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.win.closed).toBe(true));
    expect(save).toHaveBeenCalledOnce();
  });

  it("a save that fails keeps the dialog and the window", async () => {
    const save = vi.fn(async () => false);
    h = await renderWindow({ runtimeOptions: { saveProfile: save } });
    await h.act(() => h.rt.stores.profile.getState().setModified(true));
    await closeWindowFromMenu();
    await h.user.click(within(await dialog()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(h.win.closed).toBe(false);
  });

  it("names the poll windows that close with it and the polls with unapplied edits, in list order", async () => {
    h = await renderWindow();
    await h.act(() => h.rt.stores.profile.getState().setName("Boiler-PLC"));
    await h.act(() => h.rt.stores.profile.getState().setModified(true));
    await h.addPoll("Tank");
    const pump = await h.addPoll("Pump 2");
    await h.addPoll("N1", {}, "native");
    await h.addPoll("N2", {}, "native");
    await h.act(() => h.ipc.setPollView(pump, { hasUnappliedEdits: true }));
    await closeWindowFromMenu();
    expect(await dialog()).toHaveTextContent(
      'Save changes to "Boiler-PLC" before closing? This also closes 2 poll windows. Unapplied edits in: Pump 2.',
    );
  });

  it("one poll window reads '1 poll window'", async () => {
    h = await renderWindow();
    await h.act(() => h.rt.stores.profile.getState().setModified(true));
    await h.addPoll("N1", {}, "native");
    await closeWindowFromMenu();
    expect(await dialog()).toHaveTextContent("This also closes 1 poll window.");
  });

  it("unapplied edits alone ask, even when the profile is saved", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    await h.act(() => h.ipc.setPollView(a, { hasUnappliedEdits: true }));
    await closeWindowFromMenu();
    expect(await dialog()).toHaveTextContent("Unapplied edits in: Pump 2.");
  });

  it("popped-out windows alone do not ask: the window closes with all of them", async () => {
    h = await renderWindow();
    await h.addPoll("N1", {}, "native");
    await h.addPoll("N2", {}, "native");
    h.clean();
    await closeWindowFromMenu();
    await waitFor(() => expect(h.win.closed).toBe(true));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("the OS close request (Alt+F4, the close button) asks the same question and waits for it", async () => {
    h = await renderWindow();
    await h.act(() => h.rt.stores.profile.getState().setModified(true));
    const closing = h.win.requestClose();
    const d = await dialog();
    expect(h.win.closed).toBe(false);
    await h.user.click(within(d).getByRole("button", { name: "Cancel" }));
    await expect(closing).resolves.toBe(false);
    expect(h.win.closed).toBe(false);
    // Asked again: Don't save lets it close.
    const again = h.win.requestClose();
    await h.user.click(within(await dialog()).getByRole("button", { name: "Don't save" }));
    await expect(again).resolves.toBe(true);
  });

  it("the OS close request closes at once when nothing is unsaved", async () => {
    h = await renderWindow();
    await expect(h.win.requestClose()).resolves.toBe(true);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("the dialog is modal: the shortcuts are off while it is open", async () => {
    h = await renderWindow();
    await h.act(() => h.rt.stores.profile.getState().setModified(true));
    void h.win.requestClose();
    await dialog();
    expect(h.rt.stores.layout.getState().modalOpen).toBe(true);
    fireEvent.keyDown(window, { key: "n", ctrlKey: true, shiftKey: true });
    await h.act(async () => {});
    expect(h.ipc.callsOf("addPoll")).toHaveLength(0);
  });
});

describe("Window > Popped-out windows (DES-002 2.8.5)", () => {
  async function openSubmenu() {
    await h.user.click(screen.getByRole("button", { name: "Window" }));
    await h.user.click(screen.getByRole("menuitem", { name: "Popped-out windows" }));
  }

  it("is disabled with the exact title while no poll is in its own window", async () => {
    h = await renderWindow();
    await h.addPoll("Tank");
    await h.user.click(screen.getByRole("button", { name: "Window" }));
    const item = screen.getByRole("menuitem", { name: "Popped-out windows" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveAttribute("title", "No poll is open in its own window.");
  });

  it("lists Tile, Side by side, Stacked, Cascade and 'Arrange on:' with Display 1 (primary) first", async () => {
    h = await renderWindow();
    await h.addPoll("N1", {}, "native");
    await openSubmenu();
    const sub = screen.getByRole("menu", { name: "Popped-out windows" });
    await within(sub).findByRole("menuitemradio", { name: "Display 1 (primary)" });
    expect(
      Array.from(sub.querySelectorAll('[role^="menuitem"]')).map((i) => i.textContent),
    ).toEqual([
      "Tile",
      "Side by side",
      "Stacked",
      "Cascade",
      "Each monitor (in place)",
      "Display 1 (primary)",
    ]);
    expect(
      within(sub).getByRole("menuitemradio", { name: "Each monitor (in place)" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("every display of the system is listed, the primary first", async () => {
    h = await renderWindow();
    h.win.monitors = [
      {
        id: "D1",
        label: "Display 1",
        name: "D1",
        primary: true,
        workArea: { x: 0, y: 0, width: 1920, height: 1032 },
        scaleFactor: 1,
      },
      {
        id: "D2",
        label: "Display 2",
        name: "D2",
        primary: false,
        workArea: { x: 1920, y: 0, width: 1920, height: 1032 },
        scaleFactor: 1,
      },
    ];
    await h.addPoll("N1", {}, "native");
    await openSubmenu();
    const sub = screen.getByRole("menu", { name: "Popped-out windows" });
    await within(sub).findByRole("menuitemradio", { name: "Display 2" });
    expect(
      within(sub)
        .getAllByRole("menuitemradio")
        .map((i) => i.textContent),
    ).toEqual(["Each monitor (in place)", "Display 1 (primary)", "Display 2"]);
  });

  it("Tile arranges the windows of the connection on each monitor and says nothing when they fit", async () => {
    h = await renderWindow();
    await h.addPoll("N1", {}, "native");
    await h.addPoll("N2", {}, "native");
    await openSubmenu();
    await h.user.click(
      within(screen.getByRole("menu", { name: "Popped-out windows" })).getByRole("menuitem", {
        name: "Tile",
      }),
    );
    await waitFor(() => expect(h.ipc.callsOf("arrangePollWindows")).toHaveLength(1));
    expect(h.ipc.callsOf("arrangePollWindows")[0]).toEqual(["tile", { kind: "eachMonitor" }]);
    expect(screen.queryByText(/did not fit/)).not.toBeInTheDocument();
    // The workspace is not tiled by it.
    expect(h.rt.stores.workspace.getState().tileMode).toBe(false);
  });

  it("the Window menu resets the grid without arranging native windows", async () => {
    h = await renderWindow();
    await h.addPoll("A");
    await h.addPoll("N1", {}, "native");
    await h.user.click(screen.getByRole("button", { name: "Window" }));
    await h.user.click(screen.getByRole("menuitem", { name: /^Reset grid layout/ }));
    expect(h.rt.stores.workspace.getState().tileMode).toBe(false);
    expect(h.ipc.callsOf("arrangePollWindows")).toHaveLength(0);
  });

  it("a display is remembered for the next arrange and shown checked when the menu opens again", async () => {
    h = await renderWindow();
    await h.addPoll("N1", {}, "native");
    await openSubmenu();
    let sub = screen.getByRole("menu", { name: "Popped-out windows" });
    await h.user.click(
      await within(sub).findByRole("menuitemradio", { name: "Display 1 (primary)" }),
    );
    expect(h.rt.stores.arrange.getState().target).toEqual({
      kind: "monitor",
      monitorId: "\\\\.\\DISPLAY1",
    });
    await openSubmenu();
    sub = screen.getByRole("menu", { name: "Popped-out windows" });
    expect(
      await within(sub).findByRole("menuitemradio", { name: "Display 1 (primary)" }),
    ).toHaveAttribute("aria-checked", "true");
    await h.user.click(within(sub).getByRole("menuitem", { name: "Side by side" }));
    await waitFor(() => expect(h.ipc.callsOf("arrangePollWindows")).toHaveLength(1));
    expect(h.ipc.callsOf("arrangePollWindows")[0]).toEqual([
      "sideBySide",
      { kind: "monitor", monitorId: "\\\\.\\DISPLAY1" },
    ]);
  });

  it("windows that did not fit are announced in a toast", async () => {
    h = await renderWindow();
    await h.addPoll("N1", {}, "native");
    h.ipc.setResult("arrangePollWindows", { arranged: 13, overflow: 1 });
    await openSubmenu();
    await h.user.click(
      within(screen.getByRole("menu", { name: "Popped-out windows" })).getByRole("menuitem", {
        name: "Tile",
      }),
    );
    expect(await screen.findByText("1 window did not fit and was cascaded.")).toBeVisible();
  });

  it("a display that went away: the toast, and the target is each monitor again", async () => {
    h = await renderWindow();
    await h.addPoll("N1", {}, "native");
    await h.act(async () => {
      h.rt.stores.arrange.getState().setTarget({ kind: "monitor", monitorId: "gone" });
    });
    h.ipc.failNext(
      "arrangePollWindows",
      new IpcError("That display is no longer connected.", "validation", "monitor"),
    );
    await openSubmenu();
    await h.user.click(
      within(screen.getByRole("menu", { name: "Popped-out windows" })).getByRole("menuitem", {
        name: "Cascade",
      }),
    );
    expect(await screen.findByText("That display is no longer connected.")).toBeVisible();
    expect(h.rt.stores.arrange.getState().target).toEqual({ kind: "eachMonitor" });
  });

  it("the only window docked between the click and the command: 'No poll is open in its own window.'", async () => {
    h = await renderWindow();
    await h.addPoll("N1", {}, "native");
    h.ipc.setResult("arrangePollWindows", { arranged: 0, overflow: 0 });
    await openSubmenu();
    await h.user.click(
      within(screen.getByRole("menu", { name: "Popped-out windows" })).getByRole("menuitem", {
        name: "Stacked",
      }),
    );
    expect(await screen.findByText("No poll is open in its own window.")).toBeVisible();
  });

  it("Bring popped-out windows to front shows them all", async () => {
    h = await renderWindow();
    const n = (await h.addPoll("N1", {}, "native")) as PollId;
    await h.user.click(screen.getByRole("button", { name: "Window" }));
    await h.user.click(
      screen.getByRole("menuitem", { name: /^Bring popped-out windows to front/ }),
    );
    await waitFor(() => expect(h.ipc.callsOf("showPollWindows")).toHaveLength(1));
    expect(h.ipc.focused).toContain(n);
  });
});
