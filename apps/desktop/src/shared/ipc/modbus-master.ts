// The Modbus Master IPC facade. Together with `window.ts` and `index.ts` this is the only code that
// touches Tauri `invoke` / `Channel`. Stores take a `ModbusMasterIpc` as a dependency; tests and the
// dev mode replace it with the fake in `modbus-master.fake.ts`.
import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  ConnectionConfig,
  PollDefinition,
  Profile,
  ProfileSummary,
  SerialPortInfo,
  SessionEvent,
  SessionSnapshot,
  WriteRequest,
  WriteResult,
} from "./modbus-master.types";

export const MODBUS_MASTER_TOOL_ID = "modbus-master";

/** A command rejection. `code` is the stable `AppError.code` from the backend when there is one. */
export class IpcError extends Error {
  readonly code: string;
  /** For `validation` errors: the DTO input field the backend objected to (`AppError.field`). */
  readonly field: string | null;

  constructor(message: string, code = "unknown", field: string | null = null) {
    super(message);
    this.name = "IpcError";
    this.code = code;
    this.field = field;
  }
}

/** Turns whatever `invoke` rejected with (an `AppError` object or a string) into an `IpcError`. */
export function toIpcError(e: unknown): IpcError {
  if (e instanceof IpcError) return e;
  if (typeof e === "string") return new IpcError(e);
  if (e && typeof e === "object") {
    const { message, code, field } = e as { message?: unknown; code?: unknown; field?: unknown };
    if (typeof message === "string") {
      return new IpcError(
        message,
        typeof code === "string" ? code : "unknown",
        typeof field === "string" ? field : null,
      );
    }
  }
  if (e instanceof Error) return new IpcError(e.message);
  return new IpcError("Unknown error");
}

export type Unsubscribe = () => void;

export interface ModbusMasterIpc {
  /** Attaches this window's ordered event channel and returns the current snapshot. */
  openSession(onEvent: (event: SessionEvent) => void): Promise<SessionSnapshot>;
  listSerialPorts(): Promise<SerialPortInfo[]>;
  connect(config: ConnectionConfig): Promise<void>;
  cancelConnect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Starts, resumes or replaces the running poll. */
  startPoll(definition: PollDefinition): Promise<void>;
  /** Pause. */
  stopPoll(): Promise<void>;
  write(request: WriteRequest): Promise<WriteResult>;
  resetCounters(): Promise<void>;
  profilesList(): Promise<ProfileSummary[]>;
  profilesGet(name: string): Promise<Profile>;
  profilesSave(profile: Profile, overwrite: boolean): Promise<void>;
  profilesRename(oldName: string, newName: string): Promise<void>;
  profilesDelete(name: string): Promise<void>;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    throw toIpcError(e);
  }
}

// Argument keys match the Rust parameter names in src-tauri/src/commands (Tauri maps camelCase keys
// to snake_case): config, poll, request, toolId, profile, overwrite, oldName, newName, name.
export function createTauriModbusMasterIpc(): ModbusMasterIpc {
  const toolId = MODBUS_MASTER_TOOL_ID;
  return {
    openSession(onEvent) {
      const channel = new Channel<SessionEvent>();
      channel.onmessage = onEvent;
      return call<SessionSnapshot>("mm_open_session", { channel });
    },
    listSerialPorts: () => call<SerialPortInfo[]>("mm_list_serial_ports"),
    connect: (config) => call<void>("mm_connect", { config }),
    cancelConnect: () => call<void>("mm_cancel_connect"),
    disconnect: () => call<void>("mm_disconnect"),
    startPoll: (definition) => call<void>("mm_start_poll", { poll: definition }),
    stopPoll: () => call<void>("mm_stop_poll"),
    write: (request) => call<WriteResult>("mm_write", { request }),
    resetCounters: () => call<void>("mm_reset_counters"),
    profilesList: () => call<ProfileSummary[]>("profiles_list", { toolId }),
    profilesGet: (name) => call<Profile>("profiles_get", { toolId, name }),
    profilesSave: (profile, overwrite) =>
      call<void>("profiles_save", { toolId, profile, overwrite }),
    profilesRename: (oldName, newName) =>
      call<void>("profiles_rename", { toolId, oldName, newName }),
    profilesDelete: (name) => call<void>("profiles_delete", { toolId, name }),
  };
}
