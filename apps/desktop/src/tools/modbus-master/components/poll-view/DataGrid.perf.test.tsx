// What a poll update costs (DES-001 section 8, REV-005 m-3): rows format only when their value
// changed, and nothing around the rows renders for an update.
import { act, screen, within } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("../../lib/format", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/format")>();
  return { ...actual, formatValue: vi.fn(actual.formatValue) };
});
vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-virtual")>();
  return { ...actual, useVirtualizer: vi.fn(actual.useVirtualizer) };
});

import { useVirtualizer } from "@tanstack/react-virtual";
import { formatValue } from "../../lib/format";
import {
  disposeHarnesses,
  installPollViewEnvironment,
  renderPollView,
  uninstallPollViewEnvironment,
} from "./test-utils";

beforeAll(installPollViewEnvironment);
afterAll(uninstallPollViewEnvironment);
afterEach(disposeHarnesses);

async function live125() {
  const h = await renderPollView({
    host: "workspace",
    mode: "manual",
    poll: {
      definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 125, scanRateMs: 100 },
    },
  });
  act(() => {
    h.ipc.emitConnectionState("connected");
    h.ipc.emitPollState(h.pollId, "polling");
  });
  return h;
}

describe("update cost", () => {
  it("an identical update formats 0 rows and one changed value formats 1 row", async () => {
    const h = await live125();
    const values = Array.from({ length: 125 }, (_, i) => i);
    act(() => h.ipc.emitPollUpdate(h.pollId, { values }));
    const grid = screen.getByRole("grid", { name: "Register values" });
    const rendered = within(grid).getAllByRole("row").length - 1;
    expect(rendered).toBeGreaterThan(5);
    expect(rendered).toBeLessThan(125);

    const mock = vi.mocked(formatValue);
    mock.mockClear();
    act(() => h.ipc.emitPollUpdate(h.pollId, { values: [...values] }));
    expect(mock).toHaveBeenCalledTimes(0);

    const next = [...values];
    next[3] = 9999;
    act(() => h.ipc.emitPollUpdate(h.pollId, { values: next }));
    expect(mock).toHaveBeenCalledTimes(1);
    expect(within(grid).getByText("9999")).toBeVisible();
  });

  it("the grid itself does not render for an update, only its rows and the freshness chip", async () => {
    const h = await live125();
    const values = Array.from({ length: 125 }, (_, i) => i);
    act(() => h.ipc.emitPollUpdate(h.pollId, { values }));
    const mock = vi.mocked(useVirtualizer);
    mock.mockClear();
    for (let n = 1; n <= 20; n += 1) {
      act(() => h.ipc.emitPollUpdate(h.pollId, { values: values.map((v) => v + n) }));
    }
    // `useVirtualizer` runs on every render of the grid.
    expect(mock).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId("poll-summary")).toBeVisible();
  });

  it("the freshness chip follows the update time", async () => {
    const h = await live125();
    act(() => h.ipc.emitPollUpdate(h.pollId, { values: new Array(125).fill(1), at: 1000 }));
    const first = document.querySelector('[data-slot="freshness-chip"]')?.textContent;
    act(() => h.ipc.emitPollUpdate(h.pollId, { values: new Array(125).fill(2), at: 5000 }));
    const second = document.querySelector('[data-slot="freshness-chip"]')?.textContent;
    expect(first).toMatch(/^Updated /);
    expect(second).not.toBe(first);
  });
});
