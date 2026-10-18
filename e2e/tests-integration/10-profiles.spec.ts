// Integration mode (REPORT-006), (h): profiles on the real data dir (temp ESEFACT_DATA_DIR), a real app restart, layout
// and hosts restored, Modified rules, schema 1 migration with a hand-written file, unreadable files.
// CHK2-N1, N2, N3, N4, N5, N7, K1 (traffic expanded survives), CHK3-G1 is in 11-scaling.
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "../integration/fixtures";
import { makeDataDir, removeDir, startApp } from "../integration/app-session";
import { Sim } from "../integration/sim";
import { openProfile, profileV2, profilesDir, readProfile, saveProfileAs, writeProfile } from "../integration/profiles";
import { createPolls, focusPoll, referenceMap } from "../integration/scenario";
import { twoFrames } from "../integration/status-line";

const V1 = `{
  "schemaVersion": 1,
  "name": "Boiler-PLC",
  "connection": {"mode": "tcp", "host": "192.168.1.10", "port": 502, "timeoutMs": 1000},
  "poll": {"slaveId": 1, "function": 3, "startAddress": 0, "quantity": 10, "scanRateMs": 1000},
  "display": {"format": "hex", "addressBase": 1},
  "autoStartPoll": true
}`;

test.describe("(h) profiles, restart, migration", () => {
  test("CHK2-N3/N4 schema 1: opens with the migration notice, poll 'Poll 1', file unchanged until saved, then saved as schema 2", async ({ desktop, mm }) => {
    const file = writeProfile(desktop, "Boiler-PLC", V1);
    const before = fs.readFileSync(file, "utf8");
    await openProfile(mm, "Boiler-PLC");
    await expect(mm.page.getByText('This profile was saved by an earlier version. Its poll is now "Poll 1". Saving stores it in the new format, which earlier versions cannot open.')).toBeVisible();
    await expect(mm.page.getByRole("button", { name: "Dismiss" })).toBeVisible();
    await expect(mm.row("Poll 1")).toBeVisible();
    const id = await mm.idByName("Poll 1");
    await expect(mm.sub(id)).toBeVisible();
    await mm.expectDomRect(id, { x: 8, y: 8, width: 640, height: 368 });
    await expect(mm.statusLine(id)).toContainText("ID 1 · F 03 · SR 1000 ms");
    await expect(mm.profileLabel).toContainText("Boiler-PLC");
    await expect(mm.profileLabel, "not Modified after the migration").not.toContainText("Modified");
    expect(fs.readFileSync(file, "utf8"), "the schema-1 file is unchanged before Save").toBe(before);
    expect(readProfile(desktop, "Boiler-PLC").schemaVersion).toBe(1);
    // the migrated display settings: Hex, 1-based
    // (the migrated display, Hex and 1-based, is checked in the saved file below: an idle poll shows no grid)
    // Save
    await mm.page.getByRole("button", { name: "Dismiss" }).click().catch(() => undefined);
    await mm.titleBar(id).click({ position: { x: 40, y: 15 } });
    await mm.page.keyboard.press("Control+s");
    await expect.poll(() => readProfile(desktop, "Boiler-PLC").schemaVersion, { message: "saved as schema 2", timeout: 10_000 }).toBe(2);
    const saved = readProfile(desktop, "Boiler-PLC");
    expect(saved.workspace, "workspace block written").toBeTruthy();
    expect(saved.polls).toHaveLength(1);
    expect(saved.polls[0].name).toBe("Poll 1");
    expect(saved.polls[0].view, "view block written").toBeTruthy();
    expect(saved.polls[0].aliases).toEqual([]);
    expect(saved.polls[0].display).toMatchObject({ format: "hex", addressBase: 1 });
    expect(saved.connection).toMatchObject({ mode: "tcp", host: "192.168.1.10", port: 502 });
    expect("migratedFrom" in saved ? saved.migratedFrom : undefined, "no migratedFrom in the file").toBeUndefined();
  });

  test("CHK2-N5 unreadable files are listed as 'Cannot be opened (newer or damaged file)' and cannot be opened: schema 3, 17 polls, 2001 aliases, duplicate alias, minimizedOrder out of range, bad function", async ({ desktop, mm }) => {
    const poll = (name: string, extra: Record<string, unknown> = {}) => ({
      name, definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 }, active: true,
      display: { format: "unsigned", addressBase: 0, showAlias: true, copyAlias: false }, scale: null, scaleOverrides: [], valueColumns: "raw", aliases: [],
      view: { host: "workspace", open: true, workspace: null, native: null }, ...extra,
    });
    const base = (polls: unknown[], ws: Record<string, unknown> = {}) => ({ ...profileV2("x", []), polls, workspace: { ...(profileV2("x", []).workspace as object), ...ws } });
    writeProfile(desktop, "Bad-v3", JSON.stringify({ schemaVersion: 3, name: "Bad-v3", polls: [] }));
    writeProfile(desktop, "Bad-17polls", base(Array.from({ length: 17 }, (_, i) => poll(`P${i}`))));
    writeProfile(desktop, "Bad-2001aliases", base([poll("P", { aliases: Array.from({ length: 2001 }, (_, i) => ({ address: i, alias: `a${i}` })) })]));
    writeProfile(desktop, "Bad-dupalias", base([poll("P", { aliases: [{ address: 1, alias: "a" }, { address: 1, alias: "b" }] })]));
    writeProfile(desktop, "Bad-minorder", base([poll("P")], { minimizedOrder: [9] }));
    writeProfile(desktop, "Bad-function", base([poll("P", { definition: { slaveId: 1, function: 9, startAddress: 0, quantity: 10, scanRateMs: 1000 } })]));
    writeProfile(desktop, "Bad-dupname", base([poll("Same"), poll("same")]));
    writeProfile(desktop, "Good-file", base([poll("P")]));
    await mm.openMenu("File");
    await mm.menuItem("Open profile…").click();
    const dialog = mm.openDialog;
    for (const name of ["Bad-v3", "Bad-17polls", "Bad-2001aliases", "Bad-dupalias", "Bad-minorder", "Bad-function", "Bad-dupname"]) {
      const row = dialog.getByRole("row", { name: new RegExp(name) });
      await expect(row, name).toContainText("Cannot be opened (newer or damaged file)");
      await row.click();
      await expect(dialog.getByRole("button", { name: "Open", exact: true }), `${name}: Open is disabled`).toBeDisabled();
    }
    const good = dialog.getByRole("row", { name: /Good-file/ });
    await expect(good).not.toContainText("Cannot be opened");
    await good.click();
    await expect(dialog.getByRole("button", { name: "Open", exact: true })).toBeEnabled();
    // the real reasons are in the tooltips (the backend's text)
    const reasons: Record<string, string> = {};
    for (const name of ["Bad-v3", "Bad-17polls", "Bad-2001aliases", "Bad-dupalias", "Bad-minorder", "Bad-function", "Bad-dupname"]) {
      reasons[name] = (await dialog.getByRole("row", { name: new RegExp(name) }).locator("span[title]").first().getAttribute("title")) ?? "";
    }
    console.log("N5 REASONS", JSON.stringify(reasons));
  });

  test("CHK2-N7 rectangles beyond W1 are restored clamped (80 x 30 px of the title bar visible); a native placement on a missing monitor cascades on W1's monitor", async ({ desktop, mm }) => {
    test.setTimeout(90_000);
    writeProfile(
      desktop,
      "Clamp",
      profileV2("Clamp", [
        { name: "Far", workspace: { x: 4000, y: 3000, width: 640, height: 368, z: 1 } },
        { name: "Left", workspace: { x: -900, y: -500, width: 640, height: 368, z: 2 } },
        { name: "Nat", host: "native", open: true, native: { x: 5000, y: 100, width: 900, height: 640, maximized: false, monitor: "\\\\.\\DISPLAY9" } },
      ]),
    );
    await openProfile(mm, "Clamp");
    const far = await mm.idByName("Far");
    const left = await mm.idByName("Left");
    await expect(mm.sub(far)).toBeVisible();
    await twoFrames(mm.page);
    const ws = await mm.workspaceSize();
    const r1 = await mm.domRect(far);
    const r2 = await mm.domRect(left);
    expect(r1.x, `Far.x ${r1.x} keeps 80 px visible (workspace ${ws.width})`).toBeLessThanOrEqual(ws.width - 80);
    expect(r1.y).toBeLessThanOrEqual(ws.height - 30);
    expect(r2.x + r2.width, `Left right edge ${r2.x + r2.width} keeps 80 px visible`).toBeGreaterThanOrEqual(80);
    expect(r2.y).toBeGreaterThanOrEqual(0);
    // the native window opened somewhere on the (only) monitor, not at x = 5000
    await expect.poll(() => desktop.windows().filter((w) => w.title.startsWith("Nat - ")).length, { timeout: 15_000 }).toBe(1);
    const nat = desktop.windows().find((w) => w.title.startsWith("Nat - "));
    const mon = (await mm.monitors())[0];
    const wa = mon?.workArea as { x: number; y: number; width: number; height: number };
    console.log("N7 native placed at", JSON.stringify(nat?.rect), "work area px", Math.round(wa.width * (mon?.scaleFactor ?? 1)));
    expect(nat?.rect.x, "x inside the work area").toBeLessThan(Math.round(wa.width * (mon?.scaleFactor ?? 1)));
    expect(nat?.rect.x).toBeGreaterThanOrEqual(0);
  });

  test("CHK2-N1/N2/K1 round trip with a real restart: list order, definitions, display, aliases, rectangles, minimized, native placement, compact and traffic restored; layout actions do not mark Modified", async ({}, testInfo) => {
    test.setTimeout(300_000);
    const dataDir = makeDataDir();
    const sim = await Sim.start();
    let s1: Awaited<ReturnType<typeof startApp>> | null = null;
    let s2: Awaited<ReturnType<typeof startApp>> | null = null;
    try {
      await referenceMap(sim);
      s1 = await startApp(dataDir);
      const { desktop, mm } = s1;
      await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
      const ids = await createPolls(mm, [
        { name: "P1", slave: 1, fc: 3, start: 0, qty: 10, scan: 200 },
        { name: "P2", slave: 1, fc: 4, start: 0, qty: 5, scan: 300 },
        { name: "P3", slave: 1, fc: 3, start: 10, qty: 6, scan: 400 },
        { name: "P4", slave: 2, fc: 3, start: 0, qty: 4, scan: 500 },
      ]);
      const [p1, p2, p3, p4] = ids as [number, number, number, number];
      // P1: Hex and aliases
      await focusPoll(mm, p1);
      await mm.page.keyboard.press("Control+3");
      await mm.gridRow(p1, 0).locator('[data-cell="alias"]').dblclick();
      await mm.page.keyboard.type("Tank top");
      await mm.page.keyboard.press("Enter");
      await mm.page.keyboard.type("Tank bottom");
      await mm.page.keyboard.press("Enter");
      await expect(mm.gridRow(p1, 1).locator('[data-cell="alias"]')).toContainText("Tank bottom");
      // P3: 1-based
      await focusPoll(mm, p3);
      await mm.page.keyboard.press("Control+b");
      // P2: minimized
      await focusPoll(mm, p2);
      await mm.titleButton(p2, "Minimize").click();
      await expect(mm.minimizedBar).toBeVisible();
      // P3: moved and resized with the real mouse
      await focusPoll(mm, p3);
      const tp = await mm.titlePoint(p3, 60);
      await mm.page.mouse.move(tp.x, tp.y);
      await mm.page.mouse.down();
      await mm.page.mouse.move(tp.x + 260, tp.y + 90, { steps: 8 });
      await mm.page.mouse.up();
      // P4 native, moved by the OS, list order: P4 first
      await focusPoll(mm, p4);
      await mm.page.keyboard.press("Control+Shift+O");
      await desktop.w2Page(p4);
      await mm.row(p4).click();
      await mm.row(p4).focus();
      await mm.page.keyboard.press("Alt+ArrowUp");
      await mm.page.keyboard.press("Alt+ArrowUp");
      await mm.page.keyboard.press("Alt+ArrowUp");
      await expect.poll(async () => (await mm.ids())[0]).toBe(p4);
      await expect.poll(() => desktop.windows().some((w) => w.title.startsWith("P4 - ")), { timeout: 15_000 }).toBe(true);
      const natWin = desktop.windows().find((w) => w.title.startsWith("P4 - "));
      desktop.moveWindow(natWin?.hwnd as number, 333, 111, 1000, 700);
      await expect.poll(() => desktop.windows().find((w) => w.title.startsWith("P4 - "))?.rect.x).toBe(333);
      // save as Plant
      await saveProfileAs(mm, "Plant");
      await expect(mm.profileLabel).not.toContainText("Modified");
      const rects: Record<string, unknown> = {};
      for (const [n, id] of [["P1", p1], ["P3", p3]] as const) rects[n] = await mm.domRect(id);
      const file = readProfile(desktop, "Plant");
      await testInfo.attach("Plant.json", { body: JSON.stringify(file, null, 1), contentType: "application/json" });
      expect(file.schemaVersion).toBe(2);
      expect(file.polls.map((p: { name: string }) => p.name), "list order in the file").toEqual(["P4", "P1", "P2", "P3"]);
      const byName = Object.fromEntries(file.polls.map((p: { name: string }) => [p.name, p]));
      expect(byName.P1.display.format).toBe("hex");
      expect(byName.P1.aliases).toEqual([{ address: 0, alias: "Tank top" }, { address: 1, alias: "Tank bottom" }]);
      expect(byName.P3.display.addressBase).toBe(1);
      expect(byName.P2.view.workspace.state).toBe("minimized");
      expect(byName.P4.view).toMatchObject({ host: "native", open: true });
      expect(byName.P4.view.native.x, "native placement is stored in logical px (333 physical / 1.25)").toBeCloseTo(333 / 1.25, 0);
      expect(file.workspace).toMatchObject({ tileMode: false, compact: false, trafficExpanded: false });
      expect(file.workspace.minimizedOrder.length).toBe(1);
      // N2: layout actions after the save never mark the profile Modified
      await mm.grid(p1).focus();
      await mm.page.keyboard.press("Control+p");
      await expect(mm.statusLine(p1)).toHaveAttribute("data-state", "paused");
      await mm.page.keyboard.press("Control+p");
      await expect(mm.statusLine(p1)).toHaveAttribute("data-state", "polling");
      await focusPoll(mm, p3);
      const q = await mm.titlePoint(p3, 60);
      await mm.page.mouse.move(q.x, q.y);
      await mm.page.mouse.down();
      await mm.page.mouse.move(q.x - 30, q.y + 10, { steps: 4 });
      await mm.page.mouse.up();
      await mm.grid(p1).focus();
      await mm.page.keyboard.press("Control+Shift+T");
      await mm.page.keyboard.press("Control+Shift+C");
      await expect(mm.profileLabel, "layout, tile, pause/resume do not mark Modified").not.toContainText("Modified");
      // Modified by a rename
      await mm.row(p1).click();
      await mm.row(p1).focus();
      await mm.page.keyboard.press("F2");
      await mm.page.keyboard.press("Control+a");
      await mm.page.keyboard.type("P1x");
      await mm.page.keyboard.press("Enter");
      await expect(mm.profileLabel, "a rename marks Modified").toContainText("Modified");
      // restore the saved state for the round trip (rename back, then save again)
      await mm.row(p1).focus();
      await mm.page.keyboard.press("F2");
      await mm.page.keyboard.press("Control+a");
      await mm.page.keyboard.type("P1");
      await mm.page.keyboard.press("Enter");
      // compact mode + traffic panel (layout values: no Modified), then Save writes them
      await mm.grid(p1).focus();
      await mm.page.keyboard.press("Control+Shift+Backslash");
      await mm.page.keyboard.press("Control+j");
      await expect(mm.traffic).toBeVisible();
      await expect(mm.profileLabel, "compact and the traffic panel do not mark Modified").not.toContainText("Modified");
      await mm.grid(p1).focus();
      await mm.page.keyboard.press("Control+s");
      await expect.poll(() => readProfile(desktop, "Plant").workspace.compact, { message: "Save writes compact", timeout: 10_000 }).toBe(true);
      await expect(mm.profileLabel).not.toContainText("Modified");
      const saved2 = readProfile(desktop, "Plant");
      expect(saved2.workspace).toMatchObject({ tileMode: false, compact: true, trafficExpanded: true });
      console.log("N1 SAVED2 actives", JSON.stringify(saved2.polls.map((p: { name: string; active: boolean }) => [p.name, p.active])), "autoStartPoll", saved2.autoStartPoll);
      const natSaved = (saved2.polls as Array<{ name: string; view: { native: { x: number; y: number; width: number; height: number } } }>).find((p) => p.name === "P4")?.view.native;
      const rect1 = await mm.domRect(p1);
      const rect3 = await mm.domRect(p3);
      const natNow = desktop.windows().find((w) => w.title.startsWith("P4 - "))?.rect;
      // z-order of the two sub-windows that are shown (higher z-index = in front)
      const zOf = (m: typeof mm, id: number) => m.sub(id).evaluate((el) => Number(getComputedStyle(el).zIndex));
      const zBefore = (await zOf(mm, p1)) > (await zOf(mm, p3)) ? "P1 in front of P3" : "P3 in front of P1";
      await desktop.stop();
      s1 = null;

      // ---- restart on the same data dir
      s2 = await startApp(dataDir);
      const m2 = s2.mm;
      await openProfile(m2, "Plant");
      // compact mode and the traffic panel come back; the sidebar is the rail (one icon per poll in list order)
      await expect(m2.rail, "compact: the sidebar is a rail").toBeVisible({ timeout: 20_000 });
      await expect(m2.traffic, "traffic panel expanded").toBeVisible();
      const railNames = await m2.rail.getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
      expect(railNames.filter((n) => /^P\d: /.test(n)).map((n) => n.split(":")[0]), "list order after the restart").toEqual(["P4", "P1", "P2", "P3"]);
      await expect(m2.profileLabel, "opening a profile does not mark it Modified").not.toContainText("Modified");
      // leave compact mode (a layout action) to continue with the rows
      await m2.windowMenu("Collapse setup panels", "menuitemcheckbox");
      await expect(m2.pollList).toBeVisible();
      const names = await m2.pollList.getByRole("option").evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? e.textContent ?? "").split(",")[0]));
      expect(names, "list order after the restart").toEqual(["P4", "P1", "P2", "P3"]);
      const n2 = Object.fromEntries(await Promise.all(["P1", "P2", "P3", "P4"].map(async (n) => [n, await m2.idByName(n)])));
      await expect(m2.row(n2.P2 as number)).toContainText("minimized");
      await expect(m2.row(n2.P4 as number)).toContainText("own window");
      await expect.poll(() => s2?.desktop.windows().find((w) => w.title.startsWith("P4 - "))?.rect, { timeout: 20_000 }).toBeTruthy();
      const natAfter = s2.desktop.windows().find((w) => w.title.startsWith("P4 - "))?.rect;
      console.log("N1 NATIVE BEFORE/AFTER", JSON.stringify(natNow), JSON.stringify(natAfter), "saved", JSON.stringify(natSaved));
      // placements are stored in whole logical px (333 / 1.25 = 266.4 -> 266, 111 / 1.25 = 88.8 -> 88): at 125 % the window reopens
      // within 1 physical px of where it was (reported as an observation: the rounding drifts, it does not accumulate here)
      for (const k of ["x", "y", "w", "h"] as const) expect(Math.abs((natAfter?.[k] ?? 0) - (natNow?.[k] ?? 0)), `native window ${k} after the restart`).toBeLessThanOrEqual(1);
      await m2.expectDomRect(n2.P1 as number, rect1);
      await m2.expectDomRect(n2.P3 as number, rect3);
      await expect(m2.sub(n2.P2 as number)).toHaveCount(0);
      await expect(m2.minimizedBar).toContainText("P2");
      const zAfter = (await m2.sub(n2.P1 as number).evaluate((el) => Number(getComputedStyle(el).zIndex))) > (await m2.sub(n2.P3 as number).evaluate((el) => Number(getComputedStyle(el).zIndex))) ? "P1 in front of P3" : "P3 in front of P1";
      expect(zAfter, "z-order of the sub-windows after the restart").toBe(zBefore);
      // connect (the saved connection is the simulator): display and aliases are visible with data
      await m2.toolbarButton("Connect").click();
      await expect(m2.pill).toContainText("Connected", { timeout: 15_000 });
      await expect(m2.statusLine(n2.P1 as number)).toHaveAttribute("data-state", "polling", { timeout: 15_000 });
      await expect(m2.gridRow(n2.P1 as number, 0).locator('[data-cell="alias"]')).toContainText("Tank top");
      await expect(m2.gridRow(n2.P1 as number, 1).locator('[data-cell="alias"]')).toContainText("Tank bottom");
      expect((await m2.rowCells(n2.P3 as number, 0))[1], "1-based address of P3 (start 10)").toBe("11");
      expect((await m2.rowCells(n2.P1 as number, 1)).at(-1), "Hex of P1 (HR1 = 65535)").toBe("0xFFFF");
      expect(m2.pageErrors).toEqual([]);
    } finally {
      await s1?.desktop.stop();
      await s2?.desktop.stop();
      await sim.stop();
      removeDir(dataDir);
    }
  });

  test("CHK2-N6 loading while connected asks 'Disconnect and load?'; confirming closes all sub-windows and native windows without S6, then the profile's hosts open", async ({ desktop, mm, sim }) => {
    test.setTimeout(120_000);
    await referenceMap(sim);
    await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
    const ids = await createPolls(mm, [{ name: "Old1", scan: 100 }, { name: "Old2", scan: 100 }]);
    await focusPoll(mm, ids[0] as number);
    await mm.page.keyboard.press("Control+Shift+O");
    await desktop.w2Page(ids[0] as number);
    writeProfile(desktop, "Next", profileV2("Next", [{ name: "N1" }, { name: "N2", host: "native", open: true }]));
    await mm.openMenu("File");
    await mm.menuItem("Open profile…").click();
    await mm.openDialog.getByRole("row", { name: /Next/ }).dblclick();
    await expect(mm.confirm).toBeVisible();
    // the profile is Modified (polls were added), so "Save changes?" comes first, then "Disconnect and load?"
    const seen: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const dlg = mm.confirm;
      if (!(await dlg.isVisible())) break;
      const text = (await dlg.innerText()).replace(/\s+/g, " ");
      seen.push(text);
      const names = await dlg.getByRole("button").allInnerTexts();
      seen.push("buttons: " + names.join(" | "));
      const pick = names.find((n) => /^Don't save$/.test(n)) ?? names.find((n) => !/^Cancel$/.test(n)) ?? "Cancel";
      await dlg.getByRole("button", { name: pick, exact: true }).click();
      await twoFrames(mm.page);
    }
    console.log("N6 DIALOGS", JSON.stringify(seen));
    expect(seen.some((s) => /Disconnect and load\?/.test(s)), "Disconnect and load? was asked").toBe(true);
    await expect.poll(async () => (await mm.ids()).length, { timeout: 20_000 }).toBe(2);
    await mm.expectConnection("idle");
    await expect.poll(() => desktop.windows().filter((w) => /^(N2|Old1) - /.test(w.title)).map((w) => w.title.split(" - ")[0]), { timeout: 20_000 }).toEqual(["N2"]);
    expect(path.basename(profilesDir(desktop))).toBe("modbus-master");
  });
});
