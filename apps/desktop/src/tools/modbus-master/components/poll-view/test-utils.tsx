// Test harness of the poll view: one poll on the fake backend, a runtime for it, the PollView
// rendered in a host, and a controllable ResizeObserver (jsdom has no layout).
import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useRef } from "react";
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
import { createToastStore, type ToastStoreApi } from "@/shared/lib/toast.store";
import type { ScaledProviderFactory } from "../../lib/scaled";
import type { PollClipboard } from "../../runtime/clipboard";
import {
  createPollViewRuntime,
  type PollHostActions,
  type PollViewRuntime,
} from "../../runtime/poll-view-runtime";
import { type ConnectionStoreApi, createConnectionStore } from "../../store/connection.store";
import { PollView } from "./PollView";

export const TCP: ConnectionConfig = {
  mode: "tcp",
  host: "192.168.1.10",
  port: 502,
  timeoutMs: 1000,
};

/** A ResizeObserver whose callbacks the test fires by hand (jsdom never lays anything out). */
class ControlledResizeObserver {
  static all = new Set<ControlledResizeObserver>();
  #callback: ResizeObserverCallback;
  #targets = new Set<Element>();
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
    ControlledResizeObserver.all.add(this);
  }
  observe(target: Element) {
    this.#targets.add(target);
  }
  unobserve(target: Element) {
    this.#targets.delete(target);
  }
  disconnect() {
    this.#targets.clear();
    ControlledResizeObserver.all.delete(this);
  }
  /** Sets `offsetWidth` of the observed frame elements and tells the observer. */
  fireFrame(width: number) {
    for (const target of this.#targets) {
      if (
        target.getAttribute("data-slot") !== "test-frame" &&
        !target.hasAttribute("data-subwindow")
      )
        continue;
      Object.defineProperty(target, "offsetWidth", { configurable: true, value: width });
      this.#callback([], this as unknown as ResizeObserver);
    }
  }
  /**
   * Reports `width` (the BORDER box, what the app measures) for the observed elements of one slot (the
   * poll view by default), never the virtualizer's. `contentWidth` is the content box (the border box
   * minus padding and borders; default: the same); a test that feeds back the real padding of the
   * element passes it, and a correct measurement ignores it (REPORT-008 D11).
   */
  fire(width: number, slot = "poll-view", contentWidth = width) {
    for (const target of this.#targets) {
      if (target.getAttribute("data-slot") !== slot) continue;
      this.#callback(
        [
          {
            target,
            contentRect: { width: contentWidth, height: 400 },
            borderBoxSize: [{ inlineSize: width, blockSize: 400 }],
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
  }
}

/**
 * Reports `width` as the real (layout) width of every observed frame element: a sub-window's
 * `<section data-subwindow>` or the harness frame. jsdom lays nothing out, so `offsetWidth` is set by hand.
 */
export function fireFrameWidth(width: number): void {
  for (const ro of ControlledResizeObserver.all) ro.fireFrame(width);
}

let installed: { ro: typeof ResizeObserver; raf: typeof requestAnimationFrame } | null = null;

export function installPollViewEnvironment(): void {
  if (installed) return;
  installed = { ro: globalThis.ResizeObserver, raf: globalThis.requestAnimationFrame };
  globalThis.ResizeObserver = ControlledResizeObserver as unknown as typeof ResizeObserver;
  // Animation frames run at once, so a width change is applied inside `act`.
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof requestAnimationFrame;
}

export function uninstallPollViewEnvironment(): void {
  if (!installed) return;
  globalThis.ResizeObserver = installed.ro;
  globalThis.requestAnimationFrame = installed.raf;
  installed = null;
  ControlledResizeObserver.all.clear();
}

const live: PollViewRuntime[] = [];

/** Call in afterEach: detaches every runtime a test created. */
export function disposeHarnesses(): void {
  for (const rt of live.splice(0)) rt.dispose();
}

export interface PollViewHarness {
  ipc: FakeModbusMasterIpc;
  rt: PollViewRuntime;
  pollId: PollId;
  user: ReturnType<typeof userEvent.setup>;
  toasts: ToastStoreApi;
  connection: ConnectionStoreApi;
  copied: string[];
  /** Sets the width of the poll view (the container query). */
  setWidth(width: number): void;
  /** With `inFrame`: sets the real width of the frame element around the view (borders included). */
  setFrameWidth(width: number): void;
  /** Sets the width of the scale section's container (its field pairs stack when it is narrow). */
  setScaleWidth(width: number): void;
  /** With `holdAttach`: lets the attach snapshot arrive. */
  release(): Promise<void>;
  /** Runs the backend for `ms` (virtual time), inside act(). */
  advance(ms: number): void;
  /** Runs `fn` (emits, backend commands) inside act(). */
  act<T>(fn: () => T | Promise<T>): Promise<T>;
}

export interface HarnessOptions {
  host?: PollHostKind;
  mode?: FakeMode;
  poll?: Partial<PollConfigInput>;
  /** Connect before rendering (virtual mode) so the poll is polling. */
  connect?: boolean;
  /** Start a new poll paused instead of polling. */
  paused?: boolean;
  width?: number;
  /** Render the view inside a frame element (a sub-window), whose width the test sets with `setFrameWidth`. */
  inFrame?: boolean;
  hostActions?: PollHostActions;
  createScaled?: ScaledProviderFactory;
  clipboard?: PollClipboard;
  scaleSection?: ReactNode;
  /** Wraps the rendered view (a React ancestor, for event bubbling tests). */
  wrapper?: (view: ReactNode) => ReactNode;
  focusName?: boolean;
  /** Render before the attach snapshot arrives. */
  holdAttach?: boolean;
  /** With `holdAttach`: the handoff JSON the attach snapshot carries (the previous host's state). */
  handoff?: string;
  /** Seed the fake before the view attaches. */
  prepare?: (ctx: { ipc: FakeModbusMasterIpc; pollId: PollId }) => Promise<void> | void;
  getOtherNames?: () => readonly string[];
}

/** Renders one poll in a PollView against the fake backend. */
export async function renderPollView(options: HarnessOptions = {}): Promise<PollViewHarness> {
  installPollViewEnvironment();
  const host = options.host ?? "workspace";
  const ipc = createFakeModbusMasterIpc({ mode: options.mode ?? "virtual" });
  const toasts = createToastStore({ setTimer: () => 0, clearTimer: () => {} });
  const copied: string[] = [];
  const connection = createConnectionStore({
    ipc,
    role: host === "native" ? "poll" : "window",
    warn: () => {},
  });
  const snapshot = await ipc.openSession((e) => {
    if (e.type === "ConnectionStateChanged") connection.getState().applyConnectionStateChanged(e);
  });
  connection.getState().applySnapshot({ connection: snapshot.connection });

  const pollId = await ipc.addPoll(
    pollConfigInput({
      name: "Tank 1",
      definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
      ...options.poll,
    }),
    host,
  );
  if (options.connect) {
    // The connection store of a native window learns the link from its own events.
    await connection.getState().connect(TCP);
  }
  if (options.paused) await ipc.setPollActive(pollId, false);
  await options.prepare?.({ ipc, pollId });

  const rt = createPollViewRuntime({
    ipc,
    pollId,
    host,
    connection,
    toasts,
    getOtherNames: options.getOtherNames ?? (() => []),
    clipboard: options.clipboard ?? {
      writeText: async (t) => {
        copied.push(t);
      },
      readText: async () => "",
    },
    ...(options.hostActions ? { hostActions: options.hostActions } : {}),
    ...(options.createScaled ? { createScaled: options.createScaled } : {}),
    warn: () => {},
  });
  live.push(rt);
  const held = options.holdAttach ? ipc.hold("attachPollView") : null;
  const user = userEvent.setup();
  const harness: PollViewHarness = {
    ipc,
    rt,
    pollId,
    user,
    toasts,
    connection,
    copied,
    setWidth(width) {
      act(() => {
        for (const ro of ControlledResizeObserver.all) ro.fire(width);
      });
    },
    setFrameWidth(width) {
      act(() => fireFrameWidth(width));
    },
    setScaleWidth(width) {
      act(() => {
        for (const ro of ControlledResizeObserver.all) ro.fire(width, "scale-section");
      });
    },
    async release() {
      if (!held) return;
      const token = ipc.attachedViews().find((v) => v.pollId === pollId)?.token ?? 1;
      await act(async () => {
        held.release({
          viewToken: token,
          host,
          connection: ipc.connection(),
          poll: ipc.pollSummary(pollId),
          lastUpdate: null,
          handoff: options.handoff ?? null,
          compact: false,
          askOnPollClose: true,
          profileName: null,
        });
        await rt.init();
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
  if (!options.holdAttach) {
    await act(async () => {
      await rt.init();
    });
  } else {
    // The channel is live, the snapshot is held until the test calls `release()`.
    void rt.init();
  }
  const view = (
    <FrameAround enabled={options.inFrame === true} runtime={rt} host={host} options={options} />
  );
  render(options.wrapper ? options.wrapper(view) : view);
  if (options.width !== undefined) harness.setWidth(options.width);
  return harness;
}

/** A frame element around the view when a test asks for one; the view measures that element. */
function FrameAround({
  enabled,
  runtime,
  host,
  options,
}: {
  enabled: boolean;
  runtime: PollViewRuntime;
  host: PollHostKind;
  options: HarnessOptions;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pollView = (
    <PollView
      runtime={runtime}
      host={host}
      {...(enabled ? { frame: ref } : {})}
      {...(options.scaleSection ? { scaleSection: options.scaleSection } : {})}
      {...(options.focusName ? { focusName: options.focusName } : {})}
    />
  );
  return enabled ? (
    <div ref={ref} data-slot="test-frame">
      {pollView}
    </div>
  ) : (
    pollView
  );
}
