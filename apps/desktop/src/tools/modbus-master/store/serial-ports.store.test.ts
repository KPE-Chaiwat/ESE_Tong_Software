import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
} from "@/shared/ipc/modbus-master.fake";
import { createSerialPortsStore, type SerialPortsStoreApi } from "./serial-ports.store";

let ipc: FakeModbusMasterIpc;
let store: SerialPortsStoreApi;
const get = () => store.getState();

beforeEach(() => {
  ipc = createFakeModbusMasterIpc();
  store = createSerialPortsStore({ ipc });
});

describe("serialPortsStore", () => {
  it("starts idle and empty", () => {
    expect(get()).toMatchObject({ status: "idle", ports: [], error: null });
  });

  it("goes loading -> ready with the ports", async () => {
    const held = ipc.hold("listSerialPorts");
    const p = get().refresh();
    expect(get().status).toBe("loading");
    held.release([{ name: "COM3", description: "USB Serial Device" }]);
    await p;
    expect(get()).toMatchObject({
      status: "ready",
      ports: [{ name: "COM3", description: "USB Serial Device" }],
      error: null,
    });
  });

  it("goes loading -> error with the message and keeps no ports", async () => {
    ipc.failNext("listSerialPorts", "Access denied");
    const p = get().refresh();
    expect(get().status).toBe("loading");
    await p;
    expect(get()).toMatchObject({ status: "error", error: "Access denied" });
  });

  it("is ready with an empty list when no ports exist", async () => {
    ipc.ports = [];
    await get().refresh();
    expect(get()).toMatchObject({ status: "ready", ports: [], error: null });
  });

  it("recovers from an error on the next refresh", async () => {
    ipc.failNext("listSerialPorts", "boom");
    await get().refresh();
    expect(get().status).toBe("error");
    await get().refresh();
    expect(get().status).toBe("ready");
    expect(get().error).toBeNull();
    expect(get().ports.length).toBeGreaterThan(0);
  });

  it("ignores the result of an older refresh", async () => {
    const first = ipc.hold("listSerialPorts");
    const p1 = get().refresh();
    const p2 = get().refresh();
    await p2;
    expect(get().ports.map((p) => p.name)).toEqual(["COM3", "COM4"]);
    first.release([{ name: "OLD", description: null }]);
    await p1;
    expect(get().ports.map((p) => p.name)).toEqual(["COM3", "COM4"]);
  });

  it("ignores a late failure of an older refresh", async () => {
    const first = ipc.hold("listSerialPorts");
    const p1 = get().refresh();
    await get().refresh();
    first.fail("late");
    await p1;
    expect(get().status).toBe("ready");
    expect(get().error).toBeNull();
  });
});
