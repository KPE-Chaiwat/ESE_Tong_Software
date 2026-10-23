// Per-row formats in the poll view runtime (FE-009 tasks 03, 10, 12, 14): the rows, the quick
// 16-bit actions, the Format dialog wiring, copy and aliases on rows with 32/64-bit groups.
import { IpcError } from "@/shared/ipc/errors";
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
  pollConfigInput,
} from "@/shared/ipc/modbus-master.fake";
import type {
  ConnectionConfig,
  FormatOverride,
  PollHostKind,
  PollId,
} from "@/shared/ipc/modbus-master.types";
import { createToastStore, type ToastStoreApi } from "@/shared/lib/toast.store";
import { createConnectionStore } from "../store/connection.store";
import { createPollViewRuntime, type PollViewRuntime } from "./poll-view-runtime";

const tcp: ConnectionConfig = { mode: "tcp", host: "192.168.1.10", port: 502, timeoutMs: 1000 };
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);

let ipc: FakeModbusMasterIpc;
let toasts: ToastStoreApi;
let copied: string[];
let announced: string[];
const runtimes: PollViewRuntime[] = [];

const ov = (
  start: number,
  end: number,
  format: FormatOverride["format"],
  flags: Partial<FormatOverride> = {},
): FormatOverride => ({ start, end, format, swapBytes: false, reverseWords: false, ...flags });
const toastTexts = () => toasts.getState().items.map((t) => t.text);

async function open(
  patch: Parameters<typeof pollConfigInput>[0] = {},
  options: { host?: PollHostKind; clipboard?: boolean } = {},
) {
  ipc = createFakeModbusMasterIpc({ mode: "manual" });
  toasts = createToastStore({ setTimer: () => 0, clearTimer: () => {} });
  copied = [];
  announced = [];
  const connection = createConnectionStore({ ipc, warn: () => {} });
  const snapshot = await ipc.openSession((e) => {
    if (e.type === "ConnectionStateChanged") connection.getState().applyConnectionStateChanged(e);
  });
  connection.getState().applySnapshot({ connection: snapshot.connection });
  const id = await ipc.addPoll(
    pollConfigInput({ name: "A", ...patch }),
    options.host ?? "workspace",
  );
  const rt = createPollViewRuntime({
    ipc,
    pollId: id,
    host: options.host ?? "workspace",
    connection,
    toasts,
    getOtherNames: () => [],
    announce: (text) => announced.push(text),
    clipboard: {
      writeText: async (t) => {
        copied.push(t);
      },
      readText: async () => ["One", "Two", "Three"].join(LF),
    },
    warn: () => {},
  });
  runtimes.push(rt);
  await rt.init();
  return { rt, id };
}

afterEach(() => {
  for (const rt of runtimes.splice(0)) rt.dispose();
});

const ui = (rt: PollViewRuntime) => rt.stores.ui.getState();
const overridesOf = (id: PollId) => ipc.pollSummary(id).config.formatOverrides;
/** The poll is polling and one snapshot arrived. */
const setValues = (id: PollId, values: number[]) => {
  ipc.emitConnectionState("connected");
  ipc.emitPollState(id, "polling");
  ipc.emitPollUpdate(id, { values });
};

