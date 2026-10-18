// The profile flow of the connection window W1 (DES-001 S3-S5 and 3.5, DES-002 6, FE-002 task 23):
// Save, Save as, Open, the "Save changes?" and "Disconnect and load?" questions, the migration
// notice and the save requests of native windows. A profile is exported by Rust (`mm_export_profile`
// gathers the polls, hosts and layout it holds), written with `profiles_save`, and loaded with
// `profiles_get` and `mm_apply_profile`. The connection form and the stores are reached through
// small dependencies, so every flow is tested against the IPC fake.
import { toIpcError } from "@/shared/ipc/errors";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import type { ConnectionConfig, Profile, SessionSnapshot } from "@/shared/ipc/modbus-master.types";
import type { ToastStoreApi } from "@/shared/lib/toast.store";
import type { ConfirmStoreApi } from "../store/confirm.store";
import type { ConnectionStoreApi } from "../store/connection.store";
import type { DialogsStoreApi } from "../store/dialogs.store";
import {
  couldNotOpenToast,
  couldNotSaveToast,
  DISCONNECT_AND_LOAD_TITLE,
  disconnectAndLoadBody,
  FIX_FIELDS_TOAST,
  REPLACE_TITLE,
  replaceBody,
  SAVE_CHANGES_TITLE,
  saveChangesBody,
} from "../store/profile.logic";
import type { ProfileInfoStoreApi } from "../store/profile-info.store";
import type { ProfilesStoreApi } from "../store/profiles.store";
import { profileNameSchema, validate } from "../validation/schemas";

export type SaveResult = { ok: true } | { ok: false; message: string };

export interface ProfileFlowDeps {
  ipc: Pick<
    ModbusMasterIpc,
    "exportProfile" | "applyProfile" | "setProfileName" | "focusConnectionWindow"
  >;
  toasts: ToastStoreApi;
  profiles: ProfilesStoreApi;
  dialogs: DialogsStoreApi;
  confirm: ConfirmStoreApi;
  info: ProfileInfoStoreApi;
  connection: ConnectionStoreApi;
  /** Validates the CONNECTION form, shows its messages and focuses the first invalid field. */
  validateForm(): Promise<ConnectionConfig | null>;
  /** Shows the CONNECTION section (a loaded profile with an invalid field, a blocked save). */
  showForm(): void;
  /** The form shows this connection (a loaded profile). */
  adoptConnection(config: ConnectionConfig): void;
  /** Reports the workspace layout to Rust, so the export has the latest rectangles. */
  flushLayout(): Promise<void>;
  /**
   * The window stops reacting to list changes (no sub-window is mounted at a default rectangle and
   * reported to Rust) while a profile is applied. Returns the function that ends the pause.
   */
  suspendSync(): () => void;
  /** Replaces the stores of the window with the snapshot `mm_apply_profile` returned. */
  applySnapshot(snapshot: SessionSnapshot): void;
  /** The signature of what is saved, now. */
  signature(): string;
  /** Polls in their own windows and polls with unapplied edits: a load replaces them (default: none). */
  loadSummary?(): { nativeWindowCount: number; unappliedPollNames: readonly string[] };
  /** How long to wait for the link to go down before a load (ms). */
  disconnectTimeoutMs?: number;
}

export interface ProfileFlow {
  /** Ctrl+S: save, or Save as when the profile has no name. True when it was saved. */
  save(options?: { fromNative?: boolean }): Promise<boolean>;
  /** Ctrl+Shift+S: the Save as dialog (S4). True when saved. */
  saveAs(options?: { fromNative?: boolean }): Promise<boolean>;
  /** The name of the Save as dialog was submitted. */
  saveAsName(name: string): Promise<SaveResult>;
  /** Ctrl+O: the Open profile dialog (S3). */
  openDialog(): void;
  /** Opens a profile of the list (S3 Open, double click). */
  load(name: string): Promise<boolean>;
  dismissMigrationNotice(): void;
  /** A save request of a native window (`SaveRequested`). */
  requestedByNative(saveAs: boolean): Promise<void>;
  /** The profile that is loaded was renamed in S3: the window follows. */
  renamed(oldName: string, newName: string): void;
}

