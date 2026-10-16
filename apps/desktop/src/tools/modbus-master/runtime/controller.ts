// Cross-store commands of one Modbus Master window: the things a toolbar button, a shortcut or a
// dialog does that touch several stores (validation, session, config, profiles, dialogs).
// Plain TypeScript, no React, so every flow is unit tested with the IPC fake.
import { MODBUS_MASTER_TOOL_ID, toIpcError } from "@/shared/ipc/modbus-master";
import type { Profile, SessionState } from "@/shared/ipc/modbus-master.types";
import type { CloseDecision, WindowIpc } from "@/shared/ipc/window";
import { toDisplayAddress } from "../lib/address";
import { formatBit, formatHexBytes, formatValue } from "../lib/format";
import { isWritableRead } from "../lib/functions";
import { connectionSummary, isDirty } from "../store/config.logic";
import type { ConfirmSpec } from "../store/confirm.store";
import { actionsFor, isLinkUp, isPollRunning } from "../store/session.logic";
import { framesToTsv } from "../store/traffic.logic";
import { profileNameSchema, validate } from "../validation/schemas";
import type { GatewayHolder } from "./gateway";
import type { ModbusMasterStores } from "./stores";

export interface Clipboard {
  writeText(text: string): Promise<void>;
}

export interface ControllerDeps {
  stores: ModbusMasterStores;
  gateway: GatewayHolder;
  windowIpc: WindowIpc;
  clipboard?: Clipboard;
  /** How long to wait for the backend to confirm a disconnect before loading a profile. */
  disconnectTimeoutMs?: number;
}

export type SaveResult = { ok: true } | { ok: false; message: string };

export interface ModbusMasterController {
  // session
  connect(): Promise<void>;
  cancelConnect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Ctrl+L: Connect, Cancel, Disconnect or Reconnect by state. */
  toggleConnection(): Promise<void>;
  dismiss(): Promise<void>;
  // poll
  /** Start (connected) or Resume (paused) with the validated poll form. */
  startOrResume(): Promise<void>;
  pause(): Promise<void>;
  /** Ctrl+P: Start, Pause or Resume by state. */
  togglePoll(): Promise<void>;
  /** Apply: restarts a running poll, otherwise only stores the definition (DES-001 2.2). */
  applyPoll(): Promise<void>;
  // table, write, copy
  openWrite(): void;
  openWriteForRow(index: number): void;
  copyRows(): Promise<void>;
  copyFrames(): Promise<void>;
  /** "Copy bytes" of the detail strip: the selected frame as space-separated hex. */
  copyFrameBytes(): Promise<void>;
  // profiles
  /** `Ctrl+S`. */
  saveProfile(): Promise<boolean>;
  /** Opens Save as (S4), unless the setup form is invalid (then a toast explains). */
  openSaveAs(): Promise<boolean>;
  /** Save as with the Replace confirm. */
  saveProfileAs(name: string): Promise<SaveResult>;
  loadProfile(name: string): Promise<boolean>;
  /** The user asked to close the window. */
  requestClose(): Promise<CloseDecision>;
  newWindow(): Promise<void>;
  /** Stops listening to the session. */
  dispose(): void;
}

const SAVE_CHANGES_BUTTONS = [
  { id: "save", label: "Save" },
  { id: "discard", label: "Don't save", variant: "outline" },
  { id: "cancel", label: "Cancel", variant: "outline" },
] as const;

