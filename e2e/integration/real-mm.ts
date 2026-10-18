// Page objects for the REAL app (no fake IPC): they reuse the DOM locators of support/mm.ts and
// replace everything that scripted the fake with real UI actions. The fake-only hooks
// (`__ESEFACT_FAKE_*`, `callsOf`, `setMode`, ...) do not exist here: state is read from the DOM, from
// the simulator log and from read-only real commands (`invoke` of `mm_export_profile`,
// `app_list_monitors`), never from the fake.
import { expect, type Locator, type Page } from "@playwright/test";
import { Mm, NativeWin, type PollSpec } from "../support/mm";
import type { Sim } from "./sim";

export type { PollSpec };

export interface ConnectOptions {
  host?: string;
  timeoutMs?: number | string;
  autoStart?: boolean;
  /** Do not wait for the Connected pill. */
  noWait?: boolean;
}

/** Runs a Tauri command from a page (observation only: reads of real backend state). */
export async function invokeIn<T = unknown>(page: Page, cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  return page.evaluate(
    ({ cmd, args }) => {
      const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } })
        .__TAURI_INTERNALS__;
      return internals.invoke(cmd, args) as Promise<never>;
    },
    { cmd, args },
  ) as Promise<T>;
}

export interface TrafficRow {
  seq: number;
  time: string;
  dir: string;
  len: number;
  bytes: string;
  info: string;
  poll: string;
}

export class RealMm extends Mm {
  /** Connects to the simulator (real `mm_connect`) through the sidebar form and the toolbar. */
  async connectTo(sim: Sim, o: ConnectOptions = {}): Promise<void> {
    if (!(await this.hostField.isVisible())) await this.page.getByRole("button", { name: "Edit", exact: true }).click();
    await this.hostField.fill(o.host ?? "127.0.0.1");
    await this.portField.fill(String(sim.modbusPort));
    if (o.timeoutMs !== undefined) await this.timeoutField.fill(String(o.timeoutMs));
    const auto = o.autoStart ?? true;
    if ((await this.autoStart.isChecked()) !== auto) await this.autoStart.setChecked(auto);
    await this.toolbarButton("Connect").click();
    if (!o.noWait) await expect(this.pill).toContainText("Connected", { timeout: 15_000 });
  }

