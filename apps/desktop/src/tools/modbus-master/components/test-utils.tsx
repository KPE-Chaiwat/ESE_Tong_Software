import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
} from "@/shared/ipc/modbus-master.fake";
import type {
  ConnectionConfig,
  SessionState,
  StateChangedEvent,
} from "@/shared/ipc/modbus-master.types";
import { createFakeWindowIpc, type FakeWindowIpc } from "@/shared/ipc/window";
import { createModbusMasterRuntime, type ModbusMasterRuntime } from "../runtime";
import { ModbusMasterProvider } from "./context";
import { ModbusMasterWindow } from "./ModbusMasterWindow";

export interface Harness {
  rt: ModbusMasterRuntime;
  ipc: FakeModbusMasterIpc;
  win: FakeWindowIpc;
  user: ReturnType<typeof userEvent.setup>;
  copied: string[];
  /** Emits a backend state event inside act(). */
  state(state: SessionState, extra?: Partial<Omit<StateChangedEvent, "type" | "state">>): void;
  /** Opens the session inside act() (for `lazyInit`). */
  init(): Promise<void>;
  /** Runs any other backend emission inside act(). */
  emit(fn: () => void): void;
}

const syncScheduler = (cb: () => void) => {
  cb();
  return () => {};
};

export const TCP: ConnectionConfig = {
  mode: "tcp",
  host: "192.168.1.10",
  port: 502,
  timeoutMs: 1000,
};

export interface HarnessOptions {
  /** Called before the window renders (seed profiles, set config, ...). */
  prepare?: (h: { rt: ModbusMasterRuntime; ipc: FakeModbusMasterIpc }) => void;
  /** Render before the session is opened (for example with a held `openSession`). */
  lazyInit?: boolean;
}

/** Renders the whole Modbus Master window against the IPC fake. */
export async function renderWindow(options: HarnessOptions = {}): Promise<Harness> {
  const ipc = createFakeModbusMasterIpc();
  const win = createFakeWindowIpc();
  const copied: string[] = [];
  const rt = createModbusMasterRuntime(ipc, win, {
    scheduler: syncScheduler,
    clipboard: {
      writeText: async (text) => {
        copied.push(text);
      },
    },
    toastDurationMs: 60_000,
    warn: () => {},
  });
  options.prepare?.({ rt, ipc });
  const user = userEvent.setup();
  if (!options.lazyInit) {
    await act(async () => {
      await rt.init();
    });
  }
  render(
    <ModbusMasterProvider runtime={rt}>
      <div className="flex h-full flex-col">
        <ModbusMasterWindow />
      </div>
    </ModbusMasterProvider>,
  );
  return {
    rt,
    ipc,
    win,
    user,
    copied,
    state(state, extra) {
      act(() => ipc.emitState(state, extra));
    },
    async init() {
      await act(async () => {
        await rt.init();
      });
    },
    emit(fn) {
      act(fn);
    },
  };
}
