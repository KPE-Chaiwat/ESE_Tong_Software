// The Open profile (S3), Save profile as (S4) and confirm (S5) dialogs of the connection window and
// the flows behind them (FE-002 task 23): Open, Save, Save as, Disconnect and load, Save changes.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { clickWithLayoutShift } from "@/shared/lib/press-test-utils";
import { type Harness, renderWindow, TCP } from "../test-utils";
import { pollProfile, profileV2 } from "./profile-fixtures";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const toolbar = () => screen.getByRole("toolbar", { name: "Toolbar" });

async function menu(name: string, item: RegExp) {
  await h.user.click(within(toolbar()).getByRole("button", { name }));
  await h.user.click(await screen.findByRole("menuitem", { name: item }));
}

async function openList() {
  await menu("File", /^Open profile/);
  return screen.findByRole("dialog", { name: "Open profile" });
}

async function closeDialog() {
  await h.user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

/** The window has nothing unsaved (the polls it started with are the baseline). */
function clean() {
  h.rt.stores.profile.getState().setBaseline(h.rt.contentSignature());
}

async function validSetup() {
  await h.user.type(screen.getByLabelText("Host"), "192.168.1.10");
}

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

  it("shows the empty text and the error with Retry", async () => {
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
    expect(
      await within(dialog).findByText(
        "No saved profiles yet. Use Save as (Ctrl+Shift+S) to create one.",
      ),
    ).toBeVisible();
  });

  it("lists name, connection and modified, and filters case-insensitively", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([
          profileV2("Boiler-PLC"),
          profileV2("Pump-RTU", [pollProfile("Poll 1")], {
            connection: { mode: "tcp", host: "10.0.0.9", port: 502, timeoutMs: 1000 },
          }),
        ]);
      },
    });
    const dialog = await openList();
    expect(await within(dialog).findByText("Boiler-PLC")).toBeVisible();
    expect(within(dialog).getByText("TCP 10.0.0.9:502")).toBeVisible();
    await h.user.type(within(dialog).getByLabelText("Filter profiles"), "pump");
    expect(within(dialog).queryByText("Boiler-PLC")).not.toBeInTheDocument();
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
    await h.ipc.profilesSave(profileV2("Saved elsewhere"), false);
    dialog = await openList();
    expect(await within(dialog).findByText("Saved elsewhere")).toBeVisible();
  });

  it("Open replaces the polls and the connection form, never connects, and is not Modified", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Boiler-PLC", [pollProfile("Tank 1"), pollProfile("Pump 2")])]);
      },
    });
    await h.addPoll("Old");
    clean();
    const dialog = await openList();
    await h.user.click(await within(dialog).findByText("Boiler-PLC"));
    await h.user.click(within(dialog).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("Host")).toHaveValue("10.0.0.5"));
    expect(
      screen.getAllByRole("listitem").map((o) => o.getAttribute("aria-label") ?? o.textContent),
    ).toHaveLength(2);
    expect(within(toolbar()).getByText("Boiler-PLC")).toBeVisible();
    expect(screen.queryByText("· Modified")).not.toBeInTheDocument();
    expect(document.title).toBe("Modbus Master - Boiler-PLC - Not connected");
    expect(h.ipc.callsOf("connect")).toHaveLength(0);
    expect(h.ipc.pollIds()).toHaveLength(2);
  });

  it("an unreadable row shows its problem, cannot be opened, but can be deleted", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.setResult("profilesList", [
          {
            name: "Old",
            modifiedAt: 1,
            connectionSummary: "schema version 3 is not supported",
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

  it("a profile that cannot be read shows the toast and leaves the window as it was", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Boiler-PLC")]);
        ipc.failNext("profilesGet", "File is damaged");
      },
    });
    await h.addPoll("Keep me");
    clean();
    const dialog = await openList();
    await h.user.dblClick(await within(dialog).findByText("Boiler-PLC"));
    expect(await screen.findByText("Could not open profile: File is damaged")).toBeVisible();
    expect(h.ipc.callsOf("applyProfile")).toHaveLength(0);
    expect(h.ipc.pollIds()).toHaveLength(1);
  });

  it("a rejected apply shows the toast and keeps the polls", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Boiler-PLC")]);
        ipc.failNext("applyProfile", "Poll 1: slave id out of range");
      },
    });
    const keep = await h.addPoll("Keep me");
    clean();
    const dialog = await openList();
    await h.user.dblClick(await within(dialog).findByText("Boiler-PLC"));
    expect(
      await screen.findByText("Could not open profile: Poll 1: slave id out of range"),
    ).toBeVisible();
    expect(h.ipc.pollIds()).toEqual([keep]);
  });

  it("a schema 1 profile opens as one poll with the neutral notice, not Modified", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Old-file", [pollProfile("Poll 1")], { migratedFrom: 1 })]);
      },
    });
    const dialog = await openList();
    await h.user.dblClick(await within(dialog).findByText("Old-file"));
    const text =
      "This profile was saved by an earlier version. Saving stores it in the new format, which earlier versions cannot open.";
    expect(await screen.findByText(text)).toBeVisible();
    expect(screen.queryByText("· Modified")).not.toBeInTheDocument();
    expect(h.rt.stores.profile.getState().modified).toBe(false);
    await h.user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(text)).not.toBeInTheDocument();
  });

  it("saving a migrated profile hides the notice", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Old-file", [pollProfile("Poll 1")], { migratedFrom: 1 })]);
      },
    });
    const dialog = await openList();
    await h.user.dblClick(await within(dialog).findByText("Old-file"));
    await screen.findByText(/saved by an earlier version/);
    await h.act(async () => {
      await h.rt.actions.saveProfile();
    });
    expect(screen.queryByText(/saved by an earlier version/)).not.toBeInTheDocument();
    const saved = h.ipc.callsOf("profilesSave").at(-1) as unknown[];
    expect((saved[0] as { schemaVersion: number }).schemaVersion).toBe(6);
  });

  it("re-validates the connection after a load: a hand-edited value shows as invalid", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([
          profileV2("Broken", [pollProfile("Poll 1")], {
            connection: { mode: "tcp", host: "not a host!", port: 502, timeoutMs: 1000 },
          }),
        ]);
      },
    });
    const dialog = await openList();
    await h.user.dblClick(await within(dialog).findByText("Broken"));
    expect(
      await screen.findByText("Enter a valid host name or IPv4 address, for example 192.168.1.10."),
    ).toBeVisible();
  });

  it("loading while connected asks Disconnect and load?, then disconnects and applies", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Boiler-PLC")]);
      },
    });
    await h.addPoll("Pump 2");
    await h.connect();
    h.advance(300);
    clean();
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
    await waitFor(() => expect(h.rt.stores.profile.getState().name).toBe("Boiler-PLC"));
    expect(h.ipc.callsOf("applyProfile")).toHaveLength(1);
    expect(h.ipc.callsOf("connect")).toHaveLength(1);
    expect(h.rt.stores.connection.getState().state).toBe("idle");
  });

  it("Cancel on Disconnect and load? keeps the connection and the setup", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Boiler-PLC")]);
      },
    });
    await h.addPoll("Pump 2");
    await h.connect();
    clean();
    const dialog = await openList();
    await h.user.click(await within(dialog).findByText("Boiler-PLC"));
    await h.user.click(within(dialog).getByRole("button", { name: "Open" }));
    const confirm = await screen.findByRole("alertdialog");
    await h.user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(h.ipc.callsOf("disconnect")).toHaveLength(0);
    expect(h.ipc.callsOf("applyProfile")).toHaveLength(0);
    expect(h.rt.stores.connection.getState().state).toBe("connected");
  });

  it("with unsaved changes it asks Save changes? first: Cancel loads nothing", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Boiler-PLC")]);
      },
    });
    await h.addPoll("Unsaved");
    expect(h.rt.stores.profile.getState().modified).toBe(true);
    const dialog = await openList();
    await h.user.dblClick(await within(dialog).findByText("Boiler-PLC"));
    const confirm = await screen.findByRole("alertdialog", { name: "Save changes?" });
    expect(within(confirm).getByText("Save this setup as a profile before loading?")).toBeVisible();
    expect(within(confirm).getByRole("button", { name: "Save" })).toHaveFocus();
    await h.user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(h.ipc.callsOf("profilesGet")).toHaveLength(0);
  });

  it("Don't save loads the profile and drops the changes", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Boiler-PLC")]);
      },
    });
    await h.addPoll("Unsaved");
    const dialog = await openList();
    await h.user.dblClick(await within(dialog).findByText("Boiler-PLC"));
    const confirm = await screen.findByRole("alertdialog", { name: "Save changes?" });
    await h.user.click(within(confirm).getByRole("button", { name: "Don't save" }));
    await waitFor(() => expect(h.rt.stores.profile.getState().name).toBe("Boiler-PLC"));
    expect(h.rt.stores.profile.getState().modified).toBe(false);
  });

  it("Delete asks for a confirm with the safe button focused, then deletes", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Boiler-PLC"), profileV2("Pump-RTU")]);
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

  it("Rename rejects a case-insensitive duplicate; renaming the loaded profile updates the window", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Boiler-PLC"), profileV2("Pump-RTU")]);
      },
    });
    await h.act(() => h.rt.profileFlow.load("Pump-RTU"));
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
    await waitFor(() => expect(h.rt.stores.profile.getState().name).toBe("Pump-2"));
    expect(h.ipc.callsOf("setProfileName").at(-1)).toEqual(["Pump-2"]);
    expect(document.title).toBe("Modbus Master - Pump-2 - Not connected");
  });
});

