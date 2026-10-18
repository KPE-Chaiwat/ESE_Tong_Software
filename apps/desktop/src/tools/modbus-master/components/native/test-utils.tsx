// Test harness of the native poll window W2: one native poll on the fake backend, its runtime, the
// whole window rendered, and a controllable ResizeObserver (jsdom has no layout).
import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
  type FakeMode,
  pollConfigInput,
} from "@/shared/ipc/modbus-master.fake";
import type { ConnectionConfig, PollConfigInput, PollId } from "@/shared/ipc/modbus-master.types";
import { createFakeWindowIpc, type FakeWindowIpc } from "@/shared/ipc/window";
import {
  createNativePollRuntime,
  type NativePollRuntime,
  type NativePollRuntimeOptions,
} from "../../runtime/native-poll-runtime";
import { installPollViewEnvironment, uninstallPollViewEnvironment } from "../poll-view/test-utils";
import { NativeRuntimeProvider } from "./context";
import { NativePollWindow } from "./NativePollWindow";

export const TCP: ConnectionConfig = {
  mode: "tcp",
  host: "192.168.1.10",
  port: 502,
  timeoutMs: 1000,
};

export { installPollViewEnvironment, uninstallPollViewEnvironment };

export interface NativeHarness {
  ipc: FakeModbusMasterIpc;
  win: FakeWindowIpc;
  rt: NativePollRuntime;
  pollId: PollId;
  user: ReturnType<typeof userEvent.setup>;
  blurred: () => number;
  /** Sets the width of the poll view (the container query). */
  setWidth(width: number): void;
  /** Connects the link (virtual mode) and waits for it. */
  connect(): Promise<void>;
  advance(ms: number): void;
  act<T>(fn: () => T | Promise<T>): Promise<T>;
}

export interface NativeHarnessOptions {
  mode?: FakeMode;
  poll?: Partial<PollConfigInput>;
  /** Seed the fake before the window attaches (profile name, connection, preferences). */
  prepare?: (ctx: { ipc: FakeModbusMasterIpc; pollId: PollId }) => Promise<void> | void;
  runtime?: Partial<NativePollRuntimeOptions>;
  /** Do not render or start the runtime (a test that starts it itself). */
  noRender?: boolean;
}

const live: NativePollRuntime[] = [];

/** Call in afterEach. */
export function disposeNativeHarnesses(): void {
  for (const rt of live.splice(0)) rt.dispose();
}

/** Renders a native poll window against the fake backend. */
export async function renderNativeWindow(
  options: NativeHarnessOptions = {},
): Promise<NativeHarness> {
  installPollViewEnvironment();
  const ipc = createFakeModbusMasterIpc({ mode: options.mode ?? "virtual" });
  const win = createFakeWindowIpc();
  await ipc.openSession(() => {});
  const pollId = await ipc.addPoll(
    pollConfigInput({
      name: "Pump 2",
      definition: { slaveId: 5, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
      ...options.poll,
    }),
    "native",
  );
  await options.prepare?.({ ipc, pollId });
  let blurs = 0;
  const rt = createNativePollRuntime(ipc, win, {
    pollId,
    toastDurationMs: 60_000,
    warn: () => {},
    blurEditors: () => {
      blurs += 1;
    },
    ...options.runtime,
  });
  live.push(rt);
  const user = userEvent.setup();
  const harness: NativeHarness = {
    ipc,
    win,
    rt,
    pollId,
    user,
    blurred: () => blurs,
    setWidth(width) {
      // Reuses the controllable observer of the poll view harness.
      act(() => {
        // The window width: the poll view and the toolbar (a full-width block) both measure it.
        for (const ro of controlledObservers()) {
          ro.fire(width);
          ro.fire(width, "native-toolbar");
        }
      });
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
  };
  if (options.noRender) return harness;
  render(
    <NativeRuntimeProvider runtime={rt}>
      <div className="flex h-full flex-col">
        <NativePollWindow />
      </div>
    </NativeRuntimeProvider>,
  );
  await act(async () => {
    await rt.init();
  });
  return harness;
}

interface Firing {
  fire(width: number, slot?: string, contentWidth?: number): void;
}

/** The poll view harness keeps its observers private; the native one fires through the global class. */
function controlledObservers(): Iterable<Firing> {
  const Ctor = globalThis.ResizeObserver as unknown as { all?: Set<Firing> };
  return Ctor.all ?? [];
}

/**
 * Reports the toolbar of a native window: `borderWidth` is its border box (the window width),
 * `contentWidth` its content box (the border box minus its padding).
 */
export function fireToolbarWidth(borderWidth: number, contentWidth: number): void {
  act(() => {
    for (const ro of controlledObservers()) ro.fire(borderWidth, "native-toolbar", contentWidth);
  });
}
