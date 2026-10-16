import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { IpcError, toIpcError } from "./modbus-master";
import { createFakeModbusMasterIpc } from "./modbus-master.fake";
import type { ConnectionConfig, Profile, SessionEvent } from "./modbus-master.types";

const tcpConfig: ConnectionConfig = {
  mode: "tcp",
  host: "192.168.1.10",
  port: 502,
  timeoutMs: 1000,
};
const poll = { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 } as const;

function profile(name: string): Profile {
  return {
    schemaVersion: 1,
    name,
    connection: tcpConfig,
    poll,
    display: { format: "unsigned", addressBase: 0 },
    autoStartPoll: true,
  };
}

describe("fake Modbus Master IPC", () => {
  it("delivers events to the openSession callback in order", async () => {
    const fake = createFakeModbusMasterIpc();
    const seen: SessionEvent[] = [];
    await fake.openSession((e) => seen.push(e));

    fake.emitState("connecting");
    fake.emitState("connected");
    fake.emitPollUpdate({ values: [1, 2] });
    fake.emitFrames([]);
    fake.emitCounters({ requests: 1, responses: 1, errors: 0, timeouts: 0 });

    expect(seen.map((e) => e.type)).toEqual([
      "StateChanged",
      "StateChanged",
      "PollUpdate",
      "TrafficFrames",
      "Counters",
    ]);
    expect(seen.filter((e) => e.type === "StateChanged").map((e) => e.state)).toEqual([
      "connecting",
      "connected",
    ]);
  });

  it("returns the scripted snapshot from openSession", async () => {
    const fake = createFakeModbusMasterIpc();
    fake.snapshot = { ...fake.snapshot, state: "paused" };
    await expect(fake.openSession(() => {})).resolves.toMatchObject({ state: "paused" });
  });

  it("rejects connect when scripted to, then recovers", async () => {
    const fake = createFakeModbusMasterIpc();
    fake.failNext("connect", new IpcError("Port is busy", "io"));
    await expect(fake.connect(tcpConfig)).rejects.toMatchObject({
      message: "Port is busy",
      code: "io",
    });
    await expect(fake.connect(tcpConfig)).resolves.toBeUndefined();
    expect(fake.callsOf("connect")).toEqual([[tcpConfig], [tcpConfig]]);
  });

  it("can fail every call until cleared and accepts string errors", async () => {
    const fake = createFakeModbusMasterIpc();
    fake.failAlways("disconnect", "boom");
    await expect(fake.disconnect()).rejects.toThrow("boom");
    await expect(fake.disconnect()).rejects.toThrow("boom");
    fake.clearFailures();
    await expect(fake.disconnect()).resolves.toBeUndefined();
  });

  it("holds a command until released", async () => {
    const fake = createFakeModbusMasterIpc();
    const held = fake.hold("write");
    let done = false;
    const p = fake.write({ slaveId: 1, function: 6, address: 0, values: [1] }).then((r) => {
      done = true;
      return r;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    held.release({ status: "timeout" });
    await expect(p).resolves.toEqual({ status: "timeout" });
  });

  it("can fail a held command", async () => {
    const fake = createFakeModbusMasterIpc();
    const held = fake.hold("listSerialPorts");
    const p = fake.listSerialPorts();
    held.fail("no ports");
    await expect(p).rejects.toThrow("no ports");
  });

  it("uses scripted results, including functions of the arguments", async () => {
    const fake = createFakeModbusMasterIpc();
    fake.setResult("write", { status: "exception", code: 2 });
    await expect(fake.write({ slaveId: 1, function: 5, address: 0, values: [1] })).resolves.toEqual(
      {
        status: "exception",
        code: 2,
      },
    );
    fake.setResult("listSerialPorts", () => [{ name: "COM9", description: null }]);
    await expect(fake.listSerialPorts()).resolves.toEqual([{ name: "COM9", description: null }]);
  });

  it("answers a write to unit 0 like any other on TCP and with broadcastSent on RTU only", async () => {
    const fake = createFakeModbusMasterIpc();
    const write = (slaveId: number) =>
      fake.write({ slaveId, function: 6, address: 0, values: [1] });
    await fake.connect(tcpConfig);
    await expect(write(0)).resolves.toEqual({ status: "ok" });
    await expect(write(1)).resolves.toEqual({ status: "ok" });
    await fake.connect({
      mode: "rtu",
      port: "COM3",
      baud: 9600,
      dataBits: 8,
      parity: "even",
      stopBits: 1,
      timeoutMs: 1000,
    });
    await expect(write(0)).resolves.toEqual({ status: "broadcastSent" });
    await expect(write(1)).resolves.toEqual({ status: "ok" });
  });

  it("can script a linkLost write result", async () => {
    const fake = createFakeModbusMasterIpc();
    fake.setResult("write", { status: "linkLost" });
    await expect(fake.write({ slaveId: 1, function: 6, address: 3, values: [9] })).resolves.toEqual(
      { status: "linkLost" },
    );
  });

  it("delivers events that arrive before the snapshot reply (held openSession)", async () => {
    const fake = createFakeModbusMasterIpc();
    const held = fake.hold("openSession");
    const seen: string[] = [];
    const opened = fake.openSession((e) => seen.push(e.type));
    fake.emitState("connected");
    expect(seen).toEqual(["StateChanged"]);
    held.release(fake.snapshot);
    await opened;
  });

  it("carries the backend field of a validation error", () => {
    expect(toIpcError({ code: "validation", message: "bad", field: "host" })).toMatchObject({
      code: "validation",
      field: "host",
    });
    expect(toIpcError({ code: "io", message: "x", field: null }).field).toBeNull();
    expect(toIpcError("plain").field).toBeNull();
  });

  it("emits no events on its own unless simulating", async () => {
    const fake = createFakeModbusMasterIpc();
    const seen: SessionEvent[] = [];
    await fake.openSession((e) => seen.push(e));
    await fake.connect(tcpConfig);
    await fake.startPoll(poll);
    expect(seen).toEqual([]);
  });

  it("walks the session states when simulating", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeModbusMasterIpc({ simulate: true });
      const states: string[] = [];
      await fake.openSession((e) => {
        if (e.type === "StateChanged") states.push(e.state);
      });
      await fake.connect(tcpConfig);
      await vi.advanceTimersByTimeAsync(250);
      await fake.startPoll({ ...poll, scanRateMs: 100 });
      await vi.advanceTimersByTimeAsync(250);
      await fake.stopPoll();
      await fake.disconnect();
      expect(states).toEqual(["connecting", "connected", "polling", "paused", "idle"]);
      fake.reset();
    } finally {
      vi.useRealTimers();
    }
  });

  it("streams poll updates and frames with increasing sequence numbers", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeModbusMasterIpc();
      const updates: number[] = [];
      let frames = 0;
      await fake.openSession((e) => {
        if (e.type === "PollUpdate") updates.push(e.seq);
        if (e.type === "TrafficFrames") frames += e.frames.length;
      });
      fake.startStream({ intervalMs: 100, quantity: 125, framesPerTick: 2 });
      await vi.advanceTimersByTimeAsync(350);
      fake.stopStream();
      await vi.advanceTimersByTimeAsync(500);
      expect(updates).toEqual([1, 2, 3]);
      expect(frames).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("in-memory profiles", () => {
    it("saves, lists, gets, renames and deletes", async () => {
      const fake = createFakeModbusMasterIpc();
      await fake.profilesSave(profile("Boiler"), false);
      await fake.profilesSave(profile("Pump"), false);
      expect((await fake.profilesList()).map((p) => p.name)).toEqual(["Boiler", "Pump"]);
      expect((await fake.profilesList())[0]?.connectionSummary).toBe("TCP 192.168.1.10:502");
      await expect(fake.profilesGet("boiler")).resolves.toMatchObject({ name: "Boiler" });
      await fake.profilesRename("Pump", "Pump-2");
      expect((await fake.profilesList()).map((p) => p.name)).toEqual(["Boiler", "Pump-2"]);
      await fake.profilesDelete("Boiler");
      expect((await fake.profilesList()).map((p) => p.name)).toEqual(["Pump-2"]);
    });

    it("rejects duplicates without overwrite and missing profiles", async () => {
      const fake = createFakeModbusMasterIpc();
      await fake.profilesSave(profile("Boiler"), false);
      await expect(fake.profilesSave(profile("BOILER"), false)).rejects.toMatchObject({
        code: "profileExists",
      });
      await expect(fake.profilesSave(profile("BOILER"), true)).resolves.toBeUndefined();
      await expect(fake.profilesGet("nope")).rejects.toMatchObject({ code: "profileNotFound" });
      await expect(fake.profilesRename("nope", "x")).rejects.toMatchObject({
        code: "profileNotFound",
      });
      await fake.profilesSave(profile("Other"), false);
      await expect(fake.profilesRename("Other", "boiler")).rejects.toMatchObject({
        code: "profileExists",
      });
      await expect(fake.profilesDelete("nope")).rejects.toMatchObject({ code: "profileNotFound" });
    });

    it("seeds profiles", async () => {
      const fake = createFakeModbusMasterIpc();
      fake.seedProfiles([profile("A")]);
      expect((await fake.profilesList()).map((p) => p.name)).toEqual(["A"]);
    });
  });

  it("reset clears calls, scripts and state", async () => {
    const fake = createFakeModbusMasterIpc();
    fake.failAlways("connect", "x");
    await fake.disconnect();
    fake.reset();
    await expect(fake.connect(tcpConfig)).resolves.toBeUndefined();
    expect(fake.calls).toHaveLength(1);
  });
});

describe("toIpcError", () => {
  it("normalizes AppError objects, strings and errors", () => {
    expect(toIpcError({ code: "validation", message: "bad" })).toMatchObject({
      code: "validation",
      message: "bad",
    });
    expect(toIpcError("plain")).toMatchObject({ message: "plain", code: "unknown" });
    expect(toIpcError(new Error("native"))).toMatchObject({ message: "native" });
    expect(toIpcError(42)).toMatchObject({ message: "Unknown error" });
    const e = new IpcError("same", "io");
    expect(toIpcError(e)).toBe(e);
  });
});

describe("Tauri isolation", () => {
  it("no module outside shared/ipc imports @tauri-apps/api", () => {
    const srcDir = join(import.meta.dirname, "..", "..");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return files(full);
        return /\.(ts|tsx)$/.test(name) ? [full] : [];
      });
    const offenders = files(srcDir)
      .filter((f) => !relative(srcDir, f).replaceAll("\\", "/").startsWith("shared/ipc/"))
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => readFileSync(f, "utf8").includes("@tauri-apps/api"))
      .map((f) => relative(srcDir, f));
    expect(offenders).toEqual([]);
  });
});

describe("manual mode (setSimulate)", () => {
  it("a simulating fake goes quiet with setSimulate(false) and stops its stream", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeModbusMasterIpc({ simulate: true });
      const events: string[] = [];
      await fake.openSession((e) => events.push(e.type));
      await fake.connect(tcpConfig);
      await vi.advanceTimersByTimeAsync(250);
      await fake.startPoll({ ...poll, scanRateMs: 100 });
      await vi.advanceTimersByTimeAsync(250);
      const before = events.length;
      expect(before).toBeGreaterThan(3);
      fake.setSimulate(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(events).toHaveLength(before);
      await fake.stopPoll();
      await fake.disconnect();
      expect(events).toHaveLength(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the plain fake can be switched to simulation", async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeModbusMasterIpc();
      const states: string[] = [];
      await fake.openSession((e) => {
        if (e.type === "StateChanged") states.push(e.state);
      });
      fake.setSimulate(true);
      await fake.connect(tcpConfig);
      await vi.advanceTimersByTimeAsync(250);
      expect(states).toEqual(["connecting", "connected"]);
      fake.reset();
    } finally {
      vi.useRealTimers();
    }
  });
});
