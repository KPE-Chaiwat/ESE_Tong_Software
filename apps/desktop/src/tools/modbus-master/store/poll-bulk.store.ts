import { createStore, type StoreApi } from "zustand/vanilla";
import { toIpcError } from "@/shared/ipc/errors";
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import type { PollBulkPlan, PollBulkResult, PollId } from "@/shared/ipc/modbus-master.types";
import { MAX_POLLS } from "../lib/poll-names";
import type { AnnouncerStoreApi } from "./announcer.store";
import type { LayoutStoreApi } from "./layout.store";
import type { PollListStoreApi } from "./poll-list.store";
import type { PollSelectionStoreApi } from "./poll-selection.store";

export type BulkPhase =
  | "idle"
  | "preparing"
  | "confirming"
  | "duplicating"
  | "deleting"
  | "recovering";
export interface PollBulkStore {
  phase: BulkPhase;
  confirmation: PollBulkPlan | null;
  operationIds: PollId[];
  error: string | null;
  warning: boolean;
  recovery: PollBulkResult | null;
  retryPlan: PollBulkPlan | null;
  retryOperation(): Promise<void>;
  duplicateSelected(): Promise<void>;
  requestDeleteSelected(): Promise<void>;
  cancelDelete(): void;
  confirmDelete(): Promise<void>;
  dismissError(): void;
  dismissRecovery(): void;
  recoverHost(id: PollId): Promise<void>;
  retryWindowCleanup(): Promise<void>;
  resetForProfile(): void;
  dispose(): void;
}
export type PollBulkStoreApi = StoreApi<PollBulkStore>;
export interface PollBulkDeps {
  ipc: Pick<
    ModbusMasterIpc,
    "preparePollBulk" | "duplicatePolls" | "removePolls" | "recoverPollBulkWindows" | "showPoll"
  >;
  list: PollListStoreApi;
  selection: PollSelectionStoreApi;
  layout: LayoutStoreApi;
  announcer: AnnouncerStoreApi;
  focus?(target: "duplicate" | "delete" | "new" | PollId): void;
}
export const bulkLocked = (s: PollBulkStore) => s.phase !== "idle";