describe("rows()", () => {
  it("derives the rows of Start, Quantity and the overrides (L1)", async () => {
    const { rt } = await open({ formatOverrides: [ov(2, 5, "float32")] });
    const rows = rt.rows();
    expect(rows.map((r) => [r.address, r.endAddress, r.width])).toEqual([
      [0, 0, 1],
      [1, 1, 1],
      [2, 3, 2],
      [4, 5, 2],
      [6, 6, 1],
      [7, 7, 1],
      [8, 8, 1],
      [9, 9, 1],
    ]);
  });

  it("is the same list while Start, Quantity and the overrides are unchanged, even after another config event", async () => {
    const { rt, id } = await open({ formatOverrides: [ov(2, 5, "float32")] });
    const before = rt.rows();
    await rt.actions.setCopyAlias(true);
    await ipc.setPollView(id, { aliases: [{ address: 0, alias: "x" }] });
    expect(rt.rows()).toBe(before);
    await ipc.setPollView(id, { formatOverrides: [ov(2, 3, "float32")] });
    expect(rt.rows()).not.toBe(before);
    expect(rt.rows()).toHaveLength(9);
  });

  it("a coil poll has plain rows whatever the kept overrides say", async () => {
    const { rt } = await open({
      definition: { slaveId: 1, function: 1, startAddress: 0, quantity: 8, scanRateMs: 100 },
      formatOverrides: [ov(0, 3, "float32")],
    });
    expect(rt.rows()).toHaveLength(8);
    expect(rt.rows().every((r) => r.width === 1)).toBe(true);
  });

  it("has no rows before the snapshot", async () => {
    ipc = createFakeModbusMasterIpc({ mode: "manual" });
    const connection = createConnectionStore({ ipc, warn: () => {} });
    const id = await ipc.addPoll(pollConfigInput({ name: "A" }), "workspace");
    const rt = createPollViewRuntime({
      ipc,
      pollId: id,
      host: "workspace",
      connection,
      toasts: createToastStore({ setTimer: () => 0, clearTimer: () => {} }),
      warn: () => {},
    });
    runtimes.push(rt);
    expect(rt.rows()).toEqual([]);
    expect(rt.formatScope()).toEqual([]);
  });
});

describe("applyFormatOverrides (AC 1)", () => {
  it("sends only formatOverrides and the rows follow once Rust confirmed", async () => {
    const { rt, id } = await open();
    expect(await rt.actions.applyFormatOverrides([ov(2, 5, "float32")])).toBe(true);
    expect(ipc.callsOf("setPollView")).toEqual([[id, { formatOverrides: [ov(2, 5, "float32")] }]]);
    expect(rt.rows()).toHaveLength(8);
    expect(rt.stores.poll.getState().config?.formatOverrides).toEqual([ov(2, 5, "float32")]);
  });

  it("a rejected list keeps the old config and sets the command error", async () => {
    const { rt, id } = await open({ formatOverrides: [ov(0, 1, "hex")] });
    ipc.failNext(
      "setPollView",
      new IpcError("Format overrides 0-1 and 1-2 overlap.", "validation", "formatOverrides"),
    );
    expect(await rt.actions.applyFormatOverrides([ov(2, 3, "float32")])).toBe(false);
    expect(rt.stores.poll.getState().config?.formatOverrides).toEqual([ov(0, 1, "hex")]);
    expect(rt.stores.poll.getState()).toMatchObject({
      commandError: "Format overrides 0-1 and 1-2 overlap.",
      commandErrorField: "formatOverrides",
    });
    expect(overridesOf(id)).toEqual([ov(0, 1, "hex")]);
  });

  it("does not change the poll state and sends no request", async () => {
    const { rt, id } = await open();
    await ipc.connect(tcp);
    ipc.advance(300);
    const state = rt.stores.poll.getState().state;
    const requests = ipc.requestLog.length;
    await rt.actions.applyFormatOverrides([ov(2, 5, "float32")]);
    expect(rt.stores.poll.getState().state).toBe(state);
    expect(ipc.requestLog).toHaveLength(requests);
    expect(ipc.callsOf("setPollActive")).toEqual([]);
    expect(overridesOf(id)).toHaveLength(1);
  });
});

