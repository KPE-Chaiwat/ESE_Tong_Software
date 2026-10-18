// What marks a profile "Modified" and the profile round trip (FE-002 task 23, DES-002 6.1, CHK2-N2).
import { waitFor } from "@testing-library/react";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { pollProfile, profileV2 } from "../components/dialogs/profile-fixtures";
import { type Harness, renderWindow } from "../components/test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const modified = () => h.rt.stores.profile.getState().modified;

/** Connects with the connection the profile holds, so the form does not change. */
async function connectLoaded() {
  await h.act(() =>
    h.rt.stores.connection
      .getState()
      .connect({ mode: "tcp", host: "10.0.0.5", port: 502, timeoutMs: 1000 }),
  );
}

/** The view of a poll, attached (its frame mounted and its snapshot applied). */
async function attached(id: PollId) {
  const view = h.rt.views.get(id);
  await waitFor(() => expect(view.stores.poll.getState().config).not.toBeNull());
  return view;
}

/** A window with the profile "Base" loaded (4 polls); it starts clean. */
async function loaded(): Promise<PollId[]> {
  h = await renderWindow({
    prepare: ({ ipc }) => {
      ipc.seedProfiles([
        profileV2("Base", [
          pollProfile("A"),
          pollProfile("B"),
          pollProfile("C"),
          pollProfile("D", { view: { host: "native", open: true, workspace: null, native: null } }),
        ]),
      ]);
    },
  });
  await h.act(() => h.rt.profileFlow.load("Base"));
  expect(modified()).toBe(false);
  return h.ipc.pollIds();
}

describe("a profile stays clean for layout, hosts, order, Pause and the traffic filter", () => {
  it("list reorder, tile, move, resize, minimize, maximize", async () => {
    const [a, b, c] = await loaded();
    await h.act(() => h.rt.stores.pollList.getState().reorder(0, 2));
    await h.act(() => h.rt.stores.workspace.getState().tile());
    await h.act(() => h.rt.stores.workspace.getState().cascade());
    await h.act(() =>
      h.rt.stores.workspace
        .getState()
        .setRect(a as number, { x: 40, y: 40, width: 500, height: 300 }),
    );
    await h.act(() => h.rt.stores.workspace.getState().minimize(b as number));
    await h.act(() => h.rt.stores.workspace.getState().maximize(c as number));
    await h.act(() => h.rt.stores.workspace.getState().flush());
    expect(modified()).toBe(false);
  });

  it("pop out, dock, close (keep), compact mode, traffic expand and the filter", async () => {
    const [a, b] = await loaded();
    await h.act(() => h.rt.actions.popOutPoll(a as number));
    await h.act(() => h.rt.actions.dockPoll(a as number));
    await h.act(() => h.ipc.closePollView(b as number, true));
    await h.act(() => h.rt.stores.prefs.getState().setCompact(true));
    await h.act(() => h.rt.actions.toggleTraffic());
    await h.act(() => h.rt.actions.showTrafficFor(a as number));
    expect(modified()).toBe(false);
  });

  it("Pause and Resume", async () => {
    const [a] = await loaded();
    await connectLoaded();
    h.advance(200);
    await h.act(() => h.rt.stores.pollList.getState().setActive(a as number, false));
    await h.act(() => h.rt.stores.pollList.getState().setAllActive(true));
    expect(modified()).toBe(false);
  });

  it("connecting and polling with the loaded connection", async () => {
    await loaded();
    await connectLoaded();
    h.advance(300);
    expect(modified()).toBe(false);
  });
});

