import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Profile } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow, TCP } from "../test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

function profile(name: string, host = "10.0.0.5"): Profile {
  return {
    schemaVersion: 1,
    name,
    connection: { mode: "tcp", host, port: 502, timeoutMs: 1000 },
    poll: { slaveId: 2, function: 4, startAddress: 5, quantity: 3, scanRateMs: 250 },
    display: { format: "hex", addressBase: 1 },
    autoStartPoll: false,
  };
}

async function openList() {
  await h.user.click(screen.getByRole("button", { name: "Open…" }));
  return screen.findByRole("dialog", { name: "Open profile" });
}

const toolbar = () => screen.getByRole("toolbar", { name: "Toolbar" });

describe("Open profile dialog (S3)", () => {
  it("shows Loading profiles… while the list is read", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.hold("profilesList");
      },
    });
    const dialog = await openList();
    expect(within(dialog).getByText("Loading profiles…")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Open" })).toBeDisabled();
  });

  it("shows the empty text", async () => {
    h = await renderWindow();
    const dialog = await openList();
    expect(
      await within(dialog).findByText(
        "No saved profiles yet. Use Save as (Ctrl+Shift+S) to create one.",
      ),
    ).toBeVisible();
  });

  it("shows the error with Retry", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.failNext("profilesList", "Disk unavailable");
      },
    });
    const dialog = await openList();
    expect(
      await within(dialog).findByText(/Could not load profiles: Disk unavailable/),
    ).toBeVisible();
    await h.user.click(within(dialog).getByRole("button", { name: "Retry" }));
    expect(await within(dialog).findByText(/No saved profiles yet/)).toBeVisible();
  });

  it("lists name, connection and modified, and filters case-insensitively", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profile("Boiler-PLC"), profile("Pump-RTU", "10.0.0.9")]);
      },
    });
    const dialog = await openList();
    expect(await within(dialog).findByText("Boiler-PLC")).toBeVisible();
    expect(within(dialog).getByText("TCP 10.0.0.9:502")).toBeVisible();
    await h.user.type(within(dialog).getByLabelText("Filter profiles"), "pump");
    expect(within(dialog).queryByText("Boiler-PLC")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Pump-RTU")).toBeVisible();
    await h.user.clear(within(dialog).getByLabelText("Filter profiles"));
    await h.user.type(within(dialog).getByLabelText("Filter profiles"), "zzz");
    expect(within(dialog).getByText('No profiles match "zzz".')).toBeVisible();
  });

  it("re-reads the list every time it opens", async () => {
    h = await renderWindow();
    let dialog = await openList();
    await within(dialog).findByText(/No saved profiles yet/);
    await h.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await h.ipc.profilesSave(profile("Saved elsewhere"), false);
    dialog = await openList();
    expect(await within(dialog).findByText("Saved elsewhere")).toBeVisible();
  });

  it("Open loads the profile into the window and never connects", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profile("Boiler-PLC")]);
      },
    });
    const dialog = await openList();
    await h.user.click(await within(dialog).findByText("Boiler-PLC"));
    await h.user.click(within(dialog).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("Host")).toHaveValue("10.0.0.5"));
    expect(within(toolbar()).getByText("Boiler-PLC")).toBeVisible();
    expect(document.title).toBe("Modbus Master - Boiler-PLC - Not connected");
    expect(screen.queryByText("Modified")).not.toBeInTheDocument();
    expect(h.ipc.callsOf("connect")).toHaveLength(0);
  });

  it("an unreadable profile shows its problem, cannot be opened, but can be deleted", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.setResult("profilesList", [
          {
            name: "Old",
            modifiedAt: 1,
            connectionSummary: "schema version 9 is not supported",
            readable: false,
          },
          { name: "Good", modifiedAt: 2, connectionSummary: "TCP h:1", readable: true },
        ]);
      },
    });
    const dialog = await openList();
    expect(
      await within(dialog).findByText("Cannot be opened (newer or damaged file)"),
    ).toBeVisible();
    await h.user.click(within(dialog).getByText("Old"));
    expect(within(dialog).getByRole("button", { name: "Open" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeEnabled();
    await h.user.dblClick(within(dialog).getByText("Old"));
    expect(h.ipc.callsOf("profilesGet")).toHaveLength(0);
    await h.user.click(within(dialog).getByText("Good"));
    expect(within(dialog).getByRole("button", { name: "Open" })).toBeEnabled();
  });

  it("double-click opens a profile", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profile("Boiler-PLC")]);
      },
    });
    const dialog = await openList();
    await h.user.dblClick(await within(dialog).findByText("Boiler-PLC"));
    await waitFor(() => expect(h.rt.stores.config.getState().profileName).toBe("Boiler-PLC"));
  });

  it("loading while polling asks Disconnect and load?, then disconnects and applies", async () => {
    h = await renderWindow({
      prepare: ({ rt, ipc }) => {
        ipc.seedProfiles([profile("Boiler-PLC")]);
        rt.stores.config.getState().setConnection(TCP);
        rt.stores.config.getState().markSaved("Current");
      },
    });
    h.state("connecting");
    h.state("connected");
    h.state("polling");
    const dialog = await openList();
    await h.user.click(await within(dialog).findByText("Boiler-PLC"));
    await h.user.click(within(dialog).getByRole("button", { name: "Open" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Disconnect and load?" });
    expect(
      within(confirm).getByText('Loading "Boiler-PLC" will disconnect from TCP 192.168.1.10:502.'),
    ).toBeVisible();
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await h.user.click(within(confirm).getByRole("button", { name: "Disconnect and load" }));
    await waitFor(() => expect(h.ipc.callsOf("disconnect")).toHaveLength(1));
    h.state("idle");
    await waitFor(() => expect(h.rt.stores.config.getState().profileName).toBe("Boiler-PLC"));
    expect(h.ipc.callsOf("connect")).toHaveLength(0);
  });

  it("Cancel on Disconnect and load? keeps the connection and the setup", async () => {
    h = await renderWindow({
      prepare: ({ rt, ipc }) => {
        ipc.seedProfiles([profile("Boiler-PLC")]);
        rt.stores.config.getState().setConnection(TCP);
        rt.stores.config.getState().markSaved("Current");
      },
    });
    h.state("connecting");
    h.state("connected");
    const dialog = await openList();
    await h.user.click(await within(dialog).findByText("Boiler-PLC"));
    await h.user.click(within(dialog).getByRole("button", { name: "Open" }));
    const confirm = await screen.findByRole("alertdialog");
    await h.user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(h.ipc.callsOf("disconnect")).toHaveLength(0);
    expect(h.rt.stores.config.getState().profileName).toBe("Current");
  });

  it("Delete asks for a confirm with the safe button focused, then deletes", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profile("Boiler-PLC"), profile("Pump-RTU")]);
      },
    });
    const dialog = await openList();
    await h.user.click(await within(dialog).findByText("Boiler-PLC"));
    await h.user.click(within(dialog).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Delete profile?" });
    expect(within(confirm).getByText('Delete "Boiler-PLC"? This cannot be undone.')).toBeVisible();
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await h.user.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(within(dialog).queryByText("Boiler-PLC")).not.toBeInTheDocument());
    expect(within(dialog).getByText("Pump-RTU")).toBeVisible();
  });

  it("Cancel in the Delete confirm keeps the profile", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profile("Boiler-PLC")]);
      },
    });
    const dialog = await openList();
    await h.user.click(await within(dialog).findByText("Boiler-PLC"));
    await h.user.click(within(dialog).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog");
    await h.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(within(dialog).getByText("Boiler-PLC")).toBeVisible();
    expect(confirm).not.toBeInTheDocument();
  });

  it("Rename edits inline, rejects a case-insensitive duplicate and then accepts a new name", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profile("Boiler-PLC"), profile("Pump-RTU")]);
      },
    });
    const dialog = await openList();
    await h.user.click(await within(dialog).findByText("Pump-RTU"));
    await h.user.click(within(dialog).getByRole("button", { name: "Rename" }));
    const input = within(dialog).getByLabelText("New profile name");
    await h.user.clear(input);
    await h.user.type(input, "boiler-plc{Enter}");
    expect(
      await within(dialog).findByText('A profile named "boiler-plc" already exists.'),
    ).toBeVisible();
    await h.user.clear(input);
    await h.user.type(input, "Pump-2{Enter}");
    expect(await within(dialog).findByText("Pump-2")).toBeVisible();
    expect(within(dialog).queryByText("Pump-RTU")).not.toBeInTheDocument();
  });

  it("renaming the loaded profile switches the toolbar and the title", async () => {
    h = await renderWindow({
      prepare: ({ ipc, rt }) => {
        ipc.seedProfiles([profile("Boiler-PLC")]);
        rt.stores.config.getState().applyProfile(profile("Boiler-PLC"));
      },
    });
    const dialog = await openList();
    await h.user.click(await within(dialog).findByText("Boiler-PLC"));
    await h.user.click(within(dialog).getByRole("button", { name: "Rename" }));
    const input = within(dialog).getByLabelText("New profile name");
    await h.user.clear(input);
    await h.user.type(input, "Boiler-2{Enter}");
    await waitFor(() => expect(h.rt.stores.config.getState().profileName).toBe("Boiler-2"));
    expect(document.title).toBe("Modbus Master - Boiler-2 - Not connected");
  });

  it("Esc cancels an inline rename", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profile("Boiler-PLC")]);
      },
    });
    const dialog = await openList();
    await h.user.click(await within(dialog).findByText("Boiler-PLC"));
    await h.user.click(within(dialog).getByRole("button", { name: "Rename" }));
    await h.user.keyboard("{Escape}");
    expect(within(dialog).queryByLabelText("New profile name")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Boiler-PLC")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Open profile" })).toBeVisible();
  });
});

