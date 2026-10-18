import { screen, waitFor, within } from "@testing-library/react";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

describe("poll dialogs (DES-002 2.11)", () => {
  it("S6 shows the question and the sentences that apply, with Keep poll as the default", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    await h.connect();
    await h.ipc.setPollActive(a, true);
    await h.ipc.setPollView(a, { hasUnappliedEdits: true });
    h.rt.stores.host.getState().requestClose(a);
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Close poll window?")).toBeVisible();
    expect(dialog).toHaveTextContent(
      'Keep "Pump 2" on this connection, or delete it? Unapplied changes in the poll setup will be lost. A kept poll keeps polling in the background.',
    );
    expect(within(dialog).getByRole("button", { name: "Keep poll" })).toHaveFocus();
    expect(
      within(dialog).getByRole("checkbox", { name: "Don't ask again for this connection window" }),
    ).not.toBeChecked();
  });

  it("S6 says 'keeps polling' only while the poll's state is running (REPORT-003 O-2)", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    // Offline: the run intent is on but the link is down.
    expect(h.ipc.pollSummary(a).config.active).toBe(true);
    h.rt.stores.host.getState().requestClose(a);
    expect(await screen.findByRole("alertdialog")).not.toHaveTextContent("keeps polling");
    h.rt.stores.host.getState().cancelClose();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    // Polling: the sentence.
    await h.connect();
    h.rt.stores.host.getState().requestClose(a);
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "A kept poll keeps polling in the background.",
    );
    h.rt.stores.host.getState().cancelClose();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    // Paused: not.
    await h.ipc.setPollActive(a, false);
    h.rt.stores.host.getState().requestClose(a);
    expect(await screen.findByRole("alertdialog")).not.toHaveTextContent("keeps polling");
  });

  it("S6 text does not change while it is open: a poll pausing or resuming meanwhile (REPORT-004 CHK2-G6)", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    await h.connect();
    // Opened while polling: the sentence stays when the poll is paused.
    h.rt.stores.host.getState().requestClose(a);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("A kept poll keeps polling in the background.");
    await h.ipc.setPollActive(a, false);
    await h.act(() => Promise.resolve());
    expect(h.ipc.pollSummary(a).status.state).toBe("paused");
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "A kept poll keeps polling in the background.",
    );
    h.rt.stores.host.getState().cancelClose();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    // Opened while paused: the sentence does not appear when the poll resumes.
    h.rt.stores.host.getState().requestClose(a);
    expect(await screen.findByRole("alertdialog")).not.toHaveTextContent("keeps polling");
    await h.ipc.setPollActive(a, true);
    await h.act(() => Promise.resolve());
    expect(h.ipc.pollSummary(a).status.state).toBe("polling");
    expect(screen.getByRole("alertdialog")).not.toHaveTextContent("keeps polling");
  });

  it("S6 text keeps its unapplied-changes sentence and name when they change while it is open", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    await h.connect();
    await h.ipc.setPollView(a, { hasUnappliedEdits: true });
    h.rt.stores.host.getState().requestClose(a);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Unapplied changes in the poll setup will be lost.");
    await h.ipc.setPollView(a, { hasUnappliedEdits: false });
    await h.ipc.renamePoll(a, "Pump 3");
    await h.act(() => Promise.resolve());
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      'Keep "Pump 2" on this connection, or delete it? Unapplied changes in the poll setup will be lost. A kept poll keeps polling in the background.',
    );
  });

  it("S6 closes by itself when the poll is deleted elsewhere, and the shortcuts work again", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    h.rt.stores.host.getState().requestClose(a);
    await screen.findByRole("alertdialog");
    expect(h.rt.stores.layout.getState().modalOpen).toBe(true);
    await h.act(() => h.ipc.removePoll(a));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(h.rt.stores.host.getState().closing).toBeNull();
    expect(h.rt.stores.layout.getState().modalOpen).toBe(false);
  });

  it("S7 closes by itself when the poll is deleted elsewhere", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    h.rt.stores.host.getState().requestDelete(a);
    await screen.findByRole("alertdialog");
    await h.act(() => h.ipc.removePoll(a));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(h.rt.stores.host.getState().deleting).toBeNull();
    expect(h.rt.stores.layout.getState().modalOpen).toBe(false);
  });

  it("Delete poll in S6 deletes it and 'Don't ask again' is sent with it", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    h.rt.stores.host.getState().requestClose(a);
    const dialog = await screen.findByRole("alertdialog");
    await h.user.click(
      within(dialog).getByRole("checkbox", { name: "Don't ask again for this connection window" }),
    );
    await h.user.click(within(dialog).getByRole("button", { name: "Delete poll" }));
    await waitFor(() => expect(h.ipc.callsOf("closePollView")).toEqual([[a, false]]));
    expect(h.ipc.callsOf("setAskOnPollClose")).toEqual([[false]]);
  });

  it("the Close poll dialog, the Delete poll dialog and Save changes? never stack on one lock", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Pump 2");
    h.rt.stores.host.getState().requestClose(a);
    await screen.findByRole("alertdialog");
    h.rt.stores.host.getState().cancelClose();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(h.rt.stores.layout.getState().modalCount).toBe(0);
  });
});
