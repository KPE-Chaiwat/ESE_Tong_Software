// Screen reader announcements of the connection window (DES-002 2.10.8, 1.5 rule 5, DES-001 7):
// one polite and one assertive live region. A repeated text is announced again because every call
// gets a new sequence number (the region re-renders its node by it).
import { createStore, type StoreApi } from "zustand/vanilla";

export interface Announcement {
  text: string;
  seq: number;
}

export interface AnnouncerState {
  polite: Announcement;
  assertive: Announcement;
}

export interface AnnouncerActions {
  /** `assertive` is for a lost connection; everything else is polite. */
  announce(text: string, options?: { assertive?: boolean }): void;
  clear(): void;
}

export type AnnouncerStore = AnnouncerState & AnnouncerActions;
export type AnnouncerStoreApi = StoreApi<AnnouncerStore>;

const EMPTY: Announcement = { text: "", seq: 0 };

export interface AnnouncerOptions {
  /** Called for every announcement (the fake window IPC logs them for tests). */
  onAnnounce?: (text: string, assertive: boolean) => void;
}

export function createAnnouncerStore(options: AnnouncerOptions = {}): AnnouncerStoreApi {
  let seq = 0;
  return createStore<AnnouncerStore>()((set) => ({
    polite: EMPTY,
    assertive: EMPTY,
    announce(text, announceOptions = {}) {
      seq += 1;
      const entry = { text, seq };
      options.onAnnounce?.(text, announceOptions.assertive === true);
      // Only one region speaks at a time: the other one is emptied.
      set(
        announceOptions.assertive
          ? { assertive: entry, polite: EMPTY }
          : { polite: entry, assertive: EMPTY },
      );
    },
    clear: () => set({ polite: EMPTY, assertive: EMPTY }),
  }));
}
