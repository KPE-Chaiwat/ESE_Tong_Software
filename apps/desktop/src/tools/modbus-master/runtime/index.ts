import type { ModbusMasterIpc } from "@/shared/ipc/modbus-master";
import type { WindowIpc } from "@/shared/ipc/window";
import { isLinkUp } from "../store/session.logic";
import { type Clipboard, createController, type ModbusMasterController } from "./controller";
import { createGatewayHolder, type GatewayHolder } from "./gateway";
import { createStores, type ModbusMasterStores, type StoresOptions } from "./stores";

export interface ModbusMasterRuntime {
  stores: ModbusMasterStores;
  controller: ModbusMasterController;
  gateway: GatewayHolder;
  ipc: ModbusMasterIpc;
  windowIpc: WindowIpc;
  /** Opens the backend session and starts routing events. */
  init(): Promise<void>;
  dispose(): void;
}

export interface RuntimeOptions extends StoresOptions {
  clipboard?: Clipboard;
  disconnectTimeoutMs?: number;
}

/** Everything one Modbus Master window needs: stores, controller and the IPC they talk to. */
export function createModbusMasterRuntime(
  ipc: ModbusMasterIpc,
  windowIpc: WindowIpc,
  options: RuntimeOptions = {},
): ModbusMasterRuntime {
  const base = createStores(ipc, options);
  const gateway = createGatewayHolder(base.stores.config);
  const controller = createController({
    stores: base.stores,
    gateway,
    windowIpc,
    ...(options.clipboard ? { clipboard: options.clipboard } : {}),
    ...(options.disconnectTimeoutMs === undefined
      ? {}
      : { disconnectTimeoutMs: options.disconnectTimeoutMs }),
  });
  // Command failures are shown, never swallowed (REV-002 M1). A backend `validation` error that
  // names a field is also shown under that input and focuses it.
  const { session, traffic, toasts, write } = base.stores;
  const unsubscribeErrors = [
    session.subscribe((s, prev) => {
      if (s.commandError === null || s.commandError === prev.commandError) return;
      toasts.getState().show(s.commandError, { tone: "error", durationMs: 4000 });
      if (s.commandErrorField) gateway.current.showFieldError(s.commandErrorField, s.commandError);
      session.getState().clearCommandError();
    }),
    traffic.subscribe((s, prev) => {
      if (s.error === null || s.error === prev.error) return;
      toasts.getState().show(s.error, { tone: "error", durationMs: 4000 });
      traffic.getState().clearError();
    }),
    // A link-lost write result is replaced by an empty result area once the link is back (DES 2.5).
    session.subscribe((s, prev) => {
      if (
        isLinkUp(s.state) &&
        !isLinkUp(prev.state) &&
        write.getState().result?.status === "linkLost"
      ) {
        write.getState().clearResult();
      }
    }),
  ];

  // Opening the session twice (React StrictMode runs effects twice in development) must not
  // attach two channels.
  let started: Promise<void> | null = null;

  return {
    stores: base.stores,
    controller,
    gateway,
    ipc,
    windowIpc,
    init() {
      started ??= base.init();
      return started;
    },
    dispose() {
      for (const off of unsubscribeErrors) off();
      controller.dispose();
      base.dispose();
    },
  };
}

export type { ModbusMasterController, ModbusMasterStores };
