// The runtime of ONE poll view (DES-002 2.3, FE-002 task 07): the stores of a poll view and the wiring
// between them. A connection window creates one per workspace sub-window, a native poll window
// creates exactly one. The PollView component gets only this runtime and a `host` prop; it never
// knows which window it is in. Neither window kind imports the other.
//
// Wiring (all after the attach snapshot, so a moved view shows its values at once):
//  - view channel events -> poll store (state, config, counters), data store (updates), connection
//    store (shared in W1, own in W2; the same event arrives twice and counts once), prefs;
//  - poll state -> data store (begin, stale), definition change -> data store (loading or cleared);
//  - config -> alias mirror, setup draft (an untouched field follows the poll), selection range;
//  - setup drafts -> `hasUnappliedEdits` in Rust;
//  - connection idle -> data cleared.
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import type {
  DetachReason,
  DisplaySettings,
  PollHostKind,
  PollId,
  PollViewEvent,
  PollViewSnapshot,
  PrefsChangedEvent,
  ValueColumns,
  ValueFormat,
} from "@/shared/ipc/modbus-master.types";
import type { ToastStoreApi } from "@/shared/lib/toast.store";
import { addressesOf } from "../lib/address-ranges";
import { combinedRows, isCombinedFormat } from "../lib/combined";
import { combinedCopyText } from "../lib/combined-copy";
import {
  CLIPBOARD_ERROR,
  type CopyOptions,
  type CopyRow,
  copiedToast,
  copyAliasesText,
  copyRowsText,
} from "../lib/copy";
import { VALUE_FORMAT_LABELS } from "../lib/format";
import { isBitFunction } from "../lib/functions";
import {
  createScaledFactory,
  effectiveValueColumns,
  NO_SCALE,
  type ScaledProvider,
  type ScaledProviderFactory,
} from "../lib/scaled";
import { type AliasEditStart, type AliasStoreApi, createAliasStore } from "../store/alias.store";
import type { ConnectionStoreApi } from "../store/connection.store";
import {
  createOverrideDialogStore,
  type OverrideDialogStoreApi,
} from "../store/override-dialog.store";
import { isPollRunning } from "../store/poll.logic";
import { createPollStore, type PollStoreApi } from "../store/poll.store";
import {
  connectionClearsData,
  definitionChangeAction,
  pollDataActionFor,
} from "../store/poll-data.logic";
import { createPollDataStore, type PollDataStoreApi } from "../store/poll-data.store";
import {
  type DraftContext,
  draftHasEdits,
  POLL_DRAFT_FIELDS,
  type PollDraftField,
  validateDraft,
} from "../store/poll-draft.logic";
import type { CommandOrigin } from "../store/poll-host.logic";
import { createPollScaleStore, type PollScaleStoreApi } from "../store/poll-scale.store";
import { createPollViewUiStore, type PollViewUiStoreApi } from "../store/poll-view-ui.store";
import { createScaleDraftStore, type ScaleDraftStoreApi } from "../store/scale-draft.store";
import type { PollClipboard } from "./clipboard";

/** What the host does for the poll; the `⋯` menu shows only the actions the host provides. */
export interface PollHostActions {
  /** Open in its own window (sub-window only). */
  popOut?(origin?: CommandOrigin): void;
  /** Dock to workspace (native window only). */
  dock?(origin?: CommandOrigin): void;
  /** Close the view (Keep, Delete or Cancel dialog). */
  close?(): void;
  /** Delete the poll (confirm dialog). */
  deletePoll?(): void;
  /** Show the traffic of this poll (W1: expand the panel with the filter; W2: `showTraffic`). */
  showTraffic?(): void;
  /** Open the Write dialog, prefilled from this address (or none). */
  write?(address: number | null): void;
  /** Rename the poll (the title bar in a sub-window, the toolbar in a native window). */
  rename?(): void;
  duplicate?(): void;
}

export type PollViewDetachCause = DetachReason | "removed" | "attachFailed";

