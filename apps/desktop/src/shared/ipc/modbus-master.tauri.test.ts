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

import { IpcError } from "./errors";
import { createTauriModbusMasterIpc } from "./modbus-master";
import { pollConfigInput } from "./modbus-master.fake";
import type {
  PollViewEvent,
  PollViewSettings,
  Profile,
  SessionEvent,
  WorkspaceLayout,
  WorkspaceRect,
  WriteRequest,
} from "./modbus-master.types";

const ipc = createTauriModbusMasterIpc();

const tcp = { mode: "tcp", host: "h", port: 502, timeoutMs: 1000 } as const;
const definition = {
  slaveId: 1,
  function: 3,
  startAddress: 0,
  quantity: 1,
  scanRateMs: 1000,
} as const;
const input = pollConfigInput({ name: "A" });
const request: WriteRequest = { slaveId: 1, function: 6, address: 0, values: [1] };
const rect: WorkspaceRect = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  z: 1,
  state: "normal",
  restore: null,
};
const view: PollViewSettings = {
  display: input.display,
  scale: null,
  scaleOverrides: [],
  valueColumns: "raw",
  aliases: [{ address: 0, alias: "PT-201" }],
  hasUnappliedEdits: false,
};
const layout: WorkspaceLayout = {
  items: [],
  minimizedOrder: [],
  tileMode: false,
  compact: false,
  sidebarWidth: 280,
  sidebarCollapsed: false,
  trafficExpanded: false,
  trafficHeight: null,
};
const profile = { schemaVersion: 2, name: "P" } as unknown as Profile;

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe("Tauri facade: command names and argument keys (DES-002 8.2)", () => {
  it.each([
    ["connect", () => ipc.connect(tcp), "mm_connect", { config: tcp }],
    ["cancelConnect", () => ipc.cancelConnect(), "mm_cancel_connect", undefined],
    ["disconnect", () => ipc.disconnect(), "mm_disconnect", undefined],
    [
      "setAutoStartPoll",
      () => ipc.setAutoStartPoll(false),
      "mm_set_auto_start_poll",
      { enabled: false },
    ],
    ["listSerialPorts", () => ipc.listSerialPorts(), "mm_list_serial_ports", undefined],
    ["addPoll", () => ipc.addPoll(input, "workspace"), "mm_add_poll", { input, host: "workspace" }],
    ["duplicatePoll", () => ipc.duplicatePoll(3), "mm_duplicate_poll", { pollId: 3 }],
    ["removePoll", () => ipc.removePoll(3), "mm_remove_poll", { pollId: 3 }],
    [
      "updatePoll",
      () => ipc.updatePoll(3, definition),
      "mm_update_poll",
      { pollId: 3, definition },
    ],
    ["renamePoll", () => ipc.renamePoll(3, "B"), "mm_rename_poll", { pollId: 3, name: "B" }],
    ["reorderPolls", () => ipc.reorderPolls([2, 1]), "mm_reorder_polls", { order: [2, 1] }],
    [
      "setPollActive",
      () => ipc.setPollActive(3, true),
      "mm_set_poll_active",
      { pollId: 3, active: true },
    ],
    [
      "setAllPollsActive",
      () => ipc.setAllPollsActive(false),
      "mm_set_all_polls_active",
      { active: false },
    ],
    ["setPollView", () => ipc.setPollView(3, view), "mm_set_poll_view", { pollId: 3, view }],
    ["write", () => ipc.write(request, 3), "mm_write", { request, pollId: 3 }],
    ["write (no poll)", () => ipc.write(request, null), "mm_write", { request, pollId: null }],
    ["resetCounters", () => ipc.resetCounters(3), "mm_reset_counters", { pollId: 3 }],
    ["resetCounters (all)", () => ipc.resetCounters(null), "mm_reset_counters", { pollId: null }],
    [
      "detachPollView",
      () => ipc.detachPollView(3, 9),
      "mm_detach_poll_view",
      { pollId: 3, viewToken: 9 },
    ],
    ["showPoll", () => ipc.showPoll(3, null), "mm_show_poll", { pollId: 3, placement: null }],
    [
      "showPoll (placement)",
      () => ipc.showPoll(3, { workspaceRect: rect }),
      "mm_show_poll",
      { pollId: 3, placement: { workspaceRect: rect } },
    ],
    [
      "popOutPoll",
      () => ipc.popOutPoll(3, { kind: "cursor", grabOffset: { x: 1, y: 2 } }, "{}"),
      "mm_pop_out_poll",
      { pollId: 3, anchor: { kind: "cursor", grabOffset: { x: 1, y: 2 } }, handoff: "{}" },
    ],
    [
      "dockPoll",
      () => ipc.dockPoll(3, null, true, rect),
      "mm_dock_poll",
      { pollId: 3, handoff: null, requestHandoff: true, workspaceRect: rect },
    ],
    [
      "provideHandoff",
      () => ipc.provideHandoff(3, "{}"),
      "mm_provide_handoff",
      { pollId: 3, handoff: "{}" },
    ],
    [
      "closePollView",
      () => ipc.closePollView(3, true),
      "mm_close_poll_view",
      { pollId: 3, keep: true },
    ],
    ["showPollWindows", () => ipc.showPollWindows(), "mm_show_poll_windows", undefined],
    [
      "focusConnectionWindow",
      () => ipc.focusConnectionWindow(),
      "mm_focus_connection_window",
      undefined,
    ],
    [
      "setWorkspaceLayout",
      () => ipc.setWorkspaceLayout(layout),
      "mm_set_workspace_layout",
      { layout },
    ],
    ["setCompactMode", () => ipc.setCompactMode(true), "mm_set_compact_mode", { enabled: true }],
    [
      "setAskOnPollClose",
      () => ipc.setAskOnPollClose(false),
      "mm_set_ask_on_poll_close",
      { enabled: false },
    ],
    [
      "arrangePollWindows",
      () => ipc.arrangePollWindows("tile", { kind: "monitor", monitorId: "m1" }),
      "mm_arrange_poll_windows",
      { layout: "tile", target: { kind: "monitor", monitorId: "m1" } },
    ],
    ["setProfileName", () => ipc.setProfileName("P"), "mm_set_profile_name", { name: "P" }],
    ["requestSave", () => ipc.requestSave(), "mm_request_save", { saveAs: false }],
    ["requestSave (Save as)", () => ipc.requestSave(true), "mm_request_save", { saveAs: true }],
    ["showTraffic", () => ipc.showTraffic(3), "mm_show_traffic", { pollId: 3 }],
    ["applyProfile", () => ipc.applyProfile(profile), "mm_apply_profile", { profile }],
    [
      "exportProfile",
      () => ipc.exportProfile(),
      "mm_export_profile",
      { name: null, connection: null },
    ],
    [
      "exportProfile (name, connection)",
      () => ipc.exportProfile("P", tcp),
      "mm_export_profile",
      { name: "P", connection: tcp },
    ],
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
  ] as const)("%s", async (_name, call, command, args) => {
    await call();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(command, args);
  });
});

