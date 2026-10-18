// Helpers added for REPORT-007 (re-run after the REPORT-006 fixes).
import type { Page } from "@playwright/test";
import type { Desktop, NativeWindow } from "./desktop";
import type { Sim } from "./sim";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Which binary the run uses (set by the QA runner through ESEFACT_APP_EXE; default: the normal debug build). */
export const BINARY_LABEL = process.env.ESEFACT_BINARY_LABEL ?? "default";

/** Seconds of the long measurements (CHK2-D10: 60 by default). */
export const SCAN_SECONDS = Number(process.env.QA_SCAN_SECONDS ?? "60");

/** True when the page answers a CDP evaluate within `ms`, false when it does not (frozen page, OS menu mode). */
export async function responsive(page: Page, ms = 1000): Promise<boolean> {
  const answer = page.evaluate(() => document.hasFocus() || true).then(
    () => true,
    () => false,
  );
  return Promise.race([answer, sleep(ms).then(() => false)]);
}

/** Epoch ms of the request frames of one poll signature, from the simulator log. */
export function requestEpochs(sim: Sim, mark: number, pred: (r: ReturnType<Sim["requestsDecoded"]>[number]) => boolean): number[] {
  return sim.requestsDecoded(mark).filter(pred).map((r) => r.epoch);
}

export function diffs(xs: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < xs.length; i += 1) out.push((xs[i] as number) - (xs[i - 1] as number));
  return out;
}

export interface IntervalStats {
  n: number;
  mean: number;
  min: number;
  max: number;
  std: number;
  p50: number;
  p90: number;
  share107to112: number;
}

export function intervalStats(d: number[]): IntervalStats {
  const n = d.length;
  const sorted = [...d].sort((a, b) => a - b);
  const mean = n ? d.reduce((a, b) => a + b, 0) / n : 0;
  const std = n ? Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / n) : 0;
  const q = (p: number) => sorted[Math.min(n - 1, Math.floor(n * p))] ?? 0;
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    n,
    mean: r(mean),
    min: sorted[0] ?? 0,
    max: sorted[n - 1] ?? 0,
    std: r(std),
    p50: q(0.5),
    p90: q(0.9),
    share107to112: n ? r(d.filter((x) => x >= 107 && x <= 112).length / n) : 0,
  };
}

/** The visible frame (DWM extended frame bounds) of a native window, falling back to the window rect. */
export function visibleFrame(w: NativeWindow): { x: number; y: number; w: number; h: number } {
  return w.frame ?? w.rect;
}

/** Screen position (physical px) of a point given in CSS px of a page whose top-level window is `win`. */
export function screenPoint(win: NativeWindow, dpr: number, p: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(win.client.x + p.x * dpr), y: Math.round(win.client.y + p.y * dpr) };
}

/** A fingerprint of the focused element, to compare "focus is where it was". */
export async function focusFingerprint(page: Page): Promise<string> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a) return "none";
    const sub = a.closest("[data-subwindow]")?.getAttribute("data-subwindow") ?? "-";
    const label = a.getAttribute("aria-label") ?? a.getAttribute("id") ?? a.tagName;
    return `${a.tagName}|${a.getAttribute("role") ?? ""}|${label}|sub=${sub}|active=${a.getAttribute("aria-activedescendant") ?? ""}|focused=${document.hasFocus()}`;
  });
}

/** Classes of OS popup menus (#32768) that are visible in the app process. */
export function osMenus(desktop: Desktop): NativeWindow[] {
  return desktop.allWindows().filter((w) => w.cls === "#32768" && w.visible);
}

export const hwndByTitle = (desktop: Desktop, prefix: string | RegExp): number =>
  desktop.windows().find((w) => (typeof prefix === "string" ? w.title.startsWith(prefix) : prefix.test(w.title)))?.hwnd ?? 0;

/** Page-side recorder of mouse and focus events (capture phase): proves whether a press produced a `click` on a target. */
export async function installRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __rec: Array<{ ev: string; t: string; dp: boolean; at: number }>; __recOn?: boolean };
    w.__rec = [];
    if (w.__recOn) return;
    w.__recOn = true;
    const d = (t: EventTarget | null) => {
      const e = t as HTMLElement | null;
      if (!e || !e.tagName) return "?";
      const btn = e.closest?.("button");
      return `${(btn ?? e).tagName}:${(btn?.textContent ?? e.getAttribute?.("aria-label") ?? e.id ?? "").trim().slice(0, 30)}`;
    };
    for (const ev of ["mousedown", "mouseup", "click", "focusout"]) {
      window.addEventListener(ev, (e) => w.__rec.push({ ev, t: d(e.target), dp: e.defaultPrevented, at: Math.round(performance.now()) }), true);
    }
  });
}

export async function readRecorder(page: Page): Promise<Array<{ ev: string; t: string; dp: boolean; at: number }>> {
  return page.evaluate(() => (window as unknown as { __rec: Array<{ ev: string; t: string; dp: boolean; at: number }> }).__rec ?? []);
}

/** Moves the REAL cursor to the centre of `loc` and clicks with OS input (move, press, release). */
export async function hwClick(desktop: Desktop, hwnd: number, page: Page, loc: import("@playwright/test").Locator): Promise<{ x: number; y: number }> {
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (!box) throw new Error("hwClick: element not rendered");
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const hittable = await loc.evaluate((el, p) => {
    const e = document.elementFromPoint(p.x, p.y);
    return !!e && (el === e || el.contains(e));
  }, { x: cx, y: cy });
  if (!hittable) throw new Error("hwClick: the element is not the top element at its centre (covered or clipped)");
  const win = desktop.windows().find((w) => w.hwnd === hwnd);
  if (!win) throw new Error("hwClick: window not found");
  const p = screenPoint(win, dpr, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  desktop.mouseClick(p.x, p.y);
  return p;
}
