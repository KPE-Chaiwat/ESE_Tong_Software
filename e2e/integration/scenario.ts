// Shared scenario helpers for the integration specs.
import { expect } from "@playwright/test";
import type { PollSpec, RealMm } from "./real-mm";
import type { Sim } from "./sim";

export { STANDARD_8 } from "../support/mm";

/** The CHK-002 reference map on the simulator (addresses 0-99; anything above answers exception 02). */
export async function referenceMap(sim: Sim): Promise<void> {
  await sim.ctlOk("set holding 0 1234 65535 32768 0 32767 0 0 0 0 0");
  await sim.ctlOk("set input 0 4321");
  await sim.ctlOk("set coils 0 1 0 1");
  await sim.ctlOk("set discrete 0 1");
  await sim.ctlOk("limit 100");
}

/** Creates the polls through the UI (New poll + setup form + Apply) and returns their ids in order. */
export async function createPolls(mm: RealMm, specs: PollSpec[]): Promise<number[]> {
  const ids: number[] = [];
  for (const spec of specs) ids.push(await mm.addPollUi(spec, { closeSetup: true }));
  return ids;
}

/** The request signature of a poll as the simulator sees it. */
export const signature = (s: PollSpec): string => `${s.slave ?? 1}:${s.fc ?? 3}@${s.start ?? 0}x${s.qty ?? 10}`;

/** Groups the decoded requests by signature `unit:fc@addrxqty`. */
export function bySignature(reqs: ReturnType<Sim["requestsDecoded"]>): Map<string, ReturnType<Sim["requestsDecoded"]>> {
  const out = new Map<string, ReturnType<Sim["requestsDecoded"]>>();
  for (const r of reqs) {
    const k = `${r.unit}:${r.fc}@${r.addr}x${r.arg}`;
    const list = out.get(k) ?? [];
    list.push(r);
    out.set(k, list);
  }
  return out;
}

/** Checks that on every connection the log strictly alternates RX then reply (TX or NO-REPLY). */
export function alternation(sim: Sim): { ok: boolean; firstBad: string | null } {
  const lastDir = new Map<number, string>();
  for (const e of sim.entries()) {
    if (e.conn === null) continue;
    if (e.dir === "RX") {
      const last = lastDir.get(e.conn);
      if (last === "RX") return { ok: false, firstBad: `two RX in a row on conn ${e.conn}: ${e.raw}` };
      lastDir.set(e.conn, "RX");
    } else if (e.dir === "TX" || e.dir === "NO-REPLY") {
      lastDir.set(e.conn, "reply");
    }
  }
  return { ok: true, firstBad: null };
}

/** Intervals (ms) between successive requests of one signature. */
export function intervals(list: Array<{ epoch: number }>): number[] {
  const d: number[] = [];
  for (let i = 1; i < list.length; i += 1) d.push((list[i]?.epoch ?? 0) - (list[i - 1]?.epoch ?? 0));
  return d;
}

export async function pauseAll(mm: RealMm): Promise<void> {
  await mm.toolbarButton("Pause all").click();
  await expect(mm.toolbarButton("Resume all")).toBeVisible();
}

/** Raises and activates a poll's sub-window through the sidebar row and puts the focus in its grid. */
export async function focusPoll(mm: RealMm, id: number): Promise<void> {
  await mm.row(id).click();
  await expect(mm.sub(id)).toHaveAttribute("data-active", "true");
  await mm.grid(id).focus();
}