describe("Tauri facade: channels", () => {
  it("openSession passes a Channel whose messages reach the callback", async () => {
    const seen: SessionEvent[] = [];
    await ipc.openSession((e) => seen.push(e));
    const [command, args] = invoke.mock.calls[0] as [
      string,
      { channel: InstanceType<typeof FakeChannel<SessionEvent>> },
    ];
    expect(command).toBe("mm_open_session");
    args.channel.onmessage?.({ type: "SaveRequested", saveAs: true });
    expect(seen).toEqual([{ type: "SaveRequested", saveAs: true }]);
  });

  it("attachPollView passes pollId, host and a Channel for the poll view events", async () => {
    const seen: PollViewEvent[] = [];
    await ipc.attachPollView(3, "native", (e) => seen.push(e));
    const [command, args] = invoke.mock.calls[0] as [
      string,
      { pollId: number; host: string; channel: InstanceType<typeof FakeChannel<PollViewEvent>> },
    ];
    expect(command).toBe("mm_attach_poll_view");
    expect(args).toMatchObject({ pollId: 3, host: "native" });
    args.channel.onmessage?.({ type: "HandoffRequested", pollId: 3 });
    expect(seen).toEqual([{ type: "HandoffRequested", pollId: 3 }]);
  });
});

describe("Tauri facade: errors", () => {
  it("turns an AppError rejection into an IpcError with code and field", async () => {
    invoke.mockRejectedValue({ code: "validation", message: "bad order", field: "order" });
    const error = await ipc.reorderPolls([1]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IpcError);
    expect(error).toMatchObject({ code: "validation", message: "bad order", field: "order" });
  });

  it("turns a string rejection into an IpcError", async () => {
    invoke.mockRejectedValue("denied");
    await expect(ipc.requestSave()).rejects.toMatchObject({ message: "denied", code: "unknown" });
  });
});
