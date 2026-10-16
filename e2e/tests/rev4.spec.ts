// CHK-001 revision 4 items (UI side): CHK-N7 worked example, CHK-I1 / CHK-I11 texts, CHK-J29 binary
// values list, CHK-N8 clipboard refused.
import type { Locator } from "@playwright/test";
import { expect, type Frame, type ModbusApp, REGISTER_MAP_10, rxFrame, test, txFrame } from "../support/fixtures";

const AT = new Date(2026, 9, 16, 14, 2, 11, 532).getTime();

/** Every row of the (virtualized) traffic list, collected while scrolling through it. */
async function collectRows(app: ModbusApp): Promise<{ seq: number; dir: string; info: string }[]> {
  const seen = new Map<number, { seq: number; dir: string; info: string }>();
  const read = () =>
    app.frameList.locator('[id^="frame-"]').evaluateAll((rows) =>
      rows.map((r) => {
        const c = [...r.querySelectorAll('[role="gridcell"]')].map((x) => x.textContent?.trim() ?? "");
        return { seq: Number(c[0]), dir: c[2] ?? "", info: c[5] ?? "" };
      }),
    );
  await app.frameList.evaluate((el) => {
    el.scrollTop = 0;
  });
  for (let i = 0; i < 40; i += 1) {
    for (const r of await read()) seen.set(r.seq, r);
    const done = await app.frameList.evaluate((el) => {
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      el.scrollTop += Math.max(40, el.clientHeight - 60);
      return atEnd;
    });
    if (done) break;
  }
  return [...seen.values()].sort((a, b) => a.seq - b.seq);
}

test.describe("CHK-N7 worked example (rendering of the BE-001 counter semantics)", () => {
  test("CHK-N7 15 requests = 5 normal + 3 dropped + 3 exception 02 + 2 wrong unit + 2 truncated: counters 15 / 8 / 7 / 3, 12 RX rows, no discarded rows (UI side)", async ({
    app,
  }) => {
    await app.toState("polling");
    const frames: Frame[] = [];
    let seq = 0;
    const tx = (): Frame => txFrame(++seq, AT + seq * 100, [0, seq, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10]);
    const okRx = (): Frame => rxFrame(++seq, AT + seq * 100, [0, 1, 0, 0, 0, 23, 1, 3, 20, ...Array(20).fill(0)]);
    for (let i = 0; i < 5; i += 1) frames.push(tx(), okRx());
    for (let i = 0; i < 3; i += 1) frames.push(tx());
    for (let i = 0; i < 3; i += 1) frames.push(tx(), rxFrame(++seq, AT + seq * 100, [0, 1, 0, 0, 0, 3, 1, 0x83, 2], { exceptionCode: 2 }));
    for (let i = 0; i < 2; i += 1) {
      frames.push(tx(), rxFrame(++seq, AT + seq * 100, [0, 1, 0, 0, 0, 23, 2, 3, 20], { slaveId: 2, note: "Bad response: reply from slave 2, expected 1" }));
    }
    for (let i = 0; i < 2; i += 1) {
      frames.push(tx(), rxFrame(++seq, AT + seq * 100, Array.from({ length: 20 }, (_, k) => k), { note: "Bad response: short frame (20 of 29 bytes)" }));
    }
    await app.frames(frames);
    await app.counters({ requests: 15, responses: 8, errors: 7, timeouts: 3 });
    await app.expectCounters({ requests: 15, responses: 8, errors: 7, timeouts: 3 });
    await expect(app.frameList).toHaveAttribute("aria-rowcount", String(frames.length + 1));
    const rows = await collectRows(app);
    expect(rows).toHaveLength(frames.length);
    expect(rows.filter((r) => r.dir === "→ TX")).toHaveLength(15);
    expect(rows.filter((r) => r.dir === "← RX"), "RX rows").toHaveLength(12);
    expect(rows.filter((r) => r.info.includes("(discarded)")), "late replies").toEqual([]);
  });
});

