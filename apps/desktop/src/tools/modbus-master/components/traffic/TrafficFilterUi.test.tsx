// The traffic bar and filter UI (FE-002 task 25, DES-002 2.2.5): per-poll filter, counters that follow
// it, the Writes filter, the empty texts, the expanded state and "Show traffic for this poll".
import { screen, waitFor, within } from "@testing-library/react";
import type { PollId, TrafficFrame } from "@/shared/ipc/modbus-master.types";
import { pollProfile, profileV2 } from "../dialogs/profile-fixtures";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const frame = (seq: number, origin: TrafficFrame["origin"]): TrafficFrame => ({
  seq,
  at: 0,
  direction: seq % 2 === 1 ? "tx" : "rx",
  bytes: [0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10],
  slaveId: 1,
  function: 3,
  exceptionCode: null,
  note: null,
  origin,
});

const bar = () => screen.getByTestId("traffic-bar");
const panel = () => screen.getByRole("region", { name: "Communication Traffic" });
const frameOf = (id: PollId) => document.querySelector<HTMLElement>(`[data-subwindow="${id}"]`);

const set = (requests: number, responses: number, errors: number, timeouts: number) => ({
  requests,
  responses,
  errors,
  timeouts,
});

describe("the collapsed bar follows the filter (DES-002 2.2.5)", () => {
  it("shows the counters of All polls, a poll or the writes, with the link load", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Alpha");
    await h.act(() =>
      h.ipc.emitCounters({
        total: set(10, 9, 1, 0),
        writes: set(2, 2, 0, 0),
        polls: [
          {
            pollId: a,
            counters: set(8, 7, 1, 0),
            effectiveScanMs: null,
            lastOkAt: null,
          },
        ],
        linkLoadPct: 72,
      }),
    );
    expect(bar()).toHaveTextContent(
      "Requests 10 · Responses 9 · Errors 1 · Timeouts 0 · link load 72%",
    );
    await h.act(() => h.rt.actions.showTrafficFor(a));
    await h.act(() => h.rt.actions.toggleTraffic());
    expect(bar()).toHaveTextContent("Requests 8 · Responses 7 · Errors 1 · Timeouts 0");
    await h.act(() => h.rt.stores.traffic.getState().setFilter({ kind: "writes" }));
    expect(bar()).toHaveTextContent("Requests 2 · Responses 2 · Errors 0 · Timeouts 0");
  });

  it("from 90% it says the polls are slowed down, with the gauge icon", async () => {
    h = await renderWindow();
    await h.act(() => h.ipc.emitCounters({ linkLoadPct: 92 }));
    expect(bar()).toHaveTextContent("link load 92% - polls are slowed down");
    expect(bar().querySelector('[data-icon="gauge"]')).toBeInTheDocument();
  });
});

describe("filter, empty texts and expanded state", () => {
  it("a filter without frames reads 'No frames for {filter} yet.'", async () => {
    h = await renderWindow();
    await h.addPoll("Poll 7");
    const p8 = await h.addPoll("Poll 8");
    await h.act(() => h.rt.actions.showTrafficFor(p8));
    expect(screen.getByTestId("traffic-empty")).toHaveTextContent("No frames for Poll 8 yet.");
    await h.user.selectOptions(
      within(panel()).getByRole("combobox", { name: "Traffic filter" }),
      "Writes",
    );
    expect(screen.getByTestId("traffic-empty")).toHaveTextContent("No frames for Writes yet.");
  });

  it("the Writes filter shows only writes and the Poll column says which poll wrote", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Alpha");
    await h.act(() => h.rt.stores.workspace.getState().setTrafficExpanded(true));
    await h.act(() =>
      h.ipc.emitFrames([
        frame(1, { kind: "poll", pollId: a }),
        frame(2, { kind: "write", pollId: a }),
        frame(3, { kind: "write", pollId: null }),
      ]),
    );
    await h.user.selectOptions(
      within(panel()).getByRole("combobox", { name: "Traffic filter" }),
      "Writes",
    );
    const rows = within(within(panel()).getByRole("grid", { name: "Frames" })).getAllByRole("row");
    // Header row + two write frames.
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("Write: Alpha");
    expect(rows[2]).toHaveTextContent("Write");
  });

  it("deleting the filtered poll switches the filter to All polls", async () => {
    h = await renderWindow();
    await h.addPoll("Keep");
    const gone = await h.addPoll("Gone");
    await h.act(() => h.rt.actions.showTrafficFor(gone));
    const select = within(panel()).getByRole("combobox", { name: "Traffic filter" });
    expect(select).toHaveDisplayValue("Gone");
    await h.act(() => h.ipc.removePoll(gone));
    await waitFor(() => expect(select).toHaveDisplayValue("All polls"));
  });

  it("the expanded state is reported to Rust and does not mark the profile Modified", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([profileV2("Base", [pollProfile("A")])]);
      },
    });
    await h.act(() => h.rt.profileFlow.load("Base"));
    await h.act(() => h.rt.actions.toggleTraffic());
    await h.act(() => h.rt.stores.workspace.getState().flush());
    expect(h.ipc.snapshot().workspaceLayout.trafficExpanded).toBe(true);
    expect(h.rt.stores.profile.getState().modified).toBe(false);
    expect(screen.getByRole("button", { name: "Collapse traffic panel" })).toBeVisible();
  });

  it("a profile with the panel expanded opens expanded", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([
          profileV2("Open", [pollProfile("A")], {
            workspace: {
              tileMode: false,
              compact: false,
              sidebarWidth: 280,
              sidebarCollapsed: false,
              trafficExpanded: true,
              trafficHeight: 260,
              minimizedOrder: [],
            },
          }),
        ]);
      },
    });
    await h.act(() => h.rt.profileFlow.load("Open"));
    expect(panel()).toBeVisible();
    expect(h.rt.stores.workspace.getState().traffic).toEqual({ expanded: true, height: 260 });
  });

  it("Ctrl+J expands and collapses; the collapsed bar keeps the counters", async () => {
    h = await renderWindow();
    await h.act(() => h.rt.actions.toggleTraffic());
    expect(panel()).toBeVisible();
    await h.act(() => h.rt.actions.toggleTraffic());
    expect(screen.queryByRole("region", { name: "Communication Traffic" })).not.toBeInTheDocument();
    expect(bar()).toBeVisible();
  });
});