export function createController(deps: ControllerDeps): ModbusMasterController {
  const { stores, gateway, windowIpc } = deps;
  const {
    session,
    config,
    layout,
    pollData,
    selection,
    traffic,
    profiles,
    dialogs,
    confirm,
    toasts,
  } = stores;
  const clipboard: Clipboard = deps.clipboard ?? {
    writeText: (text) => navigator.clipboard.writeText(text),
  };

  const sessionState = (): SessionState => session.getState().state;

  /** A failure nobody awaits: show it instead of leaving an unhandled rejection (REV-002 m8). */
  function reportError(what: string, e: unknown) {
    toasts
      .getState()
      .show(`${what}: ${toIpcError(e).message}`, { tone: "error", durationMs: 4000 });
  }

  /** The connection the session actually has, not the draft in the form. */
  const activeConnection = () => session.getState().connection ?? config.getState().connection;

  /** Opens the setup panel so the invalid field the form just focused is visible. */
  const revealSetup = () => {
    if (!layout.getState().setupOpen) layout.getState().toggleSetup();
  };

  function waitForState(
    predicate: (s: SessionState) => boolean,
    timeoutMs = deps.disconnectTimeoutMs ?? 5000,
  ): Promise<boolean> {
    if (predicate(sessionState())) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, timeoutMs);
      const unsubscribe = session.subscribe((s) => {
        if (predicate(s.state)) {
          clearTimeout(timer);
          unsubscribe();
          resolve(true);
        }
      });
    });
  }

  // T2: a new link starts polling by itself when "Start polling when connected" is on and the poll
  // input is valid.
  const unsubscribeAutoStart = session.subscribe((state, prev) => {
    if (prev.state === "connecting" && state.state === "connected") {
      if (!config.getState().autoStartPoll) return;
      const def = gateway.current.peekPoll();
      if (def) {
        config.getState().setPoll(def);
        void session.getState().startPoll(def);
      }
    }
  });

  async function connect(): Promise<void> {
    if (!actionsFor(sessionState()).connect) return;
    const cfg = await gateway.current.validateConnection();
    if (!cfg) {
      revealSetup();
      return;
    }
    config.getState().setConnection(cfg);
    await session.getState().connect(cfg);
  }

  async function startOrResume(): Promise<void> {
    const state = sessionState();
    if (state !== "connected" && state !== "paused") return;
    const def = await gateway.current.validatePoll();
    if (!def) {
      revealSetup();
      return;
    }
    config.getState().setPoll(def);
    await session.getState().startPoll(def);
  }

  async function pause(): Promise<void> {
    await session.getState().stopPoll();
  }

  async function applyPoll(): Promise<void> {
    const def = await gateway.current.validatePoll();
    if (!def) {
      revealSetup();
      return;
    }
    // "Changed" is relative to the definition the values on screen belong to.
    const shown = pollData.getState().definition;
    const changed = shown !== null && JSON.stringify(def) !== JSON.stringify(shown);
    config.getState().setPoll(def);
    const state = sessionState();
    if (isPollRunning(state)) {
      await session.getState().startPoll(def);
    } else if (state === "paused" && changed) {
      pollData.getState().clear("settingsChanged");
    }
  }

  // ---- write ----
  function prefillFor(index: number | null) {
    const def = pollData.getState().definition ?? config.getState().poll;
    const base = {
      pollFunction: def.function,
      slaveId: def.slaveId,
      address: def.startAddress + (index ?? 0),
    };
    const raw = index === null ? undefined : pollData.getState().values?.[index];
    return raw === undefined ? base : { ...base, raw };
  }

  function openWrite(): void {
    if (!isLinkUp(sessionState())) return;
    const focused = selection.getState().focused;
    stores.write.getState().openFor(prefillFor(focused));
  }

  function openWriteForRow(index: number): void {
    const def = pollData.getState().definition ?? config.getState().poll;
    if (!isWritableRead(def.function)) {
      toasts.getState().show("Discrete inputs and input registers are read-only.");
      return;
    }
    if (!isLinkUp(sessionState())) return;
    stores.write.getState().openFor(prefillFor(index));
  }

  // ---- copy ----
  /** Writes to the clipboard. A refusal (no permission, no focus) is shown, not left unhandled. */
  async function copy(text: string): Promise<boolean> {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      toasts
        .getState()
        .show("Could not copy to the clipboard.", { tone: "error", durationMs: 4000 });
      return false;
    }
  }

  async function copyRows(): Promise<void> {
    const { values, definition, kind } = pollData.getState();
    const rows = selection.getState().selectedRows();
    if (!values || !definition || rows.length === 0) return;
    const { addressBase, format } = config.getState().display;
    const lines = rows.map((i) => {
      const raw = values[i] ?? 0;
      const shown = kind === "bits" ? formatBit(raw) : formatValue(raw, format);
      return `${toDisplayAddress(definition.startAddress + i, addressBase)}\t${shown}`;
    });
    if (!(await copy(lines.join("\n")))) return;
    toasts.getState().show(rows.length === 1 ? "Copied 1 row." : `Copied ${rows.length} rows.`);
  }

  /** Single-frame selection: copies the selected frame, and does nothing without one. */
  async function copyFrames(): Promise<void> {
    const { frames, selectedSeq, indexOfSeq } = traffic.getState();
    if (selectedSeq === null) return;
    const frame = frames.get(indexOfSeq(selectedSeq));
    if (!frame) return;
    if (!(await copy(framesToTsv([frame])))) return;
    toasts.getState().show("Copied 1 frame.");
  }

  async function copyFrameBytes(): Promise<void> {
    const { frames, selectedSeq, indexOfSeq } = traffic.getState();
    if (selectedSeq === null) return;
    const frame = frames.get(indexOfSeq(selectedSeq));
    if (!frame) return;
    if (!(await copy(formatHexBytes(frame.bytes)))) return;
    toasts.getState().show(`Copied ${frame.bytes.length} bytes.`);
  }

  // ---- profiles ----
  async function askSaveChanges(): Promise<"save" | "discard" | "cancel"> {
    const name = config.getState().profileName;
    const spec: ConfirmSpec = {
      title: "Save changes?",
      body:
        name === null
          ? "Save this setup as a profile before closing?"
          : `Save changes to "${name}" before closing?`,
      buttons: [...SAVE_CHANGES_BUTTONS],
      defaultId: "save",
      cancelId: "cancel",
    };
    return (await confirm.getState().ask(spec)) as "save" | "discard" | "cancel";
  }

  /** Validates both forms before a profile is written. */
  async function formsValid(): Promise<boolean> {
    const valid = await gateway.current.validateAll();
    if (!valid) {
      revealSetup();
      toasts
        .getState()
        .show("Fix the highlighted fields before saving.", { tone: "error", durationMs: 4000 });
      return false;
    }
    config.getState().setConnection(valid.connection);
    config.getState().setPoll(valid.poll);
    return true;
  }

  async function writeProfile(profile: Profile, overwrite: boolean): Promise<SaveResult> {
    const result = await profiles.getState().save(profile, overwrite);
    if (!result.ok) return { ok: false, message: result.message };
    config.getState().markSaved(profile.name);
    return { ok: true };
  }

  /** Save as (S4). Blocked while the setup form is invalid (DES-001 3.5). */
  async function openSaveAs(): Promise<boolean> {
    if (!(await formsValid())) return false;
    return dialogs.getState().requestSaveAs();
  }

  async function saveProfile(): Promise<boolean> {
    const name = config.getState().profileName;
    if (name === null) return openSaveAs();
    if (!(await formsValid())) return false;
    // Overwrite: the profile may have been renamed or deleted in another window (DES-001 S3).
    const result = await writeProfile(config.getState().toProfile(name), true);
    if (!result.ok) reportError("Could not save profile", new Error(result.message));
    return result.ok;
  }

  async function saveProfileAs(name: string): Promise<SaveResult> {
    const checked = validate(profileNameSchema([]), name);
    if (!checked.ok) return { ok: false, message: checked.errors.name ?? "Invalid name." };
    if (!(await formsValid())) return { ok: false, message: "Fix the highlighted fields first." };
    const profile = config.getState().toProfile(name);
    // Never overwrite blindly: the backend says when the name exists (it may have appeared in
    // another window a moment ago), and only then the user is asked (REV-002 m2).
    let result = await profiles.getState().save(profile, false);
    if (!result.ok && result.code === "profileExists") {
      const answer = await confirm.getState().ask({
        title: "Replace profile?",
        body: `A profile named "${name}" already exists. Replace it?`,
        buttons: [
          { id: "cancel", label: "Cancel", variant: "outline" },
          { id: "replace", label: "Replace", variant: "destructive" },
        ],
        defaultId: "cancel",
        cancelId: "cancel",
      });
      if (answer !== "replace") return { ok: false, message: "" };
      result = await profiles.getState().save(profile, true);
    }
    if (!result.ok) return { ok: false, message: result.message };
    config.getState().markSaved(name);
    dialogs.getState().resolveSaveAs(true);
    return { ok: true };
  }

  /** Runs the "Save changes?" flow. Returns false when the user cancels or saving fails. */
  async function resolveUnsavedChanges(): Promise<boolean> {
    if (!isDirty(config.getState())) return true;
    const answer = await askSaveChanges();
    if (answer === "cancel") return false;
    if (answer === "discard") return true;
    return saveProfile();
  }

  async function loadProfile(name: string): Promise<boolean> {
    if (!(await resolveUnsavedChanges())) return false;
    // Read the file first. If it cannot be read, the running session must stay as it is
    // (REV-003 m-3): nothing is disconnected for a profile that does not load.
    let profile: Profile;
    try {
      profile = await profiles.getState().load(name);
    } catch (e) {
      reportError("Could not open profile", e);
      return false;
    }
    const state = sessionState();
    if (state !== "idle" && state !== "disconnected") {
      const summary = connectionSummary(activeConnection());
      const answer = await confirm.getState().ask({
        title: "Disconnect and load?",
        body: `Loading "${name}" will disconnect from ${summary}.`,
        buttons: [
          { id: "cancel", label: "Cancel", variant: "outline" },
          { id: "disconnect", label: "Disconnect and load", variant: "destructive" },
        ],
        defaultId: "cancel",
        cancelId: "cancel",
      });
      if (answer !== "disconnect") return false;
      // While connecting there is nothing to disconnect yet: cancel the attempt (T4).
      if (state === "connecting") await session.getState().cancelConnect();
      else await session.getState().disconnect();
      if (session.getState().commandError) return false;
      if (!(await waitForState((s) => s === "idle"))) {
        toasts.getState().show("The device did not disconnect. The profile was not loaded.");
        return false;
      }
    }
    config.getState().applyProfile(profile);
    // Out-of-range values of a hand-edited file must show as invalid input (DES-001 3.1).
    await gateway.current.revalidate();
    // Loading never auto-connects. A leftover disconnected banner no longer describes the new setup.
    await session.getState().dismiss();
    pollData.getState().clear();
    return true;
  }

  async function requestClose(): Promise<CloseDecision> {
    if (!isDirty(config.getState())) return "close";
    return (await resolveUnsavedChanges()) ? "close" : "cancel";
  }

  return {
    connect,
    cancelConnect: () => session.getState().cancelConnect(),
    disconnect: () => session.getState().disconnect(),
    async toggleConnection() {
      const state = sessionState();
      if (state === "connecting") await session.getState().cancelConnect();
      else if (isLinkUp(state)) await session.getState().disconnect();
      else await connect();
    },
    dismiss: () => session.getState().dismiss(),
    startOrResume,
    pause,
    async togglePoll() {
      const state = sessionState();
      if (isPollRunning(state)) await pause();
      else await startOrResume();
    },
    applyPoll,
    openWrite,
    openWriteForRow,
    copyRows,
    copyFrames,
    copyFrameBytes,
    saveProfile,
    openSaveAs,
    saveProfileAs,
    loadProfile,
    requestClose,
    async newWindow() {
      try {
        await windowIpc.openToolWindow(MODBUS_MASTER_TOOL_ID);
      } catch (e) {
        reportError("Could not open a new window", e);
      }
    },
    dispose: unsubscribeAutoStart,
  };
}