describe("Save profile as dialog (S4)", () => {
  async function openSaveAs() {
    await menu("File", /^Save as/);
    return screen.findByRole("dialog", { name: "Save profile as" });
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

  it("one click on [Save] works when the blur of Name shows a message and moves the button (D4)", async () => {
    h = await renderWindow();
    await validSetup();
    const dialog = await openSaveAs();
    const name = within(dialog).getByLabelText("Name");
    await h.user.clear(name);
    await clickWithLayoutShift(
      h.user,
      within(dialog).getByRole("button", { name: "Save" }),
      () => within(dialog).queryByText("Enter a profile name.") !== null,
      () => within(dialog).getByText("Enter a profile name."),
    );
    expect(within(dialog).getByText("Enter a profile name.")).toBeVisible();
    expect(name).toHaveFocus();
    expect(h.ipc.callsOf("profilesSave")).toHaveLength(0);
  });

  it("saves the exported profile, closes, shows the name and clears Modified", async () => {
    h = await renderWindow();
    await validSetup();
    await h.addPoll("Tank 1");
    expect(h.rt.stores.profile.getState().modified).toBe(true);
    const dialog = await openSaveAs();
    await h.user.type(within(dialog).getByLabelText("Name"), "Boiler-PLC");
    await h.user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(toolbar()).getByText("Boiler-PLC")).toBeVisible();
    expect(screen.queryByText("· Modified")).not.toBeInTheDocument();
    const saved = await h.ipc.profilesGet("Boiler-PLC");
    expect(saved.schemaVersion).toBe(6);
    expect(saved.connection).toMatchObject({ mode: "tcp", host: "192.168.1.10" });
    expect(saved.polls.map((p) => p.name)).toEqual(["Tank 1"]);
    expect(h.ipc.callsOf("setProfileName").at(-1)).toEqual(["Boiler-PLC"]);
  });

  it("an existing name asks Replace profile? with Cancel focused", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Boiler-PLC")]);
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
    expect(h.rt.stores.profile.getState().name).toBe("boiler-plc");
    expect((await h.ipc.profilesGet("Boiler-PLC")).connection).toMatchObject({
      host: "192.168.1.10",
    });
  });

  it("Cancel in the Replace confirm keeps Save as open and overwrites nothing", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Boiler-PLC")]);
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

  it("with an invalid connection field nothing is saved and the toast explains", async () => {
    h = await renderWindow();
    await menu("File", /^Save as/);
    expect(await screen.findByText("Fix the highlighted fields before saving.")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Save profile as" })).not.toBeInTheDocument();
    expect(screen.getByText("Enter a host name or IPv4 address.")).toBeVisible();
    expect(h.ipc.callsOf("exportProfile")).toHaveLength(0);
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

  it("Ctrl+O opens the profile list", async () => {
    h = await renderWindow();
    act(() => {
      fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    });
    expect(await screen.findByRole("dialog", { name: "Open profile" })).toBeVisible();
  });

  it("Ctrl+S on a named profile saves it directly, over the old file, and clears Modified", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Boiler-PLC")]);
      },
    });
    await h.act(() => h.rt.profileFlow.load("Boiler-PLC"));
    await h.addPoll("Extra");
    expect(screen.getByText("· Modified")).toBeVisible();
    expect(document.title).toBe("Modbus Master - Boiler-PLC * - Not connected");
    act(() => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    });
    await waitFor(() => expect(screen.queryByText("· Modified")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect((await h.ipc.profilesGet("Boiler-PLC")).polls.map((p) => p.name)).toEqual([
      "Poll 1",
      "Extra",
    ]);
    expect(h.ipc.callsOf("profilesSave").at(-1)?.[1]).toBe(true);
  });

  it("a failed save shows 'Could not save profile: {message}' and stays Modified", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Boiler-PLC")]);
      },
    });
    await h.act(() => h.rt.profileFlow.load("Boiler-PLC"));
    await h.addPoll("Extra");
    h.ipc.failNext("profilesSave", "Disk full");
    await h.act(async () => {
      await h.rt.actions.saveProfile();
    });
    expect(await screen.findByText("Could not save profile: Disk full")).toBeVisible();
    expect(h.rt.stores.profile.getState().modified).toBe(true);
  });
});

