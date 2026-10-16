import type { Profile } from "@/shared/ipc/modbus-master.types";
import { type ConfigStoreApi, createConfigStore, selectIsDirty } from "./config.store";

let store: ConfigStoreApi;
const get = () => store.getState();

const profile: Profile = {
  schemaVersion: 1,
  name: "Boiler-PLC",
  connection: {
    mode: "rtu",
    port: "COM3",
    baud: 19200,
    dataBits: 8,
    parity: "none",
    stopBits: 2,
    timeoutMs: 800,
  },
  poll: { slaveId: 7, function: 4, startAddress: 99, quantity: 20, scanRateMs: 250 },
  display: { format: "hex", addressBase: 1 },
  autoStartPoll: false,
};

beforeEach(() => {
  store = createConfigStore();
});

describe("defaults (DES-001)", () => {
  it("has the documented initial values", () => {
    expect(get().connection).toEqual({ mode: "tcp", host: "", port: 502, timeoutMs: 1000 });
    expect(get().poll).toEqual({
      slaveId: 1,
      function: 3,
      startAddress: 0,
      quantity: 10,
      scanRateMs: 1000,
    });
    expect(get().autoStartPoll).toBe(true);
    expect(get().display).toEqual({ format: "unsigned", addressBase: 0 });
    expect(get().profileName).toBeNull();
    expect(get().savedSnapshot).toBeNull();
    expect(selectIsDirty(get())).toBe(false);
  });

  it("creates independent instances", () => {
    const other = createConfigStore();
    get().setFormat("hex");
    expect(other.getState().display.format).toBe("unsigned");
  });
});

describe("setters", () => {
  it("setConnection, setPoll, setAutoStart and setFormat replace their slice only", () => {
    get().setConnection({ mode: "tcp", host: "plc", port: 1502, timeoutMs: 500 });
    get().setPoll({ ...get().poll, quantity: 99 });
    get().setAutoStart(false);
    get().setFormat("binary");
    expect(get().connection).toMatchObject({ host: "plc", port: 1502 });
    expect(get().poll.quantity).toBe(99);
    expect(get().autoStartPoll).toBe(false);
    expect(get().display).toEqual({ format: "binary", addressBase: 0 });
  });

  it("toggleBase changes only display.addressBase, never the protocol addresses", () => {
    get().setPoll({ ...get().poll, startAddress: 40 });
    const before = get().poll;
    get().toggleBase();
    expect(get().display.addressBase).toBe(1);
    expect(get().poll).toBe(before);
    expect(get().poll.startAddress).toBe(40);
    get().toggleBase();
    expect(get().display.addressBase).toBe(0);
  });

  it("setBase sets the base explicitly", () => {
    get().setBase(1);
    expect(get().display.addressBase).toBe(1);
    get().setBase(0);
    expect(get().display.addressBase).toBe(0);
  });
});

describe("profiles", () => {
  it("applyProfile then toProfile round-trips", () => {
    get().applyProfile(profile);
    expect(get().profileName).toBe("Boiler-PLC");
    expect(get().toProfile()).toEqual(profile);
  });

  it("toProfile can name the profile for Save as", () => {
    get().applyProfile(profile);
    expect(get().toProfile("Copy").name).toBe("Copy");
    expect(createConfigStore().getState().toProfile().name).toBe("");
  });

  it("applyProfile makes the loaded content the clean baseline", () => {
    get().setFormat("signed");
    expect(selectIsDirty(get())).toBe(true);
    get().applyProfile(profile);
    expect(selectIsDirty(get())).toBe(false);
  });

  it("markSaved names the profile and clears dirty", () => {
    get().setPoll({ ...get().poll, quantity: 5 });
    expect(selectIsDirty(get())).toBe(true);
    get().markSaved("New one");
    expect(get().profileName).toBe("New one");
    expect(selectIsDirty(get())).toBe(false);
    get().setFormat("hex");
    expect(selectIsDirty(get())).toBe(true);
  });

  it("setProfileName renames without marking the content dirty", () => {
    get().applyProfile(profile);
    get().setProfileName("Renamed");
    expect(get().profileName).toBe("Renamed");
    expect(selectIsDirty(get())).toBe(false);
  });
});

describe("isDirty", () => {
  it("Untitled is dirty only after a change, and clean again when the change is undone", () => {
    expect(selectIsDirty(get())).toBe(false);
    get().setAutoStart(false);
    expect(selectIsDirty(get())).toBe(true);
    get().setAutoStart(true);
    expect(selectIsDirty(get())).toBe(false);
  });

  it("toggling the base counts as a change (it is saved in the profile)", () => {
    get().applyProfile(profile);
    get().toggleBase();
    expect(selectIsDirty(get())).toBe(true);
    get().toggleBase();
    expect(selectIsDirty(get())).toBe(false);
  });

  it.each([
    [
      "connection",
      () => get().setConnection({ mode: "tcp", host: "x", port: 502, timeoutMs: 1000 }),
    ],
    ["poll", () => get().setPoll({ ...get().poll, scanRateMs: 50 })],
    ["format", () => get().setFormat("hex")],
  ])("a %s change is dirty", (_name, change) => {
    change();
    expect(selectIsDirty(get())).toBe(true);
  });
});

describe("reset", () => {
  it("returns to the defaults", () => {
    get().applyProfile(profile);
    get().reset();
    expect(get().profileName).toBeNull();
    expect(get().connection.mode).toBe("tcp");
    expect(get().savedSnapshot).toBeNull();
    expect(selectIsDirty(get())).toBe(false);
  });
});
