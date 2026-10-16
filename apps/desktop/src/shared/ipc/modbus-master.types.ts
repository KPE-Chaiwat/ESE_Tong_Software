// The Modbus Master DTOs are generated from Rust (ts-rs) into `shared/bindings`. This module
// re-exports them and adds the few derived helper types the frontend needs. Never hand-write a
// DTO here: change the Rust type and run `pnpm bindings`.
import type {
  ConnectionConfig,
  DisplaySettings,
  PollDefinition,
  SessionEvent,
  WriteRequest,
} from "@/shared/bindings";

export type {
  AppError,
  AppErrorCode,
  BadResponseDetail,
  BadResponseKind,
  ConnectionConfig,
  Counters,
  DisplaySettings,
  ExceptionCode,
  Parity,
  PollDefinition,
  PollUpdate,
  Profile,
  ProfileSummary,
  ReasonKind,
  ReasonPhase,
  SerialPortInfo,
  SessionEvent,
  SessionReason,
  SessionSnapshot,
  SessionState,
  StateChanged,
  TrafficDirection,
  TrafficFrame,
  TrafficFrames,
  ValueFormat,
  WriteRequest,
  WriteResult,
} from "@/shared/bindings";

// ---- derived from the generated types ----
export type ConnectionMode = ConnectionConfig["mode"];
export type TcpConnectionConfig = Extract<ConnectionConfig, { mode: "tcp" }>;
export type RtuConnectionConfig = Extract<ConnectionConfig, { mode: "rtu" }>;
export type DataBits = RtuConnectionConfig["dataBits"];
export type StopBits = RtuConnectionConfig["stopBits"];
export type ReadFunction = PollDefinition["function"];
export type WriteFunction = WriteRequest["function"];
export type AddressBase = DisplaySettings["addressBase"];

/** The channel events, one alias per variant (`type` is the discriminant). */
export type StateChangedEvent = Extract<SessionEvent, { type: "StateChanged" }>;
export type PollUpdateEvent = Extract<SessionEvent, { type: "PollUpdate" }>;
export type TrafficFramesEvent = Extract<SessionEvent, { type: "TrafficFrames" }>;
export type CountersEvent = Extract<SessionEvent, { type: "Counters" }>;
