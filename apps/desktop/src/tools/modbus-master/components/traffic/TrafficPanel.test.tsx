import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { TrafficFrame } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const at = new Date(2026, 9, 12, 14, 2, 11, 532).getTime();

function frame(seq: number, over: Partial<TrafficFrame> = {}): TrafficFrame {
  return {
    seq,
    at,
    direction: seq % 2 === 1 ? "tx" : "rx",
    bytes: [0, 1, 0, 0, 0, 6, 1, 3, 0, 0, 0, 10],
    slaveId: 1,
    function: 3,
    exceptionCode: null,
    note: null,
    origin: null,
    ...over,
  };
}

const counters = (requests: number, responses: number, errors: number, timeouts: number) => ({
  total: { requests, responses, errors, timeouts },
});

/** Renders the window with the panel expanded. */
async function expanded(): Promise<void> {
  h = await renderWindow();
  await h.act(() => h.rt.stores.workspace.getState().setTrafficExpanded(true));
}

const panel = () => screen.getByRole("region", { name: "Communication Traffic" });
const list = () => within(panel()).getByRole("grid", { name: "Frames" });
const rows = () => within(list()).getAllByRole("row");

describe("traffic panel", () => {
  it("shows the empty text", async () => {
    await expanded();
    expect(screen.getByTestId("traffic-empty")).toHaveTextContent(
      "No frames yet. Requests and responses appear here.",
    );
  });

  it("shows the counters of the filter", async () => {
    await expanded();
    h.advance(0);
    await h.act(() => h.ipc.emitCounters(counters(1204, 1198, 2, 4)));
    const p = within(panel());
    expect(p.getByText("1204")).toBeVisible();
    expect(p.getByText("1198")).toBeVisible();
    expect(p.getByText("Errors")).toBeVisible();
    expect(p.getByText("4")).toBeVisible();
  });

  it("lists frames with number, time, direction as arrow plus text, length, bytes and info", async () => {
    await expanded();
    await h.act(() => h.ipc.emitFrames([frame(1), frame(2, { bytes: [0, 1, 0xab] })]));
    const [, first, second] = rows();
    expect(first).toHaveTextContent("1");
    expect(first).toHaveTextContent("14:02:11.532");
    expect(first).toHaveTextContent("→ TX");
    expect(first).toHaveTextContent("12");
    expect(first).toHaveTextContent("00 01 00 00 00 06 01 03 00 00 00 0A");
    expect(first).toHaveTextContent("FC03 slave 1");
    expect(second).toHaveTextContent("← RX");
    expect(second).toHaveTextContent("00 01 AB");
    expect(list()).toHaveAttribute("aria-rowcount", "3");
  });

  it("the Poll column shows the poll, or Write: poll, from the frame origin", async () => {
    await expanded();
    const id = await h.addPoll("Pump 2");
    await h.act(() =>
      h.ipc.emitFrames([
        frame(1, { origin: { kind: "poll", pollId: id } }),
        frame(2, { origin: { kind: "write", pollId: id } }),
        frame(3, { origin: { kind: "write", pollId: null } }),
      ]),
    );
    const [, a, b, c] = rows();
    expect(
      within(a as HTMLElement)
        .getAllByRole("gridcell")
        .at(-1),
    ).toHaveTextContent("Pump 2");
    expect(
      within(b as HTMLElement)
        .getAllByRole("gridcell")
        .at(-1),
    ).toHaveTextContent("Write: Pump 2");
    expect(
      within(c as HTMLElement)
        .getAllByRole("gridcell")
        .at(-1),
    ).toHaveTextContent("Write");
  });

  it("an RX exception frame shows the exception name in Info with an error icon", async () => {
    await expanded();
    await h.act(() =>
      h.ipc.emitFrames([frame(2, { direction: "rx", bytes: [1, 0x83, 2], exceptionCode: 2 })]),
    );
    const row = rows()[1] as HTMLElement;
    expect(row).toHaveTextContent("Exception 02 Illegal data address");
    expect(row.querySelector('[data-icon="octagon-x"]')).toBeInTheDocument();
  });

  it("selecting a frame shows the detail strip with 16 bytes per line and 4-digit offsets", async () => {
    await expanded();
    const bytes = Array.from({ length: 20 }, (_, i) => i);
    await h.act(() => h.ipc.emitFrames([frame(1, { bytes })]));
    expect(screen.queryByTestId("frame-detail")).not.toBeInTheDocument();
    await h.user.click(rows()[1] as HTMLElement);
    const detail = screen.getByTestId("frame-detail");
    expect(detail).toHaveTextContent("0000 00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F");
    expect(detail).toHaveTextContent("0010 10 11 12 13");
    expect(rows()[1]).toHaveAttribute("aria-selected", "true");
  });

  it("Copy bytes copies the selected frame as hex", async () => {
    await expanded();
    await h.act(() => h.ipc.emitFrames([frame(1, { bytes: [0, 1, 0xab] })]));
    await h.user.click(rows()[1] as HTMLElement);
    await h.user.click(screen.getByRole("button", { name: "Copy bytes" }));
    await waitFor(() => expect(h.copied).toEqual(["00 01 AB"]));
  });

  it("Copy copies the one selected frame in the tab separated format (DES-001 5.2)", async () => {
    await expanded();
    await h.act(() =>
      h.ipc.emitFrames([
        frame(1),
        frame(2, { direction: "rx", exceptionCode: 2, bytes: [1, 0x83, 2] }),
      ]),
    );
    await h.user.click(rows()[2] as HTMLElement);
    await h.user.click(within(panel()).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(h.copied).toHaveLength(1));
    expect(h.copied[0]).toBe("14:02:11.532\tRX\t01 83 02\tException 02 Illegal data address\t");
    expect(await screen.findByText("Copied 1 frame.")).toBeVisible();
  });

  it("without a selected frame, Copy is disabled and Ctrl+C copies nothing and shows no toast", async () => {
    await expanded();
    await h.act(() => h.ipc.emitFrames([frame(1), frame(2)]));
    expect(within(panel()).getByRole("button", { name: "Copy" })).toBeDisabled();
    list().focus();
    await h.user.keyboard("{Control>}c{/Control}");
    await new Promise((r) => setTimeout(r, 20));
    expect(h.copied).toEqual([]);
    expect(screen.queryByText(/Copied/)).not.toBeInTheDocument();
  });

  it("Ctrl+C in the list copies the selected frame", async () => {
    await expanded();
    await h.act(() => h.ipc.emitFrames([frame(1), frame(2)]));
    await h.user.click(rows()[2] as HTMLElement);
    await h.user.keyboard("{Control>}c{/Control}");
    await waitFor(() => expect(h.copied).toHaveLength(1));
    expect(h.copied[0]).toContain("RX");
    expect(h.copied[0]).not.toContain("TX");
    expect(await screen.findByText("Copied 1 frame.")).toBeVisible();
  });

  it("Ctrl+A in the traffic list selects nothing (single selection, DES-001 5.1)", async () => {
    await expanded();
    await h.act(() => h.ipc.emitFrames([frame(1), frame(2)]));
    await h.user.click(rows()[1] as HTMLElement);
    await h.user.keyboard("{Control>}a{/Control}");
    expect(h.rt.stores.traffic.getState().selectedSeq).toBe(1);
    expect(rows().filter((r) => r.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("Shift-click and Ctrl-click leave exactly one frame selected", async () => {
    await expanded();
    await h.act(() => h.ipc.emitFrames([frame(1), frame(2), frame(3)]));
    await h.user.click(rows()[1] as HTMLElement);
    await h.user.keyboard("{Shift>}");
    await h.user.click(rows()[3] as HTMLElement);
    await h.user.keyboard("{/Shift}{Control>}");
    await h.user.click(rows()[2] as HTMLElement);
    await h.user.keyboard("{/Control}");
    expect(rows().filter((r) => r.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(h.rt.stores.traffic.getState().selectedSeq).toBe(2);
  });

  it("arrow keys move the frame selection", async () => {
    await expanded();
    await h.act(() => h.ipc.emitFrames([frame(1), frame(2), frame(3)]));
    await h.user.click(rows()[1] as HTMLElement);
    await h.user.keyboard("{ArrowDown}{ArrowDown}");
    expect(h.rt.stores.traffic.getState().selectedSeq).toBe(3);
    await h.user.keyboard("{ArrowDown}");
    expect(h.rt.stores.traffic.getState().selectedSeq).toBe(3);
    await h.user.keyboard("{Home}");
    expect(h.rt.stores.traffic.getState().selectedSeq).toBe(1);
    await h.user.keyboard("{Escape}");
    expect(h.rt.stores.traffic.getState().selectedSeq).toBeNull();
  });

  it("Clear empties the list, keeps the counters and shows the cleared text", async () => {
    await expanded();
    await h.act(() => {
      h.ipc.emitFrames([frame(1)]);
      h.ipc.emitCounters(counters(5, 4, 0, 1));
    });
    await h.user.click(within(panel()).getByRole("button", { name: "Clear" }));
    expect(screen.getByTestId("traffic-empty")).toHaveTextContent(
      /^Log cleared at \d\d:\d\d:\d\d\.\d{3}\. New frames appear here\.$/,
    );
    expect(within(panel()).getByText("5")).toBeVisible();
  });

  it("Ctrl+Shift+K clears the log", async () => {
    await expanded();
    await h.act(() => h.ipc.emitFrames([frame(1)]));
    act(() => {
      fireEvent.keyDown(window, { key: "K", ctrlKey: true, shiftKey: true });
    });
    expect(h.rt.stores.traffic.getState().frames.size).toBe(0);
  });

  it("Reset counters calls the backend for the whole connection under All polls", async () => {
    await expanded();
    await h.act(() => h.ipc.emitCounters(counters(5, 4, 1, 1)));
    await h.user.click(within(panel()).getByRole("button", { name: "Reset counters" }));
    await waitFor(() => expect(h.ipc.callsOf("resetCounters")).toEqual([[null]]));
  });

  it("the Filter select lists All polls, Writes and the polls in list order, and filters", async () => {
    await expanded();
    const a = await h.addPoll("Alpha");
    const b = await h.addPoll("Beta");
    const select = within(panel()).getByRole("combobox", { name: "Traffic filter" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["All polls", "Writes", "Alpha", "Beta"]);
    await h.act(() =>
      h.ipc.emitFrames([
        frame(1, { origin: { kind: "poll", pollId: a } }),
        frame(2, { origin: { kind: "poll", pollId: b } }),
      ]),
    );
    await h.user.selectOptions(select, "Beta");
    expect(rows()).toHaveLength(2);
    expect(rows()[1]).toHaveTextContent("Beta");
    await h.user.selectOptions(select, "Writes");
    expect(screen.getByTestId("traffic-empty")).toHaveTextContent("No frames for Writes yet.");
  });

  it("Auto-scroll is on by default and can be switched off", async () => {
    await expanded();
    const box = screen.getByRole("checkbox", { name: "Auto-scroll" });
    expect(box).toBeChecked();
    await h.user.click(box);
    expect(h.rt.stores.traffic.getState().autoScroll).toBe(false);
  });

  it("scrolling up turns Auto-scroll off", async () => {
    await expanded();
    await h.act(() => h.ipc.emitFrames(Array.from({ length: 100 }, (_, i) => frame(i + 1))));
    const el = list();
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: 2200 });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 300 });
    el.scrollTop = 100;
    act(() => {
      fireEvent.scroll(el);
    });
    expect(h.rt.stores.traffic.getState().autoScroll).toBe(false);
    expect(screen.getByRole("checkbox", { name: "Auto-scroll" })).not.toBeChecked();
  });

  it("virtualizes a full log of 5000 frames", async () => {
    await expanded();
    await h.act(() => h.ipc.emitFrames(Array.from({ length: 5001 }, (_, i) => frame(i + 1))));
    expect(h.rt.stores.traffic.getState().frames.size).toBe(5000);
    expect(list()).toHaveAttribute("aria-rowcount", "5001");
    expect(rows().length).toBeLessThan(100);
  });

  it("the collapse button returns to the traffic bar, which keeps the counters", async () => {
    await expanded();
    await h.user.click(screen.getByRole("button", { name: "Collapse traffic panel" }));
    expect(screen.queryByRole("grid", { name: "Frames" })).not.toBeInTheDocument();
    expect(screen.getByTestId("traffic-bar")).toBeVisible();
    await h.user.click(screen.getByRole("button", { name: "Expand traffic panel" }));
    expect(screen.getByRole("grid", { name: "Frames" })).toBeVisible();
  });
});

describe("QA hooks (REPORT-003 section 5, item 5)", () => {
  it("every cell of a frame row names its column with data-cell", async () => {
    await expanded();
    const a = await h.addPoll("Pump 2");
    await h.act(() => h.ipc.emitFrames([frame(1, { origin: { kind: "poll", pollId: a } })]));
    const row = within(list()).getAllByRole("row")[1] as HTMLElement;
    const cells = within(row).getAllByRole("gridcell");
    expect(cells.map((c) => c.getAttribute("data-cell"))).toEqual([
      "seq",
      "time",
      "dir",
      "len",
      "bytes",
      "info",
      "poll",
    ]);
    expect(row.querySelector('[data-cell="poll"]')).toHaveTextContent("Pump 2");
    expect(row.querySelector('[data-cell="seq"]')).toHaveTextContent("1");
  });
});