describe("Save profile as dialog (S4)", () => {
  async function openSaveAs() {
    await h.user.click(screen.getByRole("button", { name: "Save as…" }));
    return screen.findByRole("dialog", { name: "Save profile as" });
  }

  async function validSetup() {
    await h.user.type(screen.getByLabelText("Host"), "192.168.1.10");
  }

  it("validates the name with the DES messages", async () => {
    h = await renderWindow();
    await validSetup();
    const dialog = await openSaveAs();
    expect(within(dialog).getByText("Saves connection, poll and display settings.")).toBeVisible();
    await h.user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText("Enter a profile name.")).toBeVisible();
    const name = within(dialog).getByLabelText("Name");
    await h.user.type(name, "a/b");
    expect(
      within(dialog).getByText('Profile name cannot contain \\ / : * ? " < > |'),
    ).toBeVisible();
    await h.user.clear(name);
    await h.user.type(name, "x".repeat(65));
    expect(within(dialog).getByText("Profile name must be at most 64 characters.")).toBeVisible();
    expect(h.ipc.callsOf("profilesSave")).toHaveLength(0);
  });

  it("saves, closes and shows the name in the toolbar without the Modified marker", async () => {
    h = await renderWindow();
    await validSetup();
    const dialog = await openSaveAs();
    await h.user.type(within(dialog).getByLabelText("Name"), "Boiler-PLC");
    await h.user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(toolbar()).getByText("Boiler-PLC")).toBeVisible();
    expect(screen.queryByText("Modified")).not.toBeInTheDocument();
    expect((await h.ipc.profilesList()).map((p) => p.name)).toEqual(["Boiler-PLC"]);
  });

  it("an existing name asks Replace profile? with Cancel focused", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profile("Boiler-PLC")]);
      },
    });
    await validSetup();
    const dialog = await openSaveAs();
    await h.user.type(within(dialog).getByLabelText("Name"), "boiler-plc");
    await h.user.click(within(dialog).getByRole("button", { name: "Save" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Replace profile?" });
    expect(
      within(confirm).getByText('A profile named "boiler-plc" already exists. Replace it?'),
    ).toBeVisible();
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await h.user.click(within(confirm).getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.rt.stores.config.getState().profileName).toBe("boiler-plc");
    const saved = await h.ipc.profilesGet("Boiler-PLC");
    expect(saved.connection).toMatchObject({ host: "192.168.1.10" });
  });

  it("Cancel in the Replace confirm keeps the Save as dialog open and saves nothing", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profile("Boiler-PLC")]);
      },
    });
    await validSetup();
    const dialog = await openSaveAs();
    await h.user.type(within(dialog).getByLabelText("Name"), "Boiler-PLC");
    await h.user.click(within(dialog).getByRole("button", { name: "Save" }));
    const confirm = await screen.findByRole("alertdialog");
    await h.user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Save profile as" })).toBeVisible();
    // Only the first attempt (without overwrite) was made, and the backend refused it.
    expect(h.ipc.callsOf("profilesSave").map((c) => c[1])).toEqual([false]);
  });

  it("Cancel closes without saving", async () => {
    h = await renderWindow();
    await validSetup();
    const dialog = await openSaveAs();
    await h.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.ipc.callsOf("profilesSave")).toHaveLength(0);
  });

  it("Ctrl+S on an untitled setup opens Save as, Ctrl+Shift+S always does", async () => {
    h = await renderWindow();
    await validSetup();
    act(() => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    });
    expect(await screen.findByRole("dialog", { name: "Save profile as" })).toBeVisible();
    await h.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    act(() => {
      fireEvent.keyDown(window, { key: "S", ctrlKey: true, shiftKey: true });
    });
    expect(await screen.findByRole("dialog", { name: "Save profile as" })).toBeVisible();
  });

  it("Ctrl+S on a named profile saves it directly and clears the Modified marker", async () => {
    h = await renderWindow({
      prepare: ({ rt }) => {
        rt.stores.config.getState().applyProfile(profile("Boiler-PLC"));
      },
    });
    await h.user.click(screen.getByRole("radio", { name: "Binary" }));
    expect(screen.getByText("Modified")).toBeVisible();
    expect(document.title).toBe("Modbus Master - Boiler-PLC * - Not connected");
    act(() => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    });
    await waitFor(() => expect(screen.queryByText("Modified")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect((await h.ipc.profilesGet("Boiler-PLC")).display.format).toBe("binary");
  });
});