describe("closing with unsaved changes (DES-002 2.11)", () => {
  it("Save in 'Save changes?' saves the profile and closes the window", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Boiler-PLC")]);
      },
    });
    await h.act(() => h.rt.profileFlow.load("Boiler-PLC"));
    await h.addPoll("Extra");
    const closing = h.rt.actions.closeWindow();
    const confirm = await screen.findByRole("alertdialog", { name: "Save changes?" });
    expect(within(confirm).getByText('Save changes to "Boiler-PLC" before closing?')).toBeVisible();
    await h.user.click(within(confirm).getByRole("button", { name: "Save" }));
    await closing;
    expect(h.ipc.callsOf("profilesSave")).toHaveLength(1);
    expect(h.win.closed).toBe(true);
  });

  it("an untitled setup opens Save as from the close question", async () => {
    h = await renderWindow();
    await validSetup();
    await h.addPoll("Extra");
    const closing = h.rt.actions.closeWindow();
    const confirm = await screen.findByRole("alertdialog", { name: "Save changes?" });
    await h.user.click(within(confirm).getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog", { name: "Save profile as" });
    await h.user.type(within(dialog).getByLabelText("Name"), "New-one");
    await h.user.click(within(dialog).getByRole("button", { name: "Save" }));
    await closing;
    expect(h.ipc.callsOf("profilesSave")).toHaveLength(1);
    expect(h.win.closed).toBe(true);
  });

  it("a blocked save (invalid connection) keeps the window open", async () => {
    h = await renderWindow();
    await h.addPoll("Extra");
    const closing = h.rt.actions.closeWindow();
    const confirm = await screen.findByRole("alertdialog", { name: "Save changes?" });
    await h.user.click(within(confirm).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Fix the highlighted fields before saving.")).toBeVisible();
    expect(h.win.closed).toBe(false);
    await h.user.click(screen.getByRole("button", { name: "Cancel" }));
    await closing;
    expect(h.win.closed).toBe(false);
  });
});

