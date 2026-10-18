// CHK-001 behavior that DES-002 keeps unchanged and that still holds in the new window: backend
// reason texts, connection form validation, profile dialogs, traffic panel, browser defaults,
// window hooks. Ids are the CHK-001 ids ("carry-over": the same rule, tested on the new DOM).
import { expect, hex, type Mm, profileV2, test } from "../support/mm-fixtures";

const AT = new Date(2026, 9, 16, 14, 2, 11, 532).getTime();
const hms = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

async function emitFrames(mm: Mm, frames: Array<Record<string, unknown>>): Promise<void> {
  await mm.script(
    (f, list) =>
      f.emitFrames(
        list.map((x: Record<string, unknown>) => ({
          slaveId: 1,
          function: 3,
          exceptionCode: null,
          note: null,
          origin: { kind: "poll", pollId: 1 },
          ...x,
        })),
      ),
    frames,
  );
}

async function openProfileDialog(mm: Mm): Promise<void> {
  await mm.openMenu("File");
  await mm.menuItem("Open profile…").click();
  await expect(mm.openDialog).toBeVisible();
}

test.describe("I (carry-over) disconnected reasons", () => {
  const TCP: Array<[string, string]> = [
    ["refused", "Connection refused by 127.0.0.1:5020."],
    ["connectTimeout", "No answer from 127.0.0.1:5020 within 1000 ms."],
    ["hostNotFound", 'Host "127.0.0.1" could not be resolved.'],
    ["closedByPeer", "The device at 127.0.0.1:5020 closed the connection."],
    ["ioError", "Connection error: boom"],
  ];
  for (const [kind, text] of TCP) {
    test(`CHK-I1 reason ${kind}: Disconnected pill, banner text, Reconnect and Dismiss`, async ({ mm }) => {
      await mm.open({ polls: [{ name: "Poll 1" }] });
      await mm.pressConnect({ timeoutMs: 1000 });
      await mm.script((f) => f.emitConnectionState("connecting"));
      await mm.script(
        (f, k) => f.emitConnectionState("disconnected", { reason: { kind: k, phase: "connectFailed", message: "boom" } }),
        kind,
      );
      await mm.expectPill("Disconnected", "unplug");
      await expect(mm.banner).toContainText(text);
      await expect(mm.bannerButton("Reconnect")).toBeVisible();
      await expect(mm.bannerButton("Dismiss")).toBeVisible();
      await expect(mm.liveAssertive).toContainText(text);
    });
  }

  const RTU: Array<[string, string]> = [
    ["portBusy", "COM3 is in use by another application or window."],
    ["portNotFound", "COM3 is not available. Refresh the port list."],
    ["portRemoved", "COM3 was removed."],
  ];
  for (const [kind, text] of RTU) {
    test(`CHK-I (RTU) reason ${kind}`, async ({ mm }) => {
      await mm.open({
        polls: [{ name: "Poll 1" }],
        seed: async (f) => {
          f.setMode("virtual");
          await f.connect({ mode: "rtu", port: "COM3", baud: 9600, dataBits: 8, parity: "even", stopBits: 1, timeoutMs: 1000 });
        },
      });
      await mm.script((f, k) => f.dropLink({ kind: k, phase: "linkLost", message: "x" }), kind);
      await expect(mm.banner).toContainText(text);
    });
  }

  test("CHK-I6 Dismiss shows a spinner until the backend reports idle; I10 the fields are editable again", async ({ mm }) => {
    await mm.open({ polls: [{ name: "Poll 1" }], connected: true });
    await mm.script((f) => f.dropLink());
    await mm.expectConnection("disconnected");
    await mm.script((f) => {
      (window as unknown as { __release: () => void }).__release = f.hold("disconnect").release;
    });
    await mm.bannerButton("Dismiss").click();
    await expect(mm.bannerButton("Dismiss").locator('[data-icon="loader"]')).toHaveCount(1);
    await mm.expectConnection("disconnected");
    await mm.page.evaluate(() => (window as unknown as { __release: () => void }).__release());
    await mm.script((f) => f.emitConnectionState("idle"));
    await mm.expectConnection("idle");
    await expect(mm.banner).toHaveCount(0);
    await expect(mm.hostField).toBeEditable();
    await expect(mm.portField).toBeEditable();
  });
});