test.describe("CHK-I1 / CHK-I11 texts", () => {
  test("CHK-I1 stopped simulator with Timeout 3000 ms: Connection refused banner (UI side)", async ({ app }) => {
    await app.toState("disconnected", {
      timeoutMs: 3000,
      reason: { kind: "refused", phase: "connectFailed", message: "refused" },
    });
    await app.expectPill("Disconnected", "unplug");
    await expect(app.banner.locator("p")).toHaveText("Connection refused by 127.0.0.1:5020.");
    await expect(app.bannerButton("Reconnect")).toBeVisible();
    await expect(app.bannerButton("Dismiss")).toBeVisible();
    const [[cfg]] = (await app.calls("connect")) as [[Record<string, unknown>]];
    expect(cfg).toMatchObject({ timeoutMs: 3000 });
  });

  for (const [name, reason, text] of [
    ["No answer", { kind: "connectTimeout", phase: "connectFailed", message: "timed out" }, "No answer from 127.0.0.1:5020 within 300 ms."],
    ["Connection refused", { kind: "refused", phase: "connectFailed", message: "refused" }, "Connection refused by 127.0.0.1:5020."],
  ] as const) {
    test(`CHK-I11 Timeout 300 ms against a refused port, text variant "${name}" (UI side)`, async ({ app }) => {
      await app.toState("disconnected", { timeoutMs: 300, reason });
      await app.expectPill("Disconnected", "unplug");
      await expect(app.banner.locator("p")).toHaveText(text);
    });
  }
});

