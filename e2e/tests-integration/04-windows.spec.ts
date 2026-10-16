// Integration mode, priority 4: real close requests (WM_CLOSE), several windows with their own
// sessions, profiles on disk across an app restart, window-state restore.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import {
  Desktop,
  expect,
  ModbusApp,
  openModbusWindow,
  referenceMap,
  realConnect,
  Sim,
  test,
} from "../integration/helpers-fixtures";

/** Native window whose title equals the page's document title. */
async function nativeOf(desktop: Desktop, page: Page) {
  const title = await page.title();
  await expect.poll(() => desktop.windows().filter((w) => w.title === title).length, { message: `native window "${title}"` }).toBeGreaterThan(0);
  const w = desktop.windows().find((x) => x.title === title);
  if (!w) throw new Error(`no native window "${title}"`);
  return w;
}

function jsonFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? jsonFiles(path.join(dir, e.name)) : e.name.endsWith(".json") ? [path.join(dir, e.name)] : [],
  );
}

function profileNamesOnDisk(dataDir: string): string[] {
  const dir = path.join(dataDir, "profiles");
  if (!fs.existsSync(dir)) return [];
  return jsonFiles(dir).flatMap((f) => {
    try {
      return [String(JSON.parse(fs.readFileSync(f, "utf8")).name)];
    } catch {
      return [];
    }
  });
}

/**
 * Esc first cancels an inline rename and only the next Esc closes the dialog (DES S3). The renamed row
 * is already listed while the rename is still being committed, so press Esc until the dialog is gone.
 */