describe("a profile is modified by content (CHK2-N2)", () => {
  it("New poll", async () => {
    await loaded();
    await h.act(() => h.rt.actions.newPoll());
    expect(modified()).toBe(true);
  });

  it("Delete", async () => {
    await loaded();
    await h.act(() => h.ipc.removePoll(h.ipc.pollIds()[0] as number));
    expect(modified()).toBe(true);
  });

  it("adding a poll and deleting it again is not a change", async () => {
    await loaded();
    await h.act(() => h.rt.actions.newPoll());
    const added = h.ipc.pollIds().at(-1) as number;
    await h.act(() => h.ipc.removePoll(added));
    expect(modified()).toBe(false);
  });

  it("Duplicate", async () => {
    const [a] = await loaded();
    await h.act(() => h.rt.stores.pollList.getState().duplicate(a as number));
    expect(modified()).toBe(true);
  });

  it("rename", async () => {
    const [a] = await loaded();
    await h.act(() => h.rt.stores.pollList.getState().rename(a as number, "Tank"));
    expect(modified()).toBe(true);
  });

  it("an applied definition", async () => {
    const [a] = await loaded();
    await h.act(() =>
      h.ipc.updatePoll(a as number, {
        slaveId: 2,
        function: 3,
        startAddress: 0,
        quantity: 10,
        scanRateMs: 100,
      }),
    );
    expect(modified()).toBe(true);
  });

  it("the value format", async () => {
    const [a] = await loaded();
    const view = await attached(a as number);
    await h.act(() => view.actions.setFormat("hex"));
    expect(modified()).toBe(true);
  });

  it("an alias", async () => {
    const [a] = await loaded();
    await h.act(() =>
      h.ipc.setPollView(a as number, { aliases: [{ address: 0, alias: "PT-201" }] }),
    );
    expect(modified()).toBe(true);
  });

  it("the Alias column", async () => {
    const [a] = await loaded();
    const view = await attached(a as number);
    await h.act(() => view.actions.setShowAlias(false));
    expect(modified()).toBe(true);
  });

  it("Include alias in copy", async () => {
    const [a] = await loaded();
    const view = await attached(a as number);
    await h.act(() => view.actions.setCopyAlias(true));
    expect(modified()).toBe(true);
  });

  it("a scale setting", async () => {
    const [a] = await loaded();
    await h.act(() =>
      h.ipc.setPollView(a as number, {
        scale: {
          preset: "linear",
          rawSigned: false,
          xMin: 0,
          xMax: 100,
          yMin: 0,
          yMax: 10,
          divisor: 10,
          decimals: 1,
          unit: "",
          outOfRange: "flag",
        },
      }),
    );
    expect(modified()).toBe(true);
  });

  it("Start polling when connected and the connection settings", async () => {
    await loaded();
    await h.act(() => h.rt.stores.connection.getState().setAutoStartPoll(false));
    expect(modified()).toBe(true);
    await h.act(() => h.rt.stores.connection.getState().setAutoStartPoll(true));
    expect(modified()).toBe(false);
    await h.act(() =>
      h.rt.form.current.adopt({ mode: "tcp", host: "10.9.9.9", port: 502, timeoutMs: 1000 }),
    );
    expect(modified()).toBe(true);
  });
});

describe("loading and saving", () => {
  it("a window starts clean, also when the backend already has polls (a reload)", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        // The backend already has a poll when the window opens its session.
        void ipc.addPoll(
          {
            name: "Kept",
            definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 5, scanRateMs: 100 },
            display: { format: "unsigned", addressBase: 0, showAlias: true, copyAlias: false },
            scale: null,
            scaleOverrides: [],
            valueColumns: "raw",
            aliases: [],
          },
          "workspace",
        );
      },
    });
    expect(h.ipc.pollIds()).toHaveLength(1);
    expect(modified()).toBe(false);
  });

  it("loading never marks the window modified, even for a profile with polls in every host", async () => {
    await loaded();
    expect(h.ipc.pollIds()).toHaveLength(4);
    expect(h.ipc.nativePolls()).toHaveLength(1);
    expect(modified()).toBe(false);
  });

  it("the layout of the profile is not overwritten by the load", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([
          profileV2(
            "Placed",
            [
              pollProfile("A", {
                view: {
                  host: "workspace",
                  open: true,
                  native: null,
                  workspace: {
                    x: 120,
                    y: 90,
                    width: 400,
                    height: 250,
                    z: 1,
                    state: "normal",
                    restore: null,
                  },
                },
              }),
            ],
            {
              workspace: {
                tileMode: false,
                compact: false,
                sidebarWidth: 300,
                sidebarCollapsed: false,
                trafficExpanded: false,
                trafficHeight: null,
                minimizedOrder: [],
              },
            },
          ),
        ]);
      },
    });
    await h.act(() => h.rt.profileFlow.load("Placed"));
    const id = h.ipc.pollIds()[0] as number;
    expect(h.rt.stores.workspace.getState().items[id]?.rect).toMatchObject({
      x: 120,
      y: 90,
      width: 400,
      height: 250,
    });
    expect(h.rt.stores.workspace.getState().sidebar.width).toBe(300);
    await h.act(async () => {});
    // Nothing reported a default rectangle for the new poll over the profile's.
    expect(h.ipc.pollSummary(id).workspace).toMatchObject({
      x: 120,
      y: 90,
      width: 400,
      height: 250,
    });
  });
});

