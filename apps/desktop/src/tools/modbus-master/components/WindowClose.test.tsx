import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Profile } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow } from "./test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const profile: Profile = {
  schemaVersion: 1,
  name: "Boiler-PLC",
  connection: { mode: "tcp", host: "10.0.0.5", port: 502, timeoutMs: 1000 },
  poll: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 },
  display: { format: "unsigned", addressBase: 0 },
  autoStartPoll: true,
};

describe("closing a window (task 17)", () => {
  it("closes at once when nothing changed", async () => {
    h = await renderWindow();
    await expect(h.win.requestClose()).resolves.toBe(true);
    expect(h.win.closed).toBe(true);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("closes without asking while connected and nothing changed (Rust closes the session)", async () => {
    h = await renderWindow();
    h.state("connecting");
    h.state("connected");
    h.state("polling");
    await expect(h.win.requestClose()).resolves.toBe(true);
  });

  it("asks Save changes? with the profile name and Cancel keeps the window", async () => {
    h = await renderWindow({
      prepare: ({ rt }) => {
        rt.stores.config.getState().applyProfile(profile);
      },
    });
    await h.user.click(screen.getByRole("radio", { name: "Hex" }));
    let closed: boolean | undefined;
    const request = h.win.requestClose().then((c) => {
      closed = c;
    });
    const dialog = await screen.findByRole("alertdialog", { name: "Save changes?" });
    expect(within(dialog).getByText('Save changes to "Boiler-PLC" before closing?')).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Save" })).toHaveFocus();
    expect(
      within(dialog)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Save", "Don't save", "Cancel"]);
    await h.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await request;
    expect(closed).toBe(false);
    expect(h.win.closed).toBe(false);
  });

  it("Esc counts as Cancel", async () => {
    h = await renderWindow({
      prepare: ({ rt }) => {
        rt.stores.config.getState().applyProfile(profile);
      },
    });
    await h.user.click(screen.getByRole("radio", { name: "Hex" }));
    const request = h.win.requestClose();
    await screen.findByRole("alertdialog", { name: "Save changes?" });
    await h.user.keyboard("{Escape}");
    await expect(request).resolves.toBe(false);
  });

  it("Don't save closes the window", async () => {
    h = await renderWindow({
      prepare: ({ rt }) => {
        rt.stores.config.getState().applyProfile(profile);
      },
    });
    await h.user.click(screen.getByRole("radio", { name: "Hex" }));
    const request = h.win.requestClose();
    const dialog = await screen.findByRole("alertdialog");
    await h.user.click(within(dialog).getByRole("button", { name: "Don't save" }));
    await expect(request).resolves.toBe(true);
    expect(h.ipc.callsOf("profilesSave")).toHaveLength(0);
  });

  it("Save writes the profile and closes", async () => {
    h = await renderWindow({
      prepare: ({ rt, ipc }) => {
        ipc.seedProfiles([profile]);
        rt.stores.config.getState().applyProfile(profile);
      },
    });
    await h.user.click(screen.getByRole("radio", { name: "Hex" }));
    const request = h.win.requestClose();
    const dialog = await screen.findByRole("alertdialog");
    await h.user.click(within(dialog).getByRole("button", { name: "Save" }));
    await expect(request).resolves.toBe(true);
    expect((await h.ipc.profilesGet("Boiler-PLC")).display.format).toBe("hex");
  });

  it("an unnamed setup uses the unnamed wording and Save opens Save as first", async () => {
    h = await renderWindow();
    await h.user.type(screen.getByLabelText("Host"), "192.168.1.10");
    const request = h.win.requestClose();
    const dialog = await screen.findByRole("alertdialog", { name: "Save changes?" });
    expect(within(dialog).getByText("Save this setup as a profile before closing?")).toBeVisible();
    await h.user.click(within(dialog).getByRole("button", { name: "Save" }));
    const saveAs = await screen.findByRole("dialog", { name: "Save profile as" });
    await h.user.type(within(saveAs).getByLabelText("Name"), "Fresh");
    await h.user.click(within(saveAs).getByRole("button", { name: "Save" }));
    await expect(request).resolves.toBe(true);
    expect((await h.ipc.profilesList()).map((p) => p.name)).toEqual(["Fresh"]);
  });

  it("cancelling Save as keeps the window open", async () => {
    h = await renderWindow();
    await h.user.type(screen.getByLabelText("Host"), "192.168.1.10");
    const request = h.win.requestClose();
    const dialog = await screen.findByRole("alertdialog");
    await h.user.click(within(dialog).getByRole("button", { name: "Save" }));
    const saveAs = await screen.findByRole("dialog", { name: "Save profile as" });
    await h.user.click(within(saveAs).getByRole("button", { name: "Cancel" }));
    await expect(request).resolves.toBe(false);
  });
});

describe("new window", () => {
  it("Ctrl+N opens another Modbus Master window", async () => {
    h = await renderWindow();
    act(() => {
      fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    });
    await waitFor(() => expect(h.win.openedTools).toEqual(["modbus-master"]));
  });

  it("each window keeps its own session state", async () => {
    const first = await renderWindow();
    const second = await renderWindow();
    first.state("connecting");
    first.state("connected");
    first.state("polling");
    expect(first.rt.stores.session.getState().state).toBe("polling");
    expect(second.rt.stores.session.getState().state).toBe("idle");
    first.rt.dispose();
    h = second;
  });
});
