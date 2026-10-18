// CHK-002 section N and P: profiles v2 (save, open, migration notice, Cannot be opened, Modified
// rules), invalid input messages in both hosts. File-level validation of schema 3, 17 polls, 2001
// aliases, duplicate addresses and minimizedOrder is Rust's (`profiles_*`); the UI side is the row.
import { expect, LAYOUT_SEED, Mm, STANDARD_8, test } from "../support/mm-fixtures";

interface SavedProfile {
  schemaVersion: number;
  name: string;
  workspace: { tileMode: boolean; compact: boolean; sidebarWidth: number; trafficExpanded: boolean; minimizedOrder: number[] };
  polls: Array<{
    name: string;
    definition: unknown;
    active: boolean;
    display: unknown;
    aliases: unknown;
    view: {
      host: string;
      open: boolean;
      workspace: { x: number; y: number; width: number; height: number; z: number; state: string; restore: unknown } | null;
      native: { x: number; y: number; width: number; height: number } | null;
    };
  }>;
}

async function saveAs(mm: Mm, name: string): Promise<SavedProfile> {
  await mm.openMenu("File");
  await mm.menuItem("Save as…").click();
  await mm.saveAsDialog.getByLabel("Name").fill(name);
  await mm.saveAsDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(mm.profileLabel).toContainText(name);
  const call = (await mm.lastCall("profilesSave")) as [SavedProfile, boolean];
  return call[0];
}
async function openProfile(mm: Mm, name: string): Promise<void> {
  await mm.openMenu("File");
  await mm.menuItem("Open profile…").click();
  await mm.openDialog.getByRole("row", { name: new RegExp(name) }).dblclick();
  await expect(mm.openDialog).toHaveCount(0);
}
const exportNow = (mm: Mm): Promise<SavedProfile> => mm.script((f) => f.exportProfile("x", null));
function essence(p: SavedProfile) {
  const order = p.polls
    .filter((x) => x.view.workspace)
    .map((x, i) => ({ i, z: x.view.workspace?.z ?? 0 }))
    .sort((a, b) => a.z - b.z)
    .map((x) => x.i);
  return {
    workspace: { ...p.workspace },
    polls: p.polls.map((x) => ({
      name: x.name,
      definition: x.definition,
      active: x.active,
      display: x.display,
      aliases: x.aliases,
      host: x.view.host,
      open: x.view.open,
      rect: x.view.workspace && { x: x.view.workspace.x, y: x.view.workspace.y, width: x.view.workspace.width, height: x.view.workspace.height, state: x.view.workspace.state },
      native: x.view.native && { x: x.view.native.x, y: x.view.native.y, width: x.view.native.width, height: x.view.native.height },
    })),
    zOrder: order,
  };
}

