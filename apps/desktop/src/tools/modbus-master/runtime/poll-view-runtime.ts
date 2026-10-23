// The runtime of ONE poll view (DES-002 2.3, FE-002 task 07): the stores of a poll view and the wiring
// between them. A connection window creates one per workspace sub-window, a native poll window
// creates exactly one. The PollView component gets only this runtime and a `host` prop; it never
// knows which window it is in. Neither window kind imports the other.
//
// Wiring (all after the attach snapshot, so a moved view shows its values at once):
//  - view channel events -> poll store (state, config, counters), data store (updates), connection
//    store (shared in W1, own in W2; the same event arrives twice and counts once), prefs;
//  - poll state -> data store (begin, stale), definition change -> data store (loading or cleared);
//  - config -> alias mirror, setup draft (an untouched field follows the poll), the rows (a format,
//    Start or Quantity change re-snaps selection and focus to whole rows);
//  - setup drafts -> `hasUnappliedEdits` in Rust;
//  - connection idle -> data cleared.
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import type {
  DetachReason,
  DisplaySettings,
  FormatOverride,
  PollHostKind,
  PollId,
  PollViewEvent,
  PollViewSnapshot,
  PrefsChangedEvent,
  ValueColumns,
} from "@/shared/ipc/modbus-master.types";
import type { ToastStoreApi } from "@/shared/lib/toast.store";
import { type AddressRange, rangesContain } from "../lib/address-ranges";
import { firstRuleConflict } from "../lib/color-rules";
import {
  CLIPBOARD_ERROR,
  type CopyOptions,
  type CopyRow,
  copiedToast,
  copyAliasesText,
  copyRegistersText,
  copyRowsText,
} from "../lib/copy";
import {
  appliedAnnouncement,
  applyFailedMessage,
  quickCutToast,
  ruleConflictMessage,
  tooManyMessage,
} from "../lib/format-messages";
import {
  type FormatRow,
  planFormatChange,
  rowAt,
  rowsOfConfig,
  sameOverrides,
  widenToRows,
} from "../lib/format-overrides";
import { isBitFunction } from "../lib/functions";
import { groupRowValue } from "../lib/row-value";
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
  createFormatDialogStore,
  type FormatDialogOrigin,
  type FormatDialogStoreApi,
} from "../store/format-dialog.store";
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
  /** A polite screen reader announcement (the window's announcer). */
  announce?: (text: string) => void;
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
  /** Explicit rows (any address inside a row), used by raw inspection without changing the selection. */
  addresses?: readonly number[];
  /** Overrides the poll's value columns ("Copy raw", "Copy scaled", "Copy raw and scaled"). */
  columns?: ValueColumns;
  header?: boolean;
  /** "Copy raw registers": one line per register, unsigned, whatever the row format. */
  registers?: boolean;
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
  /** Sends a new list of format overrides (the Format dialog's Apply). True when Rust acknowledged it. */
  applyFormatOverrides(overrides: FormatOverride[]): Promise<boolean>;
  /**
   * Ctrl+1 to Ctrl+4 and the quick items of the narrow Show menu: a 16-bit format, big-endian, on the
   * selected rows (the focused row when nothing is selected). No dialog (DES-009 section 5).
   */
  setSelectedFormat(format: "unsigned" | "signed" | "hex" | "binary"): Promise<void>;
  /**
   * Opens the Format dialog D1 for the selection (the focused row when nothing is selected). False
   * when it cannot open: a coil or discrete poll, no rows to act on, or a dialog that is busy.
   */
  openFormatDialog(origin: FormatDialogOrigin, originAddress?: number | null): boolean;
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
  /** The Format dialog D1 (FE-009 task 04). */
  formatDialog: FormatDialogStoreApi;
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
  /** The rows of the grid (DES-009 3.1): the same list while the range and the formats are unchanged. */
  rows(): readonly FormatRow[];
  /** What a format action acts on: the selection, or the focused row when nothing is selected. */
  formatScope(): AddressRange[];
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
          !formatDialog.getState().open &&
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

  // The rows of the grid, derived from Start, Quantity, the function and the format overrides. The
  // same list comes back while those are unchanged, so a config event about something else (an
  // alias, a counter) does not make the grid compute its rows again.
  let rowsCache: {
    key: string;
    overrides: readonly FormatOverride[];
    rows: readonly FormatRow[];
  } | null = null;
  const NO_ROWS: readonly FormatRow[] = [];
  const rows = (): readonly FormatRow[] => {
    const config = getConfig();
    if (!config) return NO_ROWS;
    const { startAddress, quantity, function: fn } = config.definition;
    const bits = isBitFunction(fn);
    const key = `${startAddress}|${quantity}|${bits}`;
    const cached = rowsCache;
    if (
      cached &&
      cached.key === key &&
      (bits ||
        cached.overrides === config.formatOverrides ||
        sameOverrides(cached.overrides, config.formatOverrides))
    ) {
      return cached.rows;
    }
    const next = rowsOfConfig(config);
    rowsCache = { key, overrides: config.formatOverrides, rows: next };
    return next;
  };

  const ui = createPollViewUiStore({
    getConfig,
    getRows: rows,
    initialSetupOpen: deps.host === "native",
  });
  const data = createPollDataStore({ pollId });
  const alias = createAliasStore({
    getConfig,
    getRows: rows,
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
  const overrides = createOverrideDialogStore({ getConfig, getRows: rows, scale });
  const formatDialog = createFormatDialogStore({
    getConfig,
    getRows: rows,
    applyFormatOverrides: (list) => poll.getState().setView({ formatOverrides: list }),
    getCommandError: () => poll.getState().commandError,
    announce: (text) => deps.announce?.(text),
  });

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
          ui.getState().syncRows();
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
          s.ruleDraft === prev.ruleDraft
        )
          return;
        void poll
          .getState()
          .reportUnappliedEdits(
            draftHasEdits(s.pollDraft) ||
              s.scaleDraft?.dirty === true ||
              s.ruleDraft?.dirty === true,
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
    ui.getState().syncRows();
    startWiring();
    // A view that arrives without its handoff (a reload, a handoff older than 10 s) has no drafts,
    // but Rust may still say there are unapplied edits: the flag follows what this view holds
    // (REV-005 m-2).
    const { pollDraft, scaleDraft, ruleDraft } = ui.getState();
    void poll
      .getState()
      .reportUnappliedEdits(
        draftHasEdits(pollDraft) || scaleDraft?.dirty === true || ruleDraft?.dirty === true,
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

  // The Format dialog closes without applying when its poll goes away, in either host: the poll was
  // deleted (the removal event, also when the host keeps the window), the view was detached, the
  // config is gone, or the poll range no longer holds a register of the scope (DES-009 11.12).
  subscriptions.push(
    poll.subscribe((s, prev) => {
      const dialog = formatDialog.getState();
      if (!dialog.open) return;
      const gone =
        (s.removed && !prev.removed) ||
        (s.attach === "detached" && prev.attach !== "detached") ||
        s.config === null;
      const config = s.config;
      const last = config ? config.definition.startAddress + config.definition.quantity - 1 : 0;
      const lostRange =
        config !== null &&
        config !== prev.config &&
        !dialog.scope.some(
          (r) => r.start <= last && r.end >= (config?.definition.startAddress ?? 0),
        );
      if (gone || lostRange) dialog.closeForRemoval();
    }),
  );

  // ---- actions ----
  /** The rows whose first register is selected (the selection always holds whole rows). */
  const selectedRows = (): FormatRow[] => {
    const { selection } = ui.getState();
    return rows().filter((row) => rangesContain(selection, row.address));
  };

  /** The rows that contain these addresses, once each, in address order. */
  const rowsContaining = (addresses: readonly number[]): FormatRow[] => {
    const list = rows();
    const found = new Set<number>();
    for (const address of addresses) {
      const index = rowAt(list, address);
      if (index !== -1) found.add(index);
    }
    return [...found].sort((a, b) => a - b).map((index) => list[index] as FormatRow);
  };

  /**
   * What a format action acts on: the selection, or the focused row when nothing is selected, always
   * as whole rows (DES-009 11.2). The UI store already keeps whole rows; widening here as well means
   * no path can hand a part of a group to the planner or the dialog (REQ-009 item 13).
   */
  const formatScope = (): AddressRange[] => {
    const { selection, focusAddress } = ui.getState();
    const list = rows();
    if (selection.length > 0) return widenToRows(selection, list);
    if (focusAddress === null) return [];
    const row = list[rowAt(list, focusAddress)];
    return row ? [{ start: row.address, end: row.endAddress }] : [];
  };

  /** The provider of the current scale; the factory hands back the same one while it is unchanged. */
  const scaledProvider = (): ScaledProvider => {
    const config = getConfig();
    return config ? createScaled(config) : NO_SCALE;
  };

  /** One copy row per visible register; a combined value appears only at its head. */
  function copyRowsFor(list: readonly FormatRow[]): CopyRow[] {
    const config = getConfig();
    if (!config) return [];
    const scaled = scaledProvider();
    const values = data.getState().values;
    const aliases = alias.getState().aliases;
    const { startAddress: start, quantity } = config.definition;
    return list.flatMap((row): CopyRow[] => {
      if (row.width === 1) {
        const raw = values?.[row.address - start];
        return [
          {
            address: row.address,
            raw,
            alias: aliases.get(row.address),
            scaled: raw === undefined ? "" : (scaled(raw, row.address)?.text ?? ""),
            format: row.format,
          },
        ];
      }
      const { words, value } = groupRowValue(row, values, start, quantity);
      const head: CopyRow = {
        address: row.address,
        raw: undefined,
        alias: aliases.get(row.address),
        scaled: "",
        group: {
          format: row.format,
          value,
          registers: Array.from({ length: row.endAddress - row.address + 1 }, (_, i) => ({
            address: row.address + i,
            raw: words[i],
            alias: aliases.get(row.address + i),
          })),
        },
      };
      return [
        head,
        ...Array.from(
          { length: row.endAddress - row.address },
          (_, i): CopyRow => ({
            address: row.address + i + 1,
            raw: undefined,
            alias: aliases.get(row.address + i + 1),
            scaled: "",
            format: row.format,
            continuation: true,
          }),
        ),
      ];
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
      if (!config) return;
      const list = choice.addresses ? rowsContaining(choice.addresses) : selectedRows();
      if (list.length === 0) return;
      const data16 = list.some((row) => row.width === 1);
      const bits = isBitFunction(config.definition.function);
      const copyData = copyRowsFor(list);
      if (choice.registers) {
        await writeClipboard(
          copyRegistersText(copyData, {
            base: config.display.addressBase,
            includeAlias: config.display.copyAlias,
            header: choice.header ?? false,
          }),
          copiedToast(copyData.length),
        );
        return;
      }
      // Combined values have no scaled value: the menu offers Copy scaled only with a 16-bit row.
      if (!data16 && (choice.columns === "scaled" || choice.columns === "both")) return;
      // A scale on a coil or discrete poll is ignored: only the raw values are copied.
      const wanted = bits ? "raw" : (choice.columns ?? effectiveValueColumns(config));
      const opts: CopyOptions = {
        format: "unsigned",
        base: config.display.addressBase,
        columns: !data16 && wanted === "scaled" ? "raw" : wanted,
        bits,
        includeAlias: config.display.copyAlias,
        header: choice.header ?? false,
      };
      await writeClipboard(copyRowsText(copyData, opts), copiedToast(copyData.length));
    },

    async copyAliases() {
      const list = selectedRows();
      if (list.length === 0) return;
      const copyData = copyRowsFor(list);
      await writeClipboard(copyAliasesText(copyData), copiedToast(copyData.length));
    },

    async pasteAliases(text) {
      const list = rows();
      const first = list[0];
      if (!first) return;
      const { selection, focusAddress } = ui.getState();
      const start = selection[0]?.start ?? focusAddress ?? first.address;
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
      // Only the alias of each row's first register: the others of a group row are kept.
      await alias.getState().clear(selectedRows().map((row) => row.address));
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
      if (!config || isBitFunction(config.definition.function)) return false;
      // Combined values have no scale: a selection with a group row cannot get an override.
      if (selectedRows().some((row) => row.width > 1)) return false;
      return overrides.getState().openForSelection(ui.getState().selection);
    },
    async removeOverridesAtSelection() {
      await scale.getState().removeOverrides(ui.getState().selection);
    },
    applyFormatOverrides(list) {
      return poll.getState().setView({ formatOverrides: list });
    },
    async setSelectedFormat(format) {
      const config = getConfig();
      if (!config || isBitFunction(config.definition.function)) return;
      if (formatDialog.getState().open) return;
      const scope = formatScope();
      if (scope.length === 0) return;
      const { startAddress, quantity } = config.definition;
      const plan = planFormatChange({
        overrides: config.formatOverrides,
        scope,
        choice: { format, order: "big" },
        pollRange: { start: startAddress, end: startAddress + quantity - 1 },
      });
      const fail = (text: string) =>
        toasts.getState().show(text, { tone: "error", durationMs: 4000 });
      if (plan.kind === "tooMany") {
        fail(tooManyMessage(plan.count));
        return;
      }
      if (plan.kind !== "ok" || plan.unchanged) return;
      const conflict = firstRuleConflict(config.colorRules, plan.overrides);
      if (conflict) {
        fail(ruleConflictMessage(conflict.name, conflict.message));
        return;
      }
      const ok = await actions.applyFormatOverrides(plan.overrides);
      if (!ok) {
        fail(applyFailedMessage(poll.getState().commandError));
        return;
      }
      const base = config.display.addressBase;
      deps.announce?.(appliedAnnouncement(format, "big", scope, base));
      if (plan.cuts.length > 0) {
        toasts.getState().show(quickCutToast(format, scope, plan.cuts, base), { durationMs: 4000 });
      }
    },
    openFormatDialog(origin, originAddress = null) {
      const config = getConfig();
      if (!config || isBitFunction(config.definition.function)) return false;
      const scope = formatScope();
      if (scope.length === 0) return false;
      const at = originAddress ?? ui.getState().focusAddress;
      const opened = formatDialog.getState().openFor(scope, origin, at);
      // The row that opened the dialog is where the focus comes back to (DES-009 4.7).
      if (opened && origin === "grid" && at !== null) ui.getState().setFocusRow(at);
      return opened;
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
      formatDialog,
      connection,
      toasts,
    },
    actions,
    hostActions,
    scaled: scaledProvider,
    rows,
    formatScope,
    lockModal: lockLocalModal,
    draftContext,
    init() {
      started ??= poll.getState().init();
      return started;
    },
    dispose() {
      // A host that tears the view down (a deleted poll closes its sub-window) may do it before the
      // removal event is handled: an Apply still on its way must then change nothing and say nothing.
      formatDialog.getState().closeForRemoval();
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