describe("Show traffic for this poll", () => {
  it("from a sub-window menu expands the panel with that filter", async () => {
    h = await renderWindow();
    await h.addPoll("Alpha");
    const b = await h.addPoll("Beta");
    await h.user.click(
      within(frameOf(b) as HTMLElement).getByRole("button", { name: "Poll actions" }),
    );
    await h.user.click(screen.getByRole("menuitem", { name: /^Show traffic for this poll/ }));
    const select = within(panel()).getByRole("combobox", { name: "Traffic filter" });
    expect(select).toHaveDisplayValue("Beta");
  });

  it("from a native window (the ShowTraffic event) expands the panel with that filter", async () => {
    h = await renderWindow();
    const a = await h.addPoll("Alpha", {}, "native");
    await h.act(() => h.ipc.showTraffic(a));
    expect(within(panel()).getByRole("combobox", { name: "Traffic filter" })).toHaveDisplayValue(
      "Alpha",
    );
  });

  describe("focus of the Filter select (REPORT-007 D7, CHK2-K5)", () => {
    const filterSelect = () => within(panel()).getByRole("combobox", { name: "Traffic filter" });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("takes the focus when the request came from a native window (W1 did not have the focus)", async () => {
      h = await renderWindow();
      const a = await h.addPoll("Alpha", {}, "native");
      vi.spyOn(document, "hasFocus").mockReturnValue(false);
      await h.act(() => h.ipc.showTraffic(a));
      await waitFor(() => expect(filterSelect()).toHaveFocus());
      expect(h.rt.stores.traffic.getState().focusRequest).toBeNull();
    });

    it("leaves the focus alone when W1 already had it (the request came from W1)", async () => {
      h = await renderWindow();
      const a = await h.addPoll("Alpha");
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
      await h.act(() => h.ipc.showTraffic(a));
      expect(filterSelect()).not.toHaveFocus();
      expect(h.rt.stores.traffic.getState().focusRequest).toBeNull();
    });

    it("showTrafficFor with focusFilter focuses it, without it does not", async () => {
      h = await renderWindow();
      const a = await h.addPoll("Alpha");
      await h.act(async () => h.rt.actions.showTrafficFor(a));
      expect(filterSelect()).not.toHaveFocus();
      await h.act(async () => h.rt.actions.showTrafficFor(a, { focusFilter: true }));
      await waitFor(() => expect(filterSelect()).toHaveFocus());
    });

    it("waits while a modal is open and takes the focus when it closes", async () => {
      h = await renderWindow();
      const a = await h.addPoll("Alpha");
      const unlock = h.rt.stores.layout.getState().lockModal();
      await h.act(async () => h.rt.actions.showTrafficFor(a, { focusFilter: true }));
      expect(filterSelect()).not.toHaveFocus();
      expect(h.rt.stores.traffic.getState().focusRequest).toBe("filter");
      await h.act(async () => unlock());
      await waitFor(() => expect(filterSelect()).toHaveFocus());
      expect(h.rt.stores.traffic.getState().focusRequest).toBeNull();
    });

    it("an already expanded panel keeps its height", async () => {
      h = await renderWindow();
      const a = await h.addPoll("Alpha");
      await h.act(async () => h.rt.stores.workspace.getState().setTrafficExpanded(true));
      const before = h.rt.stores.workspace.getState().traffic;
      await h.act(async () => h.rt.actions.showTrafficFor(a, { focusFilter: true }));
      expect(h.rt.stores.workspace.getState().traffic).toEqual(before);
    });
  });

  it("with no poll (null) it only expands the panel", async () => {
    h = await renderWindow();
    await h.addPoll("Alpha");
    await h.act(() => h.ipc.showTraffic(null));
    expect(within(panel()).getByRole("combobox", { name: "Traffic filter" })).toHaveDisplayValue(
      "All polls",
    );
  });
});
