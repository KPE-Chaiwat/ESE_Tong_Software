import { act, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import type { PollHostKind } from "@/shared/ipc/modbus-master.types";
import { clickWithLayoutShift } from "@/shared/lib/press-test-utils";
import { presetDefaults } from "../../lib/scale-presets";
import { noScaleFactory } from "../../lib/scaled";
import {
  disposeHarnesses,
  installPollViewEnvironment,
  type PollViewHarness,
  renderPollView,
  uninstallPollViewEnvironment,
} from "./test-utils";

beforeAll(installPollViewEnvironment);
afterAll(uninstallPollViewEnvironment);
afterEach(disposeHarnesses);

// Scaled columns only show for a poll that has a scale (REV-007 m-3).
const SCALE = presetDefaults("current4to20");

const statusLine = () => screen.getByRole("group", { name: "Poll status" });
const counters = () => screen.getByTestId("status-counters");

/** Emits counters for the poll from the backend side (manual mode). */
function counts(
  h: PollViewHarness,
  requests: number,
  errors: number,
  timeouts: number,
  effective: number | null = null,
) {
  act(() =>
    h.ipc.emitView(h.pollId, {
      type: "PollCounters",
      pollId: h.pollId,
      counters: { requests, responses: requests - timeouts, errors, timeouts },
      effectiveScanMs: effective,
      lastOkAt: null,
    }),
  );
}

describe.each(["workspace", "native"] as const)("PollView in the %s host", (host: PollHostKind) => {
  describe("status line (DES-002 2.3.2)", () => {
    it("polling: chip, counters in the exact format, no reason, plain line", async () => {
      const h = await renderPollView({ host, mode: "manual" });
      act(() => {
        h.ipc.emitConnectionState("connected");
        h.ipc.emitPollState(h.pollId, "polling");
        h.ipc.emitPollUpdate(h.pollId, { values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
      });
      counts(h, 1204, 0, 0);
      expect(within(statusLine()).getByText("Polling")).toBeInTheDocument();
      expect(counters()).toHaveTextContent("Tx 1204 · Err 0 · ID 1 · F 03 · SR 100 ms");
      expect(screen.queryByTestId("status-reason")).not.toBeInTheDocument();
      expect(statusLine()).toHaveAttribute("data-tone", "none");
    });

    it("Err is errors plus timeouts; the effective rate is shown when Rust reports it", async () => {
      const h = await renderPollView({ host, mode: "manual" });
      counts(h, 20, 2, 4, 160);
      expect(counters()).toHaveTextContent(
        "Tx 20 · Err 6 · ID 1 · F 03 · SR 100 ms (effective 160 ms)",
      );
      // up to 1.5 x the scan rate it is not worth showing
      counts(h, 20, 2, 4, 150);
      expect(counters()).toHaveTextContent("SR 100 ms");
      expect(counters()).not.toHaveTextContent("effective");
    });

    it("waiting: polling with no data yet", async () => {
      const h = await renderPollView({ host, connect: true });
      expect(within(statusLine()).getByText("Waiting…")).toBeInTheDocument();
      expect(h.rt.stores.data.getState().status).toBe("loading");
    });

    it("timeout: warning line, reason, and the full banner text as the tooltip", async () => {
      const h = await renderPollView({ host, connect: true });
      h.advance(300);
      act(() => {
        h.ipc.scriptFault(h.pollId, { kind: "timeout" });
      });
      h.advance(1500);
      expect(within(statusLine()).getByText("Timeout")).toBeInTheDocument();
      expect(screen.getByTestId("status-reason")).toHaveTextContent("No response within 1000 ms");
      expect(statusLine()).toHaveAttribute("data-tone", "warning");
      expect(screen.getByTestId("status-reason")).toHaveAttribute(
        "title",
        expect.stringMatching(
          /^Timeout: slave 1 did not respond within 1000 ms\. Retrying every 100 ms \(\d+ in a row\)\.$/,
        ),
      );
      expect(counters()).toHaveTextContent(/^Tx \d+ · Err \d+ · ID 1 · F 03 · SR 100 ms$/);
    });

    it("exception: error tint, chip with the code, reason with the name", async () => {
      const h = await renderPollView({ host, mode: "manual" });
      act(() => {
        h.ipc.emitConnectionState("connected");
        h.ipc.emitPollState(h.pollId, "polling");
        h.ipc.emitPollState(h.pollId, "exception", { exceptionCode: 2, consecutiveFailures: 3 });
      });
      expect(within(statusLine()).getByText("Exception 02")).toBeInTheDocument();
      expect(screen.getByTestId("status-reason")).toHaveTextContent(
        "Exception 02 (Illegal data address)",
      );
      expect(statusLine()).toHaveAttribute("data-tone", "error");
      expect(screen.getByTestId("status-reason")).toHaveAttribute(
        "title",
        "Exception 02 (Illegal data address) from slave 1 for FC03 at 0-9. Retrying every 100 ms (3 in a row).",
      );
    });

    it("bad response: warning line with the kind text", async () => {
      const h = await renderPollView({ host, mode: "manual" });
      act(() => {
        h.ipc.emitConnectionState("connected");
        h.ipc.emitPollState(h.pollId, "polling");
        h.ipc.emitPollState(h.pollId, "badResponse", {
          consecutiveFailures: 1,
          badResponseKind: "shortFrame",
          badResponseDetail: { expected: 29, got: 20, message: "" },
        });
      });
      expect(within(statusLine()).getByText("Bad response")).toBeInTheDocument();
      expect(screen.getByTestId("status-reason")).toHaveTextContent(
        "Bad response: short frame (20 of 29 bytes)",
      );
      expect(statusLine()).toHaveAttribute("data-tone", "warning");
    });

    it("paused: chip only", async () => {
      const h = await renderPollView({ host, connect: true, paused: true });
      expect(within(statusLine()).getByText("Paused")).toBeInTheDocument();
      expect(screen.queryByTestId("status-reason")).not.toBeInTheDocument();
      expect(h.rt.stores.poll.getState().state).toBe("paused");
    });

    it.each([
      ["idle", "No connection", "neutral"],
      ["connecting", "Connecting…", "neutral"],
      ["disconnected", "No connection: link lost", "error"],
    ] as const)("offline while the connection is %s", async (connection, text, tone) => {
      const h = await renderPollView({ host, mode: "manual" });
      act(() => {
        if (connection !== "idle") h.ipc.emitConnectionState(connection);
      });
      expect(within(statusLine()).getByText("Offline")).toBeInTheDocument();
      expect(screen.getByTestId("status-reason")).toHaveTextContent(text);
      expect(statusLine()).toHaveAttribute("data-tone", tone);
    });

    it("the loading (attach) state: Loading… in the status line and Loading poll… in the data card", async () => {
      const h = await renderPollView({ host, holdAttach: true });
      expect(
        within(screen.getByTestId("poll-status-line")).getByText("Loading…"),
      ).toBeInTheDocument();
      expect(screen.getByText("Loading poll…")).toBeVisible();
      await h.release();
      expect(screen.queryByText("Loading poll…")).not.toBeInTheDocument();
      expect(within(statusLine()).getByText("Offline")).toBeInTheDocument();
    });

    it("shows the data card header for a wide view and no header below 720 px", async () => {
      const h = await renderPollView({ host, mode: "manual" });
      expect(screen.getByTestId("poll-summary")).toHaveTextContent(
        "Slave 1 · FC03 · 0-9 (10) · 100 ms",
      );
      h.setWidth(600);
      expect(screen.queryByTestId("poll-summary")).not.toBeInTheDocument();
    });
  });

  describe("data card (DES-001 2.4, DES-002 2.3.4)", () => {
    it("offline text per host, with no connection", async () => {
      await renderPollView({ host, mode: "manual" });
      expect(screen.getByTestId("data-empty")).toHaveTextContent(
        host === "native"
          ? "Not connected. Connect from the connection window (Ctrl+Shift+M)."
          : "Not connected. Connect from the toolbar (Ctrl+L).",
      );
    });

    it("connecting and lost link texts", async () => {
      const h = await renderPollView({ host, mode: "manual" });
      act(() => {
        h.ipc.emitConnectionState("connecting");
      });
      expect(screen.getByTestId("data-empty")).toHaveTextContent("Connecting to the device…");
      act(() => {
        h.ipc.emitConnectionState("disconnected");
      });
      expect(screen.getByTestId("data-empty")).toHaveTextContent(
        "Connection lost. Press Reconnect to continue.",
      );
    });

    it("paused without values: how to resume", async () => {
      await renderPollView({ host, connect: true, paused: true });
      expect(screen.getByTestId("data-empty")).toHaveTextContent(
        "Poll paused. Press Resume (Ctrl+P) to read 10 holding registers from slave 1.",
      );
    });

    it("loading rows show dashes, then live values with the Updated chip", async () => {
      const h = await renderPollView({ host, connect: true });
      expect(screen.getByRole("grid", { name: "Register values" })).toHaveAttribute(
        "data-status",
        "loading",
      );
      expect(screen.getByText("Waiting for first response…")).toBeInTheDocument();
      h.advance(200);
      const grid = screen.getByRole("grid", { name: "Register values" });
      expect(grid).toHaveAttribute("data-status", "live");
      expect(screen.getByText(/^Updated \d\d:\d\d:\d\d\.\d{3}$/)).toBeInTheDocument();
      const rows = within(grid).getAllByRole("row");
      // header + 10 rows
      expect(rows).toHaveLength(11);
    });

    it("stale values keep their numbers, with the chip naming the state and the time", async () => {
      const h = await renderPollView({ host, connect: true });
      h.advance(200);
      await h.act(() => h.ipc.setPollActive(h.pollId, false));
      const grid = screen.getByRole("grid", { name: "Register values" });
      expect(grid).toHaveAttribute("data-status", "stale");
      expect(screen.getByText(/^Paused - values from \d\d:\d\d:\d\d\.\d{3}$/)).toBeInTheDocument();
      expect(within(grid).getAllByRole("row")).toHaveLength(11);
    });

    it("a lost link shows the values as stale with 'Offline - values from {time}'", async () => {
      const h = await renderPollView({ host, connect: true });
      h.advance(200);
      act(() => h.ipc.dropLink());
      expect(screen.getByText(/^Offline - values from \d\d:\d\d:\d\d\.\d{3}$/)).toBeInTheDocument();
    });

    it("exception before any data explains itself", async () => {
      const h = await renderPollView({ host, mode: "manual" });
      act(() => {
        h.ipc.emitConnectionState("connected");
        h.ipc.emitPollState(h.pollId, "polling");
        h.ipc.emitPollState(h.pollId, "exception", { exceptionCode: 2 });
      });
      expect(screen.getByTestId("data-empty")).toHaveTextContent(
        "No data: the device answered with exception 02 (Illegal data address).",
      );
    });

    it("columns: Alias, Address, Raw, Scaled in this order; Scaled follows the Show setting", async () => {
      const h = await renderPollView({
        host,
        connect: true,
        poll: { valueColumns: "both", scale: SCALE },
      });
      h.advance(200);
      const headers = screen.getAllByRole("columnheader").map((c) => c.textContent);
      expect(headers).toEqual(["Alias", "Address (0-based)", "Raw (Unsigned)", "Scaled"]);
      expect(screen.getByRole("columnheader", { name: "Scaled value" })).toBeInTheDocument();
    });

    it("Show Raw has no Scaled column", async () => {
      await renderPollView({ host, mode: "manual", connect: false });
      expect(screen.queryByRole("columnheader", { name: "Scaled value" })).not.toBeInTheDocument();
    });

    it("with showAlias off the Alias column is absent and the order is Address, Raw, Scaled", async () => {
      await renderPollView({
        host,
        mode: "manual",
        poll: {
          valueColumns: "both",
          scale: SCALE,
          display: {
            format: "unsigned",
            addressBase: 0,
            showAlias: false,
            copyAlias: false,
            swapBytes: false,
            reverseWords: false,
          },
        },
      });
      // no values yet in manual mode: force the grid with a poll update
      expect(screen.queryByRole("columnheader", { name: "Alias" })).not.toBeInTheDocument();
    });

    it("the Alias column is hidden when showAlias goes off, and the header order stays", async () => {
      const h = await renderPollView({
        host,
        connect: true,
        poll: { valueColumns: "both", scale: SCALE },
      });
      h.advance(200);
      await h.act(() => h.rt.actions.setShowAlias(false));
      expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
        "Address (0-based)",
        "Raw (Unsigned)",
        "Scaled",
      ]);
    });

    it("raw values follow the format and the address base", async () => {
      const h = await renderPollView({ host, connect: true });
      h.advance(200);
      await h.act(() => h.rt.actions.setFormat("hex"));
      expect(screen.getByRole("columnheader", { name: /Raw \(Hex\)/ })).toBeInTheDocument();
      expect(screen.getAllByText(/^0x[0-9A-F]{4}$/).length).toBeGreaterThan(0);
      await h.act(() => h.rt.actions.setAddressBase(1));
      expect(screen.getByRole("columnheader", { name: /Address \(1-based\)/ })).toBeInTheDocument();
    });

    it("FC01 shows 0 or 1 whatever the format", async () => {
      const h = await renderPollView({
        host,
        connect: true,
        poll: {
          definition: { slaveId: 1, function: 1, startAddress: 0, quantity: 8, scanRateMs: 100 },
          display: {
            format: "hex",
            addressBase: 0,
            showAlias: true,
            copyAlias: false,
            swapBytes: false,
            reverseWords: false,
          },
        },
      });
      h.advance(200);
      const grid = screen.getByRole("grid", { name: "Register values" });
      const raws = within(grid)
        .getAllByRole("gridcell")
        .filter((c) => c.getAttribute("data-cell") === "raw")
        .map((c) => c.textContent);
      expect(raws.every((t) => t === "0" || t === "1")).toBe(true);
    });
  });

  describe("scaled column seam (FE-003 supplies the provider)", () => {
    it("renders what the provider returns: number, unit, out-of-range marker", async () => {
      const h = await renderPollView({
        host,
        connect: true,
        poll: { valueColumns: "both", scale: SCALE },
        createScaled: () => (raw, address) => ({
          text: `${raw}.00`,
          unit: "mA",
          marker: address === 1 ? "outOfRange" : "none",
          tooltip: address === 1 ? "Raw 1 is outside the raw range 0-65535." : null,
          label: address === 1 ? `${raw}.00 mA, out of range` : `${raw}.00 mA`,
          override: address === 2 ? { tooltip: "Scale override 2-2: Divide by 10" } : null,
        }),
      });
      h.advance(200);
      const flagged = screen.getByLabelText(/out of range/);
      expect(flagged).toHaveAttribute("data-marker", "outOfRange");
      expect(flagged).toHaveAttribute("title", "Raw 1 is outside the raw range 0-65535.");
      expect(flagged.className).toContain("bg-warning-tint");
      expect(within(flagged).getByText("mA")).toBeInTheDocument();
      // A plain span cannot be named (REV-005 m-4): the marker is an image with a name.
      expect(
        screen.getByRole("img", { name: "Scale override 2-2: Divide by 10" }),
      ).toBeInTheDocument();
    });

    it("without a provider the Scaled cells show a dash", async () => {
      const h = await renderPollView({
        host,
        connect: true,
        poll: { valueColumns: "both", scale: SCALE },
        createScaled: noScaleFactory,
      });
      h.advance(200);
      const cells = screen
        .getAllByRole("gridcell")
        .filter((c) => c.getAttribute("data-cell") === "scaled");
      expect(cells.length).toBeGreaterThan(0);
      expect(cells.every((c) => c.textContent === "—")).toBe(true);
    });
  });

  describe("Show, format and base controls", () => {
    it("wide: segmented controls; Scaled and Both need a scale (title explains)", async () => {
      await renderPollView({ host, mode: "manual" });
      const show = screen.getByRole("radiogroup", { name: "Show" });
      expect(show).toHaveAttribute("aria-disabled", "true");
      expect(show).toHaveAttribute("title", "Set a scale to show scaled values.");
      expect(screen.getByRole("radiogroup", { name: "Raw format" })).toBeInTheDocument();
      expect(screen.getByRole("radiogroup", { name: "Address base" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Show / })).not.toBeInTheDocument();
    });

    it("with a scale the Show control is enabled and changes the columns", async () => {
      const h = await renderPollView({
        host,
        connect: true,
        poll: {
          scale: {
            preset: "divide",
            rawSigned: false,
            xMin: 0,
            xMax: 65535,
            yMin: 0,
            yMax: 1,
            divisor: 10,
            decimals: 1,
            unit: "",
            outOfRange: "flag",
          },
        },
      });
      h.advance(200);
      await h.user.click(screen.getByRole("radio", { name: "Both" }));
      expect(h.ipc.pollSummary(h.pollId).config.valueColumns).toBe("both");
      expect(screen.getByRole("columnheader", { name: "Scaled value" })).toBeInTheDocument();
    });

    it("FC01 disables the raw format with its tooltip", async () => {
      await renderPollView({
        host,
        mode: "manual",
        poll: {
          definition: { slaveId: 1, function: 1, startAddress: 0, quantity: 8, scanRateMs: 100 },
        },
      });
      const group = screen.getByRole("radiogroup", { name: "Raw format" });
      expect(group).toHaveAttribute("aria-disabled", "true");
      expect(group).toHaveAttribute("title", "Coils and discrete inputs are shown as 0 or 1.");
    });

    it("narrow: the Show menu replaces the segmented controls and has every option", async () => {
      const h = await renderPollView({ host, mode: "manual", width: 600 });
      expect(screen.queryByRole("radiogroup", { name: "Show" })).not.toBeInTheDocument();
      await h.user.click(screen.getByRole("button", { name: "Show Raw" }));
      const menu = screen.getByRole("menu", { name: "Show Raw" });
      expect(within(menu).getByRole("menuitemradio", { name: "Raw" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(within(menu).getByRole("menuitemradio", { name: "Scaled" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      for (const name of ["Unsigned", "Signed", "Hex", "Binary", "0-based", "1-based"]) {
        expect(
          within(menu).getByRole("menuitemradio", { name: new RegExp(name) }),
        ).toBeInTheDocument();
      }
      expect(within(menu).getByRole("menuitemcheckbox", { name: "Alias column" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(
        within(menu).getByRole("menuitemcheckbox", { name: "Include alias in copy" }),
      ).toHaveAttribute("aria-checked", "false");
    });

    it("narrow: choosing entries changes the poll's view settings, and the freshness chip moves to the line", async () => {
      const h = await renderPollView({ host, connect: true, width: 600 });
      h.advance(200);
      expect(within(statusLine()).getByText(/^Updated /)).toBeInTheDocument();
      await h.user.click(screen.getByRole("button", { name: "Show Raw" }));
      await h.user.click(screen.getByRole("menuitemradio", { name: /Hex/ }));
      expect(h.ipc.pollSummary(h.pollId).config.display.format).toBe("hex");
      await h.user.click(screen.getByRole("button", { name: "Show Raw" }));
      await h.user.click(screen.getByRole("menuitemcheckbox", { name: "Alias column" }));
      expect(h.ipc.pollSummary(h.pollId).config.display.showAlias).toBe(false);
      await h.user.click(screen.getByRole("button", { name: "Show Raw" }));
      await h.user.click(screen.getByRole("menuitemcheckbox", { name: "Include alias in copy" }));
      expect(h.ipc.pollSummary(h.pollId).config.display.copyAlias).toBe(true);
      await h.user.click(screen.getByRole("button", { name: "Show Raw" }));
      await h.user.click(screen.getByRole("menuitemradio", { name: /1-based/ }));
      expect(h.ipc.pollSummary(h.pollId).config.display.addressBase).toBe(1);
    });
  });

  describe("Poll actions menu", () => {
    it("Pause and Resume follow the state, and reset counters is always there", async () => {
      const h = await renderPollView({ host, connect: true });
      await h.user.click(screen.getByRole("button", { name: "Poll actions" }));
      await h.user.click(screen.getByRole("menuitem", { name: /^Pause/ }));
      expect(h.ipc.callsOf("setPollActive")).toEqual([[h.pollId, false]]);
      await h.user.click(screen.getByRole("button", { name: "Poll actions" }));
      await h.user.click(screen.getByRole("menuitem", { name: /^Resume/ }));
      expect(h.ipc.callsOf("setPollActive").at(-1)).toEqual([h.pollId, true]);
      await h.user.click(screen.getByRole("button", { name: "Poll actions" }));
      await h.user.click(screen.getByRole("menuitem", { name: "Reset counters for this poll" }));
      expect(h.ipc.callsOf("resetCounters")).toEqual([[h.pollId]]);
    });

    it("offers only the host actions the host provides, and the one that belongs to this host", async () => {
      const popOut = vi.fn();
      const dock = vi.fn();
      const close = vi.fn();
      const deletePoll = vi.fn();
      const write = vi.fn();
      const showTraffic = vi.fn();
      const h = await renderPollView({
        host,
        mode: "manual",
        hostActions: { popOut, dock, close, deletePoll, write, showTraffic },
      });
      await h.user.click(screen.getByRole("button", { name: "Poll actions" }));
      const menu = screen.getByRole("menu", { name: "Poll actions" });
      if (host === "workspace") {
        expect(
          within(menu).getByRole("menuitem", { name: /Pop out to own window/ }),
        ).toHaveTextContent("Ctrl+Shift+O");
        expect(
          within(menu).queryByRole("menuitem", { name: /Dock to workspace/ }),
        ).not.toBeInTheDocument();
        expect(within(menu).getByRole("menuitem", { name: /^Close/ })).toHaveTextContent("Ctrl+F4");
      } else {
        expect(within(menu).getByRole("menuitem", { name: /Dock to workspace/ })).toHaveTextContent(
          "Ctrl+Shift+D",
        );
        expect(within(menu).queryByRole("menuitem", { name: /Pop out/ })).not.toBeInTheDocument();
        expect(within(menu).getByRole("menuitem", { name: /^Close/ })).not.toHaveTextContent(
          "Ctrl+F4",
        );
      }
      await h.user.click(within(menu).getByRole("menuitem", { name: /Write…/ }));
      expect(write).toHaveBeenCalledWith(null);
      await h.user.click(screen.getByRole("button", { name: "Poll actions" }));
      await h.user.click(screen.getByRole("menuitem", { name: "Show traffic for this poll" }));
      expect(showTraffic).toHaveBeenCalledTimes(1);
      await h.user.click(screen.getByRole("button", { name: "Poll actions" }));
      await h.user.click(screen.getByRole("menuitem", { name: /^Close/ }));
      expect(close).toHaveBeenCalledTimes(1);
      await h.user.click(screen.getByRole("button", { name: "Poll actions" }));
      await h.user.click(screen.getByRole("menuitem", { name: "Delete…" }));
      expect(deletePoll).toHaveBeenCalledTimes(1);
      await h.user.click(screen.getByRole("button", { name: "Poll actions" }));
      await h.user.click(screen.getByRole("menuitem", { name: /Pop out|Dock/ }));
      expect(host === "workspace" ? popOut : dock).toHaveBeenCalledTimes(1);
    });

    it("without host actions only Pause or Resume and Reset counters are offered", async () => {
      const h = await renderPollView({ host, mode: "manual" });
      await h.user.click(screen.getByRole("button", { name: "Poll actions" }));
      const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
      expect(items.map((i) => i.textContent)).toEqual([
        expect.stringContaining("Resume"),
        "Reset counters for this poll",
      ]);
    });

    it("double-click on a row asks the host to write at that address", async () => {
      const write = vi.fn();
      const h = await renderPollView({ host, connect: true, hostActions: { write } });
      h.advance(200);
      const cell = screen
        .getAllByRole("gridcell")
        .find((c) => c.getAttribute("data-cell") === "raw");
      if (!cell) throw new Error("no raw cell");
      await h.user.dblClick(cell);
      expect(write).toHaveBeenCalledWith(0);
    });

    it("Write… in the row menu asks for the right-clicked row, also inside a larger selection", async () => {
      const write = vi.fn();
      const h = await renderPollView({ host, connect: true, hostActions: { write } });
      h.advance(200);
      const rawCell = (i: number) =>
        document.querySelector(`[data-row="${i}"] [data-cell="raw"]`) as HTMLElement;
      // rows 0-9 selected with the focus on row 0
      await h.user.click(rawCell(9));
      await h.user.keyboard("{Shift>}");
      await h.user.click(rawCell(0));
      await h.user.keyboard("{/Shift}");
      expect(h.rt.stores.ui.getState().focusAddress).toBe(0);
      expect(h.rt.stores.ui.getState().selection).toEqual([{ start: 0, end: 9 }]);
      await h.user.pointer({ keys: "[MouseRight]", target: rawCell(7) });
      // the selection and the focus are kept
      expect(h.rt.stores.ui.getState().selection).toEqual([{ start: 0, end: 9 }]);
      expect(h.rt.stores.ui.getState().focusAddress).toBe(0);
      await h.user.click(
        within(screen.getByRole("menu")).getByRole("menuitem", { name: /Write…/ }),
      );
      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith(7);
    });

    it("Write… in the row menu opened with the keyboard uses the focused row", async () => {
      const write = vi.fn();
      const h = await renderPollView({ host, connect: true, hostActions: { write } });
      h.advance(200);
      const rawCell = (i: number) =>
        document.querySelector(`[data-row="${i}"] [data-cell="raw"]`) as HTMLElement;
      await h.user.click(rawCell(3));
      await h.user.keyboard("{ContextMenu}");
      await h.user.click(
        within(screen.getByRole("menu")).getByRole("menuitem", { name: /Write…/ }),
      );
      expect(write).toHaveBeenCalledWith(3);
    });
  });
});

describe("setup presentation: sub-window (DES-002 2.3.3)", () => {
  it("closed: nothing; 900 px: a dock; 600 px: a popover with Done", async () => {
    const h = await renderPollView({ host: "workspace", mode: "manual" });
    expect(screen.queryByRole("complementary", { name: "Poll setup" })).not.toBeInTheDocument();
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    expect(screen.getByRole("complementary", { name: "Poll setup" })).toHaveAttribute(
      "data-presentation",
      "dock",
    );
    h.setWidth(600);
    expect(screen.queryByRole("complementary", { name: "Poll setup" })).not.toBeInTheDocument();
    const popover = screen.getByRole("dialog", { name: "Poll setup" });
    expect(popover).toHaveAttribute("aria-modal", "false");
    expect(within(popover).getByRole("button", { name: "Done" })).toBeInTheDocument();
    h.setWidth(639);
    expect(screen.getByRole("dialog", { name: "Poll setup" })).toBeInTheDocument();
    h.setWidth(640);
    expect(screen.getByRole("complementary", { name: "Poll setup" })).toBeInTheDocument();
  });

  it("the popover closes on Done and on Esc, but not on an outside click", async () => {
    const h = await renderPollView({ host: "workspace", mode: "manual", width: 600 });
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    await h.user.click(screen.getByRole("region", { name: "Data" }));
    await h.user.click(document.body);
    expect(screen.getByRole("dialog", { name: "Poll setup" })).toBeInTheDocument();
    await h.user.click(screen.getByLabelText("Name"));
    await h.user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Poll setup" })).not.toBeInTheDocument();
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    await h.user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Poll setup" })).not.toBeInTheDocument();
  });

  it("closing and reopening the popover keeps an invalid Quantity draft and its message", async () => {
    const h = await renderPollView({ host: "workspace", mode: "manual", width: 600 });
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "200");
    await h.user.tab();
    expect(screen.getByText("Quantity for FC03 must be from 1 to 125.")).toBeInTheDocument();
    expect(quantity).toHaveAttribute("aria-invalid", "true");
    await h.user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Quantity")).not.toBeInTheDocument();
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    expect(screen.getByLabelText("Quantity")).toHaveValue("200");
    expect(screen.getByText("Quantity for FC03 must be from 1 to 125.")).toBeInTheDocument();
    // switching to the dock (wider) keeps it too
    h.setWidth(900);
    expect(screen.getByLabelText("Quantity")).toHaveValue("200");
    expect(screen.getByText("Quantity for FC03 must be from 1 to 125.")).toBeInTheDocument();
  });

  it("one click on [Apply] works when the blur of Quantity shows a message and moves the button (D4)", async () => {
    const h = await renderPollView({ host: "workspace", mode: "manual", width: 900 });
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "200");
    const message = "Quantity for FC03 must be from 1 to 125.";
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    const apply = screen.getByRole("button", { name: "Apply" });
    await clickWithLayoutShift(
      h.user,
      apply,
      () => screen.queryByText(message) !== null,
      () => screen.getByText(message),
    );
    // The apply ran (it moves the focus to the first invalid field) and the message is there.
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(quantity).toHaveFocus();
  });

  it("a new poll focuses Name with its text selected", async () => {
    await renderPollView({
      host: "workspace",
      mode: "manual",
      focusName: true,
      prepare: ({ ipc: _ipc }) => {},
    });
    // the setup is closed until the host opens it; opening it focuses the field
    const h = await renderPollView({ host: "workspace", mode: "manual", focusName: true });
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    const name = screen.getAllByLabelText("Name").at(-1) as HTMLInputElement;
    expect(name).toHaveFocus();
    expect(name.selectionStart).toBe(0);
    expect(name.selectionEnd).toBe(name.value.length);
  });
});

describe("setup presentation: native window (DES-002 2.3.3, 2.6)", () => {
  it("open: the 340 px panel; below 640 px the open setup is the popover next to the rail", async () => {
    const h = await renderPollView({ host: "native", mode: "manual" });
    const panel = screen.getByRole("complementary", { name: "Poll setup" });
    expect(panel).toHaveAttribute("data-presentation", "panel");
    expect(panel).toHaveStyle({ width: "340px" });
    h.setWidth(600);
    expect(screen.queryByRole("complementary", { name: "Poll setup" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Poll setup" })).toHaveAttribute(
      "data-slot",
      "setup-popover",
    );
    const rail = screen.getByRole("button", { name: "Show setup (Ctrl+\\)" });
    expect(rail).toHaveStyle({ width: "30px" });
    expect(rail).toHaveTextContent("Setup");
  });

  it("the rail opens the panel again when the window is wide enough; the panel collapses to the rail", async () => {
    const h = await renderPollView({ host: "native", mode: "manual" });
    await h.user.click(screen.getByRole("button", { name: "Hide setup (Ctrl+\\)" }));
    expect(screen.getByRole("button", { name: "Show setup (Ctrl+\\)" })).toBeInTheDocument();
    await h.user.click(screen.getByRole("button", { name: "Show setup (Ctrl+\\)" }));
    expect(screen.getByRole("complementary", { name: "Poll setup" })).toBeInTheDocument();
  });

  describe.each([466, 626, 639])(
    "a native window of %i px: the rail opens the setup as a popover (O1, CHK2-F14)",
    (width) => {
      const rail = () => screen.getByRole("button", { name: "Show setup (Ctrl+\\)" });
      const view = () => screen.getByRole("group", { name: "Poll view" });
      const popover = () => screen.queryByRole("dialog", { name: "Poll setup" });
      /** The pop out of a poll with its setup closed: the rail only. */
      async function closed() {
        const h = await renderPollView({ host: "native", mode: "manual", width });
        await h.act(() => h.rt.stores.ui.getState().setSetupOpen(false));
        return h;
      }

      it("is the rail while closed; a click opens the popover; Esc closes it and the focus returns to the rail", async () => {
        const h = await closed();
        expect(view()).toHaveAttribute("data-presentation", "rail");
        expect(rail()).toHaveAttribute("aria-expanded", "false");
        expect(popover()).not.toBeInTheDocument();
        await h.user.click(rail());
        expect(view()).toHaveAttribute("data-presentation", "popover");
        const dialog = screen.getByRole("dialog", { name: "Poll setup" });
        expect(dialog).toHaveAttribute("data-slot", "setup-popover");
        expect(dialog).toHaveAttribute("aria-modal", "false");
        expect(dialog).toHaveStyle({ width: "360px", left: "30px" });
        // The rail stays, now expanded and pointing at the popover.
        expect(rail()).toHaveAttribute("aria-expanded", "true");
        expect(rail()).toHaveAttribute("aria-controls", dialog.id);
        // Focus is in Name (no invalid field), so Esc works at once.
        expect(within(dialog).getByLabelText("Name")).toHaveFocus();
        await h.user.keyboard("{Escape}");
        expect(popover()).not.toBeInTheDocument();
        expect(view()).toHaveAttribute("data-presentation", "rail");
        expect(rail()).toHaveAttribute("aria-expanded", "false");
        expect(rail()).toHaveFocus();
      });

      it("[Done], a second rail click and Ctrl+\\ (the setup toggle) close it too", async () => {
        const h = await closed();
        await h.user.click(rail());
        await h.user.click(screen.getByRole("button", { name: "Done" }));
        expect(popover()).not.toBeInTheDocument();
        await h.user.click(rail());
        await h.user.click(rail());
        expect(popover()).not.toBeInTheDocument();
        await h.act(() => h.rt.stores.ui.getState().toggleSetup());
        expect(popover()).toBeInTheDocument();
        await h.act(() => h.rt.stores.ui.getState().toggleSetup());
        expect(popover()).not.toBeInTheDocument();
        expect(view()).toHaveAttribute("data-presentation", "rail");
      });

      it("an invalid Quantity draft gets the focus and its message; a click on the data card does not close it", async () => {
        const h = await closed();
        await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
        const quantity = screen.getByLabelText("Quantity");
        await h.user.clear(quantity);
        await h.user.type(quantity, "200");
        await h.user.tab();
        await h.user.click(screen.getByRole("button", { name: "Done" }));
        expect(screen.getByTestId("rail-unapplied")).toBeInTheDocument();
        await h.user.click(rail());
        expect(screen.getByLabelText("Quantity")).toHaveFocus();
        expect(screen.getByLabelText("Quantity")).toHaveAttribute("aria-invalid", "true");
        expect(screen.getByText("Quantity for FC03 must be from 1 to 125.")).toBeInTheDocument();
        await h.user.click(screen.getByRole("region", { name: "Data" }));
        expect(popover()).toBeInTheDocument();
      });
    },
  );

  it("the poll view keeps data-ready once the attach snapshot is applied (CHK2-F14 hook)", async () => {
    await renderPollView({ host: "native", mode: "manual", width: 626 });
    expect(screen.getByRole("group", { name: "Poll view" })).toHaveAttribute("data-ready", "true");
  });

  it("an open setup arrives as the popover at 626 px (the handoff says open)", async () => {
    const h = await renderPollView({ host: "native", mode: "manual", width: 626 });
    expect(screen.getByRole("group", { name: "Poll view" })).toHaveAttribute(
      "data-presentation",
      "popover",
    );
    expect(h.rt.stores.ui.getState().setupOpen).toBe(true);
  });

  it.each([640, 900])(
    "a native window of %i px: the panel; the rail click opens the panel, not a popover",
    async (width) => {
      const h = await renderPollView({ host: "native", mode: "manual", width });
      const view = () => screen.getByRole("group", { name: "Poll view" });
      expect(view()).toHaveAttribute("data-presentation", "panel");
      await h.user.click(screen.getByRole("button", { name: "Hide setup (Ctrl+\\)" }));
      expect(view()).toHaveAttribute("data-presentation", "rail");
      await h.user.click(screen.getByRole("button", { name: "Show setup (Ctrl+\\)" }));
      expect(view()).toHaveAttribute("data-presentation", "panel");
      expect(screen.queryByRole("dialog", { name: "Poll setup" })).not.toBeInTheDocument();
    },
  );

  it("a live width change keeps the draft: popover at 639, panel at 640, popover at 639 again", async () => {
    const h = await renderPollView({ host: "native", mode: "manual", width: 639 });
    const view = () => screen.getByRole("group", { name: "Poll view" });
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "200");
    await h.user.tab();
    const message = "Quantity for FC03 must be from 1 to 125.";
    expect(screen.getByText(message)).toBeInTheDocument();
    h.setWidth(640);
    expect(view()).toHaveAttribute("data-presentation", "panel");
    expect(screen.getByLabelText("Quantity")).toHaveValue("200");
    expect(screen.getByText(message)).toBeInTheDocument();
    h.setWidth(639);
    expect(view()).toHaveAttribute("data-presentation", "popover");
    expect(screen.getByLabelText("Quantity")).toHaveValue("200");
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("compact mode: the rail at 639 and 900; a rail click opens the popover below 640 and the panel from 640", async () => {
    const h = await renderPollView({ host: "native", mode: "manual", width: 639 });
    const view = () => screen.getByRole("group", { name: "Poll view" });
    await h.act(() => h.ipc.setCompactMode(true));
    expect(view()).toHaveAttribute("data-presentation", "rail");
    await h.user.click(screen.getByRole("button", { name: "Show setup (Ctrl+\\)" }));
    expect(view()).toHaveAttribute("data-presentation", "popover");
    h.setWidth(640);
    expect(view()).toHaveAttribute("data-presentation", "panel");
  });

  it("compact mode puts the panel on the rail; leaving it brings the panel back", async () => {
    const h = await renderPollView({ host: "native", mode: "manual" });
    await h.act(() => h.ipc.setCompactMode(true));
    expect(screen.getByRole("button", { name: "Show setup (Ctrl+\\)" })).toBeInTheDocument();
    // a single window can still open its own setup (a local override)
    await h.user.click(screen.getByRole("button", { name: "Show setup (Ctrl+\\)" }));
    expect(screen.getByRole("complementary", { name: "Poll setup" })).toBeInTheDocument();
    await h.act(() => h.ipc.setCompactMode(false));
    expect(screen.getByRole("complementary", { name: "Poll setup" })).toBeInTheDocument();
  });
});

describe("setup form (the POLL section)", () => {
  it("shows the applied poll, with the protocol address helper and the quantity range", async () => {
    await renderPollView({ host: "native", mode: "manual" });
    expect(screen.getByLabelText("Name")).toHaveValue("Tank 1");
    expect(screen.getByLabelText("Slave ID")).toHaveValue("1");
    expect(screen.getByLabelText("Function")).toHaveValue("3");
    expect(screen.getByLabelText("Start address")).toHaveValue("0");
    expect(screen.getByLabelText("Quantity")).toHaveValue("10");
    expect(screen.getByLabelText("Scan rate (ms)")).toHaveValue("100");
    expect(screen.getByText("Protocol address 0")).toBeInTheDocument();
    expect(screen.getByText("1-125")).toBeInTheDocument();
    expect(screen.queryByText("Unapplied changes")).not.toBeInTheDocument();
  });

  it("typing marks unapplied changes and reports them; typing the old value back clears them", async () => {
    const h = await renderPollView({ host: "native", mode: "manual" });
    await h.user.type(screen.getByLabelText("Quantity"), "5");
    expect(screen.getByText("Unapplied changes")).toBeInTheDocument();
    expect(h.ipc.pollSummary(h.pollId).hasUnappliedEdits).toBe(true);
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "10");
    expect(screen.queryByText("Unapplied changes")).not.toBeInTheDocument();
    expect(h.ipc.pollSummary(h.pollId).hasUnappliedEdits).toBe(false);
  });

  it("Apply with invalid fields sends nothing, shows every message and focuses the first invalid field", async () => {
    const h = await renderPollView({ host: "native", mode: "manual" });
    const slave = screen.getByLabelText("Slave ID");
    await h.user.clear(slave);
    await h.user.type(slave, "999");
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "126");
    await h.user.click(screen.getByRole("button", { name: "Apply" }));
    expect(h.ipc.callsOf("updatePoll")).toHaveLength(0);
    expect(screen.getByText("Slave ID must be a whole number from 0 to 247.")).toBeInTheDocument();
    expect(screen.getByText("Quantity for FC03 must be from 1 to 125.")).toBeInTheDocument();
    expect(slave).toHaveFocus();
  });

  it("Apply sends the new definition and the draft ends", async () => {
    const h = await renderPollView({ host: "native", mode: "manual" });
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "20");
    await h.user.click(screen.getByRole("button", { name: "Apply" }));
    expect(h.ipc.callsOf("updatePoll")).toEqual([
      [h.pollId, { slaveId: 1, function: 3, startAddress: 0, quantity: 20, scanRateMs: 100 }],
    ]);
    expect(screen.queryByText("Unapplied changes")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Quantity")).toHaveValue("20");
  });

  it("Enter in a field applies", async () => {
    const h = await renderPollView({ host: "native", mode: "manual" });
    await h.user.type(screen.getByLabelText("Quantity"), "1{Enter}");
    expect(h.ipc.callsOf("updatePoll")).toHaveLength(1);
  });

  it("a rename from elsewhere keeps the draft and updates the untouched fields", async () => {
    const h = await renderPollView({ host: "native", mode: "manual" });
    await h.user.type(screen.getByLabelText("Quantity"), "5");
    await h.act(() => h.ipc.renamePoll(h.pollId, "Tank 2"));
    expect(screen.getByLabelText("Name")).toHaveValue("Tank 2");
    expect(screen.getByLabelText("Quantity")).toHaveValue("105");
  });

  it("renders the scale section slot below the POLL section", async () => {
    await renderPollView({
      host: "native",
      mode: "manual",
      scaleSection: <section aria-label="Scale slot">SCALE</section>,
    });
    const poll = screen.getByRole("heading", { name: "Poll" });
    const slot = screen.getByLabelText("Scale slot");
    expect(poll.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("setup presentation threshold is the FRAME width (REPORT-004 CHK2-E12)", () => {
  const dock = () => screen.queryByRole("complementary", { name: "Poll setup" });
  const popover = () => screen.queryByRole("dialog", { name: "Poll setup" });

  // The body is narrower than the frame by its border. Chromium computes the 1.5 px inactive border as
  // 1 px, so an inactive 639 px frame has a 637 px body (the old "body + 3" read 640 and flipped).
  const BORDERS = [
    ["active", 4],
    ["inactive", 2],
  ] as const;
  const VECTORS = [
    [900, "dock"],
    [641, "dock"],
    [640, "dock"],
    [639, "popover"],
    [600, "popover"],
  ] as const;

  describe.each(BORDERS)("%s frame (body = frame - %i)", (_name, border) => {
    it.each(VECTORS)("frame %i -> %s", async (frameWidth, expected) => {
      const h = await renderPollView({ host: "workspace", mode: "manual", inFrame: true });
      await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
      h.setFrameWidth(frameWidth);
      h.setWidth(frameWidth - border);
      expect(dock() !== null).toBe(expected === "dock");
      expect(popover() !== null).toBe(expected === "popover");
    });
  });

  it("the presentation follows the frame, not the body: same frame, any body width", async () => {
    const h = await renderPollView({ host: "workspace", mode: "manual", inFrame: true });
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    h.setFrameWidth(639);
    for (const body of [635, 637, 639, 640, 700]) {
      h.setWidth(body);
      expect(popover()).toBeInTheDocument();
      expect(dock()).not.toBeInTheDocument();
    }
    h.setFrameWidth(640);
    for (const body of [630, 636, 637, 640]) {
      h.setWidth(body);
      expect(dock()).toBeInTheDocument();
    }
  });

  it("the frame turning inactive (body 635 -> 637 at a 639 frame) never flips the presentation", async () => {
    const h = await renderPollView({ host: "workspace", mode: "manual", inFrame: true });
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    h.setFrameWidth(639);
    h.setWidth(635);
    expect(popover()).toBeInTheDocument();
    h.setWidth(637);
    expect(popover()).toBeInTheDocument();
    expect(dock()).not.toBeInTheDocument();
    h.setFrameWidth(640);
    h.setWidth(638);
    expect(dock()).toBeInTheDocument();
    h.setWidth(636);
    expect(dock()).toBeInTheDocument();
  });

  it("a draft survives a resize from a 640 px frame (dock) to 639 px (popover) and back", async () => {
    const h = await renderPollView({ host: "workspace", mode: "manual", inFrame: true });
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    h.setFrameWidth(640);
    h.setWidth(636);
    expect(dock()).toBeInTheDocument();
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "25");
    h.setFrameWidth(639);
    h.setWidth(635);
    expect(popover()).toBeInTheDocument();
    expect(screen.getByLabelText("Quantity")).toHaveValue("25");
    h.setFrameWidth(640);
    h.setWidth(636);
    expect(dock()).toBeInTheDocument();
    expect(screen.getByLabelText("Quantity")).toHaveValue("25");
  });

  it("before the frame is measured the view width decides (no frame, no constant)", async () => {
    const h = await renderPollView({ host: "workspace", mode: "manual", inFrame: true });
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    h.setWidth(640);
    expect(dock()).toBeInTheDocument();
    h.setWidth(639);
    expect(popover()).toBeInTheDocument();
  });

  it("a native window has no frame: its 640 px width is the panel threshold", async () => {
    const h = await renderPollView({ host: "native", mode: "manual" });
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    h.setWidth(640);
    expect(screen.getByRole("complementary", { name: "Poll setup" })).toHaveAttribute(
      "data-presentation",
      "panel",
    );
    h.setWidth(639);
    expect(screen.queryByRole("complementary", { name: "Poll setup" })).not.toBeInTheDocument();
  });
});

describe("the status line steps (DES-002 2.3.2 revision 9, CHK2-E16 to E26)", () => {
  const line = () => screen.getByTestId("poll-status-line");
  const chip = () => line().querySelector<HTMLElement>('[data-slot="freshness-chip"]');
  const show = () => within(line()).getByRole("button", { name: /^Show / });
  const actions = () => within(line()).getByRole("button", { name: "Poll actions" });
  const visibleCounters = () => counters().textContent;
  // The controls sit in a group that does not shrink; what gives way is clipped on its own side.
  const controlGroup = () => actions().parentElement as HTMLElement;

  /** Everything a user can reach on the line, at any width. */
  const controlsAreThere = () => {
    expect(show()).toBeInTheDocument();
    expect(actions()).toBeInTheDocument();
    expect(chip()).not.toBeNull();
    expect(controlGroup()).toHaveClass("shrink-0", "ml-auto");
    expect(controlGroup()).toContainElement(show());
    expect(controlGroup()).toContainElement(chip());
  };

  // The width L is the poll view width: a 640 px active frame has L = 636.
  async function live(width: number) {
    const h = await renderPollView({ host: "workspace", connect: true });
    h.setWidth(width);
    h.advance(300);
    return h;
  }

  it.each([
    [719, 1],
    [700, 1],
    [636, 1],
    [620, 1],
    [619, 2],
    [606, 2],
    [605, 3],
    [556, 3],
    [500, 3],
    [499, 4],
    [465, 4],
    [464, 5],
    [426, 5],
  ] as const)("live data at L = %i is at step %i", async (width, step) => {
    await live(width);
    expect(line()).toHaveAttribute("data-step", String(step));
    expect(chip()).not.toBeNull();
    // Step 1: the freshness chip inside the line, icon only (text kept for assistive technology and the tooltip).
    expect(chip()).toHaveAttribute("data-icon-only", "true");
    expect(chip()).toHaveAttribute("title", expect.stringMatching(/^Updated \d\d:\d\d:\d\d/));
    expect(within(chip() as HTMLElement).getByText(/^Updated /)).toHaveClass("sr-only");
    // Steps 3 and 5: the visible counters.
    const expected =
      step >= 5
        ? /^Tx \d+ · SR 100 ms$/
        : step >= 3
          ? /^Tx \d+ · Err 0 · SR 100 ms$/
          : /^Tx \d+ · Err 0 · ID 1 · F 03 · SR 100 ms$/;
    expect(visibleCounters()).toMatch(expected);
    // The tooltip always has the complete text; from step 3 so does the accessible name.
    expect(counters()).toHaveAttribute(
      "title",
      expect.stringMatching(/^Tx \d+ · Err 0 · ID 1 · F 03 · SR 100 ms$/),
    );
    if (step >= 3) {
      expect(counters()).toHaveAccessibleName(
        expect.stringMatching(/^Tx \d+ · Err 0 · ID 1 · F 03 · SR 100 ms$/),
      );
    } else {
      expect(counters()).not.toHaveAttribute("aria-label");
    }
    // Step 4: the Show control is an icon, with the same accessible name.
    if (step >= 4) {
      expect(show()).toHaveAttribute("title", "Show Raw");
      expect(show().querySelector('[data-icon="columns-3"]')).not.toBeNull();
      expect(show()).not.toHaveTextContent("Show");
    } else {
      expect(show().querySelector('[data-icon="columns-3"]')).toBeNull();
      expect(show()).toHaveTextContent("Show Raw");
    }
    controlsAreThere();
  });

  // REPORT-005 F1: at a 125% scale the view is fractional (frame 723 -> L 719.8). The width is
  // measured exactly; rounding made 464.8 -> 465 and flipped the step 0.2 px late.
  it.each([
    [719.8, 1],
    [720.0, 0],
    [720.2, 0],
    [619.8, 2],
    [620.0, 1],
    [605.8, 3],
    [606.0, 2],
    [499.8, 4],
    [500.0, 3],
    [464.8, 5],
    [465.0, 4],
    [465.2, 4],
  ] as const)("live data at a fractional L = %f is at step %i", async (width, step) => {
    await live(width);
    expect(line()).toHaveAttribute("data-step", String(step));
  });

  it.each([
    [809.8, 1],
    [810.0, 0],
  ] as const)("a long freshness text at a fractional L = %f is at step %i", async (width, step) => {
    const h = await live(900);
    act(() => {
      h.ipc.scriptFault(h.pollId, { kind: "timeout" });
    });
    h.advance(1500);
    h.setWidth(width);
    expect(line()).toHaveAttribute("data-step", String(step));
  });

  it("the data-step follows the exact width as it moves across 465 in sub-pixel moves", async () => {
    const h = await live(466);
    expect(line()).toHaveAttribute("data-step", "4");
    h.setWidth(465.2);
    expect(line()).toHaveAttribute("data-step", "4");
    h.setWidth(465.0);
    expect(line()).toHaveAttribute("data-step", "4");
    h.setWidth(464.8);
    expect(line()).toHaveAttribute("data-step", "5");
    h.setWidth(465.0);
    expect(line()).toHaveAttribute("data-step", "4");
  });

  it("re-renders only when the step (or another derived value) changes, not per sub-pixel", async () => {
    const { renderProbe } = await import("@/shared/lib/render-probe");
    const h = await live(800);
    const key = `poll-view:${h.pollId}`;
    // A resize drag inside one band (here 721..760, step 0): dozens of fractional widths.
    h.setWidth(760);
    const before = renderProbe.get(key);
    for (let i = 0; i < 40; i++) h.setWidth(760 - i * 0.37);
    expect(line()).toHaveAttribute("data-step", "0");
    expect(renderProbe.get(key)).toBe(before);
    // The same inside the step 3 band (500..605.9).
    h.setWidth(600);
    const inBand = renderProbe.get(key);
    for (let i = 0; i < 40; i++) h.setWidth(600 - i * 0.2);
    expect(line()).toHaveAttribute("data-step", "3");
    expect(renderProbe.get(key)).toBe(inBand);
    // Crossing a boundary renders once.
    h.setWidth(499.8);
    expect(line()).toHaveAttribute("data-step", "4");
    expect(renderProbe.get(key)).toBeGreaterThan(inBand);
  });

  it("the native fallback limit (no frame) compares the exact width: 639.6 is narrower than 640", async () => {
    const h = await renderPollView({ host: "native", mode: "manual" });
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    h.setWidth(640.2);
    expect(screen.getByRole("complementary", { name: "Poll setup" })).toHaveAttribute(
      "data-presentation",
      "panel",
    );
    h.setWidth(639.6);
    expect(screen.queryByRole("complementary", { name: "Poll setup" })).not.toBeInTheDocument();
  });

  it("the header freshness chip (L >= 720) keeps its full text; the step never touches it", async () => {
    const h = await live(720);
    act(() => {
      h.ipc.scriptFault(h.pollId, { kind: "timeout" });
    });
    h.advance(1500);
    expect(h.rt.stores.poll.getState().state).toBe("timeout");
    for (const width of [720, 760, 809, 810, 900]) {
      h.setWidth(width);
      // In the data card header, not on the line, with its text.
      expect(line().querySelector('[data-slot="freshness-chip"]')).toBeNull();
      const header = screen.getByText(/^No response - values from /);
      expect(header).toBeVisible();
      expect(header.closest("[data-slot='freshness-chip']")).not.toHaveAttribute("data-icon-only");
      expect(line()).toHaveAttribute("data-step", width < 810 ? "1" : "0");
    }
    h.setWidth(719);
    expect(chip()).toHaveAttribute("data-icon-only", "true");
    expect(chip()).toHaveAttribute("data-kind", "stale");
  });

  it("a live chip is step 0 at L 720 and 760; a long text is step 1 up to 809", async () => {
    const h = await live(760);
    expect(line()).toHaveAttribute("data-step", "0");
    act(() => {
      h.ipc.scriptFault(h.pollId, { kind: "timeout" });
    });
    h.advance(1500);
    expect(line()).toHaveAttribute("data-step", "1");
    h.setWidth(810);
    expect(line()).toHaveAttribute("data-step", "0");
  });

  it("the reason takes all the space that is left: the only growing item, no spacer", async () => {
    const h = await live(900);
    act(() => {
      h.ipc.scriptFault(h.pollId, { kind: "timeout" });
    });
    h.advance(1500);
    const reason = screen.getByTestId("status-reason");
    expect(reason).toHaveAttribute("data-slot", "reason");
    expect(counters()).toHaveAttribute("data-slot", "counters");
    expect(reason).toHaveClass("flex-1", "min-w-0", "truncate");
    // The strip holds the chip, the counters, the reason and the right group: nothing empty.
    const children = Array.from(line().children);
    expect(children.filter((el) => el.textContent === "" && el.children.length === 0)).toHaveLength(
      0,
    );
    expect(children.filter((el) => el.classList.contains("flex-1"))).toEqual([reason]);
    expect(controlGroup()).toHaveClass("ml-auto");
  });

  it("the counters carry their full text as the tooltip (the last resort cuts the end with an ellipsis)", async () => {
    await live(426);
    expect(counters()).toHaveAttribute(
      "title",
      expect.stringMatching(/^Tx \d+ · Err 0 · ID 1 · F 03 · SR 100 ms$/),
    );
    expect(counters()).toHaveClass("truncate", "min-w-0");
  });

  it("the wide layout (L >= 720) has no freshness chip or Show control on the line", async () => {
    await live(720);
    expect(line().querySelector('[data-slot="freshness-chip"]')).toBeNull();
    expect(within(line()).queryByRole("button", { name: /^Show / })).toBeNull();
    expect(line()).toHaveAttribute("data-step", "0");
  });

  it("a reason: shown from L = 620, hidden below, the line keeps its tone and its description", async () => {
    const h = await live(900);
    act(() => {
      h.ipc.scriptFault(h.pollId, { kind: "timeout" });
    });
    h.advance(1500);
    const reason = () => screen.getByTestId("status-reason");
    h.setWidth(620);
    expect(reason()).toBeVisible();
    expect(reason()).toHaveTextContent("No response within 1000 ms");
    h.setWidth(619);
    expect(reason()).not.toBeVisible();
    // The tint stays; the description still points at the hidden element; the state chip has the text.
    expect(line()).toHaveAttribute("data-tone", "warning");
    expect(line()).toHaveAttribute("aria-describedby", reason().id);
    expect(within(line()).getByText("Timeout").closest("[title]")).toHaveAttribute(
      "title",
      expect.stringContaining("did not respond within 1000 ms"),
    );
    controlsAreThere();
  });

  it("offline: no freshness chip, step 1 changes nothing there, the other controls are there", async () => {
    await renderPollView({ host: "workspace", mode: "manual", width: 636 });
    expect(chip()).toBeNull();
    expect(show()).toBeInTheDocument();
    expect(actions()).toBeInTheDocument();
  });
});

describe("QA hooks of the poll view (REPORT-003 section 5, items 1 and 6)", () => {
  const slotsInDocument = () =>
    Array.from(document.querySelectorAll("[data-slot^='setup-']")).map((el) =>
      el.getAttribute("data-slot"),
    );

  it("each setup surface has its own data-slot, once, never on the group", async () => {
    const h = await renderPollView({ host: "workspace", mode: "manual" });
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    h.setWidth(900);
    expect(slotsInDocument()).toEqual(["setup-dock"]);
    expect(screen.getByRole("complementary", { name: "Poll setup" })).toHaveAttribute(
      "data-slot",
      "setup-dock",
    );
    h.setWidth(500);
    expect(slotsInDocument()).toEqual(["setup-popover"]);
    expect(screen.getByRole("dialog", { name: "Poll setup" })).toHaveAttribute(
      "data-slot",
      "setup-popover",
    );
    // The group keeps its own slot and its data-presentation.
    const group = screen.getByRole("group", { name: "Poll view" });
    expect(group).toHaveAttribute("data-slot", "poll-view");
    expect(group).toHaveAttribute("data-presentation", "popover");
  });

  it("native: the panel and the rail", async () => {
    const h = await renderPollView({ host: "native", mode: "manual" });
    h.setWidth(900);
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    expect(slotsInDocument()).toEqual(["setup-panel"]);
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(false));
    expect(slotsInDocument()).toEqual(["setup-rail"]);
  });

  it("the dev render probe counts the commits of each poll view", async () => {
    const { renderProbe } = await import("@/shared/lib/render-probe");
    renderProbe.reset();
    const h = await renderPollView({ host: "workspace", connect: true });
    const key = `poll-view:${h.pollId}`;
    expect(renderProbe.enabled).toBe(true);
    const mounted = renderProbe.get(key);
    expect(mounted).toBeGreaterThan(0);
    expect(window.__ESEFACT_RENDERS__?.get(key)).toBe(mounted);
    // A PollUpdate re-renders the rows and the chip, not the view around them.
    h.advance(1000);
    const live = renderProbe.get(key);
    h.advance(1000);
    expect(renderProbe.get(key)).toBe(live);
    // A change the view does render (the width) is counted.
    h.setWidth(500);
    expect(renderProbe.get(key)).toBeGreaterThan(live);
  });
});
