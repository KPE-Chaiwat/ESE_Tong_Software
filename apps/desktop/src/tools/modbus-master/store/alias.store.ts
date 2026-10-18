// Aliases of one poll view (DES-002 2.3.5, FE-002 task 09): the applied aliases by protocol
// address, the inline editor (one row at a time) and paste. Rust owns the alias list; this store
// mirrors `PollConfig.aliases` and sends every change through `setPollView`, in one command.
import { createStore, type StoreApi } from "zustand/vanilla";
import type { AliasEntry, PollConfig } from "@/shared/ipc/modbus-master.types";
import type { ToastStoreApi } from "@/shared/lib/toast.store";
import {
  ALIAS_LIMIT,
  aliasError,
  aliasMap,
  mergeAliases,
  parseAliasPaste,
  pasteToastText,
} from "../lib/alias";
import { isCombinedFormat, registerWidth } from "../lib/combined";

export type AliasEditStart = "f2" | "dblclick" | "menu";
/** How the editor was left: `Enter`, `Shift+Enter`, `Tab` or a blur. */
export type AliasCommitKey = "enter" | "shiftEnter" | "tab" | "blur";
/** `next` and `prev` have opened the neighbor row's editor; `end` closed the editor; `invalid` kept it open. */
export type AliasCommitResult = "next" | "prev" | "end" | "invalid";

export interface AliasEditing {
  address: number;
  text: string;
  error: string | null;
  startedBy: AliasEditStart;
}

export interface AliasState {
  /** Applied aliases by protocol address. A new Map on every change. */
  aliases: ReadonlyMap<number, string>;
  editing: AliasEditing | null;
  /** A change is on its way to Rust. */
  pending: boolean;
}

export interface AliasPasteResult {
  /** Lines in range that were applied (including lines that cleared an alias). */
  pasted: number;
  skipped: number;
  beyond: number;
  capped: boolean;
}

export interface AliasActions {
  /** Mirrors the aliases of the applied poll (`aliases follow the address`). */
  applyFromConfig(config: PollConfig): void;
  beginEdit(address: number, by: AliasEditStart): void;
  /** Validates on each keystroke (DES-002 section 4). */
  setText(text: string): void;
  commit(key: AliasCommitKey): AliasCommitResult;
  cancel(): void;
  /** "Clear alias": removes the aliases of these addresses in one command. */
  clear(addresses: readonly number[]): Promise<void>;
  /** Pastes clipboard text onto consecutive addresses from `startAddress`, in one command. */
  paste(text: string, startAddress: number): Promise<AliasPasteResult | null>;
}

export type AliasStore = AliasState & AliasActions;
export type AliasStoreApi = StoreApi<AliasStore>;

export interface AliasStoreDeps {
  /** The applied poll: its range and its alias list. */
  getConfig(): PollConfig | null;
  /** `pollStore.setView`: sends the aliases with `setPollView` and applies them optimistically. */
  setView(partial: { aliases: AliasEntry[] }): Promise<boolean>;
  toasts: ToastStoreApi;
}

function rangeOf(config: PollConfig | null): { start: number; end: number } | null {
  if (!config) return null;
  const { startAddress, quantity } = config.definition;
  return { start: startAddress, end: startAddress + quantity - 1 };
}

function sameAliases(a: ReadonlyMap<number, string>, entries: readonly AliasEntry[]): boolean {
  if (a.size !== entries.length) return false;
  return entries.every((e) => a.get(e.address) === e.alias);
}

export function createAliasStore(deps: AliasStoreDeps): AliasStoreApi {
  return createStore<AliasStore>()((set, get) => {
    /** Sends one alias list; the editor state stays as the caller left it. */
    async function send(entries: AliasEntry[]): Promise<boolean> {
      set({ aliases: aliasMap(entries), pending: true });
      const ok = await deps.setView({ aliases: entries });
      set({ pending: false });
      return ok;
    }

    const current = (): readonly AliasEntry[] => deps.getConfig()?.aliases ?? [];

    return {
      aliases: new Map(),
      editing: null,
      pending: false,

      applyFromConfig(config) {
        if (sameAliases(get().aliases, config.aliases)) return;
        set({ aliases: aliasMap(config.aliases) });
      },

      beginEdit(address, by) {
        const range = rangeOf(deps.getConfig());
        if (!range || address < range.start || address > range.end) return;
        set({
          editing: { address, text: get().aliases.get(address) ?? "", error: null, startedBy: by },
        });
      },

      setText(text) {
        const editing = get().editing;
        if (!editing) return;
        set({ editing: { ...editing, text, error: aliasError(text) } });
      },

      commit(key) {
        const editing = get().editing;
        if (!editing) return "end";
        const error = aliasError(editing.text);
        if (error !== null) {
          // Blur reverts silently; the other keys do nothing while the text is invalid.
          if (key === "blur") {
            set({ editing: null });
            return "end";
          }
          if (editing.error !== error) set({ editing: { ...editing, error } });
          return "invalid";
        }

        const alias = editing.text.trim() === "" ? "" : editing.text;
        const before = get().aliases.get(editing.address) ?? "";
        if (alias !== before) {
          const merged = mergeAliases(current(), [{ address: editing.address, alias }]);
          if (merged.capped) {
            set({ editing: { ...editing, error: ALIAS_LIMIT } });
            return "invalid";
          }
          void send(merged.entries);
        }

        const config = deps.getConfig();
        const range = rangeOf(config);
        const step =
          config && config.definition.function >= 3 && isCombinedFormat(config.display.format)
            ? registerWidth(config.display.format)
            : 1;
        const { address, startedBy } = editing;
        if (key === "enter" && range && address + step <= range.end) {
          set({
            editing: {
              address: address + step,
              text: get().aliases.get(address + step) ?? "",
              error: null,
              startedBy,
            },
          });
          return "next";
        }
        if (key === "shiftEnter" && range && address - step >= range.start) {
          set({
            editing: {
              address: address - step,
              text: get().aliases.get(address - step) ?? "",
              error: null,
              startedBy,
            },
          });
          return "prev";
        }
        set({ editing: null });
        return "end";
      },

      cancel() {
        set({ editing: null });
      },

      async clear(addresses) {
        const aliases = get().aliases;
        const edits = addresses
          .filter((a) => aliases.has(a))
          .map((address) => ({ address, alias: "" }));
        if (edits.length === 0) return;
        await send(mergeAliases(current(), edits).entries);
      },

      async paste(text, startAddress) {
        const range = rangeOf(deps.getConfig());
        if (!range) return null;
        const parsed = parseAliasPaste(text, startAddress, range.end);
        if (parsed.entries.length === 0 && parsed.skipped === 0 && parsed.beyond === 0) return null;
        const merged = mergeAliases(current(), parsed.entries);
        const pasted = parsed.entries.length - merged.dropped;
        if (merged.applied > 0) await send(merged.entries);
        deps.toasts
          .getState()
          .show(pasteToastText(pasted, parsed.skipped, parsed.beyond, merged.capped));
        return { pasted, skipped: parsed.skipped, beyond: parsed.beyond, capped: merged.capped };
      },
    };
  });
}

// ---- typed selectors and derived values ----
/** A row subscribes to its own alias: a change to another row's alias leaves it alone. */
export const selectAliasAt = (address: number) => (s: AliasStore) => s.aliases.get(address);
export const selectAliasEditing = (s: AliasStore) => s.editing;
export const selectAliasCount = (s: AliasStore) => s.aliases.size;
export const selectEditingAddress = (s: AliasStore) => s.editing?.address ?? null;
export const selectAliasPending = (s: AliasStore) => s.pending;
