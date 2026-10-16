import { invoke } from "@tauri-apps/api/core";
import { type Mock, vi } from "vitest";
import { getAppInfo } from "./index";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("ipc", () => {
  it("getAppInfo invokes the app_info command", async () => {
    (invoke as Mock).mockResolvedValue({ name: "ESEfact", version: "0.1.0" });

    await expect(getAppInfo()).resolves.toEqual({ name: "ESEfact", version: "0.1.0" });
    expect(invoke).toHaveBeenCalledWith("app_info");
  });
});
