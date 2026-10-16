import { screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { type Harness, renderWindow, TCP } from "../test-utils";

vi.mock("../../lib/format", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/format")>();
  return { ...actual, formatValue: vi.fn(actual.formatValue) };
});

import { formatValue } from "../../lib/format";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

describe("table update cost (DES-001 8)", () => {
  it("a poll update re-renders only the rows whose value changed", async () => {
    h = await renderWindow({
      prepare: ({ rt }) => {
        rt.stores.config.getState().setConnection(TCP);
        rt.stores.config.getState().setPoll({
          slaveId: 1,
          function: 3,
          startAddress: 0,
          quantity: 125,
          scanRateMs: 100,
        });
      },
    });
    h.state("connecting");
    h.state("connected");
    h.state("polling");

    const values = Array.from({ length: 125 }, (_, i) => i);
    h.emit(() => h.ipc.emitPollUpdate({ values }));
    const grid = screen.getByRole("grid", { name: "Register values" });
    const rendered = within(grid).getAllByRole("row").length - 1;
    expect(rendered).toBeGreaterThan(10);
    expect(rendered).toBeLessThan(125);

    const mock = vi.mocked(formatValue);
    mock.mockClear();
    // Same values again: nothing changed, so no row formats anything.
    h.emit(() => h.ipc.emitPollUpdate({ values: [...values] }));
    expect(mock).toHaveBeenCalledTimes(0);

    // One value changes: exactly one row re-renders.
    const next = [...values];
    next[3] = 9999;
    h.emit(() => h.ipc.emitPollUpdate({ values: next }));
    expect(mock).toHaveBeenCalledTimes(1);
    expect(within(grid).getByText("9999")).toBeVisible();
  });

  it("handles 600 updates of 125 registers (60 s at 100 ms) with the store staying small", async () => {
    h = await renderWindow({
      prepare: ({ rt }) => {
        rt.stores.config.getState().setConnection(TCP);
        rt.stores.config.getState().setPoll({
          slaveId: 1,
          function: 3,
          startAddress: 0,
          quantity: 125,
          scanRateMs: 100,
        });
      },
    });
    h.state("connecting");
    h.state("connected");
    h.state("polling");
    const started = performance.now();
    h.emit(() => {
      for (let n = 1; n <= 600; n += 1) {
        h.ipc.emitPollUpdate({ values: Array.from({ length: 125 }, (_, i) => (i + n) & 0xffff) });
        h.ipc.emitFrames([
          {
            seq: 2 * n - 1,
            at: n,
            direction: "tx",
            bytes: [0, 1],
            slaveId: 1,
            function: 3,
            exceptionCode: null,
            note: null,
          },
          {
            seq: 2 * n,
            at: n,
            direction: "rx",
            bytes: [0, 1],
            slaveId: 1,
            function: 3,
            exceptionCode: null,
            note: null,
          },
        ]);
      }
    });
    const elapsed = performance.now() - started;
    expect(h.rt.stores.pollData.getState().seq).toBe(600);
    expect(h.rt.stores.traffic.getState().frames.size).toBe(1200);
    // A generous bound: this guards against accidental quadratic work, it is not a benchmark.
    expect(elapsed).toBeLessThan(15_000);
  });
});
