// REPORT-009 (D11/D12 verification). D11 reuses 20-report008b.spec.ts; this file adds the D12 W1 toolbar width scan.
import fs from "node:fs";
import path from "node:path";
import { type Desktop, expect, test } from "../integration/fixtures";
import type { NativeWindow } from "../integration/desktop";
import { saveProfileAs } from "../integration/profiles";
import { createPolls, focusPoll, referenceMap, STANDARD_8 } from "../integration/scenario";
import { hwndByTitle, sleep, visibleFrame } from "../integration/qa7";
import { gridMetrics, w1ToolbarMetrics } from "../integration/f17b";

const evidenceDir = path.join(process.cwd(), "test-results", "evidence");
fs.mkdirSync(evidenceDir, { recursive: true });
const winOf = (d: Desktop, hwnd: number) => d.windows().find((w) => w.hwnd === hwnd) as NativeWindow;
const j = (o: unknown) => JSON.stringify(o);

async function dragToMinimum(desktop: Desktop, hwnd: number): Promise<{ outer: string; client: string }> {
  const get = () => winOf(desktop, hwnd);
  desktop.moveWindow(hwnd, 100, 60, 1400, 900);
  await expect.poll(() => get().rect.w).toBe(1400);
  desktop.showWindow(hwnd, "focus");
  let f = visibleFrame(get());
  const w0 = get().rect.w;
  desktop.mouseDrag(f.x + f.w - 1, get().rect.y + 300, get().rect.x + 150, get().rect.y + 300, 30, 15);
  await expect.poll(() => get().rect.w).toBeLessThan(w0);
  f = visibleFrame(get());
  const h0 = get().rect.h;
  desktop.mouseDrag(get().rect.x + 300, f.y + f.h - 1, get().rect.x + 300, get().rect.y + 60, 30, 15);
  await expect.poll(() => get().rect.h).toBeLessThan(h0);
  await sleep(600);
  const w = get();
  return { outer: `${w.rect.w}x${w.rect.h}`, client: `${w.client.w}x${w.client.h}` };
}

