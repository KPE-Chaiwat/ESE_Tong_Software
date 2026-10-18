import { createContext, type ReactNode, useContext, useEffect } from "react";
import { useStore } from "zustand";
import type { ConnectionRuntime } from "../runtime/connection-runtime";
import type { AnnouncerStore } from "../store/announcer.store";
import type { ArrangeStore } from "../store/arrange.store";
import type { ConfirmStore } from "../store/confirm.store";
import type { ConnectionStore } from "../store/connection.store";
import type { ConnectionDraftStore } from "../store/connection-draft.store";
import type { ConnectionSectionStore } from "../store/connection-section.store";
import type { DialogsStore } from "../store/dialogs.store";
import type { DragStore } from "../store/drag.store";
import type { LayoutStore } from "../store/layout.store";
import type { PollHostStore } from "../store/poll-host.store";
import type { PollListStore } from "../store/poll-list.store";
import type { PrefsStore } from "../store/prefs.store";
import type { ProfileInfoStore } from "../store/profile-info.store";
import type { ProfilesStore } from "../store/profiles.store";
import type { SerialPortsStore } from "../store/serial-ports.store";
import type { TrafficStore } from "../store/traffic.store";
import type { WorkspaceStore } from "../store/workspace.store";

const RuntimeContext = createContext<ConnectionRuntime | null>(null);

export function ConnectionRuntimeProvider({
  runtime,
  children,
}: {
  runtime: ConnectionRuntime;
  children: ReactNode;
}) {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): ConnectionRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("ConnectionRuntimeProvider is missing");
  return runtime;
}

export const useActions = () => useRuntime().actions;

// Typed store hooks. Components select the minimum slice so unrelated updates do not re-render them.
export const useConnection = <T,>(sel: (s: ConnectionStore) => T) =>
  useStore(useRuntime().stores.connection, sel);
export const useConnectionDraft = <T,>(sel: (s: ConnectionDraftStore) => T) =>
  useStore(useRuntime().stores.draft, sel);
export const useSection = <T,>(sel: (s: ConnectionSectionStore) => T) =>
  useStore(useRuntime().stores.section, sel);
export const usePollList = <T,>(sel: (s: PollListStore) => T) =>
  useStore(useRuntime().stores.pollList, sel);
export const useTraffic = <T,>(sel: (s: TrafficStore) => T) =>
  useStore(useRuntime().stores.traffic, sel);
export const useWorkspace = <T,>(sel: (s: WorkspaceStore) => T) =>
  useStore(useRuntime().stores.workspace, sel);
export const useDrag = <T,>(sel: (s: DragStore) => T) => useStore(useRuntime().stores.drag, sel);
export const usePrefs = <T,>(sel: (s: PrefsStore) => T) => useStore(useRuntime().stores.prefs, sel);
export const usePollHost = <T,>(sel: (s: PollHostStore) => T) =>
  useStore(useRuntime().stores.host, sel);
export const useArrange = <T,>(sel: (s: ArrangeStore) => T) =>
  useStore(useRuntime().stores.arrange, sel);
export const useAnnouncer = <T,>(sel: (s: AnnouncerStore) => T) =>
  useStore(useRuntime().stores.announcer, sel);
export const useProfileInfo = <T,>(sel: (s: ProfileInfoStore) => T) =>
  useStore(useRuntime().stores.profile, sel);
export const useProfiles = <T,>(sel: (s: ProfilesStore) => T) =>
  useStore(useRuntime().stores.profiles, sel);
export const useDialogs = <T,>(sel: (s: DialogsStore) => T) =>
  useStore(useRuntime().stores.dialogs, sel);
export const useConfirm = <T,>(sel: (s: ConfirmStore) => T) =>
  useStore(useRuntime().stores.confirm, sel);
export const useSerialPorts = <T,>(sel: (s: SerialPortsStore) => T) =>
  useStore(useRuntime().stores.serialPorts, sel);
export const useLayout = <T,>(sel: (s: LayoutStore) => T) =>
  useStore(useRuntime().stores.layout, sel);

/** Tells the layout store that a modal is open while `open` is true (disables the shortcuts). */
export function useModalLock(open: boolean): void {
  const layout = useRuntime().stores.layout;
  useEffect(() => {
    if (!open) return;
    return layout.getState().lockModal();
  }, [open, layout]);
}