describe("setSelectedFormat (Ctrl+1..4)", () => {
  it("sets the format of the selected rows only (Ctrl+3 on rows 2-3)", async () => {
    const { rt, id } = await open();
    ui(rt).click(2);
    ui(rt).click(3, { shift: true });
    await rt.actions.setSelectedFormat("hex");
    expect(overridesOf(id)).toEqual([ov(2, 3, "hex")]);
    expect(announced).toEqual(["Format applied: Hex to 2-3."]);
    // the selection still covers exactly the changed registers
    expect(ui(rt).selection).toEqual([{ start: 2, end: 3 }]);
  });

  it("acts on the focused row when nothing is selected", async () => {
    const { rt, id } = await open();
    rt.stores.ui.setState({ focusAddress: 4 });
    await rt.actions.setSelectedFormat("binary");
    expect(overridesOf(id)).toEqual([ov(4, 4, "binary")]);
  });

  it("sends nothing without a selection and without a focused row", async () => {
    const { rt } = await open();
    await rt.actions.setSelectedFormat("hex");
    expect(ipc.callsOf("setPollView")).toEqual([]);
    expect(toastTexts()).toEqual([]);
  });

  it("sends nothing when the result is the same (an Unsigned row, Ctrl+1)", async () => {
    const { rt } = await open();
    ui(rt).click(2);
    await rt.actions.setSelectedFormat("unsigned");
    expect(ipc.callsOf("setPollView")).toEqual([]);
    expect(announced).toEqual([]);
  });

  it("does nothing on a coil poll", async () => {
    const { rt } = await open({
      definition: { slaveId: 1, function: 1, startAddress: 0, quantity: 8, scanRateMs: 100 },
    });
    ui(rt).click(2);
    await rt.actions.setSelectedFormat("hex");
    expect(ipc.callsOf("setPollView")).toEqual([]);
  });

  it("resets a combined value it splits and says so afterwards (P23)", async () => {
    const { rt, id } = await open({
      definition: { slaveId: 1, function: 3, startAddress: 101, quantity: 4, scanRateMs: 100 },
      formatOverrides: [ov(100, 101, "float32")],
    });
    ui(rt).click(101);
    await rt.actions.setSelectedFormat("unsigned");
    expect(overridesOf(id)).toEqual([]);
    expect(toastTexts()).toEqual([
      "Unsigned applied to 101. Also reset 100 to Unsigned because a combined value was split.",
    ]);
    expect(toasts.getState().items[0]?.tone).toBe("default");
  });

  it("says too many overrides in an error toast and sends nothing (M-T)", async () => {
    const many = Array.from({ length: 255 }, (_, i) => ov(1000 + 2 * i, 1000 + 2 * i, "hex"));
    const { rt } = await open({ formatOverrides: many });
    ui(rt).click(0);
    ui(rt).click(2, { ctrl: true });
    await rt.actions.setSelectedFormat("hex");
    expect(ipc.callsOf("setPollView")).toEqual([]);
    expect(toastTexts()).toEqual([
      "A poll can have at most 256 format overrides. This change would create 257. Select fewer separate blocks.",
    ]);
    expect(toasts.getState().items[0]?.tone).toBe("error");
  });

  it("shows the M-R text and sends nothing when a rule does not fit the prospective formats", async () => {
    const { rt } = await open();
    // A state Rust never produces (a hand-edited profile could): a decimal threshold on a rule
    // whose range meets an Unsigned 64-bit override. The check runs before anything is sent.
    const config = rt.stores.poll.getState().config;
    if (!config) throw new Error("no config");
    rt.stores.poll.setState({
      config: {
        ...config,
        formatOverrides: [ov(0, 3, "unsigned64")],
        colorRules: [
          {
            name: "Flow",
            enabled: true,
            range: { start: 0, end: 9 },
            source: "raw",
            comparison: "greaterThan",
            threshold: "1.5",
            upperThreshold: null,
            highlight: "lime",
          },
        ],
      },
    });
    ui(rt).click(8);
    await rt.actions.setSelectedFormat("hex");
    expect(ipc.callsOf("setPollView")).toEqual([]);
    expect(toastTexts()).toEqual([
      'Format not applied. Rule "Flow": Enter a whole decimal number for a 64-bit integer comparison.',
    ]);
    expect(toasts.getState().items[0]?.tone).toBe("error");
  });

  it("shows the backend rejection in an error toast", async () => {
    const { rt, id } = await open();
    ui(rt).click(2);
    ipc.failNext("setPollView", new IpcError("Not today.", "validation", "formatOverrides"));
    await rt.actions.setSelectedFormat("hex");
    expect(toastTexts()).toEqual(["Could not apply the format. Not today."]);
    expect(overridesOf(id)).toEqual([]);
    expect(announced).toEqual([]);
  });

  it("is off while the Format dialog is open", async () => {
    const { rt } = await open();
    ui(rt).click(2);
    expect(rt.actions.openFormatDialog("grid", 2)).toBe(true);
    await rt.actions.setSelectedFormat("hex");
    expect(ipc.callsOf("setPollView")).toEqual([]);
  });
});

