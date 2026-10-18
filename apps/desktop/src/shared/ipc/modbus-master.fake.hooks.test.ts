// The hooks QA asked for in REPORT-003 section 5 (items 3 and 7), and the duplicate start rule
// (D-002-11): read-only native placement, compact in a seeded layout, one monitor list, a persisted
// model, and the announcement log of the fake window.
import { createFakeModbusMasterIpc, pollConfigInput } from "./modbus-master.fake";
import type { ConnectionConfig, WorkspaceLayout } from "./modbus-master.types";
import { createFakeWindowIpc, linkMonitors } from "./window";

const tcp: ConnectionConfig = { mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 };

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const layoutWith = (patch: Partial<WorkspaceLayout> = {}): WorkspaceLayout => ({
  items: [],
  minimizedOrder: [],
  tileMode: false,
  compact: false,
  sidebarWidth: 280,
  sidebarCollapsed: false,
  trafficExpanded: false,
  trafficHeight: null,
  ...patch,
});

describe("nativePlacement(pollId)", () => {
  it("is null until the poll has a native window, then a copy of what Rust holds", async () => {
    const fake = createFakeModbusMasterIpc({ mode: "manual" });
    await fake.openSession(() => {});
    const id = await fake.addPoll(pollConfigInput({ name: "A" }), "workspace");
    expect(fake.nativePlacement(id)).toBeNull();
    await fake.popOutPoll(
      id,
      { kind: "rect", rect: { x: 200, y: 150, width: 640, height: 368 } },
      null,
    );
    const placement = fake.nativePlacement(id);
    expect(placement).toMatchObject({ x: 200, y: 150, width: 640, height: 368, maximized: false });
    // Read only: changing the copy changes nothing.
    if (placement) placement.x = 9999;
    expect(fake.nativePlacement(id)?.x).toBe(200);
    expect(fake.nativePlacement(9999)).toBeNull();
  });
});

describe("a seeded layout carries its compact flag", () => {
  it("before any session: setWorkspaceLayout sets compact, and the snapshot reports it", async () => {
    const fake = createFakeModbusMasterIpc({ mode: "manual" });
    await fake.setWorkspaceLayout(layoutWith({ compact: true, tileMode: true }));
    expect(fake.compact).toBe(true);
    const session = await fake.openSession(() => {});
    expect(session.compact).toBe(true);
    expect(session.workspaceLayout).toMatchObject({ compact: true, tileMode: true });
  });

  it("once a session is open, or setCompactMode was called, compact stays Rust's (the contract)", async () => {
    const open = createFakeModbusMasterIpc({ mode: "manual" });
    await open.openSession(() => {});
    await open.setWorkspaceLayout(layoutWith({ compact: true }));
    expect(open.compact).toBe(false);

    const commanded = createFakeModbusMasterIpc({ mode: "manual" });
    await commanded.setCompactMode(true);
    await commanded.setWorkspaceLayout(layoutWith({ compact: false }));
    expect(commanded.compact).toBe(true);
  });
});

describe("one monitor list (linkMonitors)", () => {
  it("assigning on either side changes both", async () => {
    const fake = createFakeModbusMasterIpc({ mode: "manual" });
    const win = createFakeWindowIpc();
    linkMonitors(win, fake);
    const second = {
      id: "m2",
      label: "Display 2",
      name: "m2",
      primary: false,
      workArea: { x: 1920, y: 0, width: 1280, height: 1000 },
      scaleFactor: 1,
    };
    win.monitors = [...win.monitors, second];
    expect(fake.monitors.map((m) => m.id)).toEqual(["\\\\.\\DISPLAY1", "m2"]);
    expect((await win.listMonitors()).map((m) => m.id)).toEqual(["\\\\.\\DISPLAY1", "m2"]);
    fake.monitors = [second];
    expect(win.monitors).toEqual([second]);
  });

  it("without the link the two lists are separate (as in the unit tests)", () => {
    const fake = createFakeModbusMasterIpc({ mode: "manual" });
    const win = createFakeWindowIpc();
    win.monitors = [];
    expect(fake.monitors).toHaveLength(1);
  });
});

