// CHK-002 section G: closing a poll view (S6), "don't ask again", closing W1 (Save changes?).
import { expect, fmt, test, type Mm, type PollSpec } from "../support/mm-fixtures";

const KEEP = (name: string) => `Keep "${name}" on this connection, or delete it?`;
const ACTIVE = "A kept poll keeps polling in the background.";
const UNAPPLIED = "Unapplied changes in the poll setup will be lost.";

async function connected(mm: Mm, polls: PollSpec[], opts: { autoStart?: boolean } = {}): Promise<number[]> {
  await mm.open({ polls });
  const ids = await mm.pollIds();
  await mm.useVirtual();
  await mm.pressConnect({ autoStart: opts.autoStart ?? true });
  await mm.advance(500);
  return ids;
}

test.describe("G closing", () => {
  test("CHK2-G1 close a running sub-window with the ✕ button: S6 text, Keep poll has the focus, the dialog is modal", async ({
    mm,
    page,
  }) => {
    const [id] = (await connected(mm, [{ name: "Poll 1" }])) as [number];
    await mm.titleButton(id, /^Close/).click();
    const dialog = mm.confirm;
    await expect(dialog).toContainText("Close poll window?");
    await expect(dialog).toContainText(`${KEEP("Poll 1")} ${ACTIVE}`);
    await expect(dialog).not.toContainText(UNAPPLIED);
    await expect(dialog.getByRole("button", { name: "Keep poll" })).toBeFocused();
    await expect(dialog.getByRole("button", { name: "Delete poll" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(dialog.getByLabel("Don't ask again for this connection window")).not.toBeChecked();
    // Modal: the keys of the window do nothing behind it.
    await page.keyboard.press("Control+Shift+N");
    expect(await mm.callCount("addPoll")).toBe(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(mm.sub(id)).toBeVisible();
  });

  test("CHK2-G1 Ctrl+F4 closes with S6; a paused poll has no 'keeps polling' sentence; unapplied edits add theirs", async ({
    mm,
    page,
  }) => {
    const [id] = (await connected(mm, [{ name: "Poll 1" }])) as [number];
    // Paused by the user: the run intent is off, so a kept poll does not poll.
    await mm.titleBar(id).focus();
    await page.keyboard.press("Control+p");
    await expect(mm.statusLine(id)).toContainText("Paused");
    await mm.titleBar(id).focus();
    await page.keyboard.press("Control+F4");
    await expect(mm.confirm).toContainText(KEEP("Poll 1"));
    await expect(mm.confirm).not.toContainText(ACTIVE);
    await mm.confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(mm.confirm).toHaveCount(0);
    // Unapplied edits.
    await mm.titleButton(id, /^Poll setup/).click();
    await mm.setupField(id, "Quantity").fill("12");
    await mm.setupField(id, "Quantity").blur();
    await expect(mm.titleBar(id).getByTestId("unapplied-dot")).toBeVisible();
    await mm.titleButton(id, /^Close/).click();
    await expect(mm.confirm).toContainText(`${KEEP("Poll 1")} ${UNAPPLIED}`);
    await expect(mm.confirm.getByRole("button", { name: "Keep poll" })).toBeFocused();
  });

  test("CHK2-G1 a native window: the OS close asks the same question in that window", async ({ mm }) => {
    const w2 = await mm.openNative({ polls: [{ name: "Poll 1" }] });
    await w2.requestClose();
    await expect(w2.confirm).toContainText("Close poll window?");
    await expect(w2.confirm).toContainText(`${KEEP("Poll 1")} ${ACTIVE}`);
    await expect(w2.confirm.getByRole("button", { name: "Keep poll" })).toBeFocused();
    // The OS close itself is always refused: the dialog decides (Keep or Delete close the window).
    await expect.poll(() => w2.closeOutcome()).toBe("kept");
    await w2.confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(w2.confirm).toHaveCount(0);
    expect(await w2.callCount("closePollView")).toBe(0);
  });

  // CHK2-G6 (revision 8, D-002-09): the "keeps polling" sentence depends on the STATE of the poll when S6 opens.
  interface G6Row {
    name: string;
    chip: string;
    active: boolean;
    sentence: boolean;
    prepare: (mm: Mm, id: number) => Promise<void>;
  }
  const G6_ROWS: G6Row[] = [
    {
      name: "connected, Polling, active true",
      chip: "Polling",
      active: true,
      sentence: true,
      prepare: async (mm) => {
        await mm.pressConnect({ autoStart: true });
        await mm.advance(500);
      },
    },
    {
      name: "connected, Waiting… (polling, no data yet), active true",
      chip: "Waiting…",
      active: true,
      sentence: true,
      prepare: async (mm) => {
        await mm.pressConnect({ autoStart: true });
        // no advance: the first reply has not come
      },
    },
    {
      name: "connected, Timeout, active true",
      chip: "Timeout",
      active: true,
      sentence: true,
      prepare: async (mm, id) => {
        await mm.pressConnect({ autoStart: true });
        await mm.script((f, p) => f.scriptFault(p, { kind: "timeout" }), id);
        await mm.advance(4500);
      },
    },
    {
      name: "connected, Exception 02, active true",
      chip: "Exception 02",
      active: true,
      sentence: true,
      prepare: async (mm, id) => {
        await mm.pressConnect({ autoStart: true });
        await mm.script((f, p) => f.scriptFault(p, { kind: "exception", code: 2 }), id);
        await mm.advance(1500);
      },
    },
    {
      name: "connected, Bad response, active true",
      chip: "Bad response",
      active: true,
      sentence: true,
      prepare: async (mm, id) => {
        await mm.pressConnect({ autoStart: true });
        await mm.script(
          (f, p) => f.scriptFault(p, { kind: "badResponse", badKind: "shortFrame", detail: { expected: 29, got: 20, message: "" } }),
          id,
        );
        await mm.advance(1500);
      },
    },
    {
      name: "connected, Paused by the user, active false",
      chip: "Paused",
      active: false,
      sentence: false,
      prepare: async (mm, id) => {
        await mm.pressConnect({ autoStart: true });
        await mm.advance(500);
        await mm.script((f, p) => f.setPollActive(p, false), id);
      },
    },
    {
      name: "connected, Paused because 'Start polling when connected' is off (run intent on), active true",
      chip: "Paused",
      active: true,
      sentence: false,
      prepare: async (mm) => {
        await mm.pressConnect({ autoStart: false });
      },
    },
    {
      name: "idle, Offline, active true",
      chip: "Offline",
      active: true,
      sentence: false,
      prepare: async () => {},
    },
    {
      name: "disconnected, Offline, active true",
      chip: "Offline",
      active: true,
      sentence: false,
      prepare: async (mm) => {
        await mm.pressConnect({ autoStart: true });
        await mm.advance(500);
        await mm.script((f) => f.dropLink({ kind: "closedByPeer", phase: "linkLost", message: "closed" }));
        await mm.expectConnection("disconnected");
      },
    },
  ];
  for (const row of G6_ROWS) {
    test(`CHK2-G6 sub-window, ${row.name}: the sentence is ${row.sentence ? "shown" : "not shown"}`, async ({ mm }) => {
      await mm.open({ polls: [{ name: "Poll 1" }] });
      const [id] = (await mm.pollIds()) as [number];
      await mm.useVirtual();
      await row.prepare(mm, id);
      await expect(mm.statusLine(id)).toContainText(row.chip);
      const active = await mm.script((f, p) => f.snapshot().polls.find((x: { config: { pollId: number } }) => x.config.pollId === p).config.active, id);
      expect(active, "the `active` (run intent) column of the table").toBe(row.active);
      await mm.titleButton(id, /^Close/).click();
      await expect(mm.confirm).toContainText("Close poll window?");
      await expect(mm.confirm).toContainText(KEEP("Poll 1"));
      if (row.sentence) await expect(mm.confirm).toContainText(ACTIVE);
      else await expect(mm.confirm).not.toContainText(ACTIVE);
      // The rest of S6 is the same in every case.
      await expect(mm.confirm.getByRole("button", { name: "Keep poll" })).toBeFocused();
      await expect(mm.confirm.getByRole("button", { name: "Delete poll" })).toBeVisible();
      await expect(mm.confirm.getByRole("button", { name: "Cancel" })).toBeVisible();
      await mm.confirm.getByRole("button", { name: "Cancel" }).click();
    });
  }

  // CHK2-G6 snapshot (revision 9, D-002-18): the S6 body (name, unapplied sentence, keeps-polling sentence) is computed
  // when the dialog opens and does not change while it is open; the buttons act on the poll's CURRENT state.
  /** The sidebar row by CSS (the page behind a modal dialog is hidden from the role tree, so getByRole would not find it). */
  const rowOf = (m: Mm, id: number) => m.page.locator(`[data-slot="poll-row"][data-poll-id="${id}"]`);

  async function pollingSubWindow(mm: Mm): Promise<number> {
    await mm.open({ polls: [{ name: "Poll 1" }] });
    const [id] = (await mm.pollIds()) as [number];
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.advance(500);
    await expect(mm.statusLine(id)).toContainText("Polling");
    return id;
  }

  test("CHK2-G6 snapshot (sub-window): Polling, S6 open, the poll becomes Paused behind the dialog: the sentence is still shown after 2 s; Keep poll keeps it in its CURRENT state (Paused, closed)", async ({
    mm,
  }) => {
    const id = await pollingSubWindow(mm);
    await mm.titleButton(id, /^Close/).click();
    await expect(mm.confirm).toContainText(`${KEEP("Poll 1")} ${ACTIVE}`);
    await mm.script((f, p) => f.setPollActive(p, false), id);
    await mm.advance(500);
    // The state really changed behind the dialog (observable: the status line and the sidebar chip).
    await expect(mm.statusLine(id)).toContainText("Paused");
    await expect(rowOf(mm, id)).toContainText("Paused");
    await mm.advance(2000);
    await expect(mm.confirm, "read when it opened, unchanged after 2 s").toContainText(`${KEEP("Poll 1")} ${ACTIVE}`);
    await expect(mm.confirm.getByRole("button", { name: "Keep poll" })).toBeVisible();
    // Keep poll acts on the current state: the poll stays Paused and is closed.
    await mm.confirm.getByRole("button", { name: "Keep poll" }).click();
    await expect(mm.sub(id)).toHaveCount(0);
    await expect(rowOf(mm, id)).toContainText("closed");
    await expect(rowOf(mm, id)).toContainText("Paused");
  });

  test("CHK2-G6 snapshot (sub-window): Paused, S6 open without the sentence, the poll is resumed from another host: still absent; Cancel and reopen shows the NEW state", async ({
    mm,
  }) => {
    const id = await pollingSubWindow(mm);
    await mm.script((f, p) => f.setPollActive(p, false), id);
    await expect(mm.statusLine(id)).toContainText("Paused");
    await mm.titleButton(id, /^Close/).click();
    await expect(mm.confirm).toContainText(KEEP("Poll 1"));
    await expect(mm.confirm).not.toContainText(ACTIVE);
    // Resumed from another host (sidebar or the other window): the fake is that other host.
    await mm.script((f, p) => f.setPollActive(p, true), id);
    await mm.advance(1500);
    await expect(mm.statusLine(id)).toContainText("Polling");
    await expect(rowOf(mm, id)).toContainText("Live");
    await mm.advance(2000);
    await expect(mm.confirm, "still no sentence").not.toContainText(ACTIVE);
    await expect(mm.confirm).toContainText(KEEP("Poll 1"));
    // Cancel, open again: the body is computed for the new state.
    await mm.confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(mm.confirm).toHaveCount(0);
    await mm.titleButton(id, /^Close/).click();
    await expect(mm.confirm).toContainText(`${KEEP("Poll 1")} ${ACTIVE}`);
  });

  test("CHK2-G6 snapshot (sub-window): Polling, S6 open, the link drops (poll Offline): the body is unchanged and the dialog stays open; reopened it has no sentence", async ({
    mm,
  }) => {
    const id = await pollingSubWindow(mm);
    await mm.titleButton(id, /^Close/).click();
    await expect(mm.confirm).toContainText(`${KEEP("Poll 1")} ${ACTIVE}`);
    await mm.script((f) => f.dropLink({ kind: "closedByPeer", phase: "linkLost", message: "closed" }));
    await mm.expectConnection("disconnected");
    await expect(rowOf(mm, id)).toContainText("Offline");
    await expect(mm.statusLine(id)).toContainText("Offline");
    await mm.advance(2000);
    await expect(mm.confirm, "dialog stays open").toBeVisible();
    await expect(mm.confirm).toContainText(`${KEEP("Poll 1")} ${ACTIVE}`);
    await mm.confirm.getByRole("button", { name: "Cancel" }).click();
    await mm.titleButton(id, /^Close/).click();
    await expect(mm.confirm).toContainText(KEEP("Poll 1"));
    await expect(mm.confirm).not.toContainText(ACTIVE);
  });

  test("CHK2-G6 snapshot (sub-window): a rename while S6 is open does not change the name in the dialog; reopened it has the new name", async ({
    mm,
  }) => {
    const id = await pollingSubWindow(mm);
    await mm.titleButton(id, /^Close/).click();
    await expect(mm.confirm).toContainText(KEEP("Poll 1"));
    await mm.script((f, p) => f.renamePoll(p, "Renamed"), id);
    await expect(rowOf(mm, id)).toContainText("Renamed");
    await expect(mm.confirm, "the name is the snapshot").toContainText(KEEP("Poll 1"));
    await expect(mm.confirm).not.toContainText("Renamed");
    await mm.confirm.getByRole("button", { name: "Cancel" }).click();
    await mm.titleButton(id, /^Close/).click();
    await expect(mm.confirm).toContainText(KEEP("Renamed"));
  });

  test("CHK2-G6 snapshot (native window): Polling, S6 open, the poll becomes Paused: the sentence stays; Paused and resumed while open: still absent; Cancel and reopen shows the new state", async ({
    mm,
  }) => {
    const w2 = await mm.openNative({ polls: [{ name: "Poll 1" }] });
    await expect(w2.statusLine).toContainText("Polling");
    await w2.requestClose();
    await expect(w2.confirm).toContainText(`${KEEP("Poll 1")} ${ACTIVE}`);
    await w2.script((f) => f.setPollActive(f.pollIds()[0], false));
    await w2.advance(500);
    await expect(w2.statusLine).toContainText("Paused");
    await w2.advance(2000);
    await expect(w2.confirm, "unchanged after 2 s").toContainText(`${KEEP("Poll 1")} ${ACTIVE}`);
    await w2.confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(w2.confirm).toHaveCount(0);
    // Reopened for the Paused poll: no sentence; then it is resumed while open: still absent.
    await w2.requestClose();
    await expect(w2.confirm).toContainText(KEEP("Poll 1"));
    await expect(w2.confirm).not.toContainText(ACTIVE);
    await w2.script((f) => f.setPollActive(f.pollIds()[0], true));
    await w2.advance(1500);
    await expect(w2.statusLine).toContainText("Polling");
    await w2.advance(2000);
    await expect(w2.confirm, "still no sentence").not.toContainText(ACTIVE);
    await expect(w2.confirm).toContainText(KEEP("Poll 1"));
  });

  test("CHK2-G6 snapshot (native window): Polling, S6 open, the link drops: the body is unchanged and the dialog stays open", async ({
    mm,
  }) => {
    const w2 = await mm.openNative({ polls: [{ name: "Poll 1" }] });
    await expect(w2.statusLine).toContainText("Polling");
    await w2.requestClose();
    await expect(w2.confirm).toContainText(`${KEEP("Poll 1")} ${ACTIVE}`);
    await w2.script((f) => f.dropLink({ kind: "closedByPeer", phase: "linkLost", message: "closed" }));
    await expect(w2.statusLine).toContainText("Offline");
    await w2.advance(2000);
    await expect(w2.confirm).toBeVisible();
    await expect(w2.confirm).toContainText(`${KEEP("Poll 1")} ${ACTIVE}`);
  });

  for (const [name, sentence] of [
    ["Polling", true],
    ["Paused (run intent on, auto start off)", false],
  ] as const) {
    test(`CHK2-G6 native window, ${name}: the sentence is ${sentence ? "shown" : "not shown"}`, async ({ mm }) => {
      const w2 = await mm.openNative({ polls: [{ name: "Poll 1" }] });
      if (!sentence) {
        await w2.script(async (f) => {
          await f.setAutoStartPoll(false);
          await f.disconnect();
          await f.connect({ mode: "tcp", host: "127.0.0.1", port: 5020, timeoutMs: 1000 });
          f.advance(300);
        });
        await expect(w2.statusLine).toContainText("Paused");
      } else {
        await expect(w2.statusLine).toContainText("Polling");
      }
      await w2.requestClose();
      await expect(w2.confirm).toContainText("Close poll window?");
      await expect(w2.confirm).toContainText(KEEP("Poll 1"));
      if (sentence) await expect(w2.confirm).toContainText(ACTIVE);
      else await expect(w2.confirm).not.toContainText(ACTIVE);
      await expect(w2.confirm.getByRole("button", { name: "Keep poll" })).toBeFocused();
      await w2.confirm.getByRole("button", { name: "Cancel" }).click();
    });
  }

  test("CHK2-G2 Keep poll: the view closes, the marker reads closed, Last update advances; Show restores display settings and aliases", async ({
    mm,
    page,
  }) => {
    const [id] = (await connected(mm, [
      {
        name: "Poll 1",
        formatOverrides: [fmt(0, 9, "hex")],
        aliases: [{ address: 0, alias: "Tank top" }],
      },
      { name: "Poll 2" },
    ])) as [number, number];
    await expect(mm.gridRow(id, 0).locator('[data-cell="alias"]')).toHaveText("Tank top");
    await mm.titleButton(id, /^Close/).click();
    await mm.confirm.getByRole("button", { name: "Keep poll" }).click();
    await expect(mm.sub(id)).toHaveCount(0);
    await expect(mm.row(id)).toContainText("closed");
    expect(await mm.lastCall("closePollView")).toEqual([id, true]);
    // The poll keeps running: its tooltip shows a Last update that moves on.
    const lastUpdate = async () => {
      await page.mouse.move(2, 2);
      await mm.row(id).hover();
      return (await mm.row(id).getAttribute("title"))?.match(/Last update (\d\d:\d\d:\d\d\.\d{3})/)?.[1] ?? null;
    };
    const first = await lastUpdate();
    expect(first).not.toBeNull();
    await mm.advance(2000);
    const second = await lastUpdate();
    expect(second).not.toBe(first);
    // Show brings it back with the same display settings and aliases.
    await mm.row(id).click();
    await expect(mm.sub(id)).toBeVisible();
    await expect(mm.gridRow(id, 0).locator('[data-cell="alias"]')).toHaveText("Tank top");
    await expect(mm.gridRow(id, 1).locator('[data-cell="raw"]')).toHaveText(/^0x[0-9A-F]{4}$/);
    await expect(mm.row(id)).not.toContainText("closed");
  });

  test("CHK2-G2 Delete poll removes it; Cancel keeps everything", async ({ mm }) => {
    const [a, b] = (await connected(mm, [{ name: "Poll 1" }, { name: "Poll 2" }])) as [number, number];
    await mm.titleButton(b, /^Close/).click();
    await mm.confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(mm.sub(b)).toBeVisible();
    await expect(mm.row(b)).not.toContainText("closed");
    expect(await mm.callCount("closePollView")).toBe(0);
    await mm.titleButton(b, /^Close/).click();
    await mm.confirm.getByRole("button", { name: "Delete poll" }).click();
    await expect(mm.sub(b)).toHaveCount(0);
    await expect(mm.row(b)).toHaveCount(0);
    expect(await mm.lastCall("closePollView")).toEqual([b, false]);
    await expect(mm.sub(a)).toBeVisible();
  });

  test("CHK2-G3 'Don't ask again' makes later closes keep without asking, in both hosts; a new window asks again", async ({
    mm,
    page,
  }) => {
    const [a, b] = (await connected(mm, [{ name: "Poll 1" }, { name: "Poll 2" }])) as [number, number];
    await mm.titleButton(a, /^Close/).click();
    await mm.confirm.getByLabel("Don't ask again for this connection window").check();
    await mm.confirm.getByRole("button", { name: "Keep poll" }).click();
    await expect(mm.sub(a)).toHaveCount(0);
    await mm.expectCalls("setAskOnPollClose", 1);
    expect(await mm.lastCall("setAskOnPollClose")).toEqual([false]);
    // The next close keeps at once.
    await mm.row(b).click();
    await mm.titleButton(b, /^Close/).click();
    await expect(mm.confirm).toHaveCount(0);
    await expect(mm.sub(b)).toHaveCount(0);
    expect(await mm.lastCall("closePollView")).toEqual([b, true]);

    // A native window of the same connection gets the preference through its channel.
    const w2 = await mm.openNative({ polls: [{ name: "Poll 1" }] });
    await expect.poll(async () => (await w2.prefs()).askOnPollClose, { message: "native window applied the default" }).toBe(true);
    await w2.script((f) => f.setAskOnPollClose(false));
    // Hook: `data-prefs` says when the window applied the preference event (no frame counting).
    await expect.poll(async () => (await w2.prefs()).askOnPollClose, { message: "native window applied the preference" }).toBe(false);
    await w2.requestClose();
    await expect(w2.confirm).toHaveCount(0);
    await w2.expectCalls("closePollView", 1);
    expect(await w2.calls("closePollView")).toEqual([[1, true]]);

    // A new connection window (reload = new session) asks again.
    // (The init script of `open({ polls })` seeds the same two polls again.)
    await page.bringToFront();
    await mm.open({ polls: [{ name: "Poll 1" }, { name: "Poll 2" }] });
    expect(await mm.callCount("setAskOnPollClose"), "a new session starts with the default").toBe(0);
    const [c] = await mm.pollIds();
    await mm.titleButton(c as number, /^Close/).click();
    await expect(mm.confirm).toContainText("Close poll window?");
  });

  test("CHK2-G4 closing W1 with nothing unsaved closes at once, with sub-windows and own windows, and asks nothing", async ({
    mm,
  }) => {
    await mm.open({
      polls: Array.from({ length: 6 }, (_, i) => ({ name: `Poll ${i + 1}` })),
      seed: async (f, _a, ids) => {
        for (const id of ids.slice(4)) {
          await f.popOutPoll(id, { kind: "rect", rect: { x: 50, y: 50, width: 600, height: 400 } }, null);
        }
      },
    });
    await expect(mm.statusBar).toContainText("2 in their own windows");
    expect(await mm.modified()).toBe(false);
    await mm.requestClose();
    await expect.poll(() => mm.closeOutcome()).toBe("closed");
    await expect(mm.confirm).toHaveCount(0);
  });

  test("CHK2-G5 closing W1 with a modified profile, 2 own windows and unapplied edits in Poll 2: the text, Cancel, Don't save", async ({
    mm,
  }) => {
    await mm.open({
      polls: [{ name: "Poll 1" }, { name: "Poll 2" }, { name: "Poll 3" }, { name: "Poll 4" }],
      seed: async (f, _a, ids) => {
        await f.setProfileName("Boiler");
        for (const id of ids.slice(2)) {
          await f.popOutPoll(id, { kind: "rect", rect: { x: 50, y: 50, width: 600, height: 400 } }, null);
        }
      },
    });
    const [p1, p2] = (await mm.pollIds()) as [number, number];
    // Modify the profile (rename) and leave an unapplied edit in Poll 2.
    await mm.titleBar(p1).focus();
    await mm.page.keyboard.press("F2");
    await mm.titleBar(p1).getByRole("textbox", { name: "Poll name" }).fill("Pump");
    await mm.page.keyboard.press("Enter");
    await expect(mm.row("Pump")).toBeVisible();
    await expect(mm.profileLabel).toContainText("Modified");
    await mm.row(p2).click();
    await mm.titleButton(p2, /^Poll setup/).click();
    await mm.setupField(p2, "Quantity").fill("12");
    await mm.setupField(p2, "Quantity").blur();
    await expect(mm.titleBar(p2).getByTestId("unapplied-dot")).toBeVisible();

    await mm.requestClose();
    await expect(mm.confirm).toContainText("Save changes?");
    await expect(mm.confirm).toContainText(
      'Save changes to "Boiler" before closing? This also closes 2 poll windows. Unapplied edits in: Poll 2.',
    );
    await expect.poll(() => mm.closeOutcome()).toBe("pending");
    await mm.confirm.getByRole("button", { name: "Cancel" }).click();
    await expect.poll(() => mm.closeOutcome()).toBe("kept");
    await expect(mm.sub(p1)).toBeVisible();
    await expect(mm.sub(p2)).toBeVisible();
    await expect(mm.statusBar).toContainText("2 in their own windows");
    // One native window less: "1 poll window".
    await mm.script((f) => f.dockPoll(4, null, false, null));
    await expect(mm.statusBar).toContainText("1 in its own window");
    await mm.requestClose();
    await expect(mm.confirm).toContainText(
      'Save changes to "Boiler" before closing? This also closes 1 poll window. Unapplied edits in: Poll 2.',
    );
    await mm.confirm.getByRole("button", { name: "Don't save" }).click();
    await expect.poll(() => mm.closeOutcome()).toBe("closed");
  });

  test("CHK2-G5 an unnamed modified profile asks 'Save this setup as a profile before closing?'", async ({ mm }) => {
    await mm.open({ polls: [{ name: "Poll 1" }] });
    await mm.toolbarButton("New poll").click();
    await expect(mm.profileLabel).toContainText("Modified");
    await mm.requestClose();
    await expect(mm.confirm).toContainText("Save this setup as a profile before closing?");
  });
});