test.describe("CHK-J29 binary values list", () => {
  async function binaryDialog(app: ModbusApp, address = "10") {
    await app.toLive();
    await app.toolbarButton("Write…").click();
    const d = app.writeDialog;
    await d.getByLabel("Function").selectOption("16");
    await d.getByLabel("Start address").fill(address);
    await d.getByRole("radio", { name: "Binary", exact: true }).click();
    return d;
  }
  const values = (d: Locator) => d.getByLabel(/^Values \(/);
  const sendBtn = (d: Locator) => d.getByRole("button", { name: "Send" });

  test("CHK-J29 `0000 0100 1101 0010` is four values 0, 4, 13, 2 (never one merged value)", async ({ app }) => {
    const d = await binaryDialog(app);
    await values(d).fill("0000 0100 1101 0010");
    await expect(d.getByText("Values (4)", { exact: true })).toBeVisible();
    await expect(d.getByText("Writes addresses 10-13.", { exact: true })).toBeVisible();
    await sendBtn(d).click();
    await app.expectCalls("write", 1);
    const [[req]] = (await app.calls("write")) as [[Record<string, unknown>]];
    expect(req).toEqual({ slaveId: 1, function: 16, address: 10, values: [0, 4, 13, 2] });
  });

  test("CHK-J29 `0000010011010010` is one value, 1234", async ({ app }) => {
    const d = await binaryDialog(app);
    await values(d).fill("0000010011010010");
    await expect(d.getByText("Values (1)", { exact: true })).toBeVisible();
    await sendBtn(d).click();
    await app.expectCalls("write", 1);
    const [[req]] = (await app.calls("write")) as [[Record<string, unknown>]];
    expect(req).toMatchObject({ values: [1234] });
  });

  const msg = (i: number, text: string) => `Value ${i} ("${text}") is not valid: Enter up to 16 binary digits (0 or 1).`;
  for (const [input, i, text] of [
    ["0000 0100 1101 00102", 4, "00102"],
    ["10000000000000000", 1, "10000000000000000"],
    ["0b", 1, "0b"],
  ] as const) {
    test(`CHK-J29 \`${input}\` is rejected with the item message`, async ({ app }) => {
      const d = await binaryDialog(app);
      await values(d).fill(input);
      await sendBtn(d).click();
      await expect(d.getByText(msg(i, text), { exact: true })).toBeVisible();
      expect(await app.callCount("write")).toBe(0);
    });
  }

  test("CHK-J29 the single FC06 Binary field still accepts nibble spaces", async ({ app }) => {
    await app.toLive();
    await app.toolbarButton("Write…").click();
    const d = app.writeDialog;
    await d.getByLabel("Function").selectOption("6");
    await d.getByRole("radio", { name: "Binary", exact: true }).click();
    await d.getByLabel("Value", { exact: true }).fill("0000 0100 1101 0010");
    await sendBtn(d).click();
    await app.expectCalls("write", 1);
    const [[req]] = (await app.calls("write")) as [[Record<string, unknown>]];
    expect(req).toMatchObject({ function: 6, values: [1234] });
  });
});

test.describe("CHK-N8 clipboard refused", () => {
  /** The browser denies every clipboard write; remembers when error toasts appear and disappear. */
  async function denyClipboard(app: ModbusApp): Promise<void> {
    await app.page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
      });
      const log: { text: string; tone: string; icon: boolean; shown: number; gone: number | null }[] = [];
      window.__qa = { toasts: log };
      new MutationObserver(() => {
        const now = performance.now();
        const present = [...document.querySelectorAll("[data-tone]")] as HTMLElement[];
        for (const el of present) {
          const text = el.textContent?.trim() ?? "";
          if (!log.some((t) => t.text === text && t.gone === null)) {
            log.push({ text, tone: el.dataset.tone ?? "", icon: el.querySelector('[data-icon="circle-x"]') !== null, shown: now, gone: null });
          }
        }
        for (const t of log) {
          if (t.gone === null && !present.some((el) => (el.textContent?.trim() ?? "") === t.text)) t.gone = now;
        }
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  }
  const toasts = (app: ModbusApp) =>
    app.page.evaluate(() => (window.__qa as { toasts: { text: string; tone: string; icon: boolean; shown: number; gone: number | null }[] }).toasts);

  async function expectRefused(app: ModbusApp): Promise<void> {
    await expect(app.toast("Could not copy to the clipboard.")).toBeVisible();
    // gone after about 4 s (error toasts last 4 s; ordinary ones 2 s)
    await expect.poll(async () => (await toasts(app)).find((t) => t.text.startsWith("Could not copy"))?.gone ?? null, { timeout: 8000 }).not.toBeNull();
    const all = await toasts(app);
    const refused = all.find((t) => t.text === "Could not copy to the clipboard.");
    expect(refused?.tone).toBe("error");
    expect(refused?.icon, "circle-x icon").toBe(true);
    const life = (refused?.gone ?? 0) - (refused?.shown ?? 0);
    expect(life, `toast lifetime ${Math.round(life)} ms`).toBeGreaterThan(3500);
    expect(life).toBeLessThan(5000);
    expect(all.filter((t) => /^Copied/.test(t.text)), "no 'Copied ...' toast").toEqual([]);
  }

  test("CHK-N8 Ctrl+C in the data table", async ({ app, page }) => {
    await app.toLive();
    await denyClipboard(app);
    await app.row(0).click();
    await page.keyboard.press("Control+c");
    await expectRefused(app);
  });

  test("CHK-N8 Ctrl+C on a selected traffic frame", async ({ app, page }) => {
    await app.toLive();
    await app.frames([txFrame(1, AT, [0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10]), rxFrame(2, AT + 8, [0, 1, 0, 0, 0, 5, 1, 3, 2, 4, 210])]);
    await denyClipboard(app);
    await app.frameRow(1).click();
    await page.keyboard.press("Control+c");
    await expectRefused(app);
  });

  test("CHK-N8 Copy bytes button", async ({ app }) => {
    await app.toLive();
    await app.frames([txFrame(1, AT, [0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10])]);
    await denyClipboard(app);
    await app.frameRow(1).click();
    await app.frameDetail.getByRole("button", { name: "Copy bytes" }).click();
    await expectRefused(app);
  });

  test("CHK-N8 control: with the clipboard allowed the 'Copied' toast still appears", async ({ app, page }) => {
    await app.toLive();
    await app.row(REGISTER_MAP_10.length - 1).click();
    await page.keyboard.press("Control+c");
    await expect(app.toast("Copied 1 row.")).toBeVisible();
  });
});
