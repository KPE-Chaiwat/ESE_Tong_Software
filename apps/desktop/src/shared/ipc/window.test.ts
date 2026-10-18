import { vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));

import { IpcError } from "./errors";
import type { MonitorInfo } from "./modbus-master.types";
import { createFakeWindowIpc, createTauriWindowIpc } from "./window";

const monitor: MonitorInfo = {
  id: "m1",
  label: "Display 1",
  name: "\\\\.\\DISPLAY1",
  primary: true,
  workArea: { x: 0, y: 0, width: 1920, height: 1032 },
  scaleFactor: 1.25,
};

beforeEach(() => {
  invoke.mockReset();
});

describe("listMonitors", () => {
  it("invokes app_list_monitors", async () => {
    invoke.mockResolvedValue([monitor]);
    await expect(createTauriWindowIpc().listMonitors()).resolves.toEqual([monitor]);
    expect(invoke).toHaveBeenCalledWith("app_list_monitors");
  });

  it("rejects with an IpcError", async () => {
    invoke.mockRejectedValue({ code: "internal", message: "no displays", field: null });
    const error = await createTauriWindowIpc()
      .listMonitors()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IpcError);
    expect(error).toMatchObject({ message: "no displays", code: "internal" });
  });

  it("the fake returns a scriptable list (a copy) and can fail", async () => {
    const fake = createFakeWindowIpc();
    const first = await fake.listMonitors();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ label: "Display 1", primary: true });
    expect(first[0]?.workArea).toEqual({ x: 0, y: 0, width: 1920, height: 1032 });
    const area = first[0]?.workArea;
    if (area) area.width = 1;
    expect((await fake.listMonitors())[0]?.workArea.width).toBe(1920);
    fake.monitors = [monitor, { ...monitor, id: "m2", label: "Display 2", primary: false }];
    expect((await fake.listMonitors()).map((m) => m.label)).toEqual(["Display 1", "Display 2"]);
    fake.monitorsError = "boom";
    await expect(fake.listMonitors()).rejects.toThrow("boom");
  });
});