describe("openFormatDialog", () => {
  it("opens for the selection with the origin", async () => {
    const { rt } = await open();
    ui(rt).click(2);
    ui(rt).click(5, { shift: true });
    expect(rt.actions.openFormatDialog("header")).toBe(true);
    expect(rt.stores.formatDialog.getState()).toMatchObject({
      open: true,
      scope: [{ start: 2, end: 5 }],
      origin: "header",
      originAddress: 5,
    });
  });

  it("opens for the focused row when nothing is selected, and for the menu row", async () => {
    const { rt } = await open();
    rt.stores.ui.setState({ focusAddress: 7 });
    expect(rt.actions.openFormatDialog("showMenu")).toBe(true);
    expect(rt.stores.formatDialog.getState().scope).toEqual([{ start: 7, end: 7 }]);
    rt.stores.formatDialog.getState().close();
    ui(rt).click(1);
    expect(rt.actions.openFormatDialog("grid", 1)).toBe(true);
    expect(rt.stores.formatDialog.getState()).toMatchObject({ origin: "grid", originAddress: 1 });
  });

  it("does not open without rows to act on or on a coil poll", async () => {
    const { rt } = await open();
    expect(rt.actions.openFormatDialog("header")).toBe(false);
    const coil = await open({
      definition: { slaveId: 1, function: 1, startAddress: 0, quantity: 8, scanRateMs: 100 },
    });
    ui(coil.rt).click(1);
    expect(coil.rt.actions.openFormatDialog("grid", 1)).toBe(false);
  });

  it("Apply in the dialog sends one setPollView, announces and closes (AC 1 through the store)", async () => {
    const { rt, id } = await open();
    ui(rt).click(2);
    ui(rt).click(5, { shift: true });
    rt.actions.openFormatDialog("grid", 2);
    const dialog = rt.stores.formatDialog.getState();
    dialog.setFormat("float32");
    expect(await dialog.apply()).toBe("closed");
    expect(ipc.callsOf("setPollView")).toEqual([[id, { formatOverrides: [ov(2, 5, "float32")] }]]);
    expect(announced).toEqual(["Format applied: Float 32-bit, Big-endian (ABCD) to 2-5."]);
    expect(rt.rows().map((r) => r.address)).toEqual([0, 1, 2, 4, 6, 7, 8, 9]);
    // focus and selection snap to whole rows
    expect(ui(rt).selection).toEqual([{ start: 2, end: 5 }]);
  });

  it("a bulk operation is not ready while the dialog is open", async () => {
    const { rt } = await open();
    ui(rt).click(2);
    rt.actions.openFormatDialog("grid", 2);
    expect(rt.stores.formatDialog.getState().open).toBe(true);
  });
});