export interface PollViewRuntimeDeps {
  ipc: Pick<
    ModbusMasterIpc,
    | "ackPollBulkReady"
    | "attachPollView"
    | "detachPollView"
    | "updatePoll"
    | "setPollActive"
    | "renamePoll"
    | "setPollView"
    | "resetCounters"
  >;
  pollId: PollId;
  host: PollHostKind;
  /** The window's connection store: W1's shared one, or the native window's own. */
  connection: ConnectionStoreApi;
  /**
   * The connection store is shared and fed by the session channel (W1): the copies of
   * `ConnectionStateChanged` on the view channel are not applied, because a copy held until the
   * snapshot would move the store back to an older state when it is replayed (REV-005 m-1).
   */
  sharedConnection?: boolean;
  toasts: ToastStoreApi;
  clipboard?: PollClipboard;
  /** The other polls' names (a native window has none and relies on the backend check). */
  getOtherNames?: () => readonly string[];
  hostActions?: PollHostActions;
  /** Builds the scaled value provider of a poll (default: the real scale math, FE-003). */
  createScaled?: ScaledProviderFactory;
  /**
   * Holds a modal lock on the window's layout while a dialog of this view (S8) is open: shortcuts
   * are off and pop out and dock refuse. Returns the release function.
   */
  lockModal?: () => () => void;
  canPrepareBulk?: () => boolean;
  /** The view must go away: detached by Rust, poll deleted, or the attach was rejected. */
  onDetached?: (cause: PollViewDetachCause) => void;
  onPrefsChanged?: (evt: PrefsChangedEvent) => void;
  /** The attach snapshot arrived (a native window learns "Don't ask again" and compact mode here). */
  onSnapshot?: (snapshot: PollViewSnapshot) => void;
  onHandoffRequested?: () => void;
  warn?: (message: string) => void;
}

export interface ApplySetupResult {
  ok: boolean;
  /** Something was sent to Rust. */
  applied: boolean;
  /** The first field with a message (the host moves the focus there). */
  firstInvalid: PollDraftField | null;
}

export interface CopyChoice {
  /** Explicit logical rows, used by raw inspection without changing grid selection. */
  addresses?: readonly number[];
  /** Overrides the poll's value columns ("Copy raw", "Copy scaled", "Copy raw and scaled"). */
  columns?: ValueColumns;
  header?: boolean;
}

export interface PollViewActions {
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Ctrl+P: pause a running poll, resume a paused or offline one. */
  toggleActive(): Promise<void>;
  /** [Apply]: validates the draft, renames and applies the definition. */
  applySetup(): Promise<ApplySetupResult>;
  copyRows(choice?: CopyChoice): Promise<void>;
  copyAliases(): Promise<void>;
  /** Ctrl+V with text from the paste event, or the menu with text from the clipboard. */
  pasteAliases(text: string): Promise<void>;
  pasteAliasesFromClipboard(): Promise<void>;
  clearSelectedAliases(): Promise<void>;
  editAlias(address: number, by: AliasEditStart): void;
  setValueColumns(columns: ValueColumns): Promise<void>;
  setFormat(format: ValueFormat): Promise<void>;
  setAddressBase(base: 0 | 1): Promise<void>;
  setShowAlias(show: boolean): Promise<void>;
  setCopyAlias(copy: boolean): Promise<void>;
  /** "Reset counters for this poll". */
  resetCounters(): Promise<void>;
  /** Raw, Scaled, Both (`Ctrl+Shift+V`). */
  cycleValueColumns(): Promise<void>;
  /** "Set scale for selected rows..." (`Ctrl+Shift+E`): opens S8 for the selection. False when nothing is selected. */
  openOverrideForSelection(): boolean;
  /** "Remove scale override" on the selected rows. */
  removeOverridesAtSelection(): Promise<void>;
}

export interface PollViewStores {
  poll: PollStoreApi;
  ui: PollViewUiStoreApi;
  data: PollDataStoreApi;
  alias: AliasStoreApi;
  /** The applied scale, overrides and value columns (FE-003 task 03). */
  scale: PollScaleStoreApi;
  /** The unapplied scale editor (FE-003 task 04). */
  scaleDraft: ScaleDraftStoreApi;
  /** The S8 override dialog (FE-003 task 06). */
  overrides: OverrideDialogStoreApi;
  connection: ConnectionStoreApi;
  toasts: ToastStoreApi;
}

