import type {
  AddressBase,
  ConnectionConfig,
  PollDefinition,
  Profile,
  ValueFormat,
} from "@/shared/ipc/modbus-master.types";

export const PROFILE_SCHEMA_VERSION = 1;

/** TCP defaults from DES-001 section 1: empty host, port 502, timeout 1000 ms. */
export function defaultTcpConnection(): ConnectionConfig {
  return { mode: "tcp", host: "", port: 502, timeoutMs: 1000 };
}

/** RTU defaults from DES-001 section 1: 9600, 8, Even, 1. */
export function defaultRtuConnection(): ConnectionConfig {
  return {
    mode: "rtu",
    port: "",
    baud: 9600,
    dataBits: 8,
    parity: "even",
    stopBits: 1,
    timeoutMs: 1000,
  };
}

/** Slave 1, FC03, protocol start 0, quantity 10, scan rate 1000 ms. */
export function defaultPoll(): PollDefinition {
  return { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 };
}

export interface ConfigData {
  connection: ConnectionConfig;
  poll: PollDefinition;
  autoStartPoll: boolean;
  display: { format: ValueFormat; addressBase: AddressBase };
  /** null = Untitled. */
  profileName: string | null;
  /** Serialized profile content at the last load or save. null = never saved or loaded. */
  savedSnapshot: string | null;
}

export function initialConfigData(): ConfigData {
  return {
    connection: defaultTcpConnection(),
    poll: defaultPoll(),
    autoStartPoll: true,
    display: { format: "unsigned", addressBase: 0 },
    profileName: null,
    savedSnapshot: null,
  };
}

/** Stable serialization of the saved content (the profile name is not part of it). */
export function serializeContent(
  c: Pick<ConfigData, "connection" | "poll" | "autoStartPoll" | "display">,
): string {
  return JSON.stringify({
    connection: c.connection,
    poll: c.poll,
    display: { format: c.display.format, addressBase: c.display.addressBase },
    autoStartPoll: c.autoStartPoll,
  });
}

/** Untitled is dirty only after a change, so it is compared with the defaults. */
export function isDirty(c: ConfigData): boolean {
  const baseline = c.savedSnapshot ?? serializeContent(initialConfigData());
  return serializeContent(c) !== baseline;
}

export function toProfile(c: ConfigData, name?: string): Profile {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    name: name ?? c.profileName ?? "",
    connection: c.connection,
    poll: c.poll,
    display: { format: c.display.format, addressBase: c.display.addressBase },
    autoStartPoll: c.autoStartPoll,
  };
}

export function fromProfile(profile: Profile): ConfigData {
  const data: ConfigData = {
    connection: profile.connection,
    poll: profile.poll,
    autoStartPoll: profile.autoStartPoll,
    display: { format: profile.display.format, addressBase: profile.display.addressBase },
    profileName: profile.name,
    savedSnapshot: null,
  };
  return { ...data, savedSnapshot: serializeContent(data) };
}

/** Short summary for the S5 confirm text: `TCP 192.168.1.10:502` or `COM3`. */
export function connectionSummary(c: ConnectionConfig): string {
  return c.mode === "tcp" ? `TCP ${c.host}:${c.port}` : `RTU ${c.port}`;
}
