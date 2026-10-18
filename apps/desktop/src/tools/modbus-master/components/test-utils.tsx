// Test harness of the connection window: the whole W1 against the fake backend, with a clipboard
// that records, synchronous frame schedulers and a known workspace size (jsdom has no layout).
import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
  type FakeMode,
  pollConfigInput,
} from "@/shared/ipc/modbus-master.fake";
import type {
  ConnectionConfig,
  PollConfigInput,
  PollHostKind,
  PollId,
} from "@/shared/ipc/modbus-master.types";
import { createFakeWindowIpc, type FakeWindowIpc } from "@/shared/ipc/window";
import {
  type ConnectionRuntime,
  type ConnectionRuntimeOptions,
  createConnectionRuntime,
} from "../runtime/connection-runtime";
import { ConnectionWindow } from "./ConnectionWindow";
import { ConnectionRuntimeProvider } from "./context";

export const TCP: ConnectionConfig = {
  mode: "tcp",
  host: "192.168.1.10",
  port: 502,
  timeoutMs: 1000,
};

const syncScheduler = (cb: () => void) => {
  cb();
  return () => {};
};

export interface Harness {
  rt: ConnectionRuntime;
  ipc: FakeModbusMasterIpc;
  win: FakeWindowIpc;
  user: ReturnType<typeof userEvent.setup>;
  copied: string[];
  /** Adds a poll in the workspace (or another host) and waits for its sub-window. */
  addPoll(name?: string, patch?: Partial<PollConfigInput>, host?: PollHostKind): Promise<PollId>;
  /** Connects through the toolbar path (a valid TCP connection) and waits for `connected`. */
  connect(): Promise<void>;
  /** Runs the virtual backend for `ms`, inside act(). */
  advance(ms: number): void;
  /** Runs `fn` inside act(). */
  act<T>(fn: () => T | Promise<T>): Promise<T>;
  /** Sets the measured workspace size (jsdom measures nothing). */
  setSize(width: number, height: number): void;
  /** What the window holds now is the saved profile: it is not Modified until the next change. */
  clean(): void;
}

export interface HarnessOptions {
  mode?: FakeMode;
  /** The workspace inner size. The default gives the 1316 x 700 tile area of DES-002 2.8.1. */
  size?: { width: number; height: number };
  /** Called before the window renders (seed profiles, hold commands, ...). */
  prepare?: (ctx: { ipc: FakeModbusMasterIpc; win: FakeWindowIpc }) => void;
  /** Render before the session is opened (a held `openSession`). */
  lazyInit?: boolean;
  /** More options of the runtime (a profile save, the workspace origin, ...). */
  runtimeOptions?: Partial<ConnectionRuntimeOptions>;
}

/** Renders the whole connection window against the IPC fake. */
export async function renderWindow(options: HarnessOptions = {}): Promise<Harness> {
  const ipc = createFakeModbusMasterIpc({ mode: options.mode ?? "virtual" });
  const win = createFakeWindowIpc();
  const copied: string[] = [];
  const rt = createConnectionRuntime(ipc, win, {
    scheduler: syncScheduler,
    dragScheduler: syncScheduler,
    clipboard: {
      writeText: async (text) => {
        copied.push(text);
      },
      readText: async () => "",
    },
    toastDurationMs: 60_000,
    warn: () => {},
    getWindowHeight: () => 800,
    getWorkspaceOrigin: () => ({ x: 0, y: 0 }),
    ...options.runtimeOptions,
  });
  options.prepare?.({ ipc, win });
  const user = userEvent.setup();
  if (!options.lazyInit) {
    await act(async () => {
      await rt.init();
    });
  }
  const size = options.size ?? { width: 1332, height: 716 };
  // The toolbar's narrow variant starts below 1100 px; jsdom's default window is 1024 px wide.
  window.innerWidth = 1280;
  render(
    <ConnectionRuntimeProvider runtime={rt}>
      <div className="flex h-full flex-col">
        <ConnectionWindow />
      </div>
    </ConnectionRuntimeProvider>,
  );
  act(() => rt.stores.workspace.getState().setSize(size));

  return {
    rt,
    ipc,
    win,
    user,
    copied,
    async addPoll(name, patch, host = "workspace") {
      let id = 0;
      await act(async () => {
        id = await ipc.addPoll(
          pollConfigInput({ name: name ?? `Poll ${ipc.pollIds().length + 1}`, ...patch }),
          host,
        );
      });
      return id;
    },
    async connect() {
      await act(async () => {
        await rt.stores.connection.getState().connect(TCP);
      });
    },
    advance(ms) {
      act(() => ipc.advance(ms));
    },
    async act(fn) {
      let out!: Awaited<ReturnType<typeof fn>>;
      await act(async () => {
        out = (await fn()) as typeof out;
      });
      return out;
    },
    setSize(width, height) {
      act(() => rt.stores.workspace.getState().setSize({ width, height }));
    },
    clean() {
      act(() => rt.stores.profile.getState().setBaseline(rt.contentSignature()));
    },
  };
}
