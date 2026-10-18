// Helpers for tests against the real backend (no fake IPC in the page).
import { expect, type Locator } from "@playwright/test";
import type { ModbusApp } from "../../support/app";
import type { LogEntry, Sim } from "../sim";

export interface RealConnectOptions {
  host?: string;
  timeoutMs?: number | string;
  autoStart?: boolean;
  scanMs?: number | string;
  slaveId?: number | string;
  fn?: string;
  start?: number | string;
  quantity?: number | string;
}

/** Fills the setup panel and presses the toolbar Connect (real `mm_connect`). */
export async function realConnect(mm: ModbusApp, sim: Sim, o: RealConnectOptions = {}): Promise<void> {
  await mm.host.fill(o.host ?? "127.0.0.1");
  await mm.port.fill(String(sim.modbusPort));
  if (o.timeoutMs !== undefined) await mm.timeout.fill(String(o.timeoutMs));
  if (o.slaveId !== undefined) await mm.slaveId.fill(String(o.slaveId));
  if (o.fn !== undefined) await mm.fn.selectOption(o.fn);
  if (o.start !== undefined) await mm.start.fill(String(o.start));
  if (o.quantity !== undefined) await mm.quantity.fill(String(o.quantity));
  if (o.scanMs !== undefined) await mm.scan.fill(String(o.scanMs));
  const auto = o.autoStart ?? true;
  if ((await mm.autoStart.isChecked()) !== auto) await mm.autoStart.setChecked(auto);
  await mm.toolbarButton("Connect").click();
}

/** Text of the traffic list rows as `{seq, time, dir, len, bytes, info}` (rendered rows only). */
export async function trafficRows(mm: ModbusApp) {
  return mm.frameList.locator('[id^="frame-"]').evaluateAll((rows) =>
    rows.map((r) => {
      const c = [...r.querySelectorAll('[role="gridcell"]')].map((x) => x.textContent?.trim() ?? "");
      return { seq: Number(c[0]), time: c[1] ?? "", dir: c[2] ?? "", len: Number(c[3]), bytes: c[4] ?? "", info: c[5] ?? "" };
    }),
  );
}

export const dirOf = (e: LogEntry) => (e.dir === "TX" ? "RX" : "TX"); // simulator TX = app RX

export async function pillIs(mm: ModbusApp, label: string | RegExp): Promise<void> {
  await expect(mm.pill).toHaveText(label);
}

export function bytesOf(e: LogEntry | undefined): string {
  return e?.bytes ?? "";
}

export type { Locator };

/** The CHK-001 reference map on the simulator (addresses 0-99 only; anything above answers 02). */
export async function referenceMap(sim: Sim): Promise<void> {
  await sim.ctlOk("set holding 0 1234 65535 32768 0 32767 0 0 0 0 0");
  await sim.ctlOk("set input 0 4321");
  await sim.ctlOk("set coils 0 1 0 1");
  await sim.ctlOk("set discrete 0 1");
  await sim.ctlOk("limit 100");
}

/** Enlarges the traffic panel with the splitter keyboard so many rows are rendered. */
export async function enlargeTraffic(mm: ModbusApp, presses = 16): Promise<void> {
  await mm.splitter.focus();
  for (let i = 0; i < presses; i += 1) await mm.page.keyboard.press("ArrowUp");
}

/** Hex without the transaction id: `00 01 | 00 00 00 06 01 03 ...` -> `00 00 00 06 01 03 ...`. */
export const withoutTxn = (bytes: string): string => bytes.split(" ").slice(2).join(" ");
export const txnOf = (bytes: string): string => bytes.split(" ").slice(0, 2).join(" ");

/** Local HH:MM:SS.mmm of an epoch in ms, as the traffic panel prints it. */
export function hmsLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/**
 * Negative assertion: no RX/TX frame is logged by the simulator during `windowMs`. An absence can
 * only be observed over time, so this is the one place that waits for a duration.
 */
export async function expectQuiet(sim: Sim, windowMs: number, message = "simulator stays quiet"): Promise<void> {
  const start = sim.mark();
  await new Promise((r) => setTimeout(r, windowMs));
  expect(sim.framesSince(start).length, message).toBe(0);
}