async function closeOpenDialog(mm: ModbusApp): Promise<void> {
  await expect(async () => {
    if (await mm.openDialog.count()) await mm.page.keyboard.press("Escape");
    await expect(mm.openDialog).toHaveCount(0, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

async function saveAs(mm: ModbusApp, name: string): Promise<void> {
  await mm.page.keyboard.press("Control+Shift+s");
  await mm.saveAsDialog.getByLabel("Name").fill(name);
  await mm.saveAsDialog.getByRole("button", { name: "Save" }).click();
  await expect(mm.saveAsDialog).toHaveCount(0);
  await expect(mm.profile).toContainText(name);
}

test.describe("P4 / J28 real close requests", () => {
  test.beforeEach(async ({ sim }) => {
    await referenceMap(sim);
  });

  test("CHK-P4 unsaved changes: Cancel keeps the window open, Don't save closes it", async ({ desktop, mm }) => {
    await mm.host.fill("127.0.0.1");
    const win = await nativeOf(desktop, mm.page);
    desktop.closeWindow(win.hwnd);
    await expect(mm.confirmDialog.getByText("Save changes?", { exact: true })).toBeVisible();
    await expect(mm.confirmDialog).toContainText("Save this setup as a profile before closing?");
    await expect(mm.confirmDialog.getByRole("button", { name: "Save", exact: true })).toBeFocused();
    await mm.confirmDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(mm.confirmDialog).toHaveCount(0);
    expect(mm.page.isClosed()).toBe(false);
    expect(desktop.windows().some((w) => w.hwnd === win.hwnd)).toBe(true);
    // again, now Don't save
    desktop.closeWindow(win.hwnd);
    await mm.confirmDialog.getByRole("button", { name: "Don't save" }).click();
    await expect.poll(() => mm.page.isClosed()).toBe(true);
    await expect.poll(() => desktop.windows().some((w) => w.hwnd === win.hwnd)).toBe(false);
    expect(desktop.running, "the launcher keeps the app alive").toBe(true);
  });

  test("CHK-J28 close with unsaved changes and an invalid field: Save is blocked, toast, window stays", async ({ desktop, mm }) => {
    await mm.host.fill("127.0.0.1");
    await mm.quantity.fill("126");
    desktop.closeWindow((await nativeOf(desktop, mm.page)).hwnd);
    await mm.confirmDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(mm.toast("Fix the highlighted fields before saving.")).toBeVisible();
    await expect(mm.quantity).toBeFocused();
    expect(mm.page.isClosed()).toBe(false);
    expect(desktop.windows().some((w) => w.title.startsWith("Modbus Master"))).toBe(true);
  });

  test("CHK-P4 a polling window without changes closes at once and the simulator sees the socket closed", async ({
    desktop,
    mm,
    sim,
  }) => {
    await mm.host.fill("127.0.0.1");
    await mm.port.fill(String(sim.modbusPort));
    await saveAs(mm, "Bench A"); // clean: nothing differs from the saved profile
    await mm.toolbarButton("Connect").click();
    await mm.expectPill("Polling", "activity");
    await expect.poll(() => desktop.establishedTo(sim.modbusPort), { message: "established connections to the simulator" }).toBe(1);
    await expect(mm.profile).not.toContainText("Modified");
    const win = await nativeOf(desktop, mm.page);
    desktop.closeWindow(win.hwnd);
    await expect.poll(() => mm.page.isClosed()).toBe(true);
    await expect.poll(() => desktop.windows().some((w) => w.hwnd === win.hwnd)).toBe(false);
    // simulator side: the connection ended (log line and the OS connection table)
    await expect.poll(() => sim.lines.some((l) => /conn=1 CLOSE/.test(l)), { message: "simulator logs the close of conn=1" }).toBe(true);
    await expect.poll(() => desktop.establishedTo(sim.modbusPort)).toBe(0);
  });
});

test.describe("P2 / P3 two windows, two sessions", () => {
  test("CHK-P2/P3 each window polls its own simulator; stopping one disconnects only its window", async ({ desktop, launcher, sim }) => {
    const simB = await Sim.start();
    try {
      await referenceMap(sim);
      await referenceMap(simB);
      await simB.ctlOk("set holding 0 4242");
      const w1 = await openModbusWindow(desktop, launcher);
      const w2 = await openModbusWindow(desktop, launcher);
      await realConnect(w1, sim, { scanMs: 150, timeoutMs: 3000 });
      await realConnect(w2, simB, { scanMs: 150, timeoutMs: 3000 });
      await w1.expectPill("Polling", "activity");
      await w2.expectPill("Polling", "activity");
      await expect(w1.value(0)).toHaveText("1234");
      await expect(w2.value(0)).toHaveText("4242");
      // independent counters, traffic and state: pausing window 1 does not touch window 2
      await w1.toolbarButton("Pause").click();
      await w1.expectPill("Paused", "pause");
      const before = Number(await w2.counter("Requests").innerText());
      await expect.poll(async () => Number(await w2.counter("Requests").innerText())).toBeGreaterThan(before);
      await w2.expectPill("Polling", "activity");
      await w1.toolbarButton("Resume").click();
      await w1.expectPill("Polling", "activity");
      // P3: stop simulator A only
      await sim.ctlOk("stop");
      await w1.expectPill("Disconnected", "unplug");
      await w2.expectPill("Polling", "activity");
      await w2.expectNoBanner();
      // native titles are per window
      await expect.poll(() => desktop.windows().map((w) => w.title)).toEqual(
        expect.arrayContaining([expect.stringMatching(/- Disconnected$/), expect.stringMatching(/- Polling$/)]),
      );
    } finally {
      await simB.stop();
    }
  });

  test("CHK-P2 two windows to the same simulator: two connections, independent sessions", async ({ desktop, launcher, sim }) => {
    await referenceMap(sim);
    const w1 = await openModbusWindow(desktop, launcher);
    const w2 = await openModbusWindow(desktop, launcher);
    await realConnect(w1, sim, { scanMs: 150 });
    await realConnect(w2, sim, { scanMs: 150 });
    await w1.expectPill("Polling", "activity");
    await w2.expectPill("Polling", "activity");
    await expect.poll(() => desktop.establishedTo(sim.modbusPort)).toBe(2);
    const conns = new Set(sim.frames().map((f) => f.conn));
    expect(conns.size).toBe(2);
    await w1.toolbarButton("Disconnect").click();
    await w1.expectPill("Not connected", "plug");
    await w2.expectPill("Polling", "activity");
    await expect.poll(() => desktop.establishedTo(sim.modbusPort)).toBe(1);
  });
});

test.describe("O8 profiles on disk", () => {
  test("CHK-O8 a saved profile is a file in the data directory and survives an app restart; unreadable files are flagged", async ({ sim }) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "esefact-it-profiles-"));
    let d1: Desktop | undefined;
    let d2: Desktop | undefined;
    try {
      d1 = await Desktop.start({ dataDir });
      const l1 = await d1.launcherPage();
      const mm1 = await openModbusWindow(d1, l1);
      await mm1.host.fill("127.0.0.1");
      await mm1.port.fill(String(sim.modbusPort));
      await mm1.fn.selectOption("4");
      await mm1.start.fill("5");
      await mm1.page.keyboard.press("Control+3"); // Hex
      await saveAs(mm1, "Bench A");
      const found = jsonFiles(path.join(dataDir, "profiles"));
      expect(found.length, `profile files: ${found.join(", ")}`).toBe(1);
      const file = found[0] ?? "";
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(saved).toMatchObject({
        name: "Bench A",
        schemaVersion: 1,
        connection: { mode: "tcp", host: "127.0.0.1", port: sim.modbusPort },
        poll: { function: 4, startAddress: 5 },
        display: { format: "hex" },
      });
      // a file with a newer schema is flagged (CHK-O10 on the real store)
      fs.writeFileSync(path.join(path.dirname(file), "Future.json"), JSON.stringify({ ...saved, name: "Future", schemaVersion: 99 }));
      await d1.stop();
      d1 = undefined;

      d2 = await Desktop.start({ dataDir });
      const l2 = await d2.launcherPage();
      const mm2 = await openModbusWindow(d2, l2);
      await mm2.page.keyboard.press("Control+o");
      const dialog = mm2.openDialog;
      await expect(dialog.getByRole("row", { name: /Bench A/ })).toBeVisible();
      const future = dialog.getByRole("row", { name: /Future/ });
      await expect(future).toContainText("Cannot be opened (newer or damaged file)");
      await future.click();
      await expect(dialog.getByRole("button", { name: "Open", exact: true })).toBeDisabled();
      await dialog.getByRole("row", { name: /Bench A/ }).dblclick();
      await expect(mm2.profile).toContainText("Bench A");
      await expect(mm2.port).toHaveValue(String(sim.modbusPort));
      await expect(mm2.fn).toHaveValue("4");
      await expect(mm2.start).toHaveValue("5");
      await expect(mm2.formatGroup.getByRole("radio", { name: "Hex", exact: true })).toBeChecked();
      await mm2.expectPill("Not connected", "plug");
      // Connect polls FC04 from 5 in Hex (CHK-O3 on the real backend)
      await mm2.toolbarButton("Connect").click();
      await mm2.expectPill("Polling", "activity");
      const req = sim.frames().filter((f) => f.dir === "RX").at(-1)?.bytes ?? "";
      expect(req.split(" ").slice(2).join(" ")).toBe("00 00 00 06 01 04 00 05 00 0A");
    } finally {
      await d1?.stop();
      await d2?.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("CHK-O6/O7/O9 rename, delete and recreate across two windows on the real store", async ({ desktop, launcher, sim }) => {
    const w1 = await openModbusWindow(desktop, launcher);
    const w2 = await openModbusWindow(desktop, launcher);
    await w1.host.fill("127.0.0.1");
    await w1.port.fill(String(sim.modbusPort));
    await saveAs(w1, "Bench A");
    // O9: deleted in window 2, Ctrl+S in window 1 creates it again without an error
    await w2.page.keyboard.press("Control+o");
    await expect(w2.openDialog.getByRole("row", { name: /Bench A/ })).toBeVisible(); // saved in another window
    await w2.openDialog.getByRole("row", { name: /Bench A/ }).click();
    await w2.openDialog.getByRole("button", { name: "Delete" }).click();
    await w2.confirmDialog.getByRole("button", { name: "Delete" }).click();
    await expect(w2.openDialog.getByText("No saved profiles yet.")).toBeVisible();
    await closeOpenDialog(w2);
    await w1.page.keyboard.press("Control+s");
    await expect
      .poll(() => profileNamesOnDisk(desktop.dataDir), { message: "profile re-created on disk (O9)", timeout: 10_000 })
      .toContain("Bench A");
    await w2.page.keyboard.press("Control+o");
    await expect(w2.openDialog.getByRole("row", { name: /Bench A/ })).toBeVisible();
    await expect(w1.anyToast).toHaveCount(0);
    // O7: rename the profile loaded in window 1 from window 2; window 1 keeps its own name and saves under it
    await w2.openDialog.getByRole("row", { name: /Bench A/ }).click();
    await w2.openDialog.getByRole("button", { name: "Rename" }).click();
    await w2.openDialog.getByLabel("New profile name").fill("Bench B");
    await w2.openDialog.getByLabel("New profile name").press("Enter");
    await expect(w2.openDialog.getByRole("row", { name: /Bench B/ })).toBeVisible();
    await closeOpenDialog(w2);
    await w1.page.keyboard.press("Control+s");
    // Ctrl+S is asynchronous (validation, then the backend writes the file): wait for the file itself,
    // so that a miss below is a real miss and not window 2 listing before window 1 finished saving.
    await expect
      .poll(() => profileNamesOnDisk(desktop.dataDir), { message: "profile files on disk after Ctrl+S in window 1", timeout: 10_000 })
      .toContain("Bench A");
    await w2.page.keyboard.press("Control+o");
    await expect(w2.openDialog.getByRole("row", { name: /Bench A/ })).toBeVisible(); // DES S3: created again
    await expect(w2.openDialog.getByRole("row", { name: /Bench B/ })).toBeVisible();
  });
});

test.describe("P5 window state", () => {
  test("CHK-P5 size and position of a tool window are restored after the app restarts", async ({}) => {
    const stateDir = path.join(process.env.APPDATA ?? "", "com.esefact.desktop");
    const stateFile = path.join(stateDir, ".window-state.json");
    const existed = fs.existsSync(stateFile);
    test.skip(existed, `${stateFile} already exists (user data): not touching it`);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "esefact-it-ws-"));
    let d1: Desktop | undefined;
    let d2: Desktop | undefined;
    try {
      d1 = await Desktop.start({ dataDir });
      const mm1 = await openModbusWindow(d1, await d1.launcherPage());
      const win = await nativeOf(d1, mm1.page);
      d1.moveWindow(win.hwnd, 200, 150, 1000, 700);
      await expect.poll(() => d1?.windows().find((w) => w.hwnd === win.hwnd)).toMatchObject({ x: 200, y: 150, w: 1000, h: 700 });
      // graceful exit: close the tool window, then the launcher (the plugin saves on close/exit)
      d1.closeWindow(win.hwnd);
      await expect.poll(() => mm1.page.isClosed()).toBe(true);
      const launcherWin = d1.windows().find((w) => w.title === "ESEfact");
      if (launcherWin) d1.closeWindow(launcherWin.hwnd);
      await expect.poll(() => d1?.running, { message: "app exits after its last window is closed" }).toBe(false);
      await d1.stop();
      d1 = undefined;
      expect(fs.existsSync(stateFile), `${stateFile} was written by the window-state plugin`).toBe(true);

      d2 = await Desktop.start({ dataDir });
      const mm2 = await openModbusWindow(d2, await d2.launcherPage());
      const win2 = await nativeOf(d2, mm2.page);
      expect({ x: win2.x, y: win2.y, w: win2.w, h: win2.h }).toEqual({ x: 200, y: 150, w: 1000, h: 700 });
    } finally {
      await d1?.stop();
      await d2?.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
      if (!existed) {
        fs.rmSync(stateFile, { force: true });
        try {
          fs.rmdirSync(stateDir);
        } catch {
          /* not empty: leave it */
        }
      }
    }
  });
});
