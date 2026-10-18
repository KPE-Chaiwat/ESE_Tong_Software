// Integration mode (REPORT-006), (g): closing W1 with a real WM_CLOSE: 'Save changes?' with popped-out windows and
// unapplied edits, sockets closed (OS TCP table + simulator CLOSE log), no leftover processes. CHK2-G3, G4, G5, P2.
import { type Desktop, expect, RealMm, type Sim, test } from "../integration/fixtures";
import { createPolls, focusPoll, referenceMap } from "../integration/scenario";
import { saveProfileAs } from "../integration/profiles";

const SPECS = [
  { name: "Poll 1", slave: 1, fc: 3 as const, start: 0, qty: 10, scan: 100 },
  { name: "Poll 2", slave: 2, fc: 3 as const, start: 10, qty: 10, scan: 100 },
  { name: "Poll 3", slave: 1, fc: 4 as const, start: 0, qty: 5, scan: 100 },
  { name: "Poll 4", slave: 1, fc: 1 as const, start: 0, qty: 8, scan: 100 },
];

async function setup(mm: RealMm, sim: Sim, desktop: Desktop, native: number): Promise<number[]> {
  await referenceMap(sim);
  await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
  const ids = await createPolls(mm, SPECS);
  for (let i = 0; i < native; i += 1) {
    await focusPoll(mm, ids[i] as number);
    await mm.page.keyboard.press("Control+Shift+O");
    await desktop.w2Page(ids[i] as number);
    await expect(mm.sub(ids[i] as number)).toHaveCount(0);
  }
  return ids;
}

const w1 = (desktop: Desktop) => desktop.windows().find((w) => w.title.startsWith("Modbus Master"));

