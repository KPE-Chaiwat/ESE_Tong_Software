import { vi } from "vitest";

const { invoke, FakeChannel } = vi.hoisted(() => {
  class FakeChannel<T> {
    onmessage: ((message: T) => void) | undefined;
  }
  return { invoke: vi.fn(), FakeChannel };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  Channel: FakeChannel,
}));

import { createTauriModbusMasterIpc, IpcError } from "./modbus-master";
import type { Profile, SessionEvent } from "./modbus-master.types";

const ipc = createTauriModbusMasterIpc();

const profile: Profile = {
  schemaVersion: 1,
  name: "P",
  connection: { mode: "tcp", host: "h", port: 502, timeoutMs: 1000 },
  poll: { slaveId: 1, function: 3, startAddress: 0, quantity: 1, scanRateMs: 1000 },
  display: { format: "unsigned", addressBase: 0 },
  autoStartPoll: true,
};

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe("Tauri facade: command names and argument keys (BE-001)", () => {
  it.each([
    [
      "connect",
      () => ipc.connect(profile.connection),
      "mm_connect",
      { config: profile.connection },
    ],
    ["cancelConnect", () => ipc.cancelConnect(), "mm_cancel_connect", undefined],
    ["disconnect", () => ipc.disconnect(), "mm_disconnect", undefined],
    ["startPoll", () => ipc.startPoll(profile.poll), "mm_start_poll", { poll: profile.poll }],
    ["stopPoll", () => ipc.stopPoll(), "mm_stop_poll", undefined],
    [
      "write",
      () => ipc.write({ slaveId: 1, function: 6, address: 0, values: [1] }),
      "mm_write",
      { request: { slaveId: 1, function: 6, address: 0, values: [1] } },
    ],
    ["resetCounters", () => ipc.resetCounters(), "mm_reset_counters", undefined],
    ["listSerialPorts", () => ipc.listSerialPorts(), "mm_list_serial_ports", undefined],
    ["profilesList", () => ipc.profilesList(), "profiles_list", { toolId: "modbus-master" }],
    [
      "profilesGet",
      () => ipc.profilesGet("P"),
      "profiles_get",
      { toolId: "modbus-master", name: "P" },
    ],
    [
      "profilesSave",
      () => ipc.profilesSave(profile, true),
      "profiles_save",
      { toolId: "modbus-master", profile, overwrite: true },
    ],
    [
      "profilesRename",
      () => ipc.profilesRename("A", "B"),
      "profiles_rename",
      { toolId: "modbus-master", oldName: "A", newName: "B" },
    ],
    [
      "profilesDelete",
      () => ipc.profilesDelete("P"),
      "profiles_delete",
      { toolId: "modbus-master", name: "P" },
    ],
  ] as const)("%s calls %s", async (_name, run, command, args) => {
    await run();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[0]).toBe(command);
    expect(invoke.mock.calls[0]?.[1]).toEqual(args);
  });

  it("openSession passes a channel whose messages reach the callback", async () => {
    const snapshot = { state: "idle" };
    invoke.mockResolvedValue(snapshot);
    const seen: SessionEvent[] = [];
    await expect(ipc.openSession((e) => seen.push(e))).resolves.toBe(snapshot);
    expect(invoke.mock.calls[0]?.[0]).toBe("mm_open_session");
    const channel = invoke.mock.calls[0]?.[1].channel as InstanceType<
      typeof FakeChannel<SessionEvent>
    >;
    expect(channel).toBeInstanceOf(FakeChannel);
    const event = { type: "Counters", requests: 1, responses: 1, errors: 0, timeouts: 0 } as const;
    channel.onmessage?.(event);
    expect(seen).toEqual([event]);
  });

  it("turns an AppError rejection into an IpcError with its code", async () => {
    invoke.mockRejectedValue({ code: "invalidState", message: "Not connected" });
    await expect(ipc.disconnect()).rejects.toMatchObject({
      name: "IpcError",
      code: "invalidState",
      message: "Not connected",
    });
    await expect(ipc.disconnect()).rejects.toBeInstanceOf(IpcError);
  });

  it("turns a string rejection into an IpcError", async () => {
    invoke.mockRejectedValue("command mm_connect not found");
    await expect(ipc.connect(profile.connection)).rejects.toMatchObject({
      message: "command mm_connect not found",
    });
  });
});
