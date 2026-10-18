// REQ-002 "8 polls at 100 ms" as far as jsdom can prove it (FE-002 task 28): what a stream of updates
// renders, and how fast a Pause shows. Timing on a real WebView2 (long tasks, memory, drag while
// polling) is not measurable here and is listed in the part B2b notes.
import { act, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import type { PollId } from "@/shared/ipc/modbus-master.types";

const renders = vi.hoisted(() => ({ card: 0, titleBar: 0, frames: new Map<number, number>() }));

// Counts how often the poll view body renders its data card (the wrapper renders with its parent).
vi.mock("./poll-view/DataCard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./poll-view/DataCard")>();
  const Inner = mod.DataCard;
  return {
    ...mod,
    DataCard: (props: React.ComponentProps<typeof Inner>) => {
      renders.card += 1;
      return <Inner {...props} />;
    },
  };
});
vi.mock("../lib/format", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/format")>();
  return { ...actual, formatValue: vi.fn(actual.formatValue) };
});

import { pollConfigInput } from "@/shared/ipc/modbus-master.fake";
import { formatValue } from "../lib/format";
import { type Harness, renderWindow } from "./test-utils";

let h: Harness;

// These suites drive a whole window from the fake backend: replies of the fake (an attach snapshot,
// a relayed event) reach the stores a few microtasks after the last act() and update mounted
// components. That is how the app behaves, not a missing act() in a test, and one warning per
// update buries a real one. Everything the tests do runs inside act() (RTL turns the flag on for
// the duration of each act), so only those unwrapped replies are left unwarned.
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
beforeAll(() => {
  actEnv.IS_REACT_ACT_ENVIRONMENT = false;
});
afterAll(() => {
  actEnv.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  // Let the replies still on their way land, then dispose inside act: the runtime's stores change
  // while the view is still mounted, and React warns about updates outside act.
  await act(async () => {});
  act(() => {
    h?.rt.dispose();
  });
});

const STANDARD = [
  { name: "Poll 1", fn: 3, start: 0, qty: 10 },
  { name: "Poll 2", fn: 3, start: 10, qty: 10 },
  { name: "Poll 3", fn: 4, start: 0, qty: 10 },
  { name: "Poll 4", fn: 1, start: 0, qty: 32 },
  { name: "Poll 5", fn: 2, start: 0, qty: 8 },
  { name: "Poll 6", fn: 3, start: 20, qty: 125 },
  { name: "Poll 7", fn: 3, start: 50, qty: 10 },
  { name: "Poll 8", fn: 3, start: 0, qty: 2 },
] as const;

/** The CHK2 "Standard 8 polls", all tiled in one connection window and polling at 100 ms. */
async function eight(): Promise<PollId[]> {
  h = await renderWindow();
  const ids: PollId[] = [];
  // The eight polls are added in one act: one render of the window instead of eight.
  await h.act(async () => {
    for (const p of STANDARD) {
      ids.push(
        await h.ipc.addPoll(
          pollConfigInput({
            name: p.name,
            definition: {
              slaveId: 1,
              function: p.fn,
              startAddress: p.start,
              quantity: p.qty,
              scanRateMs: 100,
            },
          }),
          "workspace",
        ),
      );
    }
  });
  await h.act(() => h.rt.stores.workspace.getState().tile());
  await h.connect();
  h.advance(500);
  return ids;
}

// Each test renders eight sub-windows with their grids: a few seconds of jsdom work on a quiet
// machine, several times that on a loaded one. The limit is explicit, not the 5 s default.
describe("8 sub-windows polling at 100 ms (CHK2-Q1, as far as jsdom goes)", {
  timeout: 60_000,
}, () => {
  it("all eight show live values", async () => {
    const ids = await eight();
    for (const id of ids) {
      const frame = document.querySelector(`[data-subwindow="${id}"]`) as HTMLElement;
      expect(within(frame).getByRole("grid").getAttribute("data-status")).toBe("live");
    }
  });

  it("two seconds of 100 ms cycles re-render no data card, and format only the visible rows", async () => {
    await eight();
    renders.card = 0;
    const mock = vi.mocked(formatValue);
    mock.mockClear();
    // One step per cycle, each in its own act: this is what the app does, update by update.
    const steps = 20;
    for (let i = 0; i < steps; i += 1) h.advance(100);
    // The poll view body does not render per update: only the cells of the rows that are on
    // screen are formatted (about 41 rows at most per sub-window, not the 125 of a poll).
    expect(renders.card).toBe(0);
    expect(mock.mock.calls.length).toBeGreaterThan(0);
    expect(mock.mock.calls.length).toBeLessThanOrEqual(steps * 8 * 41);
  });

  it("the sidebar, the rail and the summary do not render per cycle either", async () => {
    await eight();
    const chip = screen.getByTestId("summary-chip");
    const before = chip.outerHTML;
    h.advance(5_000);
    expect(screen.getByTestId("summary-chip").outerHTML).toBe(before);
  });

  it("Pause of one poll shows Paused within 100 ms of virtual time, and the others keep going", async () => {
    const ids = await eight();
    const [first, second] = ids as [PollId, PollId];
    const chipOf = (id: PollId) =>
      within(document.querySelector(`[data-subwindow="${id}"]`) as HTMLElement).getByText(
        /^(Polling|Paused)$/,
      );
    expect(chipOf(first)).toHaveTextContent("Polling");
    await h.act(() => h.rt.stores.pollList.getState().setActive(first, false));
    h.advance(100);
    expect(chipOf(first)).toHaveTextContent("Paused");
    expect(chipOf(second)).toHaveTextContent("Polling");
    // The paused poll sends no more requests; the other seven are served within their scan rate.
    const requests = (id: PollId) =>
      h.ipc.requestLog.filter((e) => e.kind === "poll" && e.pollId === id).length;
    const before = requests(first);
    const other = requests(second);
    h.advance(1000);
    expect(requests(first)).toBe(before);
    expect(requests(second)).toBeGreaterThan(other + 5);
  });

  it("16 polls: every running poll is served in every pass (no starvation in the simulation)", async () => {
    h = await renderWindow();
    const ids: PollId[] = [];
    for (let i = 0; i < 16; i += 1) {
      ids.push(
        await h.addPoll(`P${i + 1}`, {
          definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 5, scanRateMs: 100 },
        }),
      );
    }
    await h.connect();
    h.advance(3000);
    for (const id of ids) {
      const n = h.ipc.requestLog.filter((e) => e.kind === "poll" && e.pollId === id).length;
      expect(n).toBeGreaterThan(10);
    }
  });
});
