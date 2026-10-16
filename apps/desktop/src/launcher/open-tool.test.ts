import { vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));

import { modbusMasterManifest } from "@/tools/modbus-master/manifest";
import { openTool } from "./open-tool";

const globals = window as unknown as Record<string, unknown>;

afterEach(() => {
  invoke.mockReset();
  vi.unstubAllGlobals();
  delete globals.__TAURI_INTERNALS__;
});

describe("openTool", () => {
  it("inside Tauri it calls window_open_tool with the tool id", async () => {
    globals.__TAURI_INTERNALS__ = {};
    invoke.mockResolvedValue("modbus-master-1");
    await openTool(modbusMasterManifest);
    expect(invoke).toHaveBeenCalledWith("window_open_tool", { toolId: "modbus-master" });
  });

  it("turns a rejection into an IpcError with the backend message", async () => {
    globals.__TAURI_INTERNALS__ = {};
    invoke.mockRejectedValue({ code: "unknownTool", message: "Unknown tool.", field: null });
    await expect(openTool(modbusMasterManifest)).rejects.toMatchObject({
      code: "unknownTool",
      message: "Unknown tool.",
    });
  });

  it("in a plain browser it opens the route in a new tab and never calls the backend", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    await openTool(modbusMasterManifest);
    expect(open).toHaveBeenCalledWith(modbusMasterManifest.route, "_blank");
    expect(invoke).not.toHaveBeenCalled();
  });
});