describe("R2-03: every path hands whole rows to the planner and the dialog (REQ-009 item 13)", () => {
  const s32 = ov(0, 9, "signed32", { swapBytes: true });

  it("formatScope widens a selection that holds half a group", async () => {
    const { rt } = await open({ formatOverrides: [s32] });
    // a selection the UI store would never make, handed over by hand
    rt.stores.ui.setState({ selection: [{ start: 0, end: 0 }], focusAddress: 0 });
    expect(rt.formatScope()).toEqual([{ start: 0, end: 1 }]);
  });

  it("the owner's dialog opens on the whole row, on its own format, with Apply on, from a half-group selection", async () => {
    const { rt } = await open({ formatOverrides: [s32] });
    rt.stores.ui.setState({ selection: [{ start: 0, end: 0 }], focusAddress: 0, anchorAddress: 0 });
    expect(rt.actions.openFormatDialog("header")).toBe(true);
    const dialog = rt.stores.formatDialog.getState();
    expect(dialog).toMatchObject({
      scope: [{ start: 0, end: 1 }],
      format: "signed32",
      order: "bigByteSwap",
      mixed: false,
    });
    expect(await dialog.apply()).toBe("closed");
    expect(ipc.callsOf("setPollView")).toEqual([]);
  });

  it("a quick 16-bit format on a half-group selection formats the whole group row and resets nothing", async () => {
    const { rt, id } = await open({ formatOverrides: [s32] });
    rt.stores.ui.setState({ selection: [{ start: 0, end: 0 }], focusAddress: 0 });
    await rt.actions.setSelectedFormat("hex");
    expect(overridesOf(id)).toEqual([ov(0, 1, "hex"), ov(2, 9, "signed32", { swapBytes: true })]);
    expect(toastTexts()).toEqual([]);
    expect(announced).toEqual(["Format applied: Hex to 0-1."]);
  });

  it("a focus-only target (Esc) is the whole row", async () => {
    const { rt } = await open({ formatOverrides: [s32] });
    ui(rt).click(4);
    ui(rt).clearSelection();
    expect(ui(rt).selection).toEqual([]);
    expect(rt.formatScope()).toEqual([{ start: 4, end: 5 }]);
    expect(rt.actions.openFormatDialog("header")).toBe(true);
    expect(rt.stores.formatDialog.getState()).toMatchObject({
      scope: [{ start: 4, end: 5 }],
      originAddress: 4,
    });
  });

  it("partial-group split: Hex on the first row of [0-9 S32 BS] leaves the other groups, then register 1 is its own row", async () => {
    const { rt, id } = await open({ formatOverrides: [s32] });
    ui(rt).click(0);
    await rt.actions.setSelectedFormat("hex");
    // 0-1 became two Hex rows (a 16-bit format covers both registers of the group row)
    expect(overridesOf(id)).toEqual([ov(0, 1, "hex"), ov(2, 9, "signed32", { swapBytes: true })]);
    expect(rt.rows().map((r) => r.address)).toEqual([0, 1, 2, 4, 6, 8]);
    ui(rt).click(0);
    expect(ui(rt).selection).toEqual([{ start: 0, end: 0 }]);
    // now register 0 alone is a row: Signed 32-bit needs rows 0-1, said exactly
    expect(rt.actions.openFormatDialog("grid", 0)).toBe(true);
    expect(rt.stores.formatDialog.getState()).toMatchObject({ format: "hex", mixed: false });
    rt.stores.formatDialog.getState().setFormat("signed32");
  });
});

