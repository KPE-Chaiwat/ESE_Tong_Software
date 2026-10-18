// Regression tests for REV-002 and REV-003 bug classes that the legacy window had and the new
// connection window must keep (REV-006 m-10). Each describe names the finding.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { sessionReason } from "@/shared/ipc/modbus-master.fake";
import type { TrafficFrame } from "@/shared/ipc/modbus-master.types";
import { TRAFFIC_CAPACITY } from "../store/traffic.logic";
import { pollProfile, profileV2 } from "./dialogs/profile-fixtures";
import { type Harness, renderWindow } from "./test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const host = () => screen.getByLabelText("Host") as HTMLInputElement;
const banner = () => document.querySelector<HTMLElement>("[data-slot=state-banner]");
const toolbar = () => screen.getByRole("toolbar", { name: "Toolbar" });

const frame = (seq: number): TrafficFrame => ({
  seq,
  at: 0,
  direction: seq % 2 === 1 ? "tx" : "rx",
  bytes: [0, 1],
  slaveId: 1,
  function: 3,
  exceptionCode: null,
  note: null,
  origin: null,
});

describe("REV-002 m4: a full traffic log does not move under the reader", () => {
  async function fullLog() {
    h = await renderWindow();
    await h.act(() => h.rt.stores.workspace.getState().setTrafficExpanded(true));
    await h.act(() => h.ipc.emitFrames(Array.from({ length: 5000 }, (_, i) => frame(i + 1))));
    const list = within(screen.getByRole("region", { name: "Communication Traffic" })).getByRole(
      "grid",
      { name: "Frames" },
    );
    return list;
  }

  it("keeps the frame at the top of the view while Auto-scroll is off", async () => {
    const list = await fullLog();
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 110000 });
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 300 });
    await h.user.click(screen.getByRole("checkbox", { name: "Auto-scroll" }));
    // Row 100 (frame 101) is at the top of the view.
    list.scrollTop = 100 * 22;
    act(() => {
      fireEvent.scroll(list);
    });
    await h.act(() => h.ipc.emitFrames(Array.from({ length: 20 }, (_, i) => frame(5001 + i))));
    // The 20 oldest frames were dropped: the same frame is now 20 rows higher in the buffer.
    expect(list.scrollTop).toBe(80 * 22);
    await h.act(() => h.ipc.emitFrames(Array.from({ length: 5 }, (_, i) => frame(5021 + i))));
    expect(list.scrollTop).toBe(75 * 22);
  });

  it("does not touch the scroll position while Auto-scroll is on", async () => {
    const list = await fullLog();
    list.scrollTop = 1234;
    await h.act(() => h.ipc.emitFrames([frame(5001)]));
    expect(list.scrollTop).toBe(1234);
  });
});

describe("REV-002 m7: the session buttons wait for the snapshot", () => {
  it("Connect and New poll are disabled until the session is open, then enabled", async () => {
    h = await renderWindow({ lazyInit: true });
    expect(within(toolbar()).getByRole("button", { name: "Connect" })).toBeDisabled();
    expect(within(toolbar()).getByRole("button", { name: /^New poll/ })).toBeDisabled();
    await h.act(() => h.rt.init());
    await waitFor(() =>
      expect(within(toolbar()).getByRole("button", { name: "Connect" })).toBeEnabled(),
    );
    expect(within(toolbar()).getByRole("button", { name: /^New poll/ })).toBeEnabled();
  });

  it("a reloaded window shows the connection the backend has and starts clean", async () => {
    h = await renderWindow({
      lazyInit: true,
      prepare: ({ ipc }) => {
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
    await h.act(() => h.rt.init());
    expect(screen.queryByText("· Modified")).not.toBeInTheDocument();
    expect(h.rt.stores.profile.getState().modified).toBe(false);
  });
});

describe("REV-002 M2: the banner and the live region describe the running connection, not the draft", () => {
  it("editing the host after a refused connection does not change the banner", async () => {
    h = await renderWindow();
    h.ipc.scriptConnectFailure(sessionReason("refused"));
    await h.user.type(host(), "192.168.1.10");
    await h.user.click(within(toolbar()).getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(banner()).toHaveTextContent("Connection refused by 192.168.1.10:502."),
    );
    const field = host();
    await h.user.clear(field);
    await h.user.type(field, "10.0.0.9");
    expect(banner()).toHaveTextContent("Connection refused by 192.168.1.10:502.");
  });

  it("the live region announces the running target, not the draft", async () => {
    h = await renderWindow();
    await h.user.type(host(), "192.168.1.10");
    await h.user.click(within(toolbar()).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(h.ipc.callsOf("connect")).toHaveLength(1));
    await h.act(() =>
      h.rt.stores.draft.getState().setConnection({
        mode: "tcp",
        host: "10.0.0.9",
        port: 502,
        timeoutMs: 1000,
      }),
    );
    await h.act(() => h.ipc.dropLink(sessionReason("refused", "x", "linkLost")));
    expect(h.rt.stores.connection.getState().connection).toMatchObject({ host: "192.168.1.10" });
    expect(banner()).toHaveTextContent("192.168.1.10:502");
  });
});

describe("REV-003 n-4: the traffic batch is capped with the ring size", () => {
  it("a window that gets no animation frame never queues more than the ring holds", async () => {
    const callbacks: Array<() => void> = [];
    h = await renderWindow({
      runtimeOptions: {
        scheduler: (cb) => {
          callbacks.push(cb);
          return () => {};
        },
      },
    });
    const append = vi.spyOn(h.rt.stores.traffic.getState(), "appendFrames");
    // Three batches of 3,000 frames arrive before the first frame runs.
    for (let i = 0; i < 3; i += 1) {
      h.ipc.emitFrames(Array.from({ length: 3000 }, (_, k) => frame(i * 3000 + k + 1)));
    }
    act(() => {
      for (const cb of callbacks.splice(0)) cb();
    });
    const delivered = append.mock.calls.flatMap((c) => c[0] as TrafficFrame[]);
    expect(delivered.length).toBeLessThanOrEqual(TRAFFIC_CAPACITY);
    // The newest are kept.
    expect(delivered.at(-1)?.seq).toBe(9000);
  });
});

describe("DES-001 3.1: values outside the lists in a loaded profile", () => {
  it("an RTU profile shows the stored value as not supported, with the messages", async () => {
    h = await renderWindow({
      prepare: ({ ipc }) => {
        ipc.seedProfiles([
          profileV2("Hand edited", [pollProfile("Poll 1")], {
            connection: {
              mode: "rtu",
              port: "COM3",
              baud: 250000,
              dataBits: 6,
              parity: "even",
              stopBits: 3,
              timeoutMs: 1000,
            } as never,
          }),
        ]);
      },
    });
    await h.act(() => h.rt.profileFlow.load("Hand edited"));
    expect(await screen.findByText("Choose a baud rate from the list.")).toBeVisible();
    expect(screen.getByText("Data bits must be 7 or 8.")).toBeVisible();
    expect(screen.getByText("Stop bits must be 1 or 2.")).toBeVisible();
    const baud = screen.getByLabelText("Baud") as HTMLSelectElement;
    expect(baud.value).toBe("250000");
    expect(
      within(baud).getByRole("option", { name: "250000 (not supported)" }),
    ).toBeInTheDocument();
    expect(baud).toHaveAttribute("aria-invalid", "true");
    expect(h.rt.stores.connection.getState().state).toBe("idle");
  });
});