test.describe("J (carry-over) connection form validation", () => {
  test("CHK-J1..J7 messages, nothing is sent, the first invalid field is focused, the count is shown", async ({ mm }) => {
    await mm.open();
    await mm.hostField.fill("");
    await mm.portField.fill("0");
    await mm.timeoutField.fill("49");
    await mm.toolbarButton("Connect").click();
    expect(await mm.callCount("connect")).toBe(0);
    await expect(mm.connectionSection).toContainText("Enter a host name or IPv4 address.");
    await expect(mm.connectionSection).toContainText("Port must be a whole number from 1 to 65535.");
    await expect(mm.connectionSection).toContainText("Timeout must be a whole number from 50 to 10000 ms.");
    await expect(mm.page.getByTestId("attention")).toHaveText("3 fields need attention");
    await expect(mm.hostField).toBeFocused();
    await expect(mm.hostField).toHaveAttribute("aria-invalid", "true");
    await mm.hostField.fill("a b");
    await mm.hostField.blur();
    await expect(mm.connectionSection).toContainText("Enter a valid host name or IPv4 address, for example 192.168.1.10.");
    await mm.hostField.fill("300.1.1.1");
    await mm.hostField.blur();
    await expect(mm.connectionSection).toContainText("Enter a valid host name or IPv4 address, for example 192.168.1.10.");
    await mm.hostField.fill("192.168.1.10");
    await mm.portField.fill("5020");
    await mm.timeoutField.fill("1000");
    await expect(mm.page.getByTestId("attention")).toHaveCount(0);
  });

  test("CHK-J (RTU) a serial port is required", async ({ mm }) => {
    await mm.open();
    await mm.connectionSection.getByRole("radio", { name: "RTU" }).click();
    await mm.toolbarButton("Connect").click();
    expect(await mm.callCount("connect")).toBe(0);
    await expect(mm.connectionSection).toContainText("Select a serial port.");
  });

  test("CHK-Q8 Enter in a Connection field connects; the sidebar has no second Connect button", async ({ mm }) => {
    await mm.open();
    await mm.hostField.fill("127.0.0.1");
    await mm.portField.fill("5020");
    await expect(mm.connectionSection.getByRole("button", { name: "Connect", exact: true })).toHaveCount(0);
    await mm.portField.press("Enter");
    await mm.expectCalls("connect", 1);
  });
});