describe("the Format dialog closes when its poll goes away (DES-009 11.12)", () => {
  it("the poll is deleted: closed, nothing sent, and a pending reply is ignored", async () => {
    const { rt, id } = await open();
    ui(rt).click(0);
    rt.actions.openFormatDialog("header");
    rt.stores.formatDialog.getState().setFormat("hex");
    const held = ipc.holdReply("setPollView");
    const pending = rt.stores.formatDialog.getState().apply();
    expect(rt.stores.formatDialog.getState().pending).toBe(true);
    await ipc.removePoll(id);
    expect(rt.stores.formatDialog.getState()).toMatchObject({ open: false, pending: false });
    held.release();
    expect(await pending).toBe("closed");
    expect(rt.stores.formatDialog.getState()).toMatchObject({
      open: false,
      pending: false,
      error: null,
    });
    expect(announced).toEqual([]);
  });

  it("disposing the view (the host tears it down first) ignores an Apply that is still on its way", async () => {
    const { rt } = await open();
    ui(rt).click(0);
    rt.actions.openFormatDialog("header");
    rt.stores.formatDialog.getState().setFormat("hex");
    const held = ipc.holdReply("setPollView");
    const pending = rt.stores.formatDialog.getState().apply();
    rt.dispose();
    expect(rt.stores.formatDialog.getState()).toMatchObject({ open: false, pending: false });
    held.release();
    await pending;
    expect(announced).toEqual([]);
    expect(rt.stores.formatDialog.getState()).toMatchObject({ open: false, error: null });
  });

  it("an open dialog is closed by the removal event, without any Apply", async () => {
    const { rt, id } = await open();
    ui(rt).click(0);
    rt.actions.openFormatDialog("header");
    await ipc.removePoll(id);
    expect(rt.stores.formatDialog.getState().open).toBe(false);
    expect(ipc.callsOf("setPollView")).toEqual([]);
  });

  it("the view is detached by Rust: closed", async () => {
    const { rt, id } = await open();
    ui(rt).click(0);
    rt.actions.openFormatDialog("header");
    ipc.emitView(id, { type: "ViewDetached", pollId: id, reason: "poppedOut" } as never);
    expect(rt.stores.formatDialog.getState().open).toBe(false);
  });

  it("the range loses every register of the scope: closed; part of it left: stays open", async () => {
    const { rt, id } = await open();
    ui(rt).click(8);
    ui(rt).click(9, { shift: true });
    rt.actions.openFormatDialog("header");
    await ipc.updatePoll(id, {
      slaveId: 1,
      function: 3,
      startAddress: 0,
      quantity: 9,
      scanRateMs: 100,
    });
    expect(rt.stores.formatDialog.getState().open).toBe(true);
    await ipc.updatePoll(id, {
      slaveId: 1,
      function: 3,
      startAddress: 0,
      quantity: 5,
      scanRateMs: 100,
    });
    expect(rt.stores.formatDialog.getState().open).toBe(false);
    expect(ipc.callsOf("setPollView")).toEqual([]);
  });
});

describe("selection snapping after a format change", () => {
  it("focus on 3 moves to the row starting at 2 when 2-3 became a group", async () => {
    const { rt, id } = await open();
    ui(rt).click(3);
    await ipc.setPollView(id, { formatOverrides: [ov(2, 5, "float32")] });
    expect(ui(rt).focusAddress).toBe(2);
    expect(ui(rt).selection).toEqual([{ start: 2, end: 3 }]);
  });
});

