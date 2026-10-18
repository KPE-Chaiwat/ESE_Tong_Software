// Helpers for tests against the real backend (no fake IPC in the page).
import { expect } from "@playwright/test";
import type { Desktop, NativeWindow } from "./desktop";
import type { LogEntry, Sim } from "./sim";

export const LOGICAL_OFFSET = 24;

/** Local HH:MM:SS.mmm of an epoch in ms, as the traffic panel prints it. */
export function hmsLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Hex of the data part after the 7-byte MBAP header minus the transaction id (for comparing frames). */
export const withoutTxn = (bytes: string): string => bytes.split(" ").slice(2).join(" ");

/**
 * Negative assertion: no RX/TX frame is logged by the simulator during `windowMs`. An absence can
 * only be observed over time, so this is the one place that waits for a duration.
 */
export async function expectQuiet(sim: Sim, windowMs: number, message = "simulator stays quiet"): Promise<void> {
  const start = sim.mark();
  await new Promise((r) => setTimeout(r, windowMs));
  expect(sim.framesSince(start).length, message).toBe(0);
}

/** Waits until the simulator log has at least `n` frames of this direction after `mark`. */
export async function untilFrames(sim: Sim, mark: number, dir: "RX" | "TX", n: number, timeout = 20_000): Promise<void> {
  await expect
    .poll(() => sim.framesSince(mark).filter((f) => f.dir === dir).length, { timeout, intervals: [50, 100, 200] })
    .toBeGreaterThanOrEqual(n);
}

/** Native windows of the app whose title starts with `prefix`. */
export function nativeWindows(desktop: Desktop, prefix: string | RegExp): NativeWindow[] {
  return desktop.windows().filter((w) => (typeof prefix === "string" ? w.title.startsWith(prefix) : prefix.test(w.title)));
}

export const rectStr = (w: NativeWindow): string => `${w.rect.x},${w.rect.y} ${w.rect.w}x${w.rect.h}`;

/** All simulator request frames as `unit:fc@addr` strings, for quick equality in messages. */
export function summarize(entries: LogEntry[]): string {
  return entries.map((e) => `${e.dir}:${e.bytes ?? ""}`).join("\n");
}

/** Statistics over a list of numbers. */
export function stats(xs: number[]): { n: number; min: number; max: number; mean: number; p95: number } {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const mean = n ? s.reduce((a, b) => a + b, 0) / n : 0;
  return { n, min: s[0] ?? 0, max: s[n - 1] ?? 0, mean: Math.round(mean * 10) / 10, p95: s[Math.min(n - 1, Math.floor(n * 0.95))] ?? 0 };
}