test.describe("K/L/O (carry-over) profile dialogs", () => {
  test("CHK-K3 no saved profiles: text and Open disabled; K4 a filter without a match", async ({ mm }) => {
    await mm.open();
    await openProfileDialog(mm);
    await expect(mm.openDialog).toContainText("No saved profiles yet. Use Save as (Ctrl+Shift+S) to create one.");
    await expect(mm.openDialog.getByRole("button", { name: "Open", exact: true })).toBeDisabled();
    await mm.page.keyboard.press("Escape");
    await mm.script((f, p) => f.seedProfiles([p]), profileV2("Bench A"));
    await openProfileDialog(mm);
    await mm.openDialog.getByLabel("Filter profiles").fill("zzz");
    await expect(mm.openDialog).toContainText('No profiles match "zzz".');
  });

  test("CHK-L2 slow profile list: Loading profiles… and Open disabled; L5 failing list: error and Retry", async ({ mm }) => {
    await mm.open();
    await mm.script((f) => {
      (window as unknown as { __rel: (v: unknown) => void }).__rel = f.hold("profilesList").release;
    });
    await mm.openMenu("File");
    await mm.menuItem("Open profile…").click();
    await expect(mm.openDialog).toContainText("Loading profiles…");
    await expect(mm.openDialog.getByRole("button", { name: "Open", exact: true })).toBeDisabled();
    await mm.page.evaluate(() => (window as unknown as { __rel: (v: unknown) => void }).__rel([]));
    await expect(mm.openDialog).not.toContainText("Loading profiles…");
    await mm.page.keyboard.press("Escape");
    await mm.script((f) => f.failNext("profilesList", "disk on fire"));
    await openProfileDialog(mm);
    await expect(mm.openDialog).toContainText("Could not load profiles: disk on fire");
    await mm.openDialog.getByRole("button", { name: "Retry" }).click();
    await expect(mm.openDialog).not.toContainText("Could not load profiles");
  });

  test("CHK-O5 Save as with an existing name asks 'Replace profile?' (Cancel focused); Replace overwrites", async ({ mm, page }) => {
    await mm.open({ polls: [{ name: "Poll 1" }] });
    await mm.script((f, p) => f.seedProfiles([p]), profileV2("Bench A"));
    await mm.hostField.fill("127.0.0.1");
    await mm.portField.fill("5020");
    await page.keyboard.press("Control+Shift+s");
    await mm.saveAsDialog.getByLabel("Name").fill("Bench A");
    await mm.saveAsDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(mm.confirm).toContainText("Replace profile?");
    await expect(mm.confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await mm.confirm.getByRole("button", { name: "Cancel" }).click();
    expect((await mm.calls("profilesSave")).filter((c) => c[1] === true)).toHaveLength(0);
    await mm.saveAsDialog.getByRole("button", { name: "Save", exact: true }).click();
    await mm.confirm.getByRole("button", { name: "Replace" }).click();
    await expect(mm.profileLabel).toContainText("Bench A");
    expect((await mm.calls("profilesSave")).at(-1)?.[1]).toBe(true);
  });

  test("CHK-O6 Delete asks for confirmation; the profile is gone, also from a reopened list", async ({ mm }) => {
    await mm.open();
    await mm.script((f, p) => f.seedProfiles([p]), profileV2("Bench A"));
    await openProfileDialog(mm);
    await mm.openDialog.getByRole("row", { name: /Bench A/ }).click();
    await mm.openDialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(mm.confirm).toContainText("Delete profile?");
    await expect(mm.confirm).toContainText('Delete "Bench A"? This cannot be undone.');
    await mm.confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(mm.openDialog.getByRole("row", { name: /Bench A/ })).toHaveCount(0);
    await mm.page.keyboard.press("Escape");
    await openProfileDialog(mm);
    await expect(mm.openDialog.getByRole("row", { name: /Bench A/ })).toHaveCount(0);
  });

  test("CHK-O7 renaming the loaded profile renames the toolbar and the title", async ({ mm, page }) => {
    await mm.open();
    await mm.script((f, p) => f.seedProfiles([p]), profileV2("Bench A"));
    await openProfileDialog(mm);
    await mm.openDialog.getByRole("row", { name: /Bench A/ }).dblclick();
    await expect(mm.profileLabel).toContainText("Bench A");
    await expect(page).toHaveTitle("Modbus Master - Bench A - Not connected");
    await openProfileDialog(mm);
    await mm.openDialog.getByRole("row", { name: /Bench A/ }).click();
    await mm.openDialog.getByRole("button", { name: "Rename", exact: true }).click();
    await mm.openDialog.getByLabel("New profile name").fill("Bench B");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(mm.profileLabel).toContainText("Bench B");
    await expect(page).toHaveTitle("Modbus Master - Bench B - Not connected");
  });

  test("CHK-O1 the title follows the profile name, the Modified marker and the state (document and native window)", async ({ mm, page }) => {
    await mm.open({ polls: [{ name: "Poll 1" }], connected: true, seed: (f) => f.setProfileName("Bench A") });
    await expect(page).toHaveTitle(/^Modbus Master - Bench A - Connected \(1 live\)$/);
    await mm.toolbarButton("New poll").click();
    await expect(page).toHaveTitle(/^Modbus Master - Bench A \* - Connected/);
    expect((await mm.windowTitles()).at(-1)).toBe(await page.title());
  });
});

test.describe("N (carry-over) traffic panel", () => {
  test("CHK-N1 a frame row: #, time, arrow plus TX/RX, length and uppercase hex pairs", async ({ mm }) => {
    await mm.open({ polls: [{ name: "Poll 1" }] });
    await mm.page.keyboard.press("Control+j");
    const tx = [0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10];
    const rx = [0, 1, 0, 0, 0, 0x17, 1, 3, 0x14, 0xab, 0xcd, 0xef, 0x0f];
    await emitFrames(mm, [
      { seq: 2401, at: AT, direction: "tx", bytes: tx },
      { seq: 2402, at: AT + 8, direction: "rx", bytes: rx },
    ]);
    // Hook: `data-cell` names the cells of a traffic row (seq, time, dir, len, bytes, info, poll).
    const row = mm.frameList.locator("#frame-2401");
    await expect(mm.trafficCell(row, "seq")).toHaveText("2401");
    await expect(mm.trafficCell(row, "time")).toHaveText(hms(AT));
    await expect(mm.trafficCell(row, "dir")).toHaveText("→ TX");
    await expect(mm.trafficCell(row, "len")).toHaveText("12");
    await expect(mm.trafficCell(row, "bytes")).toHaveText(hex(tx));
    await expect(mm.trafficCell(row, "info")).toHaveText("FC03 slave 1");
    await expect(mm.trafficCell(row, "poll")).toHaveText("Poll 1");
    await expect(mm.trafficCell(mm.frameList.locator("#frame-2402"), "dir")).toHaveText("← RX");
  });

  test("CHK-N4 detail strip with offsets and Copy bytes; N5 Ctrl+C copies one frame line", async ({ mm, page }) => {
    await mm.open({ polls: [{ name: "Poll 1" }] });
    await page.keyboard.press("Control+j");
    const bytes = [0, 5, 0, 0, 0, 0x1d, 1, 0x10, 0, 0x0a, 0, 0x0a, 0x14, ...Array.from({ length: 20 }, (_, i) => 0xa0 + i)];
    await emitFrames(mm, [
      { seq: 7, at: AT, direction: "tx", bytes, function: 16 },
      { seq: 8, at: AT + 8, direction: "rx", bytes: [0, 1, 0, 0, 0, 3, 1, 0x83, 2], exceptionCode: 2 },
    ]);
    await mm.frameList.locator("#frame-7").click();
    const detail = page.getByTestId("frame-detail");
    const lines = (await detail.locator("pre").innerText()).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(`0000  ${hex(bytes.slice(0, 16))}`);
    expect(lines[2]).toBe(`0020  ${hex(bytes.slice(32))}`);
    await detail.getByRole("button", { name: "Copy bytes" }).click();
    expect(await mm.clipboardText()).toBe(hex(bytes));
    await mm.setClipboard("sentinel");
    await mm.frameList.locator("#frame-8").click();
    await page.keyboard.press("Control+c");
    await expect(mm.toast("Copied 1 frame.")).toBeVisible();
    expect(await mm.clipboardText()).toBe(`${hms(AT + 8)}\tRX\t00 01 00 00 00 03 01 83 02\tException 02 Illegal data address	Poll 1`);
  });

  test("CHK-N6 Reset counters sets the four counters to 0 and keeps the frames; K2 Ctrl+Shift+K clears the log and keeps the counters", async ({ mm, page }) => {
    await mm.open({ polls: [{ name: "Poll 1" }] });
    await page.keyboard.press("Control+j");
    await emitFrames(mm, [
      { seq: 1, at: AT, direction: "tx", bytes: [0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10] },
      { seq: 2, at: AT + 5, direction: "rx", bytes: [0, 1, 0, 0, 0, 3, 1, 3, 0] },
    ]);
    await mm.script((f) => f.emitCounters({ total: { requests: 12, responses: 10, errors: 1, timeouts: 1 } }));
    await expect(mm.counter("requests")).toHaveText("12");
    await mm.traffic.getByRole("button", { name: "Reset counters" }).click();
    await mm.expectCalls("resetCounters", 1);
    await expect(mm.counter("requests")).toHaveText("0");
    await expect(mm.frameList.locator("#frame-2")).toBeVisible();
    await mm.script((f) => f.emitCounters({ total: { requests: 7, responses: 7, errors: 0, timeouts: 0 } }));
    await expect(mm.counter("requests")).toHaveText("7");
    await mm.frameList.locator("#frame-1").click();
    await page.keyboard.press("Control+Shift+K");
    await expect(mm.frameList.locator("#frame-1")).toHaveCount(0);
    await expect(mm.page.getByTestId("traffic-empty")).toContainText("Log cleared at");
    await expect(mm.counter("requests")).toHaveText("7");
  });
});

test.describe("Q/P (carry-over) browser defaults, layout, window hooks", () => {
  test("CHK-Q1 browser defaults are suppressed for the window's shortcuts", async ({ mm, page }) => {
    await mm.open({ polls: [{ name: "Poll 1" }], connected: true });
    await mm.workspace.click({ position: { x: 1320, y: 700 } });
    const keys = ["Control+p", "Control+o", "Control+s", "Control+Shift+s", "Control+n", "Control+j", "Control+Shift+t", "Control+Shift+c", "Control+Shift+o", "Control+F4", "Control+F6", "Alt+ArrowLeft", "Alt+ArrowRight"];
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __seen: string[] }).__seen = seen;
      window.addEventListener("keydown", (e) => {
        if (["Control", "Shift", "Alt", "Escape"].includes(e.key)) return;
        seen.push(`${e.ctrlKey ? "C" : ""}${e.shiftKey ? "S" : ""}${e.altKey ? "A" : ""}+${e.key}:${e.defaultPrevented}`);
      });
    });
    for (const k of keys) {
      await page.keyboard.press(k);
      // A dialog opened by a key is closed again.
      await page.keyboard.press("Escape");
    }
    const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
    expect(seen.length).toBeGreaterThanOrEqual(keys.length);
    for (const entry of seen) expect(entry, `defaultPrevented for ${entry}`).toMatch(/:true$/);
  });

  test("CHK-Q7 960 x 600: no horizontal scroll and the toolbar actions are reachable", async ({ mm }) => {
    await mm.open({ polls: [{ name: "Poll 1" }], connected: true, viewport: { width: 960, height: 600 } });
    await expect
      .poll(() => mm.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: "horizontal overflow of the page in px" })
      .toBeLessThanOrEqual(0);
    for (const name of ["File", "Connection", "New poll", "Window", "Disconnect"]) {
      await expect(mm.toolbarButton(name)).toBeInViewport();
    }
  });

  test("CHK-P1 Ctrl+N asks the window IPC for a new Modbus Master window; nothing with a modal open; a failure toasts", async ({ mm, page }) => {
    await mm.open();
    await page.keyboard.press("Control+n");
    await expect.poll(() => mm.openedTools()).toEqual(["modbus-master"]);
    await openProfileDialog(mm);
    await page.keyboard.press("Control+n");
    expect(await mm.openedTools()).toEqual(["modbus-master"]);
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      window.__ESEFACT_FAKE_WINDOW_IPC__.openError = "Unknown tool";
    });
    await page.keyboard.press("Control+n");
    await expect(mm.toast("Could not open a new window: Unknown tool")).toBeVisible();
  });

  test("CHK-R6 invalid fields have aria-invalid and the message linked by aria-describedby", async ({ mm }) => {
    await mm.open();
    await mm.portField.fill("0");
    await mm.portField.blur();
    await expect(mm.portField).toHaveAttribute("aria-invalid", "true");
    const describedBy = await mm.portField.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(mm.page.locator(`[id="${describedBy?.split(" ")[0]}"]`)).toContainText("Port must be a whole number from 1 to 65535.");
  });

  test("CHK-R5 Afacad for text and a monospace font for values; English only", async ({ mm }) => {
    await mm.open({ polls: [{ name: "Poll 1" }], connected: true });
    const [ui, mono] = await mm.page.evaluate(() => {
      const raw = document.querySelector('[data-cell="raw"]') as HTMLElement;
      return [getComputedStyle(document.body).fontFamily, getComputedStyle(raw).fontFamily];
    });
    expect(ui).toContain("Afacad");
    expect(mono).toMatch(/JetBrains Mono|monospace/);
    expect(await mm.page.evaluate(() => document.documentElement.lang)).toMatch(/^en/);
  });
});