  /** The ids of every poll in the list, in list order (from the sidebar rows). */
  async ids(): Promise<number[]> {
    const raw = await this.pollList.locator("[data-poll-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-poll-id")));
    return raw.map(Number);
  }

  async idByName(name: string): Promise<number> {
    const id = await this.row(name).first().getAttribute("data-poll-id");
    if (id === null) throw new Error(`no poll named ${name}`);
    return Number(id);
  }

  /** New poll through the toolbar, then the setup form and Apply. Returns the poll id. */
  async addPollUi(spec: PollSpec, opts: { closeSetup?: boolean } = {}): Promise<number> {
    const before = await this.ids();
    await this.toolbarButton("New poll").click();
    await expect.poll(async () => (await this.ids()).length, { message: "a new row appears" }).toBe(before.length + 1);
    const ids = await this.ids();
    const id = ids.find((i) => !before.includes(i)) as number;
    await expect(this.sub(id)).toBeVisible();
    await this.applySetup(id, spec);
    if (opts.closeSetup ?? true) await this.closeSetup(id);
    return id;
  }

  /** Fills the poll form of a sub-window (dock or popover) and presses Apply. */
  async applySetup(id: number, spec: PollSpec): Promise<void> {
    const f = (label: string) => this.setupField(id, label);
    await expect(this.setup(id)).toBeVisible();
    await f("Name").fill(spec.name);
    await f("Slave ID").fill(String(spec.slave ?? 1));
    await f("Function").selectOption(String(spec.fc ?? 3));
    await f("Start address").fill(String(spec.start ?? 0));
    await f("Quantity").fill(String(spec.qty ?? 10));
    await f("Scan rate (ms)").fill(String(spec.scan ?? 100));
    await this.setup(id).getByRole("button", { name: "Apply", exact: true }).click();
    await expect(this.row(id)).toContainText(spec.name);
  }

  async closeSetup(id: number): Promise<void> {
    if (await this.setup(id).isVisible()) {
      await this.titleButton(id, /^Poll setup/).click();
      await expect(this.setup(id)).toHaveCount(0);
    }
  }

  /** The text of the first line of a sidebar row. */
  async rowText(id: number): Promise<string> {
    return ((await this.row(id).innerText()) ?? "").replace(/\s+/g, " ").trim();
  }

  /** Real backend state (export of the current setup); `connection` is needed once while idle. */
  async exportProfile(): Promise<Record<string, any>> {
    return invokeIn(this.page, "mm_export_profile", {
      connection: { mode: "tcp", host: "127.0.0.1", port: 502, timeoutMs: 1000 },
    });
  }

  async monitors(): Promise<Array<{ id: string; label: string; primary: boolean; scaleFactor: number; workArea: { x: number; y: number; width: number; height: number } }>> {
    return invokeIn(this.page, "app_list_monitors");
  }

  /** Counters of the traffic bar (collapsed bar text) or of the panel header (expanded; it follows the filter). */
  async totals(): Promise<{ requests: number; responses: number; errors: number; timeouts: number }> {
    if (await this.traffic.isVisible()) {
      const n = async (k: "requests" | "responses" | "errors" | "timeouts") => Number(await this.counter(k).innerText());
      return { requests: await n("requests"), responses: await n("responses"), errors: await n("errors"), timeouts: await n("timeouts") };
    }
    const text = await this.trafficBar.innerText();
    const m = /Requests (\d+) · Responses (\d+) · Errors (\d+) · Timeouts (\d+)/.exec(text);
    if (!m) throw new Error(`traffic bar text not recognised: ${text}`);
    return { requests: Number(m[1]), responses: Number(m[2]), errors: Number(m[3]), timeouts: Number(m[4]) };
  }

  async expandTraffic(): Promise<void> {
    if (await this.traffic.isVisible()) return;
    await this.trafficBar.getByRole("button", { name: /Expand/ }).click();
    await expect(this.traffic).toBeVisible();
  }

  /**
   * Every row the traffic panel holds, read by scrolling the virtualized list from top to bottom.
   * Call it while no frames are added (polls paused), otherwise the list changes under the scroll.
   */
  async readTrafficAll(): Promise<TrafficRow[]> {
    return this.frameList.evaluate(async (grid) => {
      const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
      const seen = new Map<number, TrafficRow>();
      const collect = () => {
        for (const row of grid.querySelectorAll('[role="row"][id^="frame-"]')) {
          const t = (k: string) => (row.querySelector(`[data-cell="${k}"]`)?.textContent ?? "").trim();
          const seq = Number(t("seq"));
          seen.set(seq, { seq, time: t("time"), dir: t("dir"), len: Number(t("len")), bytes: t("bytes"), info: t("info"), poll: t("poll") });
        }
      };
      grid.scrollTop = 0;
      await raf();
      await raf();
      collect();
      const step = Math.max(40, Math.floor(grid.clientHeight * 0.6));
      let guard = 0;
      while (grid.scrollTop + grid.clientHeight < grid.scrollHeight - 1 && guard++ < 5000) {
        grid.scrollTop = Math.min(grid.scrollHeight, grid.scrollTop + step);
        await raf();
        await raf();
        collect();
      }
      await raf();
      collect();
      return [...seen.values()].sort((a, b) => a.seq - b.seq);
    });
  }

  /** The grid cell text of one data row of a sub-window: [alias, address, raw, scaled]. */
  async rowCells(who: number | string, index: number): Promise<string[]> {
    const row = this.gridRow(who, index);
    return row.locator('[role="gridcell"]').allInnerTexts();
  }
}

/** A native poll window (W2) of the real app. */
export class RealNative extends NativeWin {
  async cells(index: number): Promise<string[]> {
    return this.gridRow(index).locator('[role="gridcell"]').allInnerTexts();
  }
}

/** Selected row indexes and the first visible row of a data grid (works for sub-windows and W2). */
export async function gridState(grid: Locator): Promise<{ selected: number[]; top: number }> {
  return grid.evaluate((el) => ({
    selected: [...el.querySelectorAll('[role="row"][aria-selected="true"]')]
      .map((r) => Number(r.getAttribute("data-row")))
      .sort((a, b) => a - b),
    top: Math.round(el.scrollTop / 24),
  }));
}

export type { Locator };
export { expect };