test.describe("REPORT-009 D12 W1 toolbar", () => {
  test("CHK2-F17 D12 W1 minimum real drag + widths 960..1200 css: Disconnect inside, one row h-14, no overlaps, profile label from 1100", async ({ desktop, mm, sim }, testInfo) => {
    test.setTimeout(900_000);
    await referenceMap(sim);
    await sim.ctlOk("set holding 20 1 2 3");
    await mm.connectTo(sim, { autoStart: true, timeoutMs: 1000 });
    const ids = await createPolls(mm, STANDARD_8);
    await expect(mm.statusLine(ids[0] as number)).toHaveAttribute("data-state", "polling");
    await saveProfileAs(mm, "Plant");
    const w1 = hwndByTitle(desktop, "Modbus Master");
    const reached = await dragToMinimum(desktop, w1);
    await focusPoll(mm, ids[0] as number);
    const sub = mm.sub(ids[0] as number);
    if ((await sub.getAttribute("data-state")) !== "maximized") await mm.titleButton(ids[0] as number, /^Maximize/).click();
    await sleep(500);
    await expect(mm.traffic).toHaveCount(0);
    const dpr = await mm.page.evaluate(() => window.devicePixelRatio);

    const probe = async () => {
      const t = await w1ToolbarMetrics(mm.page);
      const x = await mm.page.evaluate(() => {
        const tb = document.querySelector('[role="toolbar"][aria-label="Toolbar"]') as HTMLElement;
        const btns = [...tb.querySelectorAll("button")] as HTMLElement[];
        const dis = btns.find((b) => b.innerText.trim() === "Disconnect");
        const dr = dis?.getBoundingClientRect();
        const prof = tb.querySelector('[data-testid="profile"]') as HTMLElement | null;
        const profName = prof?.querySelector("span[title]") as HTMLElement | null;
        const pill = tb.querySelector('[data-slot="status-pill"]') as HTMLElement | null;
        const chip = tb.querySelector('[data-testid="summary-chip"]') as HTMLElement | null;
        const cut = (e: HTMLElement | null | undefined) => (e ? e.scrollWidth > e.clientWidth + 1 : null);
        const labelEl = pill?.querySelector("span.truncate") as HTMLElement | null;
        return {
          disconnectRight: dr ? Math.round(dr.right * 10) / 10 : null,
          winW: document.documentElement.clientWidth,
          profileShown: !!prof,
          profileTitle: profName?.getAttribute("title") ?? null,
          pillText: pill?.innerText.trim() ?? null,
          pillTitle: pill?.getAttribute("title") ?? null,
          pillCut: cut(labelEl),
          chipText: chip?.innerText.trim() ?? null,
          chipTitle: chip?.getAttribute("title") ?? null,
          chipCut: cut(chip?.querySelector("span.truncate, span") as HTMLElement | null),
          tbH: Math.round(tb.getBoundingClientRect().height * 10) / 10,
          spread: (() => { const cs = ([...btns, ...(tb.querySelectorAll("[data-slot=status-pill]") as unknown as HTMLElement[]), ...(chip ? [chip] : [])]).map((e) => { const b = e.getBoundingClientRect(); return (b.top + b.bottom) / 2; }); return Math.round((Math.max(...cs) - Math.min(...cs)) * 10) / 10; })(),
        };
      });
      return { t, x };
    };
    const rowOf = (outer: number, p: Awaited<ReturnType<typeof probe>>) => ({
      outer,
      css: p.t.inner,
      rows: p.t.rows,
      h: p.x.tbH,
      spread: p.x.spread,
      scrollOver: p.t.scrollOver,
      disconnectRight: p.x.disconnectRight,
      winW: p.x.winW,
      clipped: p.t.clipped,
      overlaps: p.t.overlaps,
      sum: p.t.sumChildren,
      content: p.t.contentWidth,
      profileShown: p.x.profileShown,
      profileTitle: p.x.profileTitle,
      pillCut: p.x.pillCut,
      pillTitle: p.x.pillTitle,
      pillText: p.x.pillText,
      chipCut: p.x.chipCut,
      chipTitle: p.x.chipTitle,
      chipText: p.x.chipText,
    });

    const min = await probe();
    const gm = await gridMetrics(mm.page, `[data-subwindow="${ids[0]}"] [role="grid"][aria-label="Register values"]`);
    const minRow = rowOf(Number(reached.outer.split("x")[0]), min);
    console.log("D12 W1 minimum", j({ dpr, reached, minRow, grid: { complete: gm.completeStrict.length, gridH: gm.gridH } }));
    fs.writeFileSync(path.join(evidenceDir, "d12-w1-minimum.png"), await mm.page.screenshot());
    fs.writeFileSync(path.join(evidenceDir, "d12-w1-minimum.json"), j({ dpr, reached, minRow, items: min.t.items, childWidths: min.t.childWidths, gm }));

    // outer = css * 1.25 + 18 at 125 %: 1218 = 960 css, 1393 = 1100 css, 1518 = 1200 css
    const outers = [...new Set([1218, 1230, 1250, 1268, 1290, 1310, 1330, 1350, 1370, 1385, 1390, 1391, 1392, 1393, 1394, 1395, 1396, 1400, 1420, 1450, 1480, 1518])];
    const rows: Array<ReturnType<typeof rowOf>> = [];
    for (const W of outers) {
      desktop.moveWindow(w1, 50, 40, W, 800);
      await expect.poll(() => winOf(desktop, w1).rect.w).toBe(W);
      const dl = Date.now() + 8000; let iw = 0; while (Date.now() < dl) { iw = await mm.page.evaluate(() => window.innerWidth); if (Math.abs(iw - winOf(desktop, w1).client.w / dpr) <= 2) break; await sleep(50); }
      if (Math.abs(iw - winOf(desktop, w1).client.w / dpr) > 2) console.log("D12 width mismatch", W, iw, JSON.stringify(winOf(desktop, w1)));
      await sleep(300);
      rows.push(rowOf(W, await probe()));
    }
    console.log("D12 W1 widths", j(rows));
    fs.writeFileSync(path.join(evidenceDir, "d12-w1-widths.json"), j(rows));
    await testInfo.attach("d12-widths.json", { body: j(rows), contentType: "application/json" });

    expect.soft(reached.outer, "W1 real drag minimum").toBe("1218x797");
    expect.soft(min.x.disconnectRight, `Disconnect right edge at the minimum (window ${min.x.winW})`).toBeLessThanOrEqual(min.x.winW);
    expect.soft(min.t.scrollOver, "toolbar horizontal overflow at the minimum").toBeLessThanOrEqual(0);
    expect.soft(min.x.spread, "centre spread at the minimum").toBeLessThanOrEqual(2);
    expect.soft(min.x.tbH, "toolbar height h-14").toBe(56);
    expect.soft(min.t.clipped, "clipped controls at the minimum").toEqual([]);
    expect.soft(min.t.overlaps, "overlaps at the minimum").toEqual([]);
    expect.soft(min.x.profileShown, "profile label hidden at 960 css").toBe(false);
    expect.soft(gm.completeStrict.length, "P1 grid complete rows").toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      const tag = `outer ${r.outer} (${r.css} css)`;
      expect.soft(r.disconnectRight as number, `${tag}: Disconnect right edge`).toBeLessThanOrEqual(r.winW);
      expect.soft(r.scrollOver, `${tag}: scroll overflow`).toBeLessThanOrEqual(0);
      expect.soft(r.spread, `${tag}: vertical centre spread of all controls (one row)`).toBeLessThanOrEqual(2);
      expect.soft(r.h, `${tag}: height`).toBe(56);
      expect.soft(r.clipped, `${tag}: clipped`).toEqual([]);
      expect.soft(r.overlaps, `${tag}: overlaps`).toEqual([]);
      expect.soft(r.profileShown, `${tag}: profile label shown iff css >= 1100`).toBe(r.css >= 1100);
      if (r.profileShown) expect.soft(r.profileTitle, `${tag}: profile title is the full name`).toBe("Plant");
      if (r.pillCut) expect.soft(r.pillTitle, `${tag}: cut pill has a full title`).toBe(r.pillText);
      if (r.chipCut) expect.soft(r.chipTitle, `${tag}: cut chip has a title`).toBeTruthy();
    }
  });
});