describe("save requests of a native window (DES-002 3.1)", () => {
  it("a named profile is saved without a dialog", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Boiler-PLC")]);
      },
    });
    await h.act(() => h.rt.profileFlow.load("Boiler-PLC"));
    await h.addPoll("Extra");
    await h.act(() => h.ipc.requestSave(false));
    await waitFor(() => expect(h.ipc.callsOf("profilesSave")).toHaveLength(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(h.rt.stores.profile.getState().modified).toBe(false));
  });

  it("an untitled profile brings W1 to the front and opens Save as", async () => {
    h = await renderWindow();
    await validSetup();
    void h.ipc.requestSave(false);
    expect(await screen.findByRole("dialog", { name: "Save profile as" })).toBeVisible();
    expect(h.ipc.callsOf("focusConnectionWindow")).toHaveLength(1);
    await closeDialog();
  });

  it("Save as always asks for a name", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Boiler-PLC")]);
      },
    });
    await h.act(() => h.rt.profileFlow.load("Boiler-PLC"));
    await h.act(() => h.ipc.requestSave(true));
    expect(await screen.findByRole("dialog", { name: "Save profile as" })).toBeVisible();
    await closeDialog();
  });

  it("an invalid connection field brings W1 to the front with the toast", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Boiler-PLC")]);
      },
    });
    await h.act(() => h.rt.profileFlow.load("Boiler-PLC"));
    const host = screen.getByLabelText("Host");
    await h.user.clear(host);
    await h.act(() => h.ipc.requestSave(false));
    expect(await screen.findByText("Fix the highlighted fields before saving.")).toBeVisible();
    expect(h.ipc.callsOf("focusConnectionWindow")).toHaveLength(1);
    expect(h.ipc.callsOf("profilesSave")).toHaveLength(0);
  });
});

void TCP;
