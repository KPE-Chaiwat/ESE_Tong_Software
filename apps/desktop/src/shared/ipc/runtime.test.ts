import { vi } from "vitest";
import { createIpcRuntime } from "./runtime";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  delete window.__ESEFACT_FAKE_IPC__;
  delete window.__ESEFACT_FAKE_WINDOW_IPC__;
});

const tcp = { mode: "tcp", host: "h", port: 502, timeoutMs: 1000 } as const;

describe("createIpcRuntime (test hooks only with the env flag)", () => {
  it("without the flag it is the real backend and installs no global", () => {
    vi.stubEnv("VITE_FAKE_IPC", "");
    const runtime = createIpcRuntime();
    expect(window.__ESEFACT_FAKE_IPC__).toBeUndefined();
    expect(window.__ESEFACT_FAKE_WINDOW_IPC__).toBeUndefined();
    expect("callsOf" in runtime.modbus).toBe(false);
    expect("requestClose" in runtime.window).toBe(false);
  });

  it("any other value is not a flag either", () => {
    vi.stubEnv("VITE_FAKE_IPC", "0");
    createIpcRuntime();
    expect(window.__ESEFACT_FAKE_IPC__).toBeUndefined();
    expect(window.__ESEFACT_FAKE_WINDOW_IPC__).toBeUndefined();
  });

  it("VITE_FAKE_IPC=1 installs the simulating fake and the fake window", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_FAKE_IPC", "1");
    const runtime = createIpcRuntime();
    expect(window.__ESEFACT_FAKE_IPC__).toBe(runtime.modbus);
    expect(window.__ESEFACT_FAKE_WINDOW_IPC__).toBe(runtime.window);
    const states: string[] = [];
    await runtime.modbus.openSession((e) => {
      if (e.type === "ConnectionStateChanged") states.push(e.state);
    });
    await runtime.modbus.connect(tcp);
    await vi.advanceTimersByTimeAsync(300);
    expect(states).toEqual(["connecting", "connected"]);
    window.__ESEFACT_FAKE_IPC__?.reset();
  });

  it("VITE_FAKE_IPC=manual installs the same hooks but nothing happens by itself", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_FAKE_IPC", "manual");
    const runtime = createIpcRuntime();
    expect(window.__ESEFACT_FAKE_IPC__).toBe(runtime.modbus);
    expect(window.__ESEFACT_FAKE_WINDOW_IPC__).toBe(runtime.window);
    const states: string[] = [];
    await runtime.modbus.openSession((e) => {
      if (e.type === "ConnectionStateChanged") states.push(e.state);
    });
    await runtime.modbus.connect(tcp);
    await runtime.modbus.addPoll(
      {
        name: "Poll 1",
        definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
        display: { addressBase: 0, showAlias: true, copyAlias: false },
        formatOverrides: [],
        colorRules: [],
        scale: null,
        scaleOverrides: [],
        valueColumns: "raw",
        aliases: [],
      },
      "workspace",
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(states).toEqual([]);
    // The test drives the session itself.
    window.__ESEFACT_FAKE_IPC__?.emitConnectionState("connecting");
    expect(states).toEqual(["connecting"]);
  });

  it("the fake window exposes the close request, openedTools and titles", async () => {
    vi.stubEnv("VITE_FAKE_IPC", "manual");
    const runtime = createIpcRuntime();
    const hook = window.__ESEFACT_FAKE_WINDOW_IPC__;
    await runtime.window.setTitle("Modbus Master - Untitled - Not connected");
    await runtime.window.openToolWindow("modbus-master");
    expect(hook?.titles).toEqual(["Modbus Master - Untitled - Not connected"]);
    expect(hook?.openedTools).toEqual(["modbus-master"]);
    await runtime.window.onCloseRequested(() => "cancel");
    await expect(hook?.requestClose()).resolves.toBe(false);
  });
});

describe("createIpcRuntime hooks (REPORT-003 section 5, item 3)", () => {
  it("the fake window and the Modbus fake share one monitor list", () => {
    vi.stubEnv("VITE_FAKE_IPC", "manual");
    const runtime = createIpcRuntime();
    const fakeWindow = window.__ESEFACT_FAKE_WINDOW_IPC__;
    const fake = window.__ESEFACT_FAKE_IPC__;
    expect(runtime.window).toBe(fakeWindow);
    if (!fakeWindow || !fake) throw new Error("the hooks are installed");
    fakeWindow.monitors = [];
    expect(fake.monitors).toEqual([]);
  });

  it("?fakePersist keeps the fake's model in sessionStorage across a new runtime (a reload)", async () => {
    vi.stubEnv("VITE_FAKE_IPC", "manual");
    window.sessionStorage.clear();
    window.history.pushState({}, "", "/?fakePersist");
    try {
      const first = createIpcRuntime();
      await first.modbus.openSession(() => {});
      await first.modbus.addPoll(
        {
          name: "Kept",
          definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
          display: { addressBase: 0, showAlias: true, copyAlias: false },
          formatOverrides: [],
          colorRules: [],
          scale: null,
          scaleOverrides: [],
          valueColumns: "raw",
          aliases: [],
        },
        "workspace",
      );
      const second = createIpcRuntime();
      const snapshot = await second.modbus.openSession(() => {});
      expect(snapshot.polls.map((p) => p.config.name)).toEqual(["Kept"]);
    } finally {
      window.history.pushState({}, "", "/");
      window.sessionStorage.clear();
    }
  });

  it("without ?fakePersist nothing is stored", async () => {
    vi.stubEnv("VITE_FAKE_IPC", "manual");
    window.sessionStorage.clear();
    const runtime = createIpcRuntime();
    await runtime.modbus.openSession(() => {});
    expect(window.sessionStorage.length).toBe(0);
  });
});
