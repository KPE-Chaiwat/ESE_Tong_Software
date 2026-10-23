// Helpers for the CHK-010 real-window run (REPORT-031): evidence files, a minimal PNG reader for pixel checks,
// the F10 fixture on the simulator and a native pop-out at its minimum size.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { expect, type Locator, type Page } from "@playwright/test";
import type { Desktop, NativeWindow } from "./desktop";
import type { RealMm } from "./real-mm";
import { RealNative } from "./real-mm";
import { hwndByTitle } from "./qa7";
import { REPO, type Sim } from "./sim";

export const EVIDENCE_DIR = path.join(REPO, "e2e", "test-results", "evidence", "chk10");
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

/** Collected facts of one test, written next to the screenshots (the REPORT cites these files). */
export class Evidence {
  readonly facts: Record<string, unknown> = {};
  constructor(readonly name: string) {}
  set(key: string, value: unknown): void {
    this.facts[key] = value;
  }
  async shot(page: Page, file: string, locator?: Locator): Promise<string> {
    const full = path.join(EVIDENCE_DIR, `${this.name}-${file}.png`);
    if (locator) await locator.screenshot({ path: full });
    else await page.screenshot({ path: full });
    return full;
  }
  save(): void {
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${this.name}.json`), JSON.stringify(this.facts, null, 2));
  }
}

/** Registers 0-9 of fixture F10 on the simulator (all unit ids share the map). */
export async function setF10(sim: Sim): Promise<void> {
  await sim.ctlOk("set holding 0 16712 0 0 0 16712 0 161 65534 9 10");
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Pops a poll out and returns its native window page and handle. */
export async function popOut(desktop: Desktop, mm: RealMm, id: number, namePrefix: string): Promise<{ nw: RealNative; hwnd: number }> {
  await mm.titleButton(id, /^Open in its own window/).click();
  const page = await desktop.w2Page(id);
  const nw = new RealNative(page);
  await expect(nw.root).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  await expect(nw.view).toHaveAttribute("data-attach", "attached", { timeout: 20_000 });
  await expect.poll(() => hwndByTitle(desktop, `${namePrefix} - `), { timeout: 15_000 }).not.toBe(0);
  return { nw, hwnd: hwndByTitle(desktop, `${namePrefix} - `) };
}

export const winOf = (desktop: Desktop, hwnd: number): NativeWindow => desktop.windows().find((w) => w.hwnd === hwnd) as NativeWindow;

/** Sets the CSS client size of a native window (physical px = css x dpr) and waits until the page reports it. */
export async function setClientCss(desktop: Desktop, hwnd: number, page: Page, cssW: number, cssH: number): Promise<{ w: number; h: number; dpr: number }> {
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const w0 = winOf(desktop, hwnd);
  const frameW = w0.rect.w - w0.client.w;
  const frameH = w0.rect.h - w0.client.h;
  desktop.moveWindow(hwnd, w0.rect.x, w0.rect.y, Math.round(cssW * dpr) + frameW, Math.round(cssH * dpr) + frameH);
  await expect
    .poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight]), { timeout: 5000, intervals: [50] })
    .toEqual([cssW, cssH]);
  return { w: cssW, h: cssH, dpr };
}

/** The minimum native poll window: 480 x 320 logical outer px (the Tauri min size), converted to physical px. */
export async function toMinimum(desktop: Desktop, hwnd: number, page: Page): Promise<{ w: number; h: number; outer: { w: number; h: number }; dpr: number }> {
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const w0 = winOf(desktop, hwnd);
  desktop.moveWindow(hwnd, w0.rect.x, w0.rect.y, Math.round(480 * dpr), Math.round(320 * dpr));
  await expect
    .poll(async () => {
      const w = winOf(desktop, hwnd);
      return `${w.rect.w}x${w.rect.h}`;
    }, { timeout: 5000 })
    .toBe(`${Math.round(480 * dpr)}x${Math.round(320 * dpr)}`);
  await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 5000 }).toBeLessThan(480);
  const [w, h] = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
  const outer = winOf(desktop, hwnd).rect;
  return { w: w as number, h: h as number, outer: { w: outer.w, h: outer.h }, dpr };
}

// ---- minimal PNG reader (8-bit RGB or RGBA, no interlace) for the pixel checks ----
export interface Png {
  w: number;
  h: number;
  channels: number;
  data: Buffer;
}

export function readPng(buf: Buffer): Png {
  let o = 8;
  let w = 0;
  let h = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    const body = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      if (body[8] !== 8) throw new Error(`png bit depth ${body[8]}`);
      colorType = body[9] as number;
      if (body[12] !== 0) throw new Error("interlaced png");
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`png color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)] as number;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (out[y * stride + x - channels] as number) : 0;
      const b = y > 0 ? (out[(y - 1) * stride + x] as number) : 0;
      const c = x >= channels && y > 0 ? (out[(y - 1) * stride + x - channels] as number) : 0;
      const v = raw[src + x] as number;
      let r: number;
      if (f === 0) r = v;
      else if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[y * stride + x] = r & 255;
    }
  }
  return { w, h, channels, data: out };
}

export function pixel(png: Png, x: number, y: number): [number, number, number] {
  const i = (y * png.w + x) * png.channels;
  return [png.data[i] as number, png.data[i + 1] as number, png.data[i + 2] as number];
}

/** Counts pixels within `tol` (max channel distance) of the colour inside an optional rectangle (png px). */
export function countNear(png: Png, rgb: [number, number, number], tol: number, rect?: { x: number; y: number; w: number; h: number }): number {
  const x0 = Math.max(0, Math.floor(rect?.x ?? 0));
  const y0 = Math.max(0, Math.floor(rect?.y ?? 0));
  const x1 = Math.min(png.w, Math.ceil((rect?.x ?? 0) + (rect?.w ?? png.w)));
  const y1 = Math.min(png.h, Math.ceil((rect?.y ?? 0) + (rect?.h ?? png.h)));
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const [r, g, b] = pixel(png, x, y);
      if (Math.max(Math.abs(r - rgb[0]), Math.abs(g - rgb[1]), Math.abs(b - rgb[2])) <= tol) n++;
    }
  }
  return n;
}

/** WCAG contrast ratio of two sRGB colours (0-255). */
export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const lum = ([r, g, bl]: [number, number, number]) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}