describe("copy with group rows (DES-009 8.3)", () => {
  it("a mixed selection of L1 rows 1-3 with a header", async () => {
    const { rt, id } = await open({
      formatOverrides: [ov(2, 5, "float32")],
      scale: null,
    });
    setValues(id, [10, 0x00a1, 0x3f80, 0, 0, 0, 0, 0, 0, 0]);
    ui(rt).click(1);
    ui(rt).click(2, { shift: true });
    await rt.actions.copyRows({ header: true });
    expect(copied.at(-1)).toBe(
      ["Address (0-based)", "Raw (Mixed)"].join(TAB) +
        LF +
        ["1", "161"].join(TAB) +
        LF +
        ["2", "1"].join(TAB) +
        LF +
        ["3", "--"].join(TAB),
    );
  });

  it("a same-format 16-bit selection keeps Raw (Hex); a group-only one says Interpreted", async () => {
    const { rt, id } = await open({ formatOverrides: [ov(0, 1, "hex"), ov(4, 7, "float32")] });
    setValues(id, [1, 2, 3, 4, 0x3f80, 0, 0x4000, 0, 9, 9]);
    ui(rt).click(0);
    ui(rt).click(1, { shift: true });
    await rt.actions.copyRows({ header: true });
    expect(copied.at(-1)?.split(LF)[0]).toBe(["Address (0-based)", "Raw (Hex)"].join(TAB));
    ui(rt).click(4);
    ui(rt).click(6, { shift: true });
    await rt.actions.copyRows({ header: true });
    expect(copied.at(-1)).toBe(
      [
        ["Address (0-based)", "Interpreted (Float 32-bit)"].join(TAB),
        ["4", "1"].join(TAB),
        ["5", "--"].join(TAB),
        ["6", "2"].join(TAB),
        ["7", "--"].join(TAB),
      ].join(LF),
    );
  });

  it("Copy raw registers expands a group into one line per register with each alias", async () => {
    const { rt, id } = await open({
      formatOverrides: [ov(2, 5, "float32")],
      aliases: [
        { address: 2, alias: "Flow" },
        { address: 3, alias: "Flow low" },
      ],
      display: { addressBase: 0, showAlias: true, copyAlias: true },
    });
    setValues(id, [0, 0, 0x3f80, 0x0001, 0, 0, 0, 0, 0, 0]);
    ui(rt).click(2);
    await rt.actions.copyRows({ registers: true });
    expect(copied.at(-1)).toBe(
      [["Flow", "2", "16256"].join(TAB), ["Flow low", "3", "1"].join(TAB)].join(LF),
    );
  });

  it("Both gives an empty scaled field for a group row; Incomplete copies as text", async () => {
    const { rt, id } = await open({
      definition: { slaveId: 1, function: 3, startAddress: 100, quantity: 5, scanRateMs: 100 },
      formatOverrides: [ov(100, 105, "float32", { swapBytes: true, reverseWords: true })],
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
      valueColumns: "both",
    });
    setValues(id, [0, 0x803f, 0, 0xc03f, 7]);
    ui(rt).selectAll();
    await rt.actions.copyRows();
    expect(copied.at(-1)).toBe(
      [
        ["100", "1", ""].join(TAB),
        ["101", "--", "--"].join(TAB),
        ["102", "1.5", ""].join(TAB),
        ["103", "--", "--"].join(TAB),
        ["104", "Incomplete", ""].join(TAB),
      ].join(LF),
    );
  });

  it("64-bit integers copy exactly", async () => {
    const { rt, id } = await open({ formatOverrides: [ov(0, 7, "unsigned64")] });
    setValues(id, [0xffff, 0xffff, 0xffff, 0xffff, 0x20, 0, 0, 1, 0, 0]);
    ui(rt).click(0);
    ui(rt).click(4, { shift: true });
    await rt.actions.copyRows({ columns: "raw" });
    expect(copied.at(-1)).toBe(
      [
        ["0", "18446744073709551615"].join(TAB),
        ...[1, 2, 3].map((a) => [a, "--"].join(TAB)),
        ["4", "9007199254740993"].join(TAB),
        ...[5, 6, 7].map((a) => [a, "--"].join(TAB)),
      ].join(LF),
    );
  });

  it("Copy scaled with only group rows copies nothing; with a 16-bit row it does", async () => {
    const { rt, id } = await open({
      formatOverrides: [ov(0, 3, "float32")],
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
    });
    setValues(id, [0, 0, 0, 0, 50, 0, 0, 0, 0, 0]);
    ui(rt).click(0);
    await rt.actions.copyRows({ columns: "scaled" });
    expect(copied).toEqual([]);
    ui(rt).click(4);
    await rt.actions.copyRows({ columns: "scaled" });
    expect(copied).toEqual([["4", "5.0"].join(TAB)]);
  });

  it("Copy aliases copies the alias of each visible register", async () => {
    const { rt } = await open({
      formatOverrides: [ov(2, 5, "float32")],
      aliases: [
        { address: 1, alias: "One" },
        { address: 2, alias: "Group" },
        { address: 3, alias: "Hidden second" },
      ],
    });
    ui(rt).click(1);
    ui(rt).click(4, { shift: true });
    await rt.actions.copyAliases();
    expect(copied.at(-1)).toBe(["One", "Group", "Hidden second", "", ""].join(LF));
    expect(toastTexts()).toEqual(["Copied 5 rows."]);
  });

  it("an explicit address copies the row that contains it (the raw inspector)", async () => {
    const { rt, id } = await open({ formatOverrides: [ov(2, 5, "float32")] });
    setValues(id, [0, 0, 7, 8, 0, 0, 0, 0, 0, 0]);
    await rt.actions.copyRows({ registers: true, addresses: [3] });
    expect(copied.at(-1)).toBe([["2", "7"].join(TAB), ["3", "8"].join(TAB)].join(LF));
  });
});

