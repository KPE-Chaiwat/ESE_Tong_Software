// A counters event does not render the sidebar rows, the rail icons or the minimized pills
// (REV-006 m-9): they select slices that a counters update leaves alone.
import { screen, within } from "@testing-library/react";
import { vi } from "vitest";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow } from "../test-utils";

const renders = vi.hoisted(() => ({ chip: 0, compact: 0 }));

vi.mock("../PollChip", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../PollChip")>();
  return {
    ...mod,
    PollChip: (props: Parameters<typeof mod.PollChip>[0]) => {
      renders.chip += 1;
      return mod.PollChip(props);
    },
  };
});

vi.mock("../../lib/status-line", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../lib/status-line")>();
  return {
    ...mod,
    compactChip: (...args: Parameters<typeof mod.compactChip>) => {
      renders.compact += 1;
      return mod.compactChip(...args);
    },
  };
});

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

async function running(): Promise<PollId[]> {
  h = await renderWindow();
  const ids: PollId[] = [];
  for (const n of ["A", "B", "C", "D"]) ids.push(await h.addPoll(n));
  await h.connect();
  h.advance(300);
  return ids;
}

/** One `Counters` event: every poll has new numbers and a new last update time. */
function counters(ids: PollId[], n: number) {
  return h.ipc.emitCounters({
    polls: ids.map((pollId) => ({
      pollId,
      counters: { requests: n, responses: n, errors: 0, timeouts: 0 },
      effectiveScanMs: null,
      lastOkAt: 1000 + n,
    })),
  });
}

describe("render counts of the sidebar (REV-006 m-9)", () => {
  it("the rows do not render on a counters event, and the tooltip reads the counters when wanted", async () => {
    const ids = await running();
    await h.act(() => counters(ids, 1));
    const before = renders.chip;
    for (let n = 2; n < 22; n += 1) await h.act(() => counters(ids, n));
    expect(renders.chip).toBe(before);
    const row = within(screen.getByRole("listbox", { name: "Polls" })).getAllByRole("option")[0];
    await h.user.hover(row as HTMLElement);
    expect(row?.getAttribute("title")).toMatch(
      /^A · Slave 1 · FC03 · 0-9 \(10\) · 1000 ms · Last update \d\d:\d\d:\d\d\.021 · Errors 0$/,
    );
  });

  it("a state change renders only the row of that poll", async () => {
    const ids = await running();
    const before = renders.chip;
    await h.act(() => h.ipc.emitPollState(ids[1] as PollId, "timeout", { consecutiveFailures: 1 }));
    expect(renders.chip - before).toBe(1);
  });

  it("the rail icons and the minimized pills do not render on a counters event either", async () => {
    const ids = await running();
    await h.act(() => h.rt.stores.prefs.getState().setCompact(true));
    await h.act(() => h.rt.stores.workspace.getState().minimize(ids[0] as PollId));
    expect(screen.getAllByRole("button", { name: /^[A-D]: / }).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-slot="minimized-pill"]')).not.toBeNull();
    await h.act(() => counters(ids, 1));
    const before = renders.compact;
    for (let n = 2; n < 12; n += 1) await h.act(() => counters(ids, n));
    expect(renders.compact).toBe(before);
  });
});
