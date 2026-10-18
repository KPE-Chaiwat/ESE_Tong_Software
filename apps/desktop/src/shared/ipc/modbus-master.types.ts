// The DTO barrel of the multi-poll Modbus Master facade (FE-002). Every type is generated from Rust
// (`shared/bindings`, ts-rs, never edited by hand); this module re-exports them and adds the few
// derived helper types the frontend needs. The former TEMP types are gone (BE-002 final contract).
import type {
  ConnectionConfig,
  DisplaySettings,
  PollDefinition,
  PollViewEvent,
  SessionEvent,
  WriteRequest,
} from "@/shared/bindings";

export type {
  AliasEntry,
  AppError,
  AppErrorCode,
  AppInfo,
  ArrangeLayout,
  ArrangeResult,
  ArrangeTarget,
  BadResponseDetail,
  BadResponseKind,
  ConnectionConfig,
  ConnectionCounters,
  ConnectionState,
  ConnectionStatus,
  Counters,
  DetachReason,
  DisplaySettings,
  ExceptionCode,
  LogicalPoint,
  LogicalRect,
  MonitorInfo,
  Parity,
  PollConfig,
  PollConfigInput,
  PollCounters,
  PollDefinition,
  PollHostKind,
  PollId,
  PollProfile,
  PollState,
  PollStatus,
  PollSummary,
  PollUpdate,
  PollViewEvent,
  PollViewPlacement,
  PollViewSettings,
  PollViewSnapshot,
  PopOutAnchor,
  Prefs,
  Profile,
  ProfileSummary,
  ReasonKind,
  ReasonPhase,
  ScaleOutOfRange,
  ScaleOverride,
  ScalePreset,
  ScaleSettings,
  SerialPortInfo,
  SessionEvent,
  SessionReason,
  SessionSnapshot,
  ShowPollPlacement,
  SubWindowState,
  TrafficDirection,
  TrafficFrame,
  TrafficOrigin,
  ValueColumns,
  ValueFormat,
  ViewToken,
  WindowPlacement,
  WorkspaceItem,
  WorkspaceLayout,
  WorkspaceProfile,
  WorkspaceRect,
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

/** The channel events, one alias per variant (`type` is the discriminant, the payload is flat). */
type SessionVariant<T extends SessionEvent["type"]> = Extract<SessionEvent, { type: T }>;
type ViewVariant<T extends PollViewEvent["type"]> = Extract<PollViewEvent, { type: T }>;

export type ConnectionStateChangedEvent = SessionVariant<"ConnectionStateChanged">;
export type PollStateChangedEvent = SessionVariant<"PollStateChanged">;
export type PollListChangedEvent = SessionVariant<"PollListChanged">;
export type TrafficFramesEvent = SessionVariant<"TrafficFrames">;
export type CountersEvent = SessionVariant<"Counters">;
export type RevealPollEvent = SessionVariant<"RevealPoll">;
export type SaveRequestedEvent = SessionVariant<"SaveRequested">;
export type ShowTrafficEvent = SessionVariant<"ShowTraffic">;
export type PrefsChangedEvent = SessionVariant<"PrefsChanged">;
export type PollUpdateEvent = ViewVariant<"PollUpdate">;
export type PollConfigChangedEvent = ViewVariant<"PollConfigChanged">;
export type PollCountersEvent = ViewVariant<"PollCounters">;
export type PollRemovedEvent = ViewVariant<"PollRemoved">;
export type ProfileNameChangedEvent = ViewVariant<"ProfileNameChanged">;
export type ViewDetachedEvent = ViewVariant<"ViewDetached">;
export type HandoffRequestedEvent = ViewVariant<"HandoffRequested">;