test.describe("N profiles v2", () => {
  test("CHK2-N1 (UI side) round trip: list order, display, aliases, rectangles, states, z-order, hosts, closed, compact, traffic", async ({ mm }) => {
    const specs = STANDARD_8.map((s, i) => ({
      ...s,
      ...(i === 0 ? { display: { format: "hex" }, aliases: [{ address: 0, alias: "a0" }, { address: 1, alias: "a1" }, { address: 2, alias: "a2" }] } : {}),
      ...(i === 2 ? { display: { addressBase: 1 }, aliases: [{ address: 0, alias: "c0" }] } : {}),
    }));
    await mm.open({
      polls: specs,
      seed: async (f, _a, ids) => {
        await f.reorderPolls([ids[2], ids[0], ids[1], ids[3], ids[4], ids[5], ids[6], ids[7]]);
        await f.popOutPoll(ids[4], { kind: "rect", rect: { x: 300, y: 200, width: 700, height: 500 } }, null);
        await f.popOutPoll(ids[5], { kind: "rect", rect: { x: 900, y: 300, width: 640, height: 420 } }, null);
        await f.closePollView(ids[7], true);
        const base = f.snapshot().workspaceLayout;
        f.setWorkspaceLayout({
          ...base,
          trafficExpanded: true,
          minimizedOrder: [ids[1]],
          items: [
            { pollId: ids[0], rect: { x: 8, y: 8, width: 1316, height: 640, z: 2, state: "maximized", restore: { x: 60, y: 70, width: 600, height: 340 } } },
            { pollId: ids[1], rect: { x: 100, y: 100, width: 640, height: 368, z: 1, state: "minimized", restore: null } },
            { pollId: ids[2], rect: { x: 220, y: 90, width: 560, height: 300, z: 4, state: "normal", restore: null } },
            { pollId: ids[3], rect: { x: 640, y: 260, width: 520, height: 280, z: 3, state: "normal", restore: null } },
          ],
        });
      },
    });
    await mm.hostField.fill("127.0.0.1");
    await mm.portField.fill("5020");
    // Compact mode last: the sidebar becomes a rail and the form is out of reach.
    await mm.toolbar.click({ position: { x: 4, y: 4 } });
    await mm.page.keyboard.press("Control+Shift+Backslash");
    await expect(mm.rail).toBeVisible();
    const saved = await saveAs(mm, "Round trip");
    expect(saved.schemaVersion).toBe(2);
    expect(saved.polls.map((p) => p.name)).toEqual(["Poll 3", "Poll 1", "Poll 2", "Poll 4", "Poll 5", "Poll 6", "Poll 7", "Poll 8"]);

    // "Close and reopen the app": a new window with a new backend that only has the saved file.
    const page2 = await mm.page.context().newPage();
    const mm2 = new Mm(page2);
    await mm2.open({ seed: (f, a) => f.seedProfiles([a]), seedArg: saved });
    await page2.bringToFront();
    await openProfile(mm2, "Round trip");
    await expect.poll(() => mm2.pollIds().then((x) => x.length)).toBe(8);
    await expect(mm2.statusBar).toContainText("2 in their own windows");
    await mm2.expectConnection("idle");
    await expect.poll(async () => essence(await exportNow(mm2))).toEqual(essence(saved));
    // What the user sees: compact rail, traffic panel, sub-windows at the saved places, the pill, "closed".
    await expect(mm2.rail).toBeVisible();
    await expect(mm2.traffic).toBeVisible();
    const p3 = await mm2.idOf("Poll 3");
    await mm2.expectDomRect(p3, { x: 220, y: 90, width: 560, height: 300 });
    await expect(mm2.sub(await mm2.idOf("Poll 1"))).toHaveAttribute("data-state", "maximized");
    await expect(mm2.minimizedBar).toContainText("Poll 2");
    await expect(mm2.rail.locator('[data-slot="rail-icon"]')).toHaveCount(8);
    expect(await mm2.modified()).toBe(false);
  });

  test("CHK2-N2 not Modified by layout, host, pause and filter actions", async ({ mm, page }) => {
    await mm.open({
      polls: [{ name: "Poll 1" }, { name: "Poll 2" }, { name: "Poll 3" }],
      connected: true,
      seed: LAYOUT_SEED,
      seedArg: { items: [{ index: 0, x: 40, y: 40, width: 500, height: 300 }, { index: 1, x: 640, y: 100, width: 500, height: 300 }, { index: 2, x: 300, y: 420, width: 500, height: 250 }] },
    });
    const [a, b, c] = (await mm.pollIds()) as [number, number, number];
    const clean = async (what: string) => expect(await mm.modified(), `Modified after: ${what}`).toBe(false);
    await clean("start");
    // Move, resize, snap (free drag), swap.
    await mm.dragTitle(a, 60, 40);
    await mm.release();
    await clean("move");
    const handle = await mm.sub(a).locator('[data-resize-handle="se"]').boundingBox();
    if (!handle) throw new Error("handle");
    await mm.dragStart({ x: handle.x + 5, y: handle.y + 5 }, { x: handle.x + 45, y: handle.y + 35 }, 5);
    await mm.release();
    await clean("resize");
    await page.keyboard.down("Control");
    await mm.dragStart(await mm.titlePoint(a, 30), await mm.titlePoint(b, 60), 8);
    await mm.release();
    await page.keyboard.up("Control");
    await clean("swap");
    // Tile, cascade, minimize, maximize, restore.
    await mm.windowMenu("Tile");
    await clean("tile");
    await mm.windowMenu("Cascade");
    await clean("cascade");
    await mm.titleButton(c, "Minimize").click();
    await clean("minimize");
    await mm.minimizedBar.getByRole("button", { name: /^Poll 3/ }).click();
    await clean("restore");
    await mm.titleButton(c, "Maximize").click();
    await clean("maximize");
    await mm.titleButton(c, "Restore").click();
    // List reorder, compact, traffic, pause, filter.
    await mm.row(a).focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(async () => (await mm.calls("reorderPolls")).length).toBe(1);
    await clean("list reorder");
    await page.keyboard.press("Control+Shift+Backslash");
    await expect(mm.rail).toBeVisible();
    await clean("compact");
    await page.keyboard.press("Control+Shift+Backslash");
    await page.keyboard.press("Control+j");
    await mm.traffic.getByRole("combobox", { name: "Traffic filter" }).selectOption({ label: "Poll 2" });
    await clean("traffic and filter");
    await page.keyboard.press("Control+j");
    await mm.sub(b).click({ position: { x: 10, y: 150 } });
    await mm.grid(b).focus();
    await page.keyboard.press("Control+p");
    await expect(mm.statusLine(b)).toContainText("Paused");
    await page.keyboard.press("Control+p");
    await clean("pause and resume");
    // Pop out, dock, close (keep).
    await mm.row(c).click();
    await mm.titleButton(c, /^Open in its own window/).click();
    await mm.expectCalls("popOutPoll", 1);
    await clean("pop out");
    await mm.script((f, id) => f.dockPoll(id, null, false, null), c);
    await expect(mm.sub(c)).toBeVisible();
    await clean("dock");
    await mm.row(c).click();
    await mm.titleButton(c, /^Close/).click();
    await mm.confirm.getByRole("button", { name: "Keep poll" }).click();
    await clean("close (keep)");
  });

  test("CHK2-N2 Modified by rename, Apply, format, alias, alias column, copy option, New poll and Delete", async ({ mm, page }) => {
    const modifiers: Array<[string, (a: number) => Promise<void>]> = [
      ["rename", async (a) => {
        await mm.titleBar(a).focus();
        await page.keyboard.press("F2");
        await mm.titleBar(a).getByRole("textbox", { name: "Poll name" }).fill("Renamed");
        await page.keyboard.press("Enter");
      }],
      ["Apply", async (a) => {
        await mm.titleButton(a, /^Poll setup/).click();
        await mm.setupField(a, "Quantity").fill("12");
        await mm.setup(a).getByRole("button", { name: "Apply", exact: true }).click();
      }],
      ["format change", async (a) => {
        await mm.grid(a).focus();
        await page.keyboard.press("Control+3");
      }],
      ["alias commit", async (a) => {
        await mm.gridRow(a, 0).locator('[data-cell="alias"]').dblclick();
        await mm.sub(a).getByRole("textbox", { name: /^Alias for address/ }).fill("X");
        await page.keyboard.press("Enter");
        await page.keyboard.press("Escape");
      }],
      ["alias column toggle", async (a) => {
        await mm.statusLine(a).getByRole("button", { name: /^Show / }).click();
        await page.getByRole("menuitemcheckbox", { name: "Alias column" }).click();
      }],
      ["Include alias in copy", async (a) => {
        await mm.statusLine(a).getByRole("button", { name: /^Show / }).click();
        await page.getByRole("menuitemcheckbox", { name: "Include alias in copy" }).click();
      }],
      ["New poll", async () => {
        await mm.toolbarButton("New poll").click();
      }],
      ["Delete", async (a) => {
        await mm.row(a).focus();
        await page.keyboard.press("Delete");
        await mm.confirm.getByRole("button", { name: "Delete", exact: true }).click();
      }],
    ];
    await mm.open({
      polls: [{ name: "Poll 1" }, { name: "Poll 2" }],
      connected: true,
      seed: async (f) => {
        await f.setProfileName("Base");
      },
    });
    const [a] = (await mm.pollIds()) as [number, number];
    for (const [what, run] of modifiers) {
      expect(await mm.modified(), `clean before ${what}`).toBe(false);
      await run(a);
      await expect(mm.profileLabel, `Modified after ${what}`).toContainText("Modified");
      // Save resets the baseline (named profile: no dialog).
      await page.keyboard.press("Escape");
      await page.keyboard.press("Control+s");
      await expect(mm.profileLabel).not.toContainText("Modified");
      if (what === "Delete") break;
    }
  });

  test("CHK2-N3 a profile that Rust migrated from schema 1: one sub-window 'Poll 1', the notice, not Modified; nothing saved before Save", async ({ mm }) => {
    const migrated = {
      schemaVersion: 2,
      name: "Old file",
      connection: { mode: "tcp", host: "127.0.0.1", port: 5020, timeoutMs: 1000 },
      autoStartPoll: true,
      connectionWindow: null,
      workspace: { tileMode: false, compact: false, sidebarWidth: 280, sidebarCollapsed: false, trafficExpanded: false, trafficHeight: null, minimizedOrder: [] },
      polls: [
        {
          name: "Poll 1",
          definition: { slaveId: 3, function: 4, startAddress: 5, quantity: 6, scanRateMs: 500 },
          active: true,
          display: { format: "signed", addressBase: 1, showAlias: true, copyAlias: false },
          scale: null,
          scaleOverrides: [],
          valueColumns: "raw",
          aliases: [],
          view: { host: "workspace", open: true, workspace: null, native: null },
        },
      ],
      migratedFrom: 1,
    };
    await mm.open({ seed: (f, a) => f.seedProfiles([a]), seedArg: migrated });
    await openProfile(mm, "Old file");
    await expect(mm.row("Poll 1")).toBeVisible();
    const id = await mm.idOf("Poll 1");
    await mm.expectDomRect(id, { x: 8, y: 8 });
    const notice = mm.page.getByText(
      "This profile was saved by an earlier version. Saving stores it in the new format, which earlier versions cannot open.",
    );
    await expect(notice).toBeVisible();
    await expect(mm.page.getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
    expect(await mm.modified()).toBe(false);
    expect(await mm.callCount("profilesSave"), "the file is untouched before Save").toBe(0);
    await mm.page.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(notice).toHaveCount(0);
    expect(await mm.modified(), "Dismiss does not change the profile").toBe(false);
    await expect(mm.statusLine(id)).toContainText("ID 3");
    await expect(mm.statusLine(id)).toContainText("F 04");
    // Save: the new format.
    await mm.page.keyboard.press("Control+s");
    await mm.expectCalls("profilesSave", 1);
    const saved = ((await mm.lastCall("profilesSave")) as [SavedProfile, boolean])[0];
    expect(saved.schemaVersion).toBe(2);
    expect(saved.workspace).toBeDefined();
    expect(saved.polls[0]?.view).toBeDefined();
    expect(saved.polls[0]).toHaveProperty("aliases");
  });

  test("CHK2-N5 (UI side) an unreadable profile row reads 'Cannot be opened (newer or damaged file)' and cannot be opened", async ({ mm }) => {
    await mm.open({
      seed: (f) =>
        f.setResult("profilesList", [
          { name: "Newer file", modifiedAt: 1_700_000_000_000, connectionSummary: "schemaVersion 3", readable: false },
          { name: "Good file", modifiedAt: 1_700_000_000_000, connectionSummary: "TCP 127.0.0.1:5020", readable: true },
        ]),
    });
    await mm.openMenu("File");
    await mm.menuItem("Open profile…").click();
    const bad = mm.openDialog.getByRole("row", { name: /Newer file/ });
    await expect(bad).toContainText("Cannot be opened (newer or damaged file)");
    await bad.click();
    await expect(mm.openDialog.getByRole("button", { name: "Open", exact: true })).toBeDisabled();
    await mm.openDialog.getByRole("row", { name: /Good file/ }).click();
    await expect(mm.openDialog.getByRole("button", { name: "Open", exact: true })).toBeEnabled();
  });

  test("CHK2-N6 loading while connected asks 'Disconnect and load?'; after confirming no S6 shows and the hosts of the profile open", async ({ mm }) => {
    const saved = await (async () => {
      const profile = {
        schemaVersion: 2,
        name: "Loadme",
        connection: { mode: "tcp", host: "127.0.0.1", port: 5020, timeoutMs: 1000 },
        autoStartPoll: true,
        connectionWindow: null,
        workspace: { tileMode: false, compact: false, sidebarWidth: 280, sidebarCollapsed: false, trafficExpanded: false, trafficHeight: null, minimizedOrder: [] },
        polls: ["A", "B"].map((name, i) => ({
          name,
          definition: { slaveId: 1, function: 3, startAddress: i * 10, quantity: 10, scanRateMs: 100 },
          active: true,
          display: { format: "unsigned", addressBase: 0, showAlias: true, copyAlias: false },
          scale: null,
          scaleOverrides: [],
          valueColumns: "raw",
          aliases: [],
          view: {
            host: i === 0 ? "workspace" : "native",
            open: true,
            workspace: i === 0 ? { x: 30, y: 30, width: 500, height: 300, z: 1, state: "normal", restore: null } : null,
            native: i === 1 ? { x: 100, y: 100, width: 600, height: 400, maximized: false, monitor: "\\\\.\\DISPLAY1" } : null,
          },
        })),
        migratedFrom: null,
      };
      return profile;
    })();
    await mm.open({
      polls: [{ name: "Poll 1" }, { name: "Poll 2" }],
      connected: true,
      seed: (f, a) => f.seedProfiles([a]),
      seedArg: saved,
    });
    await mm.openMenu("File");
    await mm.menuItem("Open profile…").click();
    await mm.openDialog.getByRole("row", { name: /Loadme/ }).dblclick();
    await expect(mm.confirm).toContainText("Disconnect and load?");
    await mm.confirm.getByRole("button", { name: /Disconnect and load/ }).click();
    await expect(mm.row("A")).toBeVisible();
    await expect(mm.row("Poll 1")).toHaveCount(0);
    await expect(mm.confirm).toHaveCount(0);
    await mm.expectCalls("disconnect", 1);
    await expect(mm.statusBar).toContainText("1 in its own window");
    const a = await mm.idOf("A");
    await mm.expectDomRect(a, { x: 30, y: 30, width: 500, height: 300 });
    await mm.expectConnection("idle");
  });

  test("CHK2-N7 (UI side) stored rectangles beyond a small window are clamped to keep 80 x 30 px of the title bar", async ({ mm }) => {
    const profile = {
      schemaVersion: 2,
      name: "Far away",
      connection: { mode: "tcp", host: "127.0.0.1", port: 5020, timeoutMs: 1000 },
      autoStartPoll: true,
      connectionWindow: null,
      workspace: { tileMode: false, compact: false, sidebarWidth: 280, sidebarCollapsed: false, trafficExpanded: false, trafficHeight: null, minimizedOrder: [] },
      polls: [
        {
          name: "A",
          definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
          active: true,
          display: { format: "unsigned", addressBase: 0, showAlias: true, copyAlias: false },
          scale: null,
          scaleOverrides: [],
          valueColumns: "raw",
          aliases: [],
          view: { host: "workspace", open: true, workspace: { x: 5000, y: 4000, width: 640, height: 368, z: 1, state: "normal", restore: null }, native: null },
        },
      ],
      migratedFrom: null,
    };
    await mm.open({ viewport: { width: 1100, height: 700 }, seed: (f, a) => f.seedProfiles([a]), seedArg: profile });
    await openProfile(mm, "Far away");
    const id = await mm.idOf("A");
    const ws = await mm.workspaceSize();
    await expect.poll(async () => (await mm.domRect(id)).x).toBe(ws.width - 80);
    await expect.poll(async () => (await mm.domRect(id)).y).toBe(ws.height - 30);
  });

  test("CHK2-N8 Ctrl+S in a native window asks W1 to save; an untitled profile opens Save as in W1", async ({ mm, page }) => {
    const w2 = await mm.openNative({ polls: [{ name: "Poll 1" }] });
    await w2.grid.focus();
    await w2.page.keyboard.press("Control+s");
    await w2.expectCalls("requestSave", 1);
    expect((await w2.calls("requestSave"))[0]).toEqual([false]);
    // Rust relays it to W1 (here: the fake of W1 gets the same command).
    await mm.open({ polls: [{ name: "Poll 1" }], connected: true });
    await page.bringToFront();
    await mm.script((f) => f.requestSave(false));
    await expect(mm.saveAsDialog).toBeVisible();
    await mm.expectCalls("focusConnectionWindow", 1);
  });
});

test.describe("P invalid input", () => {
  const CASES: Array<[string, string, string]> = [
    ["Name", "", "Enter a poll name."],
    ["Name", "a".repeat(49), "Poll name must be at most 48 characters."],
    ["Name", " a", "Poll name cannot start or end with a space."],
    ["Slave ID", "248", "Slave ID must be a whole number from 0 to 247."],
    ["Start address", "70000", "Start address must be a whole number from 0 to 65535."],
    ["Quantity", "200", "Quantity for FC03 must be from 1 to 125."],
    ["Quantity", "0", "Quantity for FC03 must be from 1 to 125."],
    ["Scan rate (ms)", "10", "Scan rate must be a whole number from 20 to 60000 ms."],
  ];

  test("CHK2-P1 poll name and definition messages in the sub-window setup", async ({ mm }) => {
    await mm.open({ polls: [{ name: "Poll 1" }, { name: "Tank" }] });
    const [a] = (await mm.pollIds()) as [number, number];
    await mm.row(a).click();
    await mm.titleButton(a, /^Poll setup/).click();
    for (const [label, text, message] of CASES) {
      await mm.setupField(a, label).fill(text);
      await mm.setupField(a, label).blur();
      await expect(mm.setup(a), `${label} = "${text}"`).toContainText(message);
      await expect(mm.setupField(a, label)).toHaveAttribute("aria-invalid", "true");
      await mm.setupField(a, label).fill(label === "Name" ? "Poll 1" : label === "Slave ID" ? "1" : label === "Start address" ? "0" : label === "Quantity" ? "10" : "1000");
      await mm.setupField(a, label).blur();
    }
    await mm.setupField(a, "Name").fill("tank");
    await mm.setupField(a, "Name").blur();
    await expect(mm.setup(a)).toContainText('A poll named "tank" already exists on this connection.');
  });

  test("CHK2-P1 the same messages in the native window panel", async ({ mm }) => {
    const w2 = await mm.openNative({ polls: [{ name: "Poll 1" }] });
    await expect(w2.setupPanel).toBeVisible();
    for (const [label, text, message] of CASES.filter((c) => c[0] !== "Name")) {
      await w2.field(label).fill(text);
      await w2.field(label).blur();
      await expect(w2.page.getByTestId("poll-setup"), `${label} = "${text}"`).toContainText(message);
      await w2.field(label).fill(label === "Slave ID" ? "1" : label === "Start address" ? "0" : label === "Quantity" ? "10" : "1000");
      await w2.field(label).blur();
    }
  });

  test("CHK2-P2 Save with an invalid connection field: toast, nothing saved; from a native window W1 shows it", async ({ mm, page }) => {
    await mm.open({ polls: [{ name: "Poll 1" }] });
    await mm.hostField.fill("not a host!");
    await mm.portField.fill("5020");
    await mm.toolbar.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+s");
    await expect(mm.toast("Fix the highlighted fields before saving.")).toBeVisible();
    expect(await mm.callCount("profilesSave")).toBe(0);
    await expect(mm.hostField).toBeFocused();
    await expect(mm.sidebar).toContainText("Enter a valid host name or IPv4 address, for example 192.168.1.10.");
    // From a native window: it asks W1 (Rust relays `SaveRequested`), W1 shows the toast and comes forward.
    const w2 = await mm.openNative({ polls: [{ name: "Poll 1" }] });
    await w2.grid.focus();
    await w2.page.keyboard.press("Control+s");
    await w2.expectCalls("requestSave", 1);
    await mm.page.bringToFront();
    await mm.script((f) => f.requestSave(false));
    await expect(mm.toast("Fix the highlighted fields before saving.")).toHaveCount(2);
    await mm.expectCalls("focusConnectionWindow", 1);
  });
});

// CHK2-N9 (revision 8, O-5, D-002-14): a pointer press that only raises a sub-window sends no layout; the
// z-order is reported with the next layout action; Save flushes it first.
test.describe("N9 z-order reporting", () => {
  const SEED = {
    items: [
      { index: 0, x: 8, y: 8, width: 500, height: 320, z: 1 },
      { index: 1, x: 300, y: 120, width: 500, height: 320, z: 2 },
    ],
  };
  const zOf = (mm: Mm, id: number) => mm.sub(id).evaluate((el) => Number(getComputedStyle(el).zIndex));
  const methods = (mm: Mm): Promise<string[]> => mm.script((f) => f.calls.map((c: { method: string }) => c.method));

  test("CHK2-N9 a press on A's body raises it without a layout report; the next layout action (minimize B) reports A above B", async ({
    mm,
  }) => {
    await mm.open({
      polls: [{ name: "A" }, { name: "B" }],
      seed: async (f, a, ids) => {
        await f.setProfileName("Plant");
        // `LAYOUT_SEED` is not reachable from here: store the rectangles directly.
        const base = f.snapshot().workspaceLayout;
        f.setWorkspaceLayout({
          ...base,
          items: [
            { pollId: ids[0], rect: { x: 8, y: 8, width: 500, height: 320, z: 1, state: "normal", restore: null } },
            { pollId: ids[1], rect: { x: 300, y: 120, width: 500, height: 320, z: 2, state: "normal", restore: null } },
          ],
        });
        void a;
      },
      connected: true,
    });
    const [a, b] = (await mm.pollIds()) as [number, number];
    await expect(mm.sub(b)).toHaveAttribute("aria-current", "true");
    expect(await zOf(mm, b)).toBeGreaterThan(await zOf(mm, a));
    const layoutCalls = await mm.callCount("setWorkspaceLayout");
    // The press on A's body (its visible left strip), no move.
    await mm.sub(a).click({ position: { x: 10, y: 150 } });
    await expect(mm.sub(a)).toHaveAttribute("aria-current", "true");
    expect(await zOf(mm, a), "A is drawn in front").toBeGreaterThan(await zOf(mm, b));
    expect(await mm.callCount("setWorkspaceLayout"), "no layout report for the press").toBe(layoutCalls);
    expect(await mm.modified(), "the raise does not mark the profile Modified").toBe(false);
    // A layout action follows: B is minimized.
    await mm.titleButton(b, "Minimize").click();
    await expect.poll(() => mm.callCount("setWorkspaceLayout")).toBe(layoutCalls + 1);
    const reported = (await mm.lastCall("setWorkspaceLayout")) as [{ items: Array<{ pollId: number; rect: { z: number; state: string } }> }];
    const ra = reported[0].items.find((i) => i.pollId === a);
    const rb = reported[0].items.find((i) => i.pollId === b);
    expect(rb?.rect.state).toBe("minimized");
    expect(ra?.rect.z, "the one reported layout has A above B").toBeGreaterThan(rb?.rect.z ?? 0);
  });

  test("CHK2-N9 raise A by a press, then Ctrl+S alone: a layout with A above B is sent BEFORE the save; reopening shows A in front; not Modified", async ({
    mm,
    page,
  }) => {
    await mm.open({
      polls: [{ name: "A" }, { name: "B" }],
      seed: async (f, a, ids) => {
        await f.setProfileName("Plant");
        const base = f.snapshot().workspaceLayout;
        f.setWorkspaceLayout({
          ...base,
          items: [
            { pollId: ids[0], rect: { x: 8, y: 8, width: 500, height: 320, z: 1, state: "normal", restore: null } },
            { pollId: ids[1], rect: { x: 300, y: 120, width: 500, height: 320, z: 2, state: "normal", restore: null } },
          ],
        });
        void a;
      },
      connected: true,
    });
    const [a, b] = (await mm.pollIds()) as [number, number];
    // Store the profile once so that it has a file and Ctrl+S saves without a dialog.
    await saveAs(mm, "Plant");
    const before = (await methods(mm)).length;
    await mm.sub(a).click({ position: { x: 10, y: 150 } });
    await expect(mm.sub(a)).toHaveAttribute("aria-current", "true");
    expect(await zOf(mm, a)).toBeGreaterThan(await zOf(mm, b));
    expect(await mm.modified(), "not Modified by the raise").toBe(false);
    expect((await methods(mm)).slice(before).filter((m) => m === "setWorkspaceLayout"), "nothing reported yet").toEqual([]);
    // Focus stays in the window content; Ctrl+S with no other action.
    await mm.titleBar(a).focus();
    await page.keyboard.press("Control+s");
    await expect.poll(async () => (await methods(mm)).slice(before).includes("profilesSave")).toBe(true);
    const after = (await methods(mm)).slice(before);
    const iLayout = after.indexOf("setWorkspaceLayout");
    const iSave = after.indexOf("profilesSave");
    expect(iLayout, "a layout was reported").toBeGreaterThanOrEqual(0);
    expect(iLayout, "the layout comes BEFORE the save command").toBeLessThan(iSave);
    const layout = (await mm.calls("setWorkspaceLayout")).at(-1) as [{ items: Array<{ pollId: number; rect: { z: number } }> }];
    const za = layout[0].items.find((i) => i.pollId === a)?.rect.z ?? 0;
    const zb = layout[0].items.find((i) => i.pollId === b)?.rect.z ?? 0;
    expect(za, "A above B in the reported layout").toBeGreaterThan(zb);
    const saved = ((await mm.lastCall("profilesSave")) as [SavedProfile, boolean])[0];
    const sa = saved.polls.find((p) => p.name === "A")?.view.workspace?.z ?? 0;
    const sb = saved.polls.find((p) => p.name === "B")?.view.workspace?.z ?? 0;
    expect(sa, "the saved profile has A above B").toBeGreaterThan(sb);
    expect(await mm.modified()).toBe(false);
    // Reopen the profile (connected: the window asks first): A is in front.
    const applied = await mm.callCount("applyProfile");
    await mm.openMenu("File");
    await mm.menuItem("Open profile…").click();
    await mm.openDialog.getByRole("row", { name: /Plant/ }).dblclick();
    await expect(mm.confirm).toContainText("Disconnect and load?");
    await mm.confirm.getByRole("button", { name: /Disconnect and load/ }).click();
    await mm.expectCalls("applyProfile", applied + 1);
    await expect(mm.confirm).toHaveCount(0);
    const na = await mm.idOf("A");
    const nb = await mm.idOf("B");
    await expect(mm.sub(na)).toBeVisible();
    await expect(mm.sub(nb)).toBeVisible();
    expect(await zOf(mm, na), "A in front after reopening").toBeGreaterThan(await zOf(mm, nb));
  });
});