export function createProfileFlow(deps: ProfileFlowDeps): ProfileFlow {
  const { toasts, profiles, dialogs, confirm, info, connection } = deps;

  const fail = (message: string) =>
    toasts.getState().show(message, { tone: "error", durationMs: 4000 });

  function waitForState(
    predicate: (state: string) => boolean,
    timeoutMs = deps.disconnectTimeoutMs ?? 5000,
  ): Promise<boolean> {
    if (predicate(connection.getState().state)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, timeoutMs);
      const unsubscribe = connection.subscribe((s) => {
        if (predicate(s.state)) {
          clearTimeout(timer);
          unsubscribe();
          resolve(true);
        }
      });
    });
  }

  const bringToFront = () => void deps.ipc.focusConnectionWindow().catch(() => {});

  /** Validates the connection form before anything is written (DES-001 3.5). */
  async function validForm(
    options: { fromNative?: boolean } = {},
  ): Promise<ConnectionConfig | null> {
    const config = await deps.validateForm();
    if (!config) {
      deps.showForm();
      if (options.fromNative) bringToFront();
      toasts.getState().show(FIX_FIELDS_TOAST, { tone: "error", durationMs: 4000 });
    }
    return config;
  }

  async function write(
    name: string,
    config: ConnectionConfig,
    overwrite: boolean,
  ): Promise<{ ok: true } | { ok: false; message: string; code: string }> {
    await deps.flushLayout();
    let profile: Profile;
    try {
      profile = await deps.ipc.exportProfile(name, config);
    } catch (e) {
      const error = toIpcError(e);
      return { ok: false, message: error.message, code: error.code };
    }
    return profiles.getState().save({ ...profile, name }, overwrite);
  }

  /** The profile was written under `name`: that is the new baseline, and the name follows. */
  async function markSaved(name: string): Promise<void> {
    info.getState().setName(name);
    info.getState().setBaseline(deps.signature());
    info.getState().setMigrated(false);
    try {
      await deps.ipc.setProfileName(name);
    } catch {
      // The native windows keep the old name in their title until the next change.
    }
  }

  async function saveAs(options: { fromNative?: boolean } = {}): Promise<boolean> {
    if (!(await validForm(options))) return false;
    if (options.fromNative) bringToFront();
    return dialogs.getState().requestSaveAs();
  }

  async function save(options: { fromNative?: boolean } = {}): Promise<boolean> {
    const name = info.getState().name;
    if (name === null) return saveAs(options);
    const config = await validForm(options);
    if (!config) return false;
    // Overwrite: the profile may have been renamed or deleted in another window (DES-001 S3).
    const result = await write(name, config, true);
    if (!result.ok) {
      fail(couldNotSaveToast(result.message));
      return false;
    }
    await markSaved(name);
    return true;
  }

  async function saveAsName(name: string): Promise<SaveResult> {
    const checked = validate(profileNameSchema([]), name);
    if (!checked.ok) return { ok: false, message: checked.errors.name ?? "Invalid name." };
    const config = await validForm();
    if (!config) return { ok: false, message: "" };
    // Never overwrite blindly: the backend says when the name exists (it may have appeared in
    // another window a moment ago), and only then the user is asked (REV-002 m2).
    let result = await write(name, config, false);
    if (!result.ok && result.code === "profileExists") {
      const answer = await confirm.getState().ask({
        title: REPLACE_TITLE,
        body: replaceBody(name),
        buttons: [
          { id: "cancel", label: "Cancel", variant: "outline" },
          { id: "replace", label: "Replace", variant: "destructive" },
        ],
        defaultId: "cancel",
        cancelId: "cancel",
      });
      if (answer !== "replace") return { ok: false, message: "" };
      result = await write(name, config, true);
    }
    if (!result.ok) return { ok: false, message: result.message };
    await markSaved(name);
    dialogs.getState().resolveSaveAs(true);
    return { ok: true };
  }

  /** "Save changes?" before a load. False when the user cancels or the save fails. */
  async function resolveUnsaved(): Promise<boolean> {
    const { nativeWindowCount, unappliedPollNames } = deps.loadSummary?.() ?? {
      nativeWindowCount: 0,
      unappliedPollNames: [],
    };
    // The same rule as closing the window: unsaved changes, or unapplied edits that a load discards.
    if (!info.getState().modified && unappliedPollNames.length === 0) return true;
    const answer = await confirm.getState().ask({
      title: SAVE_CHANGES_TITLE,
      body: saveChangesBody({
        profileName: info.getState().name,
        nativeWindowCount,
        unappliedPollNames,
        reason: "load",
      }),
      buttons: [
        { id: "save", label: "Save" },
        { id: "discard", label: "Don't save", variant: "outline" },
        { id: "cancel", label: "Cancel", variant: "outline" },
      ],
      defaultId: "save",
      cancelId: "cancel",
    });
    if (answer === "cancel") return false;
    if (answer === "discard") return true;
    return save();
  }

  async function load(name: string): Promise<boolean> {
    if (!(await resolveUnsaved())) return false;
    // Read the file first. If it cannot be read, the running session stays as it is: nothing is
    // disconnected for a profile that does not load (REV-003 m-3).
    let profile: Profile;
    try {
      profile = await profiles.getState().load(name);
    } catch (e) {
      fail(couldNotOpenToast(toIpcError(e).message));
      return false;
    }
    const state = connection.getState().state;
    if (state === "connected" || state === "connecting") {
      const answer = await confirm.getState().ask({
        title: DISCONNECT_AND_LOAD_TITLE,
        body: disconnectAndLoadBody(name, connection.getState().connection),
        buttons: [
          { id: "cancel", label: "Cancel", variant: "outline" },
          { id: "disconnect", label: "Disconnect and load", variant: "destructive" },
        ],
        defaultId: "cancel",
        cancelId: "cancel",
      });
      if (answer !== "disconnect") return false;
      // While connecting there is nothing to disconnect yet: cancel the attempt (C4).
      if (state === "connecting") await connection.getState().cancelConnect();
      else await connection.getState().disconnect();
      if (connection.getState().commandError) return false;
      if (!(await waitForState((s) => s === "idle"))) {
        toasts.getState().show("The device did not disconnect. The profile was not loaded.");
        return false;
      }
    }
    let snapshot: SessionSnapshot;
    const resume = deps.suspendSync();
    try {
      snapshot = await deps.ipc.applyProfile(profile);
    } catch (e) {
      resume();
      fail(couldNotOpenToast(toIpcError(e).message));
      return false;
    }
    // Every sub-window and native window of the old polls is gone (Rust closed them without S6);
    // the new polls come with their hosts and rectangles.
    deps.applySnapshot(snapshot);
    deps.adoptConnection(profile.connection);
    info.getState().setName(profile.name === "" ? null : profile.name);
    info.getState().setMigrated(profile.migratedFrom !== null);
    // A hand-edited file can hold values outside the lists: the form shows them as invalid input
    // (DES-001 3.1). Loading never connects by itself.
    if (!(await deps.validateForm())) deps.showForm();
    info.getState().setBaseline(deps.signature());
    return true;
  }

  return {
    save,
    saveAs,
    saveAsName,
    openDialog: () => dialogs.getState().showOpenProfile(),
    load,
    dismissMigrationNotice: () => info.getState().setMigrated(false),
    async requestedByNative(asSaveAs) {
      if (asSaveAs) await saveAs({ fromNative: true });
      else await save({ fromNative: true });
    },
    renamed(oldName, newName) {
      const current = info.getState().name;
      if (current !== null && current.toLowerCase() === oldName.toLowerCase()) {
        info.getState().setName(newName);
        void deps.ipc.setProfileName(newName).catch(() => {});
      }
    },
  };
}
