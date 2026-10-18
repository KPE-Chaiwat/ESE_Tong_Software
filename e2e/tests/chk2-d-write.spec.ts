// CHK-002 section D (Write from a poll view, UI side) and the Write dialog texts of DES-001 2.5 / 3.3
// that DES-002 3.3 keeps. Scheduling and wire order (D1, D2, D7, D8) need the real backend.
import { expect, test, type Mm, type PollSpec } from "../support/mm-fixtures";

async function live(mm: Mm, specs: PollSpec[] = [{ name: "Poll 1", qty: 10 }, { name: "Poll 2", start: 10 }]): Promise<number[]> {
  await mm.open({ polls: specs, connected: true });
  const ids = await mm.pollIds();
  await expect(mm.grid(ids[0] as number)).toHaveAttribute("data-status", "live");
  return ids;
}
async function openWrite(mm: Mm, id: number): Promise<void> {
  await mm.row(id).click();
  await mm.grid(id).focus();
  await mm.page.keyboard.press("Control+e");
  await expect(mm.writeDialog).toBeVisible();
}
const field = (mm: Mm, label: string) => mm.writeDialog.getByLabel(label, { exact: true });

test.describe("D write from a poll view", () => {
  test("CHK2-D4 FC06 write (address 40, value 7) from P1: queued, confirmed, traffic shows 'Write: Poll 1'", async ({ mm, page }) => {
    const [p1] = (await live(mm)) as [number, number];
    await openWrite(mm, p1);
    await expect(mm.writeDialog).toContainText("Write · Poll 1");
    await expect(field(mm, "Slave ID")).toHaveValue("1");
    await field(mm, "Function").selectOption("6");
    await field(mm, "Start address").fill("40");
    await field(mm, "Value").fill("7");
    await mm.writeDialog.getByRole("button", { name: "Send" }).click();
    await expect(mm.page.getByTestId("write-result")).toContainText("Writing…");
    await mm.advance(100);
    await expect(mm.page.getByTestId("write-result")).toContainText("Write confirmed by slave 1: register at 40.");
    const call = (await mm.lastCall("write")) as [{ slaveId: number; function: number; address: number; values: number[] }, number];
    expect(call[0]).toEqual({ slaveId: 1, function: 6, address: 40, values: [7] });
    expect(call[1], "the request carries the poll id").toBe(p1);
    await mm.writeDialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.keyboard.press("Control+j");
    await expect(mm.frameList.getByRole("gridcell", { name: "Write: Poll 1" }).first()).toBeVisible();
  });

  test("CHK2-D (write) polling continues after the write and the other poll's writes use their own name", async ({ mm }) => {
    const [p1, p2] = (await live(mm)) as [number, number];
    await openWrite(mm, p2);
    await expect(mm.writeDialog).toContainText("Write · Poll 2");
    await expect(field(mm, "Start address")).toHaveValue("10");
    await field(mm, "Value").fill("5");
    await mm.writeDialog.getByRole("button", { name: "Send" }).click();
    await mm.advance(100);
    await expect(mm.page.getByTestId("write-result")).toContainText("Write confirmed by slave 1: register at 10.");
    expect((await mm.lastCall("write"))?.[1]).toBe(p2);
    await mm.writeDialog.getByRole("button", { name: "Close", exact: true }).click();
    const tx = async () => Number((await mm.statusText(p1)).match(/Tx (\d+)/)?.[1]);
    const before = await tx();
    await mm.advance(1000);
    await expect.poll(tx).toBeGreaterThan(before);
  });

  test("CHK2-D6 link lost during a write: the text with [Reconnect]; Reconnect brings the link back and clears it", async ({ mm }) => {
    const [p1] = (await live(mm)) as [number, number];
    await mm.script((f) => f.setResult("write", { status: "linkLost" }));
    await openWrite(mm, p1);
    await field(mm, "Value").fill("7");
    await mm.writeDialog.getByRole("button", { name: "Send" }).click();
    const result = mm.page.getByTestId("write-result");
    await expect(result).toContainText(
      "Connection lost during the write. The write may or may not have been applied. Reconnect and check the value before sending again.",
    );
    await mm.script((f) => f.dropLink());
    const reconnect = result.getByRole("button", { name: "Reconnect" });
    await expect(reconnect).toBeVisible();
    await mm.script((f) => f.setResult("write", { status: "ok" }));
    const before = await mm.callCount("connect");
    await reconnect.click();
    await mm.expectCalls("connect", before + 1);
    await expect(result.getByRole("button", { name: "Reconnect" })).toHaveCount(0);
    await expect(mm.writeDialog.getByRole("button", { name: "Send" })).toBeFocused();
  });

  test("CHK2-D6 the link drops while the dialog is open (queued write): 'Not connected. Connect before writing.', no [Reconnect], Send disabled", async ({ mm }) => {
    const [, p2] = (await live(mm)) as [number, number];
    await openWrite(mm, p2);
    await field(mm, "Value").fill("7");
    await mm.writeDialog.getByRole("button", { name: "Send" }).click();
    await expect(mm.page.getByTestId("write-result")).toContainText("Writing…");
    // The write is still in the queue (virtual time stands still) when the link goes.
    await mm.script((f) => f.dropLink());
    await mm.expectConnection("disconnected");
    const result = mm.page.getByTestId("write-result");
    await expect(result).toContainText("Not connected. Connect before writing.");
    await expect(result.getByRole("button", { name: "Reconnect" })).toHaveCount(0);
    await expect(mm.writeDialog.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  const RESULTS: Array<{ name: string; result: unknown; text: string }> = [
    { name: "exception", result: { status: "exception", code: 2 }, text: "Exception 02 (Illegal data address). Nothing was confirmed." },
    { name: "timeout", result: { status: "timeout" }, text: "No response within 1000 ms. The write may or may not have been applied." },
    {
      name: "bad response",
      result: { status: "badResponse", kind: "shortFrame", detail: { expected: 29, got: 20, message: "" } },
      text: "Bad response: short frame (20 of 29 bytes). The write may or may not have been applied.",
    },
  ];
  for (const r of RESULTS) {
    test(`CHK2-D (write result) ${r.name}: the DES-001 2.5 text`, async ({ mm }) => {
      const [p1] = (await live(mm)) as [number, number];
      await mm.script((f, res) => f.setResult("write", res), r.result);
      await openWrite(mm, p1);
      await field(mm, "Value").fill("7");
      await mm.writeDialog.getByRole("button", { name: "Send" }).click();
      await expect(mm.page.getByTestId("write-result")).toContainText(r.text);
    });
  }

  test("CHK2-D (unit 0) on TCP slave 0 is a normal unit: no warning, a normal confirmation", async ({ mm }) => {
    const [p1] = (await live(mm)) as [number, number];
    await openWrite(mm, p1);
    await field(mm, "Slave ID").fill("0");
    await field(mm, "Value").fill("7");
    await expect(mm.writeDialog).not.toContainText("Broadcast");
    await mm.writeDialog.getByRole("button", { name: "Send" }).click();
    await mm.advance(100);
    await expect(mm.page.getByTestId("write-result")).toContainText("Write confirmed by slave 0:");
  });

  test("CHK2-D (unit 0) on RTU slave 0 is a broadcast: warning and 'Broadcast sent.'", async ({ mm }) => {
    await mm.open({
      polls: [{ name: "Poll 1" }],
      seed: async (f) => {
        f.setMode("virtual");
        await f.connect({ mode: "rtu", port: "COM3", baud: 9600, dataBits: 8, parity: "even", stopBits: 1, timeoutMs: 1000 });
        f.advance(300);
      },
    });
    const [p1] = (await mm.pollIds()) as [number];
    await expect(mm.grid(p1)).toHaveAttribute("data-status", "live");
    await openWrite(mm, p1);
    await field(mm, "Slave ID").fill("0");
    await field(mm, "Value").fill("7");
    await expect(mm.writeDialog).toContainText("Broadcast: devices do not reply, so the result cannot be confirmed.");
    await mm.writeDialog.getByRole("button", { name: "Send" }).click();
    await mm.advance(100);
    await expect(mm.page.getByTestId("write-result")).toContainText(
      "Broadcast sent. Devices do not reply to slave ID 0, so the write cannot be confirmed.",
    );
  });

  test("CHK2-D (validation) messages of the Write dialog", async ({ mm }) => {
    const [p1] = (await live(mm)) as [number, number];
    await openWrite(mm, p1);
    await field(mm, "Slave ID").fill("248");
    await field(mm, "Slave ID").blur();
    await expect(mm.writeDialog).toContainText("Slave ID must be a whole number from 0 to 247.");
    await field(mm, "Slave ID").fill("1");
    await field(mm, "Value").fill("65536");
    await field(mm, "Value").blur();
    await expect(mm.writeDialog).toContainText("Value must be from 0 to 65535.");
    await expect(mm.writeDialog.getByRole("button", { name: "Send" })).toBeEnabled();
    await mm.writeDialog.getByRole("button", { name: "Send" }).click();
    expect(await mm.callCount("write"), "an invalid value sends nothing").toBe(0);
  });

  test("CHK2-D (binary list) 0000 0100 1101 0010 in FC16 is four values (J29)", async ({ mm }) => {
    const [p1] = (await live(mm)) as [number, number];
    await openWrite(mm, p1);
    await field(mm, "Function").selectOption("16");
    await mm.writeDialog.getByRole("radio", { name: "Binary" }).click();
    await mm.writeDialog.getByLabel(/^Values/).fill("0000 0100 1101 0010");
    await expect(mm.writeDialog.getByText("Values (4)")).toBeVisible();
    await expect(mm.writeDialog).toContainText("Writes addresses 0-3.");
    await mm.writeDialog.getByLabel(/^Values/).fill("0000 0100 1101 00102");
    await mm.writeDialog.getByLabel(/^Values/).blur();
    await expect(mm.writeDialog).toContainText('Value 4 ("00102") is not valid: Enter up to 16 binary digits (0 or 1).');
  });

  test("CHK2-D (read-only) Enter on a row of an FC04 poll shows the read-only toast and no dialog", async ({ mm, page }) => {
    const [p1] = (await live(mm, [{ name: "Poll 1", fc: 4 }])) as [number];
    await mm.gridRow(p1, 1).click();
    await page.keyboard.press("Enter");
    await expect(mm.toast("Discrete inputs and input registers are read-only.")).toBeVisible();
    await expect(mm.writeDialog).toHaveCount(0);
  });

  test("CHK2-D (alias) the Write dialog shows the alias of the start address", async ({ mm }) => {
    const [p1] = (await live(mm, [{ name: "Poll 1", aliases: [{ address: 0, alias: "Tank top" }] }])) as [number];
    await mm.gridRow(p1, 0).click();
    await mm.page.keyboard.press("Enter");
    await expect(mm.writeDialog).toBeVisible();
    await expect(mm.page.getByTestId("write-alias")).toContainText("Tank top");
  });

  test("CHK2-D3 (UI side) 16 polls at 20 ms: 'link load … polls are slowed down' with the gauge, SR with the effective rate", async ({ mm }) => {
    await mm.open({
      polls: Array.from({ length: 16 }, (_, i) => ({ name: `Poll ${i + 1}`, scan: 20, qty: 4 })),
      connected: false,
    });
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.advance(1000);
    await mm.advance(1000);
    await expect(mm.trafficBar).toContainText(/link load (9\d|100)% - polls are slowed down/);
    await expect(mm.trafficBar.locator('[data-icon="gauge"]')).toHaveCount(1);
    const ids = await mm.pollIds();
    for (const id of ids.slice(0, 4)) {
      const text = await mm.statusText(id);
      const m = text.match(/SR 20 ms \(effective (\d+) ms\)/);
      expect(m, `status line of poll ${id}: ${text}`).not.toBeNull();
      expect(Number(m?.[1])).toBeGreaterThan(30);
    }
  });
});

// CHK2-D9 (revision 8, O-6): with the link down Write… does nothing at all: no dialog, no toast, no
// announcement, no write command. The same steps connected open "Write · {name}".
interface WriteHost {
  page: import("@playwright/test").Page;
  statusLine: import("@playwright/test").Locator;
  grid: import("@playwright/test").Locator;
  gridRow(i: number): import("@playwright/test").Locator;
  dialog: import("@playwright/test").Locator;
  toasts: import("@playwright/test").Locator;
  titleBar?: import("@playwright/test").Locator;
  announcedCount(text: string | RegExp): Promise<number>;
  writeCalls(): Promise<number>;
}

/** Runs the four ways to ask for a write. Returns the steps that could be performed. */
async function askToWrite(h: WriteHost): Promise<string[]> {
  const did: string[] = [];
  // 1. Write… in the ⋯ menu.
  await h.statusLine.getByRole("button", { name: "Poll actions" }).click();
  const item = h.page.getByRole("menu").last().getByRole("menuitem", { name: /^Write…/ });
  await expect(item).toBeVisible();
  await item.click({ force: true });
  did.push("menu");
  await h.page.keyboard.press("Escape");
  // 2. Ctrl+E with the focus in the grid (or on the sub-window title bar when there is no grid).
  if ((await h.grid.count()) > 0) {
    await h.grid.focus();
    did.push("ctrl+e in grid");
  } else if (h.titleBar) {
    await h.titleBar.focus();
    did.push("ctrl+e on title bar");
  }
  await h.page.keyboard.press("Control+e");
  // 3. Enter and 4. a double-click on a data row.
  if ((await h.gridRow(1).count()) > 0) {
    await h.gridRow(1).click();
    await h.page.keyboard.press("Enter");
    did.push("enter on row");
    await h.gridRow(1).dblclick();
    did.push("double-click on row");
  }
  return did;
}

test.describe("D9 Write… with the link down", () => {
  for (const down of ["disconnected", "idle"] as const) {
    test(`CHK2-D9 sub-window, connection ${down}: no dialog, no toast, no announcement, no write command; the same steps connected open the dialog`, async ({
      mm,
    }, testInfo) => {
      await mm.open({ polls: [{ name: "Poll 1", qty: 10 }], connected: true });
      const [id] = (await mm.pollIds()) as [number];
      await expect(mm.grid(id)).toHaveAttribute("data-status", "live");
      const host: WriteHost = {
        page: mm.page,
        statusLine: mm.statusLine(id),
        grid: mm.grid(id),
        gridRow: (i) => mm.gridRow(id, i),
        dialog: mm.writeDialog,
        toasts: mm.toasts,
        titleBar: mm.titleBar(id),
        announcedCount: (t) => mm.announcedCount(t),
        writeCalls: () => mm.callCount("write"),
      };
      // Control: connected, the first step (menu) opens the dialog.
      await host.statusLine.getByRole("button", { name: "Poll actions" }).click();
      await mm.page.getByRole("menu").last().getByRole("menuitem", { name: /^Write…/ }).click();
      await expect(mm.writeDialog).toContainText("Write · Poll 1");
      await mm.writeDialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(mm.writeDialog).toHaveCount(0);
      // The link goes down: disconnected keeps the (stale) values, idle follows a Dismiss.
      await mm.script((f) => f.dropLink({ kind: "closedByPeer", phase: "linkLost", message: "closed" }));
      await mm.expectConnection("disconnected");
      if (down === "idle") {
        await mm.bannerButton("Dismiss").click();
        await mm.expectConnection("idle");
      }
      const announced0 = (await mm.announcements()).length;
      const toasts0 = await mm.toasts.count();
      const did = await askToWrite(host);
      testInfo.annotations.push({ type: "steps", description: `${down}: ${did.join(", ")}` });
      await expect(mm.writeDialog, "no Write dialog").toHaveCount(0);
      await expect(mm.toasts, "no toast").toHaveCount(toasts0);
      expect((await mm.announcements()).slice(announced0), "no announcement").toEqual([]);
      expect(await mm.callCount("write"), "no write command (the control never sent one)").toBe(0);
      // Back up: it works again.
      if (down === "idle") await mm.pressConnect({ autoStart: true });
      else await mm.toolbarButton("Reconnect").click();
      await mm.expectConnection("connected");
      await mm.advance(500);
      await mm.statusLine(id).getByRole("button", { name: "Poll actions" }).click();
      await mm.page.getByRole("menu").last().getByRole("menuitem", { name: /^Write…/ }).click();
      await expect(mm.writeDialog).toContainText("Write · Poll 1");
    });

    test(`CHK2-D9 native window, connection ${down}: no dialog, no toast, no announcement, no write command`, async ({
      mm,
    }, testInfo) => {
      const w2 = await mm.openNative({ polls: [{ name: "Poll 1" }], connect: true });
      await expect(w2.grid).toHaveAttribute("data-status", "live");
      const dialog = w2.page.getByRole("dialog", { name: /^Write/ });
      // Control: connected, Ctrl+E in the grid opens the dialog.
      await w2.grid.focus();
      await w2.page.keyboard.press("Control+e");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await w2.script((f) => f.dropLink({ kind: "closedByPeer", phase: "linkLost", message: "closed" }));
      await expect(w2.banner).toBeVisible();
      if (down === "idle") {
        // A native window cannot Dismiss: the connection window does. Mirror it in this fake.
        await w2.script((f) => f.emitConnectionState("idle"));
        await expect(w2.connectionPill).toContainText("Not connected");
      }
      const announced0 = (await w2.announcements()).length;
      const toasts0 = await w2.toasts.count();
      const did = await askToWrite({
        page: w2.page,
        statusLine: w2.statusLine,
        grid: w2.grid,
        gridRow: (i) => w2.gridRow(i),
        dialog,
        toasts: w2.toasts,
        announcedCount: (t) => w2.announcedCount(t),
        writeCalls: () => w2.callCount("write"),
      });
      testInfo.annotations.push({ type: "steps", description: `native ${down}: ${did.join(", ")}` });
      await expect(dialog, "no Write dialog").toHaveCount(0);
      await expect(w2.toasts, "no toast").toHaveCount(toasts0);
      expect((await w2.announcements()).slice(announced0).filter((a) => /write/i.test(a.text)), "no write announcement").toEqual([]);
      expect(await w2.callCount("write"), "no write command").toBe(0);
    });
  }
});
