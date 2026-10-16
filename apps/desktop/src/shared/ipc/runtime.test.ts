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
      if (e.type === "StateChanged") states.push(e.state);
    });
    await runtime.modbus.connect(tcp);
    await vi.advanceTimersByTimeAsync(300);
    expect(states).toEqual(["connecting", "connected"]);
  });

  it("VITE_FAKE_IPC=manual installs the same hooks but nothing happens by itself", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_FAKE_IPC", "manual");
    const runtime = createIpcRuntime();
    expect(window.__ESEFACT_FAKE_IPC__).toBe(runtime.modbus);
    expect(window.__ESEFACT_FAKE_WINDOW_IPC__).toBe(runtime.window);
    const states: string[] = [];
    await runtime.modbus.openSession((e) => {
      if (e.type === "StateChanged") states.push(e.state);
    });
    await runtime.modbus.connect(tcp);
    await runtime.modbus.startPoll({
      slaveId: 1,
      function: 3,
      startAddress: 0,
      quantity: 10,
      scanRateMs: 100,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(states).toEqual([]);
    // The test drives the session itself.
    window.__ESEFACT_FAKE_IPC__?.emitState("connecting");
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
