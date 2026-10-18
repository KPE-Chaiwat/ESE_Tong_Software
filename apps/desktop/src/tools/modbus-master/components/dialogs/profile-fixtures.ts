// Profile builders for the tests of the profile flow (schema 2, DES-002 6.1).
import type { PollProfile, Profile } from "@/shared/ipc/modbus-master.types";

export function pollProfile(name: string, patch: Partial<PollProfile> = {}): PollProfile {
  return {
    name,
    definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
    active: true,
    display: {
      format: "unsigned",
      addressBase: 0,
      showAlias: true,
      copyAlias: false,
      swapBytes: false,
      reverseWords: false,
    },
    colorRules: [],
    scale: null,
    scaleOverrides: [],
    valueColumns: "raw",
    aliases: [],
    view: { host: "workspace", open: true, workspace: null, native: null },
    ...patch,
  };
}

export function profileV2(
  name: string,
  polls: PollProfile[] = [pollProfile("Poll 1")],
  patch: Partial<Profile> = {},
): Profile {
  return {
    schemaVersion: 3,
    name,
    connection: { mode: "tcp", host: "10.0.0.5", port: 502, timeoutMs: 1000 },
    autoStartPoll: true,
    connectionWindow: null,
    workspace: {
      tileMode: false,
      compact: false,
      sidebarWidth: 280,
      sidebarCollapsed: false,
      trafficExpanded: false,
      trafficHeight: null,
      minimizedOrder: [],
    },
    polls,
    migratedFrom: null,
    ...patch,
  };
}
