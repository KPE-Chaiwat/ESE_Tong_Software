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
    ...over,
  };
}

const panel = () => screen.getByRole("region", { name: "Communication Traffic" });
const list = () => within(panel()).getByRole("grid", { name: "Frames" });
const rows = () => within(list()).getAllByRole("row");

describe("traffic panel (task 14)", () => {
  it("shows the empty text", async () => {
    h = await renderWindow();
    expect(screen.getByTestId("traffic-empty")).toHaveTextContent(
      "No frames yet. Requests and responses appear here.",
    );
  });

  it("shows the counters", async () => {
    h = await renderWindow();
    h.emit(() => h.ipc.emitCounters({ requests: 1204, responses: 1198, errors: 2, timeouts: 4 }));
    const p = within(panel());
    expect(p.getByText("1204")).toBeVisible();
    expect(p.getByText("1198")).toBeVisible();
    expect(p.getByText("Errors")).toBeVisible();
    expect(p.getByText("4")).toBeVisible();
  });

  it("lists frames with number, time, direction as arrow plus text, length, bytes and info", async () => {
    h = await renderWindow();
    h.emit(() => h.ipc.emitFrames([frame(1), frame(2, { bytes: [0, 1, 0xab] })]));
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

  it("an RX exception frame shows the exception name in Info with an error icon", async () => {
    h = await renderWindow();
    h.emit(() =>
      h.ipc.emitFrames([frame(2, { direction: "rx", bytes: [1, 0x83, 2], exceptionCode: 2 })]),
    );
    const row = rows()[1] as HTMLElement;
    expect(row).toHaveTextContent("Exception 02 Illegal data address");
    expect(row.querySelector('[data-icon="octagon-x"]')).toBeInTheDocument();
  });

  it("selecting a frame shows the detail strip with 16 bytes per line and 4-digit offsets", async () => {
    h = await renderWindow();
    const bytes = Array.from({ length: 20 }, (_, i) => i);
    h.emit(() => h.ipc.emitFrames([frame(1, { bytes })]));
    expect(screen.queryByTestId("frame-detail")).not.toBeInTheDocument();
    await h.user.click(rows()[1] as HTMLElement);
    const detail = screen.getByTestId("frame-detail");
    expect(detail).toHaveTextContent("0000 00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F");
    expect(detail).toHaveTextContent("0010 10 11 12 13");
    expect(rows()[1]).toHaveAttribute("aria-selected", "true");
  });

  it("Copy bytes copies the selected frame as hex", async () => {
    h = await renderWindow();
    h.emit(() => h.ipc.emitFrames([frame(1, { bytes: [0, 1, 0xab] })]));
    await h.user.click(rows()[1] as HTMLElement);
    await h.user.click(screen.getByRole("button", { name: "Copy bytes" }));
    await waitFor(() => expect(h.copied).toEqual(["00 01 AB"]));
  });

  it("Copy copies the one selected frame in the tab separated format (DES-001 5.2)", async () => {
    h = await renderWindow();
    h.emit(() =>
      h.ipc.emitFrames([
        frame(1),
        frame(2, { direction: "rx", exceptionCode: 2, bytes: [1, 0x83, 2] }),
      ]),
    );
    await h.user.click(rows()[2] as HTMLElement);
    await h.user.click(within(panel()).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(h.copied).toHaveLength(1));
    expect(h.copied[0]).toBe("14:02:11.532\tRX\t01 83 02\tException 02 Illegal data address");
    expect(await screen.findByText("Copied 1 frame.")).toBeVisible();
  });

  it("without a selected frame, Copy is disabled and Ctrl+C copies nothing and shows no toast", async () => {
    h = await renderWindow();
    h.emit(() => h.ipc.emitFrames([frame(1), frame(2)]));
    expect(within(panel()).getByRole("button", { name: "Copy" })).toBeDisabled();
    list().focus();
    await h.user.keyboard("{Control>}c{/Control}");
    await new Promise((r) => setTimeout(r, 20));
    expect(h.copied).toEqual([]);
    expect(screen.queryByText(/Copied/)).not.toBeInTheDocument();
  });

  it("Ctrl+C in the list copies the selected frame", async () => {
    h = await renderWindow();
    h.emit(() => h.ipc.emitFrames([frame(1), frame(2)]));
    await h.user.click(rows()[2] as HTMLElement);
    await h.user.keyboard("{Control>}c{/Control}");
    await waitFor(() => expect(h.copied).toHaveLength(1));
    expect(h.copied[0]).toContain("RX");
    expect(h.copied[0]).not.toContain("TX");
    expect(await screen.findByText("Copied 1 frame.")).toBeVisible();
  });

  it("Ctrl+A in the traffic list selects nothing (single selection, DES-001 5.1)", async () => {
    h = await renderWindow();
    h.emit(() => h.ipc.emitFrames([frame(1), frame(2)]));
    await h.user.click(rows()[1] as HTMLElement);
    await h.user.keyboard("{Control>}a{/Control}");
    expect(h.rt.stores.traffic.getState().selectedSeq).toBe(1);
    expect(rows().filter((r) => r.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("Shift-click and Ctrl-click leave exactly one frame selected", async () => {
    h = await renderWindow();
    h.emit(() => h.ipc.emitFrames([frame(1), frame(2), frame(3)]));
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
    h = await renderWindow();
    h.emit(() => h.ipc.emitFrames([frame(1), frame(2), frame(3)]));
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
    h = await renderWindow();
    h.emit(() => {
      h.ipc.emitFrames([frame(1)]);
      h.ipc.emitCounters({ requests: 5, responses: 4, errors: 0, timeouts: 1 });
    });
    await h.user.click(within(panel()).getByRole("button", { name: "Clear" }));
    expect(screen.getByTestId("traffic-empty")).toHaveTextContent(
      /^Log cleared at \d\d:\d\d:\d\d\.\d{3}\. New frames appear here\.$/,
    );
    expect(within(panel()).getByText("5")).toBeVisible();
  });

  it("Ctrl+Shift+K clears the log", async () => {
    h = await renderWindow();
    h.emit(() => h.ipc.emitFrames([frame(1)]));
    act(() => {
      fireEvent.keyDown(window, { key: "K", ctrlKey: true, shiftKey: true });
    });
    expect(h.rt.stores.traffic.getState().frames.size).toBe(0);
  });

  it("Reset counters calls the backend and zeroes them", async () => {
    h = await renderWindow();
    h.emit(() => h.ipc.emitCounters({ requests: 5, responses: 4, errors: 1, timeouts: 1 }));
    await h.user.click(within(panel()).getByRole("button", { name: "Reset counters" }));
    await waitFor(() => expect(h.ipc.callsOf("resetCounters")).toHaveLength(1));
    await waitFor(() => expect(h.rt.stores.traffic.getState().counters.requests).toBe(0));
  });

  it("Auto-scroll is on by default and can be switched off", async () => {
    h = await renderWindow();
    const box = screen.getByRole("checkbox", { name: "Auto-scroll" });
    expect(box).toBeChecked();
    await h.user.click(box);
    expect(h.rt.stores.traffic.getState().autoScroll).toBe(false);
  });

  it("scrolling up turns Auto-scroll off", async () => {
    h = await renderWindow();
    h.emit(() => h.ipc.emitFrames(Array.from({ length: 100 }, (_, i) => frame(i + 1))));
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
    h = await renderWindow();
    h.emit(() => h.ipc.emitFrames(Array.from({ length: 5001 }, (_, i) => frame(i + 1))));
    expect(h.rt.stores.traffic.getState().frames.size).toBe(5000);
    expect(list()).toHaveAttribute("aria-rowcount", "5001");
    expect(rows().length).toBeLessThan(100);
  });

  it("the collapse button toggles the panel body", async () => {
    h = await renderWindow();
    await h.user.click(screen.getByRole("button", { name: "Collapse traffic panel" }));
    expect(within(panel()).queryByRole("grid")).not.toBeInTheDocument();
    await h.user.click(screen.getByRole("button", { name: "Expand traffic panel" }));
    expect(within(panel()).getByRole("grid", { name: "Frames" })).toBeVisible();
  });
});