describe("persist: a reloaded page finds the stored model again", () => {
  it("polls, hosts, rectangles, layout, preferences, profile name and profiles survive", async () => {
    const storage = memoryStorage();
    const first = createFakeModbusMasterIpc({ mode: "manual", persist: { storage } });
    await first.openSession(() => {});
    const a = await first.addPoll(pollConfigInput({ name: "A" }), "workspace");
    const b = await first.addPoll(pollConfigInput({ name: "B" }), "workspace");
    await first.setWorkspaceLayout({
      ...layoutWith({ tileMode: true, sidebarWidth: 321 }),
      items: [
        {
          pollId: a,
          rect: { x: 40, y: 50, width: 500, height: 300, z: 3, state: "normal", restore: null },
        },
      ],
    });
    await first.setCompactMode(true);
    await first.setAskOnPollClose(false);
    await first.setProfileName("Boiler-PLC");
    await first.popOutPoll(
      b,
      { kind: "rect", rect: { x: 300, y: 120, width: 600, height: 340 } },
      null,
    );

    const reloaded = createFakeModbusMasterIpc({ mode: "manual", persist: { storage } });
    const snapshot = await reloaded.openSession(() => {});
    expect(snapshot.polls.map((p) => [p.config.name, p.host])).toEqual([
      ["A", "workspace"],
      ["B", "native"],
    ]);
    expect(snapshot.polls[0]?.workspace).toMatchObject({ x: 40, y: 50, width: 500, z: 3 });
    expect(snapshot.workspaceLayout).toMatchObject({
      tileMode: true,
      sidebarWidth: 321,
      compact: true,
    });
    expect(snapshot.compact).toBe(true);
    expect(snapshot.askOnPollClose).toBe(false);
    expect(snapshot.profileName).toBe("Boiler-PLC");
    expect(reloaded.nativePlacement(b)).toMatchObject({ x: 300, y: 120 });
    // The connection is not stored: the app starts idle.
    expect(snapshot.connection.state).toBe("idle");
    // New polls continue the id sequence.
    const c = await reloaded.addPoll(pollConfigInput({ name: "C" }), "workspace");
    expect(c).toBeGreaterThan(b);
  });

  it("without the option nothing is stored, a bad stored value is ignored, and reset() clears it", async () => {
    const storage = memoryStorage();
    const plain = createFakeModbusMasterIpc({ mode: "manual" });
    await plain.addPoll(pollConfigInput({ name: "A" }), "workspace");
    expect(storage.map.size).toBe(0);

    storage.setItem("esefact-fake-ipc", "{not json");
    const broken = createFakeModbusMasterIpc({ mode: "manual", persist: { storage } });
    expect(broken.pollIds()).toEqual([]);

    const kept = createFakeModbusMasterIpc({ mode: "manual", persist: { storage, key: "k" } });
    await kept.addPoll(pollConfigInput({ name: "A" }), "workspace");
    expect(storage.map.has("k")).toBe(true);
    kept.reset();
    expect(storage.map.has("k")).toBe(false);
  });
});

describe("duplicate starts by the new-poll rule (D-002-11, CHK2-B5)", () => {
  async function duplicateAfter(autoStart: boolean, connect: boolean) {
    const fake = createFakeModbusMasterIpc({ mode: "virtual" });
    await fake.openSession(() => {});
    await fake.setAutoStartPoll(autoStart);
    const a = await fake.addPoll(pollConfigInput({ name: "A" }), "workspace");
    if (connect) {
      await fake.connect(tcp);
      fake.advance(100);
    }
    const copy = await fake.duplicatePoll(a);
    return fake.pollSummary(copy);
  }

  it("auto start on and the link up: polling", async () => {
    expect((await duplicateAfter(true, true)).status.state).toBe("polling");
  });
  it("auto start off and the link up: paused", async () => {
    const copy = await duplicateAfter(false, true);
    expect(copy.status.state).toBe("paused");
    expect(copy.config.active).toBe(false);
  });
  it("the link down: offline, with the run intent of the rule", async () => {
    expect((await duplicateAfter(true, false)).status.state).toBe("offline");
    const off = await duplicateAfter(false, false);
    expect(off.status.state).toBe("offline");
    expect(off.config.active).toBe(false);
  });
});

describe("the fake window logs what it announced", () => {
  it("recordAnnouncement keeps text and urgency in order, at most 500", () => {
    const win = createFakeWindowIpc();
    win.recordAnnouncement?.("Connected.", false);
    win.recordAnnouncement?.("Disconnected. Link lost.", true);
    expect(win.announcements).toEqual([
      { text: "Connected.", assertive: false },
      { text: "Disconnected. Link lost.", assertive: true },
    ]);
    for (let i = 0; i < 600; i += 1) win.recordAnnouncement?.(`n${i}`, false);
    expect(win.announcements).toHaveLength(500);
    expect(win.announcements.at(-1)?.text).toBe("n599");
  });
});

describe("freezePollCounters(pollId, counters) (REPORT-004 CHK2-E26)", () => {
  it("sets Tx and Err and keeps them while the poll keeps running; null lets them run again", async () => {
    const fake = createFakeModbusMasterIpc({ mode: "virtual" });
    await fake.openSession(() => {});
    const id = await fake.addPoll(pollConfigInput({ name: "A" }), "workspace");
    await fake.connect(tcp);
    fake.advance(1000);
    expect(fake.pollSummary(id).counters.counters.requests).toBeGreaterThan(0);

    fake.freezePollCounters(id, { requests: 1234, errors: 3 });
    expect(fake.pollSummary(id).counters.counters).toMatchObject({
      requests: 1234,
      errors: 3,
      timeouts: 0,
    });
    fake.advance(2000);
    expect(fake.pollSummary(id).counters.counters).toMatchObject({ requests: 1234, errors: 3 });

    fake.freezePollCounters(id, null);
    fake.advance(2000);
    expect(fake.pollSummary(id).counters.counters.requests).toBeGreaterThan(1234);
  });

  it("an attached view is told at once", async () => {
    const fake = createFakeModbusMasterIpc({ mode: "manual" });
    await fake.openSession(() => {});
    const id = await fake.addPoll(pollConfigInput({ name: "A" }), "workspace");
    const events: Array<{ type: string; counters?: { requests: number; errors: number } }> = [];
    await fake.attachPollView(id, "workspace", (e) => events.push(e as never));
    fake.freezePollCounters(id, { requests: 1234, errors: 0 });
    const last = events.filter((e) => e.type === "PollCounters").at(-1);
    expect(last?.counters).toMatchObject({ requests: 1234, errors: 0 });
  });
});