function roundTripProfile(tileMode: boolean) {
  // A maximized window fills the tile area; its normal rectangle is `restore`.
  const place = (x: number, z: number, state: "normal" | "minimized" | "maximized") => ({
    host: "workspace" as const,
    open: true,
    native: null,
    workspace:
      state === "maximized"
        ? {
            x: 8,
            y: 8,
            width: 1316,
            height: 648,
            z,
            state,
            restore: { x, y: 20, width: 500, height: 300 },
          }
        : { x, y: 20, width: 500, height: 300, z, state, restore: null },
  });
  const native = (x: number) => ({
    host: "native" as const,
    open: true,
    workspace: null,
    native: { x, y: 50, width: 900, height: 640, maximized: false, monitor: "Display 1" },
  });
  return profileV2(
    "Round",
    [
      pollProfile("A", {
        view: place(10, 1, "normal"),
        aliases: [
          { address: 0, alias: "PT-201" },
          { address: 3, alias: "FT-102" },
        ],
      }),
      pollProfile("B", { view: place(60, 2, "minimized") }),
      pollProfile("C", { view: place(110, 3, "maximized"), aliases: [{ address: 1, alias: "X" }] }),
      pollProfile("D", { view: place(160, 4, "normal"), active: false }),
      pollProfile("E", { view: native(30) }),
      pollProfile("F", { view: native(60) }),
      pollProfile("G", {
        view: { host: "workspace", open: false, workspace: null, native: null },
      }),
    ],
    {
      autoStartPoll: false,
      workspace: {
        tileMode,
        compact: true,
        sidebarWidth: 320,
        sidebarCollapsed: true,
        trafficExpanded: true,
        trafficHeight: 260,
        minimizedOrder: [1],
      },
    },
  );
}

describe("round trip (CHK2-N1)", () => {
  async function open(original: ReturnType<typeof roundTripProfile>) {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([original]);
      },
    });
    await h.act(() => h.rt.profileFlow.load("Round"));
    expect(h.rt.stores.profile.getState().modified).toBe(false);
  }

  it("4 sub-windows (one minimized, one maximized), 2 native, compact, order, aliases and a closed poll come back exactly", async () => {
    const original = roundTripProfile(false);
    await open(original);
    await h.act(() => h.rt.profileFlow.save());
    expect(await h.ipc.profilesGet("Round")).toEqual(original);
    await waitFor(() => expect(h.rt.stores.profile.getState().modified).toBe(false));
  });

  it("with tile mode on the tiles are computed again, and saving is stable", async () => {
    const original = roundTripProfile(true);
    await open(original);
    await h.act(() => h.rt.profileFlow.save());
    const first = await h.ipc.profilesGet("Round");
    expect(first.workspace).toEqual(original.workspace);
    expect(first.polls.map((p) => [p.name, p.view.host, p.view.open])).toEqual(
      original.polls.map((p) => [p.name, p.view.host, p.view.open]),
    );
    expect(first.polls.map((p) => p.aliases)).toEqual(original.polls.map((p) => p.aliases));
    // The same profile loaded and saved again does not change.
    await h.act(() => h.rt.profileFlow.load("Round"));
    await h.act(() => h.rt.profileFlow.save());
    expect(await h.ipc.profilesGet("Round")).toEqual(first);
  });
});
