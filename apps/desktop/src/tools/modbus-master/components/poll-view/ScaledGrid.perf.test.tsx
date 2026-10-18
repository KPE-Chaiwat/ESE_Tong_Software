// What the scaled column costs (DES-003 3.3, CHK3-G4): a row computes its scaled text only when its
// raw value or the scale changed; nothing else renders for an update.
import { act, screen, within } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("../../lib/scale-math", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/scale-math")>();
  return { ...actual, scaleValue: vi.fn(actual.scaleValue) };
});
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
import { scaleValue } from "../../lib/scale-math";
import { presetDefaults } from "../../lib/scale-presets";
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
      scale: presetDefaults("current4to20"),
      scaleOverrides: [{ start: 2, end: 4, scale: presetDefaults("divide") }],
      valueColumns: "both",
    },
  });
  act(() => {
    h.ipc.emitConnectionState("connected");
    h.ipc.emitPollState(h.pollId, "polling");
  });
  return h;
}

describe("update cost with a scale", () => {
  it("an identical update scales 0 rows; one changed raw value scales 1 row, scaled column included", async () => {
    const h = await live125();
    const values = Array.from({ length: 125 }, (_, i) => i * 100);
    act(() => h.ipc.emitPollUpdate(h.pollId, { values }));
    const grid = screen.getByRole("grid", { name: "Register values" });
    const rendered = within(grid).getAllByRole("row").length - 1;
    expect(rendered).toBeGreaterThan(5);
    expect(rendered).toBeLessThan(125);

    const scale = vi.mocked(scaleValue);
    const format = vi.mocked(formatValue);
    scale.mockClear();
    format.mockClear();
    act(() => h.ipc.emitPollUpdate(h.pollId, { values: [...values] }));
    expect(scale).toHaveBeenCalledTimes(0);
    expect(format).toHaveBeenCalledTimes(0);

    const next = [...values];
    next[6] = 40000;
    act(() => h.ipc.emitPollUpdate(h.pollId, { values: next }));
    expect(scale).toHaveBeenCalledTimes(1);
    expect(format).toHaveBeenCalledTimes(1);
    const row = document.querySelector('[data-row="6"]') as HTMLElement;
    // 40000 on the default 0-65535 scale: 4 + 40000 / 65535 x 16 = 13.77
    expect(row.querySelector('[data-cell="scaled"]')).toHaveTextContent("13.77mA");
  });

  it("the grid itself does not render for an update, with the scaled column on", async () => {
    const h = await live125();
    const values = Array.from({ length: 125 }, (_, i) => i);
    act(() => h.ipc.emitPollUpdate(h.pollId, { values }));
    const mock = vi.mocked(useVirtualizer);
    mock.mockClear();
    for (let n = 1; n <= 20; n += 1) {
      act(() => h.ipc.emitPollUpdate(h.pollId, { values: values.map((v) => v + n) }));
    }
    expect(mock).toHaveBeenCalledTimes(0);
  });

  it("a change that is not about the scale (an alias) leaves the other rows alone", async () => {
    const h = await live125();
    act(() => h.ipc.emitPollUpdate(h.pollId, { values: Array.from({ length: 125 }, (_, i) => i) }));
    const scale = vi.mocked(scaleValue);
    scale.mockClear();
    await act(async () => {
      await h.ipc.setPollView(h.pollId, { aliases: [{ address: 9, alias: "PT-201" }] });
    });
    expect(scale).toHaveBeenCalledTimes(0);
  });

  it("a changed scale scales each visible row once", async () => {
    const h = await live125();
    act(() => h.ipc.emitPollUpdate(h.pollId, { values: Array.from({ length: 125 }, (_, i) => i) }));
    const grid = screen.getByRole("grid", { name: "Register values" });
    const rendered = within(grid).getAllByRole("row").length - 1;
    const scale = vi.mocked(scaleValue);
    scale.mockClear();
    await act(async () => {
      await h.rt.stores.scale
        .getState()
        .applyScale({ ...presetDefaults("current4to20"), decimals: 3 });
    });
    expect(scale.mock.calls.length).toBe(rendered);
  });

  it("no backend traffic is added by scaling: an update after a scale change sends nothing", async () => {
    const h = await live125();
    act(() => h.ipc.emitPollUpdate(h.pollId, { values: new Array(125).fill(1) }));
    const methods = ["setPollView", "updatePoll", "write", "setPollActive"] as const;
    const count = () => methods.map((m) => h.ipc.callsOf(m).length);
    const before = count();
    act(() => h.ipc.emitPollUpdate(h.pollId, { values: new Array(125).fill(2) }));
    expect(count()).toEqual(before);
  });
});
