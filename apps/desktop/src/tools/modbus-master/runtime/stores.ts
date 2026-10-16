// Composition root of one Modbus Master window: creates every store, wires them together and
// routes the backend events. Each Tauri window is its own JS context, so there is exactly one
// runtime per window; tests create a fresh runtime per test.
import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import type { SessionEvent, SessionSnapshot, TrafficFrame } from "@/shared/ipc/modbus-master.types";
import { createToastStore, type ToastStoreApi } from "@/shared/lib/toast.store";
import { type ConfigStoreApi, createConfigStore } from "../store/config.store";
import { type ConfirmStoreApi, createConfirmStore } from "../store/confirm.store";
import { createDialogsStore, type DialogsStoreApi } from "../store/dialogs.store";
import { createLayoutStore, type LayoutStoreApi } from "../store/layout.store";
import { pollDataActionFor } from "../store/poll-data.logic";
import { createPollDataStore, type PollDataStoreApi } from "../store/poll-data.store";
import { createProfilesStore, type ProfilesStoreApi } from "../store/profiles.store";
import { createSerialPortsStore, type SerialPortsStoreApi } from "../store/serial-ports.store";
import { isLinkUp, isPollRunning } from "../store/session.logic";
import { createSessionStore, type SessionStoreApi } from "../store/session.store";
import { createSetupStatusStore, type SetupStatusStoreApi } from "../store/setup-status.store";
import { createTableSelectionStore, type SelectionStoreApi } from "../store/table-selection.store";
import { createBatcher, type FrameScheduler, TRAFFIC_CAPACITY } from "../store/traffic.logic";
import { createTrafficStore, type TrafficStoreApi } from "../store/traffic.store";
import { createWriteStore, type WriteStoreApi } from "../store/write.store";

export interface ModbusMasterStores {
  session: SessionStoreApi;
  config: ConfigStoreApi;
  layout: LayoutStoreApi;
  serialPorts: SerialPortsStoreApi;
  pollData: PollDataStoreApi;
  selection: SelectionStoreApi;
  traffic: TrafficStoreApi;
  write: WriteStoreApi;
  profiles: ProfilesStoreApi;
  confirm: ConfirmStoreApi;
  dialogs: DialogsStoreApi;
  setupStatus: SetupStatusStoreApi;
  toasts: ToastStoreApi;
}

export interface StoresOptions {
  /** Frame scheduler for coalescing traffic updates. Defaults to requestAnimationFrame. */
  scheduler?: FrameScheduler;
  warn?: (message: string) => void;
  toastDurationMs?: number;
}

export interface StoresRuntime {
  stores: ModbusMasterStores;
  /** Opens the backend session (`mm_open_session`) and starts routing events. */
  init(): Promise<void>;
  dispose(): void;
}

export function createStores(ipc: ModbusMasterIpc, options: StoresOptions = {}): StoresRuntime {
  const config = createConfigStore();
  const layout = createLayoutStore();
  const pollData = createPollDataStore();
  const selection = createTableSelectionStore();
  const serialPorts = createSerialPortsStore({ ipc });
  const profiles = createProfilesStore({ ipc });
  const traffic = createTrafficStore({ ipc });
  const confirm = createConfirmStore();
  const dialogs = createDialogsStore();
  const setupStatus = createSetupStatusStore();
  const toasts = createToastStore(
    options.toastDurationMs === undefined ? {} : { durationMs: options.toastDurationMs },
  );

  // Traffic frames arrive in bursts: coalesce them into one store write per animation frame.
  const frameBatcher = createBatcher<TrafficFrame>(
    (frames) => traffic.getState().appendFrames(frames),
    options.scheduler,
    TRAFFIC_CAPACITY,
  );

  const route = (event: SessionEvent): void => {
    switch (event.type) {
      case "PollUpdate":
        pollData.getState().applyUpdate(event);
        break;
      case "TrafficFrames":
        frameBatcher.push(event.frames);
        break;
      case "Counters":
        traffic.getState().setCounters({
          requests: event.requests,
          responses: event.responses,
          errors: event.errors,
          timeouts: event.timeouts,
        });
        break;
      case "StateChanged":
        break;
    }
  };

  const onSnapshot = (snapshot: SessionSnapshot): void => {
    traffic.getState().setCounters(snapshot.counters);
    // A reloaded window gets its setup back from the backend.
    config.getState().adoptBackendSetup(snapshot.config, snapshot.poll);
    const data = pollData.getState();
    if (snapshot.poll && (isPollRunning(snapshot.state) || snapshot.lastUpdate)) {
      data.begin(snapshot.poll);
      if (snapshot.lastUpdate) data.applyUpdate({ type: "PollUpdate", ...snapshot.lastUpdate });
      // Values from before the reload are stale unless the poll is running fine.
      if (snapshot.state !== "polling") pollData.getState().markStale();
    }
  };

  const session = createSessionStore({
    ipc,
    onEvent: route,
    onSnapshot,
    ...(options.warn ? { warn: options.warn } : {}),
  });

  const write = createWriteStore({
    ipc,
    getAddressBase: () => config.getState().display.addressBase,
    getTableFormat: () => config.getState().display.format,
    getPoll: () => config.getState().poll,
    isLinkUp: () => isLinkUp(session.getState().state),
  });

  // Session state -> poll data (FE-001 task 11 wiring rule).
  const unsubscribeSession = session.subscribe((state, prev) => {
    if (state.state === prev.state && state.revision === prev.revision) return;
    // Only the event that answers the Apply restarts the view, not a repeated failure before it.
    const restarted = prev.pending === "startPoll" && state.pending === null;
    const action = pollDataActionFor(prev.state, state.state, restarted);
    const data = pollData.getState();
    if (action === "begin") data.begin(state.pollDefinition ?? config.getState().poll);
    else if (action === "markStale") data.markStale();
    else if (action === "clear") data.clear();
  });

  // The table selection follows the number of rows on screen.
  const unsubscribePoll = pollData.subscribe((state, prev) => {
    if (state.definition === prev.definition) return;
    selection.getState().setRowCount(state.definition?.quantity ?? 0);
  });

  return {
    stores: {
      session,
      config,
      layout,
      serialPorts,
      pollData,
      selection,
      traffic,
      write,
      profiles,
      confirm,
      dialogs,
      setupStatus,
      toasts,
    },
    init: () => session.getState().init(),
    dispose() {
      unsubscribeSession();
      unsubscribePoll();
      frameBatcher.dispose();
      toasts.getState().clear();
    },
  };
}
