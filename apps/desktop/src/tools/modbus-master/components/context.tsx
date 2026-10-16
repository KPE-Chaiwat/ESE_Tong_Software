import { createContext, type ReactNode, useContext, useEffect } from "react";
import { useStore } from "zustand";
import type { ModbusMasterRuntime } from "../runtime";
import type { ConfigStore } from "../store/config.store";
import type { ConfirmStore } from "../store/confirm.store";
import type { DialogsStore } from "../store/dialogs.store";
import type { LayoutStore } from "../store/layout.store";
import type { PollDataStore } from "../store/poll-data.store";
import type { ProfilesStore } from "../store/profiles.store";
import type { SerialPortsStore } from "../store/serial-ports.store";
import type { SessionStore } from "../store/session.store";
import type { SetupStatusStore } from "../store/setup-status.store";
import type { SelectionStore } from "../store/table-selection.store";
import type { TrafficStore } from "../store/traffic.store";
import type { WriteStore } from "../store/write.store";

const RuntimeContext = createContext<ModbusMasterRuntime | null>(null);

export function ModbusMasterProvider({
  runtime,
  children,
}: {
  runtime: ModbusMasterRuntime;
  children: ReactNode;
}) {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): ModbusMasterRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("ModbusMasterProvider is missing");
  return runtime;
}

export const useController = () => useRuntime().controller;

// Typed store hooks. Components select the minimum slice so unrelated updates do not re-render them.
export const useSession = <T,>(sel: (s: SessionStore) => T) =>
  useStore(useRuntime().stores.session, sel);
export const useConfig = <T,>(sel: (s: ConfigStore) => T) =>
  useStore(useRuntime().stores.config, sel);
export const useLayout = <T,>(sel: (s: LayoutStore) => T) =>
  useStore(useRuntime().stores.layout, sel);
export const useSerialPorts = <T,>(sel: (s: SerialPortsStore) => T) =>
  useStore(useRuntime().stores.serialPorts, sel);
export const usePollData = <T,>(sel: (s: PollDataStore) => T) =>
  useStore(useRuntime().stores.pollData, sel);
export const useSelection = <T,>(sel: (s: SelectionStore) => T) =>
  useStore(useRuntime().stores.selection, sel);
export const useTraffic = <T,>(sel: (s: TrafficStore) => T) =>
  useStore(useRuntime().stores.traffic, sel);
export const useWrite = <T,>(sel: (s: WriteStore) => T) => useStore(useRuntime().stores.write, sel);
export const useProfiles = <T,>(sel: (s: ProfilesStore) => T) =>
  useStore(useRuntime().stores.profiles, sel);
export const useConfirm = <T,>(sel: (s: ConfirmStore) => T) =>
  useStore(useRuntime().stores.confirm, sel);
export const useDialogs = <T,>(sel: (s: DialogsStore) => T) =>
  useStore(useRuntime().stores.dialogs, sel);
export const useSetupStatus = <T,>(sel: (s: SetupStatusStore) => T) =>
  useStore(useRuntime().stores.setupStatus, sel);

/**
 * The connection and poll the session actually has: what the banner, the live region and the write
 * dialog describe. The setup form holds drafts that may differ until Connect or Apply (REV-002 M2).
 */
export function useRunningSetup() {
  const connection = useSession((s) => s.connection);
  const poll = useSession((s) => s.pollDefinition);
  const draftConnection = useConfig((s) => s.connection);
  const draftPoll = useConfig((s) => s.poll);
  return { connection: connection ?? draftConnection, poll: poll ?? draftPoll };
}

/** Tells the layout store that a modal is open while `open` is true (disables the shortcuts). */
export function useModalLock(open: boolean): void {
  const layout = useRuntime().stores.layout;
  useEffect(() => {
    if (!open) return;
    return layout.getState().lockModal();
  }, [open, layout]);
}
