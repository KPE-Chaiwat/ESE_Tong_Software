// CHK-001 R. accessibility and style (what a browser can verify; NVDA is manual)
import { expect, type ModbusApp, REGISTER_MAP_10, rxFrame, tcpProfile, test, txFrame } from "../support/fixtures";

const AT = new Date(2026, 9, 16, 14, 2, 11, 532).getTime();
const DARK = "rgb(49, 47, 46)";
const ACCENT = "rgb(215, 242, 108)";
const ORANGE = "rgb(250, 129, 48)";
const RED = "rgb(239, 68, 68)";

interface Stop {
  zone: string;
  tag: string;
  name: string;
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
  boxShadow: string;
}

async function focusStop(app: ModbusApp): Promise<Stop | null> {
  return app.page.evaluate(async () => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    // Buttons transition outline-color: read the style once the transition is over.
    await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined)));
    const zone = (() => {
      if (el.closest('[role="toolbar"]')) return "toolbar";
      if (el.closest('[data-slot="state-banner"]')) return "banner";
      if (el.closest("aside")) return "setup";
      if (el.closest('[data-testid="splitter"]') || el.matches('[data-testid="splitter"]')) return "splitter";
      if (el.closest('[data-testid="frame-detail"]')) return "traffic-detail";
      if (el.closest('[aria-label="Frames"]')) return "traffic-list";
      if (el.closest('[data-testid="traffic-panel"]')) return "traffic-controls";
      if (el.closest('[aria-label="Register values"]')) return "table";
      if (el.closest('section[aria-label="Data"]')) return "data-controls";
      return "other";
    })();
    const s = getComputedStyle(el);
    const name =
      el.getAttribute("aria-label") ??
      (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null) ??
      el.textContent?.trim().slice(0, 40) ??
      "";
    return {
      zone,
      tag: `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[${el.getAttribute("role")}]` : ""}`,
      name: name ?? "",
      outlineStyle: s.outlineStyle,
      outlineWidth: s.outlineWidth,
      outlineColor: s.outlineColor,
      boxShadow: s.boxShadow,
    };
  });
}

test.describe("R. accessibility and style", () => {
  test("CHK-R1 tab order follows DES 7 and every stop shows a focus ring (dark on light, lime on dark)", async ({
    app,
    page,
  }, testInfo) => {
    await app.toLive();
    await app.pollUpdate(REGISTER_MAP_10, { at: AT });
    await app.frames([
      txFrame(1, AT, [0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10]),
      rxFrame(2, AT + 8, [0, 1, 0, 0, 0, 5, 1, 3, 2, 4, 210]),
    ]);
    await app.emitState("disconnected", {
      reason: { kind: "closedByPeer", phase: "linkLost", message: "closed" },
    });
    await expect(app.banner).toBeVisible();
    await app.frameRow(1).click(); // opens the detail strip
    await expect(app.frameDetail).toBeVisible();
    // Start the sequential navigation at the first control of the window.
    await page.keyboard.press("Shift"); // keyboard modality, so that focus() shows :focus-visible
    await app.toolbarButton("Toggle setup panel").focus();

    const stops: Stop[] = [];
    const first = await focusStop(app);
    if (first) stops.push(first);
    for (let i = 0; i < 90; i += 1) {
      await page.keyboard.press("Tab");
      const stop = await focusStop(app);
      if (!stop) break; // focus left the document
      stops.push(stop);
    }
    await testInfo.attach("tab-order.json", {
      body: JSON.stringify(stops.map((s) => `${s.zone} | ${s.tag} | ${s.name}`), null, 2),
      contentType: "application/json",
    });

    const zones = stops.reduce<string[]>((acc, s) => {
      if (acc.at(-1) !== s.zone) acc.push(s.zone);
      return acc;
    }, []);
    expect(zones).toEqual([
      "toolbar",
      "banner",
      "setup",
      "data-controls",
      "table",
      "splitter",
      "traffic-controls",
      "traffic-list",
      "traffic-detail",
    ]);

    const bad = stops.filter((s) => {
      const outlined = s.outlineStyle === "solid" && s.outlineWidth === "2px";
      const onDark = s.zone.startsWith("traffic");
      const expected = onDark ? ACCENT : DARK;
      const colored = s.outlineColor === expected || s.boxShadow.includes(expected);
      return !(outlined || s.boxShadow !== "none") || !colored;
    });
    expect(
      bad.map((s) => `${s.zone} ${s.tag} "${s.name}" outline=${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`),
      "stops without the DES focus ring",
    ).toEqual([]);
  });

  test("CHK-R (DES 7) Open profile dialog returns focus to the Open… button on close", async ({ app }) => {
    await app.toolbarButton("Open…").click();
    await expect(app.openDialog).toBeVisible();
    await app.page.keyboard.press("Escape");
    await expect(app.openDialog).toHaveCount(0);
    await expect(app.toolbarButton("Open…")).toBeFocused();
  });

  test("CHK-R (DES 7) Save as dialog returns focus to the Save as… button on close", async ({ app }) => {
    await app.host.fill("127.0.0.1");
    await app.toolbarButton("Save as…").click();
    await expect(app.saveAsDialog).toBeVisible();
    await app.page.keyboard.press("Escape");
    await expect(app.saveAsDialog).toHaveCount(0);
    await expect(app.toolbarButton("Save as…")).toBeFocused();
  });

  test("CHK-R (DES 7) Write dialog returns focus to the Write… button on close", async ({ app }) => {
    await app.toLive();
    await app.toolbarButton("Write…").click();
    await expect(app.writeDialog).toBeVisible();
    await app.page.keyboard.press("Escape");
    await expect(app.writeDialog).toHaveCount(0);
    await expect(app.toolbarButton("Write…")).toBeFocused();
  });

  test("CHK-R (DES 7) modals open with focus on the first field, confirms on the safe button", async ({
    app,
  }) => {
    await app.seedProfiles([tcpProfile("Bench A")]);
    await app.toolbarButton("Open…").click();
    await expect(app.openDialog.getByLabel("Filter profiles")).toBeFocused();
    await app.openDialog.getByRole("row", { name: /Bench A/ }).click();
    await app.openDialog.getByRole("button", { name: "Delete" }).click();
    await expect(app.confirmDialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  });

  test("CHK-R3 no text on a solid red fill; orange only on warning elements", async ({ app }) => {
    const scan = () =>
      app.page.evaluate(
        ({ red, orange }) => {
          const out: { kind: string; el: string }[] = [];
          for (const el of document.querySelectorAll<HTMLElement>("body *")) {
            const s = getComputedStyle(el);
            const hasText = [...el.childNodes].some(
              (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
            );
            const desc = `${el.tagName.toLowerCase()}${el.dataset.slot ? `[${el.dataset.slot}]` : ""}:${(el.textContent ?? "").trim().slice(0, 30)}`;
            if (s.backgroundColor === red && hasText) out.push({ kind: "text-on-red", el: desc });
            if (s.color === red && hasText) out.push({ kind: "red-text", el: desc });
            if (
              s.backgroundColor === orange ||
              s.color === orange ||
              s.borderTopColor === orange ||
              s.borderLeftColor === orange
            ) {
              const inWarning = el.closest(
                '[data-variant="timeout"], [data-variant="badResponse"], [data-variant="warning"]',
              );
              out.push({ kind: inWarning ? "orange-on-warning" : "orange-elsewhere", el: desc });
            }
          }
          return out;
        },
        { red: RED, orange: ORANGE },
      );

    const findings: Record<string, { kind: string; el: string }[]> = {};
    await app.toLive();
    findings.polling = await scan();
    await app.emitState("paused");
    findings.paused = await scan();
    await app.emitState("polling");
    await app.emitState("timeout", { consecutiveFailures: 1 });
    findings.timeout = await scan();
    await app.emitState("exception", { exceptionCode: 2, consecutiveFailures: 1 });
    findings.exception = await scan();
    await app.emitState("badResponse", { badResponseKind: "crc", consecutiveFailures: 1 });
    findings.badResponse = await scan();
    await app.emitState("disconnected", {
      reason: { kind: "closedByPeer", phase: "linkLost", message: "closed" },
    });
    findings.disconnected = await scan();

    for (const [state, list] of Object.entries(findings)) {
      expect(
        list.filter((f) => f.kind === "text-on-red" || f.kind === "red-text"),
        `${state}: red fill with text or red text`,
      ).toEqual([]);
      expect(
        list.filter((f) => f.kind === "orange-elsewhere"),
        `${state}: orange outside warning elements`,
      ).toEqual([]);
      if (state !== "timeout" && state !== "badResponse") {
        expect(list, `${state}: no orange at all`).toEqual([]);
      } else {
        expect(list.length, `${state}: orange is used by its warning elements`).toBeGreaterThan(0);
      }
    }
  });

  test("CHK-R3 write warnings use orange only for warnings (broadcast, timeout, bad response)", async ({
    app,
  }) => {
    await app.toState("polling", { rtu: "COM3" });
    await app.toolbarButton("Write…").click();
    await app.writeDialog.getByLabel("Slave ID").fill("0");
    const warning = app.writeDialog.getByText("Broadcast: devices do not reply", { exact: false });
    await expect(warning).toBeVisible();
    await app.script((f) => f.setResult("write", { status: "timeout" }));
    await app.writeDialog.getByRole("button", { name: "Send" }).click();
    await expect(app.writeResult).toContainText("No response within");
    await expect(app.writeResult.locator("p")).toHaveCSS("background-color", ORANGE);
    await expect(app.writeResult.locator("p")).toHaveCSS("color", DARK);
    await app.script((f) => f.setResult("write", { status: "exception", code: 2 }));
    await app.writeDialog.getByRole("button", { name: "Send" }).click();
    await expect(app.writeResult).toContainText("Exception 02");
    const bg = await app.writeResult.locator("p").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe(RED);
    expect(bg).not.toBe(ORANGE);
  });

  test("CHK-R5 Afacad for text, monospace for values, addresses, bytes and times; English only", async ({
    app,
  }) => {
    await app.toLive();
    await app.frames([txFrame(1, AT, [0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10])]);
    await expect(app.frameRow(1)).toBeVisible(); // frames are batched per animation frame
    const fonts = await app.page.evaluate(async () => {
      await document.fonts.ready;
      const family = (el: Element | null) => (el ? getComputedStyle(el).fontFamily : "(missing)");
      const loaded = [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, ""));
      return {
        loaded: [...new Set(loaded)],
        lang: document.documentElement.lang,
        body: family(document.body),
        toolbarButton: family(document.querySelector('[role="toolbar"] button')),
        label: family(document.querySelector("aside label")),
        banner: family(document.querySelector("h2")),
        value: family(document.querySelector('#data-row-0 [role="gridcell"]:nth-child(2)')),
        address: family(document.querySelector('#data-row-0 [role="gridcell"]:nth-child(1)')),
        frameBytes: family(document.querySelector('#frame-1 [role="gridcell"]:nth-child(5)')),
        frameTime: family(document.querySelector('#frame-1 [role="gridcell"]:nth-child(2)')),
        hostInput: family(document.querySelector("aside input")),
        statusTime: family(document.querySelector("footer span span")),
      };
    });
    expect(fonts.loaded).toEqual(expect.arrayContaining(["Afacad", "JetBrains Mono"]));
    expect(fonts.lang).toBe("en");
    for (const k of ["body", "toolbarButton", "label", "banner"] as const) {
      expect(fonts[k], `${k} uses Afacad`).toContain("Afacad");
    }
    for (const k of ["value", "address", "frameBytes", "frameTime", "hostInput", "statusTime"] as const) {
      expect(fonts[k], `${k} uses the monospace font`).toContain("JetBrains Mono");
    }
  });

  test("CHK-R6 invalid fields have aria-invalid and the message linked by aria-describedby", async ({
    app,
    page,
  }) => {
    await app.toolbarButton("Connect").click();
    const check = async (field: import("@playwright/test").Locator, message: string) => {
      await expect(field).toHaveAttribute("aria-invalid", "true");
      const ids = ((await field.getAttribute("aria-describedby")) ?? "").split(" ").filter(Boolean);
      expect(ids.length).toBeGreaterThan(0);
      const texts = await page.evaluate(
        (list) => list.map((id) => document.getElementById(id)?.textContent?.trim() ?? null),
        ids,
      );
      expect(texts).toContain(message);
    };
    await check(app.host, "Enter a host name or IPv4 address.");
    await app.quantity.fill("126");
    await app.quantity.blur();
    await check(app.quantity, "Quantity for FC03 must be from 1 to 125.");
  });

  test("CHK-R6 write dialog and profile name fields too", async ({ app, page }) => {
    await app.toState("polling");
    await app.toolbarButton("Write…").click();
    const value = app.writeDialog.getByLabel("Value", { exact: true });
    await value.fill("70000");
    await app.writeDialog.getByRole("button", { name: "Send" }).click();
    await expect(value).toHaveAttribute("aria-invalid", "true");
    const ids = ((await value.getAttribute("aria-describedby")) ?? "").split(" ");
    const text = await page.evaluate((id) => document.getElementById(id)?.textContent, ids[0] ?? "");
    expect(text).toContain("Value must be from 0 to 65535.");
    await app.writeDialog.getByRole("button", { name: "Close", exact: true }).click();

    await page.keyboard.press("Control+Shift+s");
    const name = app.saveAsDialog.getByLabel("Name");
    await name.fill("");
    await app.saveAsDialog.getByRole("button", { name: "Save" }).click();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    const nameIds = ((await name.getAttribute("aria-describedby")) ?? "").split(" ");
    const nameText = await page.evaluate((id) => document.getElementById(id)?.textContent, nameIds[0] ?? "");
    expect(nameText).toBe("Enter a profile name.");
  });

  test("CHK-R (DES 7) tables are grids with aria-rowcount, aria-rowindex and aria-selected; updates are not announced", async ({
    app,
  }) => {
    await app.toLive();
    await expect(app.table).toHaveAttribute("aria-rowcount", "11");
    await expect(app.row(0)).toHaveAttribute("aria-rowindex", "2");
    await expect(app.row(9)).toHaveAttribute("aria-rowindex", "11");
    await expect(app.row(0)).toHaveAttribute("aria-selected", "false");
    await app.row(0).click();
    await expect(app.row(0)).toHaveAttribute("aria-selected", "true");
    // value updates must not reach a live region
    await app.page.evaluate(() => {
      window.__qa = { mutations: 0 };
      const regions = document.querySelectorAll('[aria-live], [role="status"], [role="alert"]');
      const obs = new MutationObserver((l) => {
        (window.__qa as { mutations: number }).mutations += l.length;
      });
      for (const r of regions) obs.observe(r, { childList: true, subtree: true, characterData: true });
    });
    for (let i = 0; i < 5; i += 1) await app.pollUpdate(REGISTER_MAP_10.map((v) => v + i + 1));
    await expect(app.value(0)).toHaveText(String(1234 + 5));
    expect(await app.page.evaluate(() => (window.__qa as { mutations: number }).mutations)).toBe(0);
  });
});
