import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
} from "@/shared/ipc/modbus-master.fake";
import type { Profile } from "@/shared/ipc/modbus-master.types";
import { createProfilesStore, type ProfilesStoreApi, visibleProfiles } from "./profiles.store";

function profile(name: string): Profile {
  return {
    schemaVersion: 3,
    name,
    connection: { mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 },
    autoStartPoll: true,
    connectionWindow: null,
    workspace: {
      tileMode: false,
      compact: false,
      sidebarWidth: 280,
      sidebarCollapsed: false,
      trafficExpanded: false,
      trafficHeight: null,
      minimizedOrder: [],
    },
    polls: [],
    migratedFrom: null,
  };
}

let ipc: FakeModbusMasterIpc;
let store: ProfilesStoreApi;
const get = () => store.getState();
const names = () => get().items.map((p) => p.name);

beforeEach(() => {
  ipc = createFakeModbusMasterIpc();
  ipc.seedProfiles([profile("Boiler-PLC"), profile("Pump-RTU")]);
  store = createProfilesStore({ ipc });
});

describe("initial state", () => {
  it("is idle with no items and no filter", () => {
    expect(get()).toMatchObject({ status: "idle", items: [], error: null, filter: "" });
  });
});

describe("refresh", () => {
  it("goes loading -> ready with the items", async () => {
    const held = ipc.hold("profilesList");
    const p = get().refresh();
    expect(get().status).toBe("loading");
    held.release([{ name: "A", modifiedAt: 1, connectionSummary: "TCP x:1" }]);
    await p;
    expect(get()).toMatchObject({ status: "ready", error: null });
    expect(names()).toEqual(["A"]);
  });

  it("goes loading -> error and keeps the message", async () => {
    ipc.failNext("profilesList", "Disk unavailable");
    const p = get().refresh();
    expect(get().status).toBe("loading");
    await p;
    expect(get()).toMatchObject({ status: "error", error: "Disk unavailable" });
  });

  it("is ready and empty when there are no profiles", async () => {
    ipc.reset();
    await get().refresh();
    expect(get()).toMatchObject({ status: "ready", items: [] });
  });

  it("a retry after an error recovers", async () => {
    ipc.failNext("profilesList", "x");
    await get().refresh();
    await get().refresh();
    expect(get().status).toBe("ready");
    expect(get().error).toBeNull();
  });

  it("ignores a late result of an older refresh", async () => {
    const first = ipc.hold("profilesList");
    const p1 = get().refresh();
    await get().refresh();
    first.release([]);
    await p1;
    expect(names()).toEqual(["Boiler-PLC", "Pump-RTU"]);
  });
});

describe("filter", () => {
  it("filters case-insensitively on the name", async () => {
    await get().refresh();
    get().setFilter("pump");
    expect(visibleProfiles(get().items, get().filter).map((p) => p.name)).toEqual(["Pump-RTU"]);
    get().setFilter("PLC");
    expect(visibleProfiles(get().items, get().filter).map((p) => p.name)).toEqual(["Boiler-PLC"]);
    get().setFilter("  ");
    expect(visibleProfiles(get().items, get().filter)).toHaveLength(2);
    get().setFilter("zzz");
    expect(visibleProfiles(get().items, get().filter)).toEqual([]);
  });
});

describe("exists", () => {
  it("compares case-insensitively", async () => {
    await get().refresh();
    expect(get().exists("boiler-plc")).toBe(true);
    expect(get().exists("  Pump-RTU ")).toBe(true);
    expect(get().exists("Other")).toBe(false);
  });
});

describe("save", () => {
  it("saves a new profile and refreshes the list", async () => {
    await get().refresh();
    await expect(get().save(profile("New"), false)).resolves.toEqual({ ok: true });
    expect(names()).toEqual(["Boiler-PLC", "New", "Pump-RTU"]);
  });

  it("reports an existing name without overwrite", async () => {
    const result = await get().save(profile("boiler-plc"), false);
    expect(result).toMatchObject({ ok: false, code: "profileExists" });
  });

  it("overwrites after the Replace confirm", async () => {
    await expect(get().save(profile("BOILER-PLC"), true)).resolves.toEqual({ ok: true });
    expect(ipc.callsOf("profilesSave").at(-1)?.[1]).toBe(true);
  });
});

describe("load", () => {
  it("returns the profile", async () => {
    await expect(get().load("Boiler-PLC")).resolves.toMatchObject({ name: "Boiler-PLC" });
  });

  it("rejects when the profile is missing", async () => {
    await expect(get().load("nope")).rejects.toMatchObject({ code: "profileNotFound" });
  });
});

describe("rename", () => {
  it("renames and refreshes", async () => {
    await get().refresh();
    await expect(get().rename("Pump-RTU", "Pump-2")).resolves.toEqual({ ok: true });
    expect(names()).toEqual(["Boiler-PLC", "Pump-2"]);
  });

  it("rejects a case-insensitive duplicate with the DES message and sends nothing", async () => {
    await get().refresh();
    const result = await get().rename("Pump-RTU", "boiler-plc");
    expect(result).toEqual({
      ok: false,
      message: 'A profile named "boiler-plc" already exists.',
      code: "invalidProfileName",
    });
    expect(ipc.callsOf("profilesRename")).toHaveLength(0);
  });

  it("allows changing only the case of its own name", async () => {
    await get().refresh();
    await expect(get().rename("Pump-RTU", "PUMP-rtu")).resolves.toEqual({ ok: true });
  });

  it("rejects invalid names with the DES messages", async () => {
    await get().refresh();
    expect(await get().rename("Pump-RTU", "")).toMatchObject({ message: "Enter a profile name." });
    expect(await get().rename("Pump-RTU", "a/b")).toMatchObject({
      message: 'Profile name cannot contain \\ / : * ? " < > |',
    });
    expect(await get().rename("Pump-RTU", "x".repeat(65))).toMatchObject({
      message: "Profile name must be at most 64 characters.",
    });
  });

  it("sends the name as typed: no silent trim, and a padded name is rejected", async () => {
    await get().refresh();
    await expect(get().rename("Pump-RTU", " Pump-3")).resolves.toEqual({
      ok: false,
      message: "Profile name cannot start or end with a space.",
      code: "invalidProfileName",
    });
    expect(ipc.callsOf("profilesRename")).toHaveLength(0);
    await get().rename("Pump-RTU", "Pump 3");
    expect(ipc.callsOf("profilesRename")[0]).toEqual(["Pump-RTU", "Pump 3"]);
  });

  it("applies the DES-001 3.4 rules to rename", async () => {
    await get().refresh();
    expect(await get().rename("Pump-RTU", ".hidden")).toMatchObject({
      message: "Profile name cannot start with a dot.",
    });
    expect(await get().rename("Pump-RTU", "CON")).toMatchObject({
      message: '"CON" is reserved by Windows and cannot be used as a profile name.',
    });
  });

  it("reports a backend failure", async () => {
    await get().refresh();
    ipc.failNext("profilesRename", "Disk full");
    await expect(get().rename("Pump-RTU", "Other")).resolves.toMatchObject({
      ok: false,
      message: "Disk full",
    });
  });
});

describe("remove", () => {
  it("deletes and refreshes", async () => {
    await get().refresh();
    await expect(get().remove("Boiler-PLC")).resolves.toEqual({ ok: true });
    expect(names()).toEqual(["Pump-RTU"]);
  });

  it("reports a missing profile", async () => {
    await expect(get().remove("nope")).resolves.toMatchObject({
      ok: false,
      code: "profileNotFound",
    });
  });
});