export interface PollViewRuntime {
  pollId: PollId;
  host: PollHostKind;
  stores: PollViewStores;
  actions: PollViewActions;
  hostActions: PollHostActions;
  /** The provider of scaled values for the poll's current scale and overrides. */
  scaled(): ScaledProvider;
  /** Locks the window's modal state for a dialog of this view; returns the release function. */
  lockModal(): () => void;
  /** What the setup form validates against: connection mode, display base, the other polls' names. */
  draftContext(): DraftContext;
  /** Attaches the view channel and applies the snapshot and the handoff. Safe to call twice. */
  init(): Promise<void>;
  /** Detaches with this view's own token and stops every subscription. */
  dispose(): void;
}

export function createPollViewRuntime(deps: PollViewRuntimeDeps): PollViewRuntime {
  const { pollId, connection, toasts } = deps;
  const createScaled = deps.createScaled ?? createScaledFactory();
  const hostActions: PollHostActions = {};
  for (const [name, action] of Object.entries(deps.hostActions ?? {})) {
    Object.assign(hostActions, {
      [name]: (...args: unknown[]) => {
        if (!ui.getState().bulkOperationToken) (action as (...args: unknown[]) => void)(...args);
      },
    });
  }
  let localModalCount = 0;
  let bulkUnlock: (() => void) | null = null;
  const lockLocalModal = () => {
    localModalCount += 1;
    const unlock = deps.lockModal?.();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      localModalCount -= 1;
      unlock?.();
    };
  };
  const subscriptions: Array<() => void> = [];

  const onEvent = (event: PollViewEvent): void => {
    switch (event.type) {
      case "BulkOperationPrepare": {
        const token = poll.getState().viewToken;
        const ready =
          token !== null &&
          poll.getState().pending === null &&
          localModalCount === 0 &&
          !overrides.getState().open &&
          !ui.getState().bulkOperationToken &&
          (deps.canPrepareBulk?.() ?? true);
        if (ready) {
          ui.setState({ bulkOperationToken: event.operationToken });
          if (deps.host === "native") bulkUnlock = deps.lockModal?.() ?? null;
        }
        if (token !== null)
          void deps.ipc.ackPollBulkReady(event.operationToken, pollId, token, ready).catch(() => {
            if (ui.getState().bulkOperationToken === event.operationToken) {
              ui.setState({ bulkOperationToken: null });
              bulkUnlock?.();
              bulkUnlock = null;
            }
          });
        break;
      }
      case "BulkOperationRelease":
        if (ui.getState().bulkOperationToken === event.operationToken) {
          ui.setState({ bulkOperationToken: null });
          bulkUnlock?.();
          bulkUnlock = null;
        }
        break;
      case "PollUpdate":
        data.getState().applyUpdate(event);
        break;
      case "ConnectionStateChanged":
        // A native window learns the connection from its own channel; in W1 the session channel
        // is the one source.
        if (!deps.sharedConnection) connection.getState().applyConnectionStateChanged(event);
        break;
      case "PrefsChanged":
        ui.getState().applyCompact(event.compact);
        deps.onPrefsChanged?.(event);
        break;
      case "HandoffRequested":
        deps.onHandoffRequested?.();
        break;
      default:
        break;
    }
  };

  const poll = createPollStore({
    ipc: deps.ipc,
    pollId,
    host: deps.host,
    toasts,
    ...(deps.getOtherNames ? { getOtherNames: deps.getOtherNames } : {}),
    ...(deps.warn ? { warn: deps.warn } : {}),
    onEvent,
    onSnapshot: (snapshot) => applySnapshot(snapshot),
  });
  const getConfig = () => poll.getState().config;
  const ui = createPollViewUiStore({ getConfig, initialSetupOpen: deps.host === "native" });
  const data = createPollDataStore({ pollId });
  const alias = createAliasStore({
    getConfig,
    setView: (partial) => poll.getState().setView(partial),
    toasts,
  });
  const scale = createPollScaleStore({
    getConfig,
    setView: (partial) => poll.getState().setView(partial),
  });
  const scaleDraftStore = createScaleDraftStore({
    getConfig,
    applyScale: (settings) => scale.getState().applyScale(settings),
    persist: (draft) => ui.getState().setScaleDraft(draft),
  });
  const overrides = createOverrideDialogStore({ getConfig, scale });

  function startWiring(): void {
    // poll state -> data view
    subscriptions.push(
      poll.subscribe((s, prev) => {
        if (s.state !== prev.state) {
          const action = pollDataActionFor(prev.state, s.state);
          if (action === "begin" && s.config) data.getState().begin(s.config.definition);
          else if (action === "markStale") data.getState().markStale();
        }
        // config -> alias mirror, draft, selection range, data view
        if (s.config !== prev.config && s.config) {
          alias.getState().applyFromConfig(s.config);
          scale.getState().applyFromConfig(s.config);
          scaleDraftStore.getState().syncApplied(s.config);
          ui.getState().reconcileConfig(s.config, prev.config?.display.addressBase);
          ui.getState().syncRange();
          if (prev.config) {
            const change = definitionChangeAction(
              prev.config.definition,
              s.config.definition,
              s.state,
            );
            if (change === "begin") data.getState().begin(s.config.definition);
            else if (change === "clear") data.getState().clear("settingsChanged");
          }
        }
      }),
    );
    // connection -> data view (Disconnect and Dismiss clear the stale values)
    subscriptions.push(
      connection.subscribe((s, prev) => {
        if (connectionClearsData(prev.state, s.state)) data.getState().clear();
      }),
    );
    // setup drafts -> hasUnappliedEdits
    subscriptions.push(
      ui.subscribe((s, prev) => {
        if (
          s.pollDraft === prev.pollDraft &&
          s.scaleDraft === prev.scaleDraft &&
          s.interpretationDraft === prev.interpretationDraft &&
          s.ruleDraft === prev.ruleDraft
        )
          return;
        void poll
          .getState()
          .reportUnappliedEdits(
            draftHasEdits(s.pollDraft) ||
              s.scaleDraft?.dirty === true ||
              s.ruleDraft?.dirty === true ||
              s.interpretationDraft !== null,
          );
      }),
    );
  }

  function applySnapshot(snapshot: PollViewSnapshot): void {
    const config = snapshot.poll.config;
    // W1 already has the connection from its session; a native window learns it here.
    if (!connection.getState().ready) {
      connection.getState().applySnapshot({ connection: snapshot.connection });
    }
    ui.getState().applyCompact(snapshot.compact);
    alias.getState().applyFromConfig(config);
    scale.getState().applyFromConfig(config);
    scaleDraftStore.getState().syncApplied(config);

    // The attach snapshot carries the last good values: a moved view shows them at once.
    const def = config.definition;
    const state = snapshot.poll.status.state;
    if (snapshot.lastUpdate) data.getState().seed(def, snapshot.lastUpdate);
    if (snapshot.lastUpdate) {
      if (state !== "polling") data.getState().markStale();
    } else if (isPollRunning(state)) {
      data.getState().begin(def);
    }

    // The handoff of the previous host: selection, scroll, widths, drafts, setup (once).
    ui.getState().applyHandoff(snapshot.handoff);
    scaleDraftStore.getState().hydrate(ui.getState().scaleDraft);
    ui.getState().syncRange();
    startWiring();
    // A view that arrives without its handoff (a reload, a handoff older than 10 s) has no drafts,
    // but Rust may still say there are unapplied edits: the flag follows what this view holds
    // (REV-005 m-2).
    const { pollDraft, scaleDraft, interpretationDraft, ruleDraft } = ui.getState();
    void poll
      .getState()
      .reportUnappliedEdits(
        draftHasEdits(pollDraft) ||
          scaleDraft?.dirty === true ||
          ruleDraft?.dirty === true ||
          interpretationDraft !== null,
      );
    deps.onSnapshot?.(snapshot);
  }

  // The host learns when the view must go away.
  subscriptions.push(
    poll.subscribe((s, prev) => {
      if ((s.attach === "detached" && prev.attach !== "detached") || (s.removed && !prev.removed)) {
        bulkUnlock?.();
        bulkUnlock = null;
        ui.setState({ bulkOperationToken: null });
      }
      if (s.attach === "detached" && prev.attach !== "detached") {
        deps.onDetached?.(s.detachReason ?? (s.attachError !== null ? "attachFailed" : "closed"));
      }
      if (s.removed && !prev.removed) deps.onDetached?.("removed");
    }),
  );

  // ---- actions ----
  const rangeOf = (): { start: number; end: number } | null => {
    const c = getConfig();
    return c
      ? {
          start: c.definition.startAddress,
          end: c.definition.startAddress + c.definition.quantity - 1,
        }
      : null;
  };

  const selectedAddresses = (): number[] => addressesOf(ui.getState().selection);

  /** The provider of the current scale; the factory hands back the same one while it is unchanged. */
  const scaledProvider = (): ScaledProvider => {
    const config = getConfig();
    return config ? createScaled(config) : NO_SCALE;
  };

  function copyRowsFor(addresses: readonly number[]): CopyRow[] {
    const config = getConfig();
    if (!config) return [];
    const scaled = scaledProvider();
    const values = data.getState().values;
    const start = config.definition.startAddress;
    return addresses.map((address) => {
      const raw = values?.[address - start];
      return {
        address,
        raw,
        alias: alias.getState().aliases.get(address),
        scaled: raw === undefined ? "" : (scaled(raw, address)?.text ?? ""),
      };
    });
  }

  async function writeClipboard(text: string, toast: string): Promise<void> {
    try {
      await (deps.clipboard ?? failingClipboard).writeText(text);
      toasts.getState().show(toast);
    } catch {
      toasts.getState().show(CLIPBOARD_ERROR, { tone: "error", durationMs: 4000 });
    }
  }

  const setDisplay = async (patch: Partial<DisplaySettings>) => {
    const config = getConfig();
    if (config) await poll.getState().setView({ display: { ...config.display, ...patch } });
  };

  const draftContext = (): DraftContext => ({
    mode: connection.getState().connection?.mode ?? "tcp",
    base: getConfig()?.display.addressBase ?? 0,
    others: deps.getOtherNames?.() ?? [],
  });

  const actions: PollViewActions = {
    async pause() {
      await poll.getState().setActive(false);
    },
    async resume() {
      await poll.getState().setActive(true);
    },
    async toggleActive() {
      const { state } = poll.getState();
      await poll.getState().setActive(!isPollRunning(state));
    },

    async applySetup() {
      const config = getConfig();
      const draft = ui.getState().pollDraft;
      if (!config || !draft || !draftHasEdits(draft))
        return { ok: true, applied: false, firstInvalid: null };
      const ctx = draftContext();
      const fail = (errors: Partial<Record<PollDraftField, string>>): ApplySetupResult => {
        const current = ui.getState().pollDraft ?? draft;
        ui.getState().setPollDraft({ ...current, errors });
        return {
          ok: false,
          applied: false,
          firstInvalid: POLL_DRAFT_FIELDS.find((f) => errors[f] !== undefined) ?? null,
        };
      };
      const result = validateDraft(draft, ctx);
      if (!result.ok) return fail(result.errors);

      let applied = false;
      if (draft.dirty.includes("name")) {
        const message = await poll.getState().rename(result.name);
        if (message) return fail({ name: message });
        applied = true;
      }
      if (draft.dirty.some((f) => f !== "name")) {
        const ok = await poll.getState().apply(result.definition);
        if (!ok) {
          const { commandError, commandErrorField } = poll.getState();
          const field = POLL_DRAFT_FIELDS.find((f) => f === commandErrorField);
          return fail(field && commandError ? { [field]: commandError } : {});
        }
        applied = true;
      }
      ui.getState().setPollDraft(null);
      return { ok: true, applied, firstInvalid: null };
    },

    async copyRows(choice = {}) {
      const config = getConfig();
      const addresses = choice.addresses ?? selectedAddresses();
      if (!config || addresses.length === 0) return;
      const bits = config.definition.function === 1 || config.definition.function === 2;
      if (!bits && isCombinedFormat(config.display.format)) {
        if (choice.columns === "scaled" || choice.columns === "both") return;
        const rows = combinedRows(
          config.definition.startAddress,
          config.definition.quantity,
          data.getState().values,
          config.display.format,
          config.display,
        ).filter((row) => addresses.includes(row.address));
        await writeClipboard(
          combinedCopyText(rows, alias.getState().aliases, {
            base: config.display.addressBase,
            includeAlias: config.display.copyAlias,
            header: choice.header ?? false,
            label: VALUE_FORMAT_LABELS[config.display.format],
            rawRegisters: choice.columns === "raw",
          }),
          copiedToast(rows.length),
        );
        return;
      }
      const opts: CopyOptions = {
        format: config.display.format,
        base: config.display.addressBase,
        // A scale on a coil or discrete poll is ignored: only the raw values are copied.
        columns: bits ? "raw" : (choice.columns ?? effectiveValueColumns(config)),
        bits,
        includeAlias: config.display.copyAlias,
        header: choice.header ?? false,
      };
      await writeClipboard(
        copyRowsText(copyRowsFor(addresses), opts),
        copiedToast(addresses.length),
      );
    },

    async copyAliases() {
      const addresses = selectedAddresses();
      if (addresses.length === 0) return;
      await writeClipboard(copyAliasesText(copyRowsFor(addresses)), copiedToast(addresses.length));
    },

    async pasteAliases(text) {
      const range = rangeOf();
      if (!range) return;
      const { selection, focusAddress } = ui.getState();
      const start = selection[0]?.start ?? focusAddress ?? range.start;
      await alias.getState().paste(text, start);
    },

    async pasteAliasesFromClipboard() {
      const reader = deps.clipboard?.readText;
      if (!reader) {
        toasts
          .getState()
          .show("Could not read the clipboard.", { tone: "error", durationMs: 4000 });
        return;
      }
      try {
        const text = await reader.call(deps.clipboard);
        await actions.pasteAliases(text);
      } catch {
        toasts
          .getState()
          .show("Could not read the clipboard.", { tone: "error", durationMs: 4000 });
      }
    },

    async clearSelectedAliases() {
      await alias.getState().clear(selectedAddresses());
    },

    editAlias(address, by) {
      alias.getState().beginEdit(address, by);
    },

    async setValueColumns(columns) {
      await scale.getState().setValueColumns(columns);
    },
    async cycleValueColumns() {
      await scale.getState().cycleValueColumns();
    },
    openOverrideForSelection() {
      const config = getConfig();
      if (
        !config ||
        isBitFunction(config.definition.function) ||
        isCombinedFormat(config.display.format)
      )
        return false;
      return overrides.getState().openForSelection(ui.getState().selection);
    },
    async removeOverridesAtSelection() {
      await scale.getState().removeOverrides(ui.getState().selection);
    },
    async setFormat(format) {
      await setDisplay({ format });
    },
    async setAddressBase(base) {
      await setDisplay({ addressBase: base });
    },
    async setShowAlias(show) {
      await setDisplay({ showAlias: show });
    },
    async setCopyAlias(copy) {
      await setDisplay({ copyAlias: copy });
    },

    async resetCounters() {
      try {
        await deps.ipc.resetCounters(pollId);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not reset the counters.";
        toasts.getState().show(message, { tone: "error", durationMs: 4000 });
      }
    },
  };

  let started: Promise<void> | null = null;

  return {
    pollId,
    host: deps.host,
    stores: {
      poll,
      ui,
      data,
      alias,
      scale,
      scaleDraft: scaleDraftStore,
      overrides,
      connection,
      toasts,
    },
    actions,
    hostActions,
    scaled: scaledProvider,
    lockModal: lockLocalModal,
    draftContext,
    init() {
      started ??= poll.getState().init();
      return started;
    },
    dispose() {
      bulkUnlock?.();
      bulkUnlock = null;
      ui.setState({ bulkOperationToken: null });
      for (const off of subscriptions.splice(0)) off();
      poll.getState().dispose();
    },
  };
}

const failingClipboard: PollClipboard = {
  writeText: () => Promise.reject(new Error("No clipboard")),
};