export function createPollBulkStore(deps: PollBulkDeps): PollBulkStoreApi {
  let unlock: (() => void) | null = null;
  let disposed = false;
  let epoch = 0;
  let confirmedOrder: PollId[] = [];
  const begin = () => {
    if (unlock || deps.layout.getState().modalOpen || disposed) return false;
    unlock = deps.layout.getState().lockModal();
    return true;
  };
  const release = () => {
    unlock?.();
    unlock = null;
  };
  return createStore<PollBulkStore>()((set, get) => {
    const ids = () => {
      const order = deps.list.getState().order;
      const selected = deps.selection.getState().selectedIds;
      return [
        ...order.filter((id) => selected.has(id)),
        ...[...selected].filter((id) => !order.includes(id)),
      ];
    };
    const fail = (action: "duplicate" | "delete", error: unknown) => {
      const e = toIpcError(error);
      deps.selection.getState().reconcile(deps.list.getState().order);
      set({
        phase: "idle",
        confirmation: null,
        error:
          e.field === "polls" ||
          e.message === "The selected polls changed. Review your selection and try again."
            ? e.message
            : `Could not ${action} the selected polls. ${e.message}`,
        warning: e.code === "validation" || e.code === "invalidState",
      });
      release();
      deps.focus?.(action);
    };
    async function execute(plan: PollBulkPlan) {
      const action = plan.action;
      const generation = epoch;
      const before = deps.list.getState().order;
      const selected = plan.targets.map((p) => p.config.pollId);
      const lastRemoved = Math.max(...selected.map((id) => before.indexOf(id)));
      set({
        phase: action === "duplicate" ? "duplicating" : "deleting",
        confirmation: null,
        error: null,
      });
      try {
        const mutate = () =>
          action === "duplicate"
            ? deps.ipc.duplicatePolls(plan.planToken)
            : deps.ipc.removePolls(plan.planToken);
        let result: PollBulkResult;
        try {
          result = await mutate();
        } catch (error) {
          if (toIpcError(error).code !== "unknown") throw error;
          // A lost response must resolve through the same idempotent token, never a fresh plan.
          result = await mutate();
        }
        if (disposed || generation !== epoch) return;
        // The ordered session channel publishes the authoritative list before this reply. Never
        // overwrite a newer channel list with result.polls, which may already be superseded.
        deps.selection.getState().reconcile(deps.list.getState().order);
        set({
          phase: "idle",
          recovery: result.issues.length ? result : null,
          operationIds: [],
          error: null,
          retryPlan: null,
        });
        deps.announcer
          .getState()
          .announce(
            `${action === "duplicate" ? "Duplicated" : "Deleted"} ${selected.length} polls.`,
          );
        release();
        if (action === "delete") {
          const survivors = deps.list.getState().order;
          const following = before.slice(lastRemoved + 1).find((id) => survivors.includes(id));
          const preceding = before
            .slice(0, lastRemoved)
            .reverse()
            .find((id) => survivors.includes(id));
          deps.focus?.(following ?? preceding ?? survivors[0] ?? "new");
        } else deps.focus?.("duplicate");
      } catch (error) {
        if (!disposed && generation === epoch) {
          fail(action, error);
          set({
            retryPlan: toIpcError(error).code === "unknown" ? plan : null,
          });
        }
      } finally {
        if (generation === epoch) release();
      }
    }
    const stopSelection = deps.selection.subscribe((s, prev) => {
      if (s.selectedIds !== prev.selectedIds && get().phase === "idle" && !get().retryPlan)
        set({ error: null });
    });
    const stopList = deps.list.subscribe((s, prev) => {
      const confirmation = get().confirmation;
      if (!confirmation || get().phase !== "confirming") return;
      const changedOrder =
        s.order.length !== confirmedOrder.length ||
        s.order.some((id, i) => id !== confirmedOrder[i]);
      const changedTarget = confirmation.targets.some((target) => {
        const id = target.config.pollId;
        const current = s.polls[id];
        if (current === prev.polls[id]) return false;
        return (
          !current ||
          JSON.stringify([
            current.config,
            current.host,
            current.open,
            current.hasUnappliedEdits,
          ]) !== JSON.stringify([target.config, target.host, target.open, target.hasUnappliedEdits])
        );
      });
      if (changedOrder || changedTarget)
        fail("delete", {
          code: "validation",
          message: "The selected polls changed. Review your selection and try again.",
          field: "pollIds",
        });
    });
    return {
      phase: "idle",
      confirmation: null,
      operationIds: [],
      error: null,
      warning: false,
      recovery: null,
      retryPlan: null,
      async duplicateSelected() {
        const selected = ids();
        if (
          !selected.length ||
          get().phase !== "idle" ||
          get().retryPlan ||
          get().recovery ||
          !begin()
        )
          return;
        const available = MAX_POLLS - deps.list.getState().order.length;
        if (selected.length > available) {
          set({
            error: `Cannot duplicate ${selected.length} polls. This connection has room for ${available} more (maximum 16).`,
            warning: true,
          });
          release();
          return;
        }
        set({ phase: "preparing", operationIds: selected, error: null });
        const generation = epoch;
        try {
          const plan = await deps.ipc.preparePollBulk("duplicate", selected);
          if (!disposed && generation === epoch) await execute(plan);
        } catch (error) {
          if (!disposed && generation === epoch) fail("duplicate", error);
        }
      },
      async requestDeleteSelected() {
        const selected = ids();
        if (
          !selected.length ||
          get().phase !== "idle" ||
          get().retryPlan ||
          get().recovery ||
          !begin()
        )
          return;
        set({ phase: "preparing", operationIds: selected, error: null });
        confirmedOrder = [...deps.list.getState().order];
        const generation = epoch;
        try {
          const confirmation = await deps.ipc.preparePollBulk("delete", selected);
          if (!disposed && generation === epoch) set({ phase: "confirming", confirmation });
        } catch (error) {
          if (!disposed && generation === epoch) fail("delete", error);
        }
      },
      cancelDelete() {
        if (get().phase !== "confirming") return;
        set({ phase: "idle", confirmation: null, operationIds: [] });
        release();
        deps.focus?.("delete");
      },
      async confirmDelete() {
        const { confirmation, phase } = get();
        if (confirmation && phase === "confirming") await execute(confirmation);
      },
      async retryOperation() {
        const plan = get().retryPlan;
        if (!plan || get().phase !== "idle" || !begin()) return;
        await execute(plan);
      },
      dismissError: () => set({ error: null }),
      dismissRecovery: () => set({ recovery: null }),
      async recoverHost(id) {
        if (
          get().phase !== "idle" ||
          !get().recovery?.issues.some(
            (issue) => issue.pollId === id && issue.recovery === "showPoll",
          ) ||
          !begin()
        )
          return;
        const generation = epoch;
        set({ phase: "recovering", error: null });
        try {
          await deps.ipc.showPoll(id, null);
          if (disposed || generation !== epoch) return;
          const recovery = get().recovery;
          if (recovery) {
            const issues = recovery.issues.filter((issue) => issue.pollId !== id);
            set({ recovery: issues.length ? { ...recovery, issues } : null });
          }
        } catch (error) {
          if (disposed || generation !== epoch) return;
          set({
            error: `Could not reopen the poll window. ${toIpcError(error).message}`,
            warning: false,
          });
        } finally {
          if (!disposed && generation === epoch) {
            set({ phase: "idle" });
            release();
          }
        }
      },
      async retryWindowCleanup() {
        const recovery = get().recovery;
        if (!recovery || get().phase !== "idle" || !begin()) return;
        const generation = epoch;
        set({ phase: "recovering", error: null });
        try {
          const result = await deps.ipc.recoverPollBulkWindows(recovery.operationToken);
          if (disposed || generation !== epoch) return;
          set({ recovery: result.issues.length ? result : null });
        } catch (error) {
          if (disposed || generation !== epoch) return;
          set({
            error: `Could not close the removed poll windows. ${toIpcError(error).message}`,
            warning: false,
          });
        } finally {
          if (!disposed && generation === epoch) {
            set({ phase: "idle" });
            release();
          }
        }
      },
      resetForProfile() {
        epoch += 1;
        release();
        set({
          phase: "idle",
          confirmation: null,
          operationIds: [],
          recovery: null,
          error: null,
          retryPlan: null,
        });
      },
      dispose() {
        disposed = true;
        epoch += 1;
        stopList();
        stopSelection();
        release();
      },
    };
  });
}