describe("aliases on rows (DES-009 8.5)", () => {
  it("paste sets one alias per visible register from the first selected row", async () => {
    const { rt, id } = await open({ formatOverrides: [ov(2, 3, "float32")] });
    ui(rt).click(1);
    await rt.actions.pasteAliases(["A", "B", "C"].join(LF));
    expect(ipc.pollSummary(id).config.aliases).toEqual([
      { address: 1, alias: "A" },
      { address: 2, alias: "B" },
      { address: 3, alias: "C" },
    ]);
  });

  it("paste from the clipboard menu uses the same rule", async () => {
    const { rt, id } = await open({ formatOverrides: [ov(0, 1, "float32")] });
    ui(rt).click(0);
    await rt.actions.pasteAliasesFromClipboard();
    expect(ipc.pollSummary(id).config.aliases).toEqual([
      { address: 0, alias: "One" },
      { address: 1, alias: "Two" },
      { address: 2, alias: "Three" },
    ]);
  });

  it("Clear alias on a selected group row clears only the alias of its first register", async () => {
    const { rt, id } = await open({
      formatOverrides: [ov(2, 5, "float32")],
      aliases: [
        { address: 2, alias: "Group" },
        { address: 3, alias: "Second register" },
      ],
    });
    ui(rt).click(2);
    await rt.actions.clearSelectedAliases();
    expect(ipc.pollSummary(id).config.aliases).toEqual([{ address: 3, alias: "Second register" }]);
  });

  it("editAlias on a continuation edits that register's alias", async () => {
    const { rt } = await open({ formatOverrides: [ov(2, 5, "float32")] });
    rt.actions.editAlias(3, "menu");
    expect(rt.stores.alias.getState().editing?.address).toBe(3);
  });
});

describe("scale and rows (DES-009 8.1)", () => {
  it("Set scale for selected rows is refused when the selection holds a group row", async () => {
    const { rt } = await open({ formatOverrides: [ov(2, 5, "float32")] });
    ui(rt).click(1);
    ui(rt).click(2, { shift: true });
    expect(rt.actions.openOverrideForSelection()).toBe(false);
    expect(rt.stores.overrides.getState().open).toBe(false);
    ui(rt).click(1);
    expect(rt.actions.openOverrideForSelection()).toBe(true);
  });

  it("a format change leaves the scale and the overrides untouched", async () => {
    const scale = {
      preset: "divide" as const,
      rawSigned: false,
      xMin: 0,
      xMax: 65535,
      yMin: 0,
      yMax: 1,
      divisor: 10,
      decimals: 1,
      unit: "C",
      outOfRange: "flag" as const,
    };
    const { rt, id } = await open({
      scale,
      scaleOverrides: [{ start: 4, end: 5, scale: { ...scale, divisor: 100 } }],
      valueColumns: "both",
    });
    const before = ipc.pollSummary(id).config;
    ui(rt).selectAll();
    await rt.actions.setSelectedFormat("hex");
    const after = ipc.pollSummary(id).config;
    expect(after.scale).toEqual(before.scale);
    expect(after.scaleOverrides).toEqual(before.scaleOverrides);
    expect(after.valueColumns).toBe("both");
  });

  it("Show Scaled/Both stays available with group rows", async () => {
    const { rt, id } = await open({
      formatOverrides: [ov(0, 3, "float32")],
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
    });
    await rt.actions.setValueColumns("scaled");
    expect(ipc.pollSummary(id).config.valueColumns).toBe("scaled");
  });
});