test.describe("(g) close behavior", () => {
  test("CHK2-G5 W1 with an Untitled modified profile, 2 native windows and unapplied edits in Poll 3: 'Save changes?' text, Cancel keeps all, Don't save closes all and the socket", async ({ desktop, mm, sim }) => {
    test.setTimeout(120_000);
    const ids = await setup(mm, sim, desktop, 2);
    // unapplied edit in the sub-window Poll 3
    await focusPoll(mm, ids[2] as number);
    await mm.titleButton(ids[2] as number, /^Poll setup/).click();
    await mm.setupField(ids[2] as number, "Quantity").fill("6");
    await mm.setupField(ids[2] as number, "Quantity").blur();
    await expect(mm.sub(ids[2] as number).getByTestId("unapplied-dot")).toBeVisible();
    expect(desktop.establishedTo(sim.modbusPort), "one TCP connection before").toBe(1);
    const hwnd = w1(desktop)?.hwnd as number;
    const countWindows = () => desktop.windows().filter((w) => !w.title.startsWith("ESEfact")).length;
    expect(countWindows(), "W1 + 2 native windows").toBe(3);
    desktop.closeWindow(hwnd);
    await expect(mm.confirm).toBeVisible();
    await expect(mm.confirm).toContainText("Save changes?");
    await expect(mm.confirm).toContainText("Save this setup as a profile before closing? This also closes 2 poll windows. Unapplied edits in: Poll 3.");
    await expect(mm.confirm.getByRole("button", { name: "Save", exact: true })).toBeFocused();
    // Cancel keeps everything
    await mm.confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(mm.confirm).toHaveCount(0);
    expect(countWindows(), "Cancel keeps all windows").toBe(3);
    expect(desktop.establishedTo(sim.modbusPort), "Cancel keeps the connection").toBe(1);
    // Don't save closes W1 and both native windows and the socket
    desktop.closeWindow(hwnd);
    await expect(mm.confirm).toBeVisible();
    await mm.confirm.getByRole("button", { name: "Don't save" }).click();
    await expect.poll(countWindows, { message: "W1 and the poll windows are gone", timeout: 15_000 }).toBe(0);
    await expect.poll(() => desktop.establishedTo(sim.modbusPort), { message: "OS TCP table: socket closed", timeout: 10_000 }).toBe(0);
    await expect.poll(() => sim.linesWith("CLOSE").length, { message: "simulator logged CLOSE", timeout: 10_000 }).toBeGreaterThan(0);
    expect(desktop.windows().map((w) => w.title), "only the launcher is left").toEqual(["ESEfact"]);
    // the OS windows are gone; the CDP page objects of the destroyed webviews are removed a little later (diagnosis: how much later)
    const tClosed = Date.now();
    await expect.poll(() => desktop.w2Pages().length, { message: "no native poll page left (CDP targets of the destroyed webviews)", timeout: 20_000, intervals: [100] }).toBe(0);
    console.log("G5 CDP PAGES GONE AFTER", Date.now() - tClosed, "ms");
  });

  test("CHK2-G5 one native window: the text reads 'This also closes 1 poll window.'", async ({ desktop, mm, sim }) => {
    test.setTimeout(90_000);
    await setup(mm, sim, desktop, 1);
    desktop.closeWindow(w1(desktop)?.hwnd as number);
    await expect(mm.confirm).toContainText("This also closes 1 poll window.");
    await mm.confirm.getByRole("button", { name: "Cancel" }).click();
  });

  test("CHK2-G4 a saved profile: W1 with 4 sub-windows and native windows closes everything at once (no dialog), the socket is closed", async ({ desktop, mm, sim }) => {
    test.setTimeout(120_000);
    const ids = await setup(mm, sim, desktop, 2);
    expect(ids).toHaveLength(4);
    await saveProfileAs(mm, "Plant");
    await expect(mm.profileLabel).not.toContainText("Modified");
    expect(desktop.establishedTo(sim.modbusPort)).toBe(1);
    const countWindows = () => desktop.windows().filter((w) => !w.title.startsWith("ESEfact")).length;
    expect(countWindows()).toBe(3);
    desktop.closeWindow(w1(desktop)?.hwnd as number);
    await expect.poll(countWindows, { message: "everything closed at once", timeout: 15_000 }).toBe(0);
    await expect.poll(() => desktop.establishedTo(sim.modbusPort), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => sim.linesWith("CLOSE").length, { message: "simulator logged the closed connection", timeout: 10_000 }).toBeGreaterThan(0);
  });

  test("CHK2-G3 'Don't ask again for this connection window': later closes keep without asking; a reopened W1 asks again", async ({ desktop, mm, sim, launcher }) => {
    test.setTimeout(120_000);
    const ids = await setup(mm, sim, desktop, 0);
    await focusPoll(mm, ids[0] as number);
    await mm.page.keyboard.press("Control+F4");
    await expect(mm.confirm).toBeVisible();
    await mm.confirm.getByLabel("Don't ask again for this connection window").check();
    await mm.confirm.getByRole("button", { name: "Keep poll" }).click();
    await expect(mm.row(ids[0] as number)).toContainText("closed");
    await focusPoll(mm, ids[1] as number);
    await mm.page.keyboard.press("Control+F4");
    await expect(mm.confirm, "no S6 any more in this window").toHaveCount(0);
    await expect(mm.row(ids[1] as number)).toContainText("closed");
    // a new connection window asks again
    const known = new Set(desktop.pages());
    await mm.page.keyboard.press("Control+n");
    const page2 = await desktop.newPage(known, (u) => /\/tools\/modbus-master(\/)?(\?|#|$)/.test(u));
    const m2 = new (await import("../integration/real-mm")).RealMm(page2);
    await expect(m2.toolbarButton("Connect")).toBeEnabled();
    await m2.toolbarButton("New poll").click();
    const id = await m2.idByName("Poll 1");
    await m2.sub(id).locator('[data-slot="title-bar"]').click();
    await m2.page.keyboard.press("Control+F4");
    await expect(m2.confirm).toBeVisible();
    await m2.confirm.getByRole("button", { name: "Cancel" }).click();
    void launcher;
  });

  test("INT-G-1 closing the last window ends the app: no esefact-desktop and no WebView2 process of this run is left", async ({ desktop, launcher, mm }) => {
    test.setTimeout(90_000);
    await expect(mm.pill).toBeVisible();
    const ids = desktop.processIds();
    expect(ids.length, "app + WebView2 processes before").toBeGreaterThan(1);
    // close the connection window, then the launcher (the user closing the last window)
    desktop.closeWindow(w1(desktop)?.hwnd as number);
    await expect.poll(() => desktop.windows().filter((w) => w.title.startsWith("Modbus Master")).length).toBe(0);
    const l = desktop.windows().find((w) => w.title === "ESEfact");
    desktop.closeWindow(l?.hwnd as number);
    const code = await desktop.waitForExit(20_000);
    console.log("EXIT CODE after closing the last window:", code);
    expect(code, "the app process ended after its last window closed").not.toBeNull();
    await expect.poll(() => desktop.processIds().length, { message: "no process of this run is left", timeout: 20_000 }).toBe(0);
    void launcher;
  });
});

test.describe("(g) several connection windows", () => {
  test("CHK-001 P2/P3 two connection windows to one simulator: two TCP connections, Disconnect in one leaves one", async ({ desktop, mm, sim }) => {
    test.setTimeout(90_000);
    await referenceMap(sim);
    await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
    const known = new Set(desktop.pages());
    await mm.page.keyboard.press("Control+n");
    const page2 = await desktop.newPage(known, (u) => /\/tools\/modbus-master(\/)?(\?|#|$)/.test(u));
    const m2 = new RealMm(page2);
    await expect(m2.toolbarButton("Connect")).toBeEnabled();
    await m2.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
    await expect.poll(() => desktop.establishedTo(sim.modbusPort), { timeout: 10_000 }).toBe(2);
    await m2.toolbarButton("Disconnect").click();
    await m2.expectConnection("idle");
    await expect.poll(() => desktop.establishedTo(sim.modbusPort), { timeout: 10_000 }).toBe(1);
    await mm.expectConnection("connected");
    await expect.poll(() => sim.linesWith("CLOSE").length).toBeGreaterThan(0);
  });
});
