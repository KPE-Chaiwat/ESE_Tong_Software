import { vi } from "vitest";
import { IpcError } from "@/shared/ipc/errors";
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
  pollConfigInput,
} from "@/shared/ipc/modbus-master.fake";
import type { PollHostKind, PollId, PopOutAnchor } from "@/shared/ipc/modbus-master.types";
import { createToastStore, type ToastStoreApi } from "@/shared/lib/toast.store";
import { isPollRunning } from "./poll.logic";
import {
  CLOSE_ACTIVE,
  CLOSE_UNAPPLIED,
  closeDialogBody,
  closeSnapshotText,
  deleteDialogBody,
  dockedAnnouncement,
  dockFailedToast,
  fallbackFocusTarget,
  focusTargetAfterFailure,
  handoffRefusedToast,
  hostChangeAnnouncement,
  needsWindowCloseConfirm,
  popOutFailedToast,
  poppedOutAnnouncement,
  WINDOW_CLOSE_TITLE,
  windowCloseBody,
} from "./poll-host.logic";
import { createPollHostStore, type PollHostStoreApi } from "./poll-host.store";

describe("S6 and S7 texts (DES-002 2.11)", () => {
  it("the Close body asks the question and adds the sentences that apply, in order", () => {
    expect(closeDialogBody("Pump 2", { hasUnappliedEdits: false, polling: false })).toBe(
      'Keep "Pump 2" on this connection, or delete it?',
    );
    expect(closeDialogBody("Pump 2", { hasUnappliedEdits: false, polling: true })).toBe(
      `Keep "Pump 2" on this connection, or delete it? ${CLOSE_ACTIVE}`,
    );
    expect(closeDialogBody("Pump 2", { hasUnappliedEdits: true, polling: true })).toBe(
      `Keep "Pump 2" on this connection, or delete it? ${CLOSE_UNAPPLIED} ${CLOSE_ACTIVE}`,
    );
    expect(CLOSE_UNAPPLIED).toBe("Unapplied changes in the poll setup will be lost.");
    expect(CLOSE_ACTIVE).toBe("A kept poll keeps polling in the background.");
  });

  it("the Delete body", () => {
    expect(deleteDialogBody("Pump 2")).toBe(
      'Delete "Pump 2"? Its window closes and its settings are removed from this connection.',
    );
  });
});

describe("host texts (DES-002 4, 2.10.8)", () => {
  it("the toasts and announcements are exact", () => {
    expect(popOutFailedToast("boom")).toBe("Could not open the poll window: boom");
    expect(dockFailedToast("boom")).toBe("Could not dock the poll: boom");
    expect(handoffRefusedToast("Pump 2")).toBe('Close the dialog in the "Pump 2" window first.');
    expect(poppedOutAnnouncement("Pump 2")).toBe("Pump 2 opened in its own window.");
    expect(dockedAnnouncement("Pump 2")).toBe("Pump 2 docked in the workspace.");
  });

  it("a dock is announced when an open poll moved from its own window to the workspace", () => {
    const native = { host: "native", open: true } as const;
    const workspace = { host: "workspace", open: true } as const;
    expect(hostChangeAnnouncement("P", native, workspace)).toBe("P docked in the workspace.");
    expect(hostChangeAnnouncement("P", workspace, native)).toBeNull();
    expect(hostChangeAnnouncement("P", workspace, workspace)).toBeNull();
    // A closed poll that is reopened is a show, not a dock.
    expect(hostChangeAnnouncement("P", { host: "native", open: false }, workspace)).toBeNull();
  });
});

describe("closing the connection window (DES-002 2.11)", () => {
  const base = { profileName: "Boiler-PLC", modified: false, nativeCount: 0, unappliedNames: [] };

  it("nothing unsaved closes at once; unsaved changes ask", () => {
    expect(needsWindowCloseConfirm(base)).toBe(false);
    expect(needsWindowCloseConfirm({ ...base, modified: true })).toBe(true);
    expect(needsWindowCloseConfirm({ ...base, unappliedNames: ["Pump 2"] })).toBe(true);
    expect(WINDOW_CLOSE_TITLE).toBe("Save changes?");
  });

  it("the body of a named profile", () => {
    expect(windowCloseBody({ ...base, modified: true })).toBe(
      'Save changes to "Boiler-PLC" before closing?',
    );
  });

  it("an unnamed setup asks to save it as a profile", () => {
    expect(windowCloseBody({ ...base, profileName: null, modified: true })).toBe(
      "Save this setup as a profile before closing?",
    );
  });

  it("adds the popped-out windows and the unapplied edits, in that order", () => {
    expect(
      windowCloseBody({ ...base, modified: true, nativeCount: 2, unappliedNames: ["Pump 2"] }),
    ).toBe(
      'Save changes to "Boiler-PLC" before closing? This also closes 2 poll windows. Unapplied edits in: Pump 2.',
    );
    expect(windowCloseBody({ ...base, modified: true, nativeCount: 1 })).toBe(
      'Save changes to "Boiler-PLC" before closing? This also closes 1 poll window.',
    );
    expect(windowCloseBody({ ...base, unappliedNames: ["Pump 2", "Valves"] })).toBe(
      'Save changes to "Boiler-PLC" before closing? Unapplied edits in: Pump 2, Valves.',
    );
  });
});

let ipc: FakeModbusMasterIpc;
let toasts: ToastStoreApi;
let store: PollHostStoreApi;
let ask = true;
let modal = false;
let setAsk: ReturnType<typeof vi.fn<(enabled: boolean) => void>>;
let flush: ReturnType<typeof vi.fn<() => void>>;
let blur: ReturnType<typeof vi.fn<() => void>>;
let marks: Array<[PollId, string | null]>;
let announced: string[];
let handoff: string | null;
const get = () => store.getState();
const toastTexts = () => toasts.getState().items.map((t) => t.text);

beforeEach(async () => {
  ipc = createFakeModbusMasterIpc({ mode: "manual" });
  await ipc.openSession(() => {});
  toasts = createToastStore({ setTimer: () => 0, clearTimer: () => {} });
  ask = true;
  modal = false;
  handoff = '{"version":1}';
  marks = [];
  announced = [];
  setAsk = vi.fn<(enabled: boolean) => void>((enabled) => {
    ask = enabled;
  });
  flush = vi.fn<() => void>();
  blur = vi.fn<() => void>();
  store = createPollHostStore({
    ipc,
    toasts,
    describe: (id) => {
      if (!ipc.pollIds().includes(id)) return null;
      const p = ipc.pollSummary(id);
      return {
        name: p.config.name,
        host: p.host,
        open: p.open,
        hasUnappliedEdits: p.hasUnappliedEdits,
        polling: isPollRunning(p.status.state),
      };
    },
    askOnPollClose: () => ask,
    setAskOnPollClose: setAsk,
    flushLayout: flush,
    getHandoff: () => handoff,
    blurEditors: blur,
    markViewPending: (id, kind) => marks.push([id, kind]),
    isModalOpen: () => modal,
    announce: (text) => announced.push(text),
  });
});

async function poll(name = "Pump 2", host: PollHostKind = "workspace") {
  return ipc.addPoll(pollConfigInput({ name }), host);
}

const ANCHOR: PopOutAnchor = { kind: "rect", rect: { x: 100, y: 80, width: 640, height: 368 } };
const RECT = { x: 8, y: 8, width: 640, height: 368, z: 1, state: "normal", restore: null } as const;

describe("pollHostStore close (S6)", () => {
  it("starts with no dialog and nothing pending", () => {
    expect(get()).toMatchObject({ closing: null, closeBody: null, deleting: null, pending: {} });
  });

  it("requestClose opens S6", async () => {
    const id = await poll();
    get().requestClose(id);
    expect(get().closing).toBe(id);
  });

  it("S6 is a snapshot: a state change while it is open does not change the stored body (REPORT-004 CHK2-G6)", async () => {
    const id = await poll("Pump 2");
    ipc.emitPollState(id, "polling");
    expect(isPollRunning(ipc.pollSummary(id).status.state)).toBe(true);
    get().requestClose(id);
    expect(get().closeBody).toEqual({
      name: "Pump 2",
      unappliedSentence: false,
      keepsPollingSentence: true,
    });
    // Paused, renamed and edited while S6 is open: the stored body is unchanged.
    ipc.emitPollState(id, "paused");
    await ipc.renamePoll(id, "Pump 3");
    await ipc.setPollView(id, { hasUnappliedEdits: true });
    expect(get().closeBody).toEqual({
      name: "Pump 2",
      unappliedSentence: false,
      keepsPollingSentence: true,
    });
    // Closing and reopening reads the poll again.
    get().cancelClose();
    expect(get().closeBody).toBeNull();
    get().requestClose(id);
    expect(get().closeBody).toEqual({
      name: "Pump 3",
      unappliedSentence: true,
      keepsPollingSentence: false,
    });
    const body = get().closeBody;
    if (!body) throw new Error("S6 should be open");
    expect(closeSnapshotText(body)).toBe(
      `Keep "Pump 3" on this connection, or delete it? ${CLOSE_UNAPPLIED}`,
    );
  });

  it("Keep and Delete clear the snapshot and act on the poll as it is then", async () => {
    const id = await poll();
    get().requestClose(id);
    await get().confirmClose("keep", false);
    expect(get().closeBody).toBeNull();
    expect(ipc.callsOf("closePollView")).toEqual([[id, true]]);
  });

  it("an unknown poll opens nothing", () => {
    get().requestClose(99);
    expect(get().closing).toBeNull();
  });

  it("Keep reports the layout, then closes the view and keeps the poll", async () => {
    const id = await poll();
    get().requestClose(id);
    await get().confirmClose("keep", false);
    expect(flush).toHaveBeenCalledOnce();
    expect(ipc.callsOf("closePollView")).toEqual([[id, true]]);
    expect(get().closing).toBeNull();
    expect(ipc.pollSummary(id).open).toBe(false);
  });

  it("Delete removes the poll", async () => {
    const id = await poll();
    get().requestClose(id);
    await get().confirmClose("delete", false);
    expect(ipc.callsOf("closePollView")).toEqual([[id, false]]);
    expect(ipc.pollIds()).toEqual([]);
  });

  it("Cancel does nothing", async () => {
    const id = await poll();
    get().requestClose(id);
    get().cancelClose();
    expect(get().closing).toBeNull();
    expect(ipc.callsOf("closePollView")).toHaveLength(0);
  });

  it("'Don't ask again' is sent and later closes keep without asking", async () => {
    const id = await poll();
    get().requestClose(id);
    await get().confirmClose("keep", true);
    expect(setAsk).toHaveBeenCalledWith(false);
    await ipc.showPoll(id, null);
    get().requestClose(id);
    expect(get().closing).toBeNull();
    await vi.waitFor(() => expect(ipc.callsOf("closePollView")).toHaveLength(2));
  });

  it("closing a native poll works the same (the window is Rust's to destroy)", async () => {
    const id = await poll("Pump 2", "native");
    get().requestClose(id);
    await get().confirmClose("keep", false);
    expect(ipc.callsOf("closePollView")).toEqual([[id, true]]);
  });

  it("a rejected close shows the error and clears the pending flag", async () => {
    const id = await poll();
    ipc.failNext("closePollView", "no window");
    get().requestClose(id);
    await get().confirmClose("keep", false);
    expect(toasts.getState().items.at(-1)).toMatchObject({ text: "no window", tone: "error" });
    expect(get().pending[id]).toBeNull();
  });

  it("confirmClose without a dialog does nothing", async () => {
    await get().confirmClose("keep", false);
    expect(ipc.callsOf("closePollView")).toHaveLength(0);
  });
});

describe("pollHostStore delete (S7)", () => {
  it("Delete asks first, then removes the poll", async () => {
    const id = await poll();
    get().requestDelete(id);
    expect(get().deleting).toBe(id);
    expect(ipc.callsOf("removePoll")).toHaveLength(0);
    await get().confirmDelete();
    expect(ipc.callsOf("removePoll")).toEqual([[id]]);
    expect(get().deleting).toBeNull();
  });

  it("Cancel keeps the poll", async () => {
    const id = await poll();
    get().requestDelete(id);
    get().cancelDelete();
    await get().confirmDelete();
    expect(ipc.pollIds()).toEqual([id]);
  });

  it("a rejected delete shows the error", async () => {
    const id = await poll();
    ipc.failNext("removePoll", "busy");
    get().requestDelete(id);
    await get().confirmDelete();
    expect(toasts.getState().items.at(-1)?.text).toBe("busy");
  });
});

describe("pollHostStore show (H12-H14)", () => {
  it("sends showPoll and clears its pending flag", async () => {
    const id = await poll();
    await get().show(id);
    expect(ipc.callsOf("showPoll")).toEqual([[id, null]]);
    expect(get().pending[id]).toBeNull();
  });

  it("passes the drop rectangle (a list drag)", async () => {
    const id = await poll();
    await get().show(id, { workspaceRect: RECT });
    expect(ipc.callsOf("showPoll")).toEqual([[id, { workspaceRect: RECT }]]);
  });

  it("is pending while the command runs and ignores a second show of the same poll", async () => {
    const id = await poll();
    const held = ipc.hold("showPoll");
    const first = get().show(id);
    expect(get().pending[id]).toBe("show");
    await get().show(id);
    expect(ipc.callsOf("showPoll")).toHaveLength(1);
    held.release();
    await first;
    expect(get().pending[id]).toBeNull();
  });

  it("a rejected show of a workspace poll is the plain message", async () => {
    const id = await poll();
    ipc.failNext("showPoll", "no window");
    await get().show(id);
    expect(toasts.getState().items.at(-1)).toMatchObject({ text: "no window", tone: "error" });
  });

  it("a rejected show of a native poll says the window could not be opened", async () => {
    const id = await poll("Pump 2", "native");
    ipc.failNext("showPoll", "no window");
    await get().show(id);
    expect(toastTexts()).toEqual(["Could not open the poll window: no window"]);
  });

  it("an unknown poll is ignored", async () => {
    await get().show(99);
    expect(ipc.callsOf("showPoll")).toHaveLength(0);
  });
});

describe("pollHostStore popOut (H4, DES-002 2.5.2)", () => {
  it("reports the layout, blurs the editor, then sends the anchor and the handoff", async () => {
    const id = await poll();
    expect(await get().popOut(id, ANCHOR)).toBe(true);
    expect(blur).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledOnce();
    expect(ipc.callsOf("popOutPoll")).toEqual([[id, ANCHOR, '{"version":1}']]);
    expect(ipc.pollSummary(id).host).toBe("native");
    expect(announced).toEqual(["Pump 2 opened in its own window."]);
  });

  it("blurs before it reads the handoff (a valid editor commits first)", async () => {
    const id = await poll();
    const order: string[] = [];
    blur.mockImplementation(() => order.push("blur"));
    store = createPollHostStore({
      ipc,
      toasts,
      describe: () => ({
        name: "Pump 2",
        host: "workspace",
        open: true,
        hasUnappliedEdits: false,
        polling: false,
      }),
      askOnPollClose: () => true,
      setAskOnPollClose: () => {},
      getHandoff: () => {
        order.push("handoff");
        return null;
      },
      blurEditors: blur,
    });
    await store.getState().popOut(id, ANCHOR);
    expect(order).toEqual(["blur", "handoff"]);
  });

  it("without a view the handoff is null", async () => {
    const id = await poll();
    handoff = null;
    await get().popOut(id, ANCHOR);
    expect(ipc.callsOf("popOutPoll")).toEqual([[id, ANCHOR, null]]);
  });

  it("is pending, with a spinner on the control, until the command resolves", async () => {
    const id = await poll();
    const held = ipc.hold("popOutPoll");
    const run = get().popOut(id, ANCHOR);
    await vi.waitFor(() => expect(get().pending[id]).toBe("popOut"));
    expect(marks).toEqual([[id, "popOut"]]);
    // The poll has not moved: the sub-window stays until Rust says so.
    expect(ipc.pollSummary(id).host).toBe("workspace");
    // A second press does nothing while it runs.
    expect(await get().popOut(id, ANCHOR)).toBe(false);
    expect(ipc.callsOf("popOutPoll")).toHaveLength(1);
    held.release();
    expect(await run).toBe(true);
    expect(get().pending[id]).toBeNull();
    expect(marks).toEqual([
      [id, "popOut"],
      [id, null],
    ]);
  });

  it("a failure shows 'Could not open the poll window: {message}' and stays quiet", async () => {
    const id = await poll();
    ipc.failNext("popOutPoll", "boom");
    expect(await get().popOut(id, ANCHOR)).toBe(false);
    expect(toasts.getState().items.at(-1)).toMatchObject({
      text: "Could not open the poll window: boom",
      tone: "error",
    });
    expect(announced).toEqual([]);
    expect(get().pending[id]).toBeNull();
    expect(marks.at(-1)).toEqual([id, null]);
  });

  it("a scripted backend failure puts the poll back in the workspace", async () => {
    const id = await poll();
    ipc.scriptPopOutFailure("The window could not be created.");
    expect(await get().popOut(id, ANCHOR)).toBe(false);
    expect(toastTexts()).toEqual([
      "Could not open the poll window: The window could not be created.",
    ]);
    expect(ipc.pollSummary(id).host).toBe("workspace");
  });

  it("does nothing while a dialog is open in this window", async () => {
    const id = await poll();
    modal = true;
    expect(await get().popOut(id, ANCHOR)).toBe(false);
    expect(ipc.callsOf("popOutPoll")).toHaveLength(0);
    modal = false;
    get().requestClose(id);
    expect(await get().popOut(id, ANCHOR)).toBe(false);
    expect(ipc.callsOf("popOutPoll")).toHaveLength(0);
  });

  it("only an open workspace poll can pop out", async () => {
    const native = await poll("N", "native");
    const closed = await poll("C");
    await ipc.closePollView(closed, true);
    expect(await get().popOut(native, ANCHOR)).toBe(false);
    expect(await get().popOut(closed, ANCHOR)).toBe(false);
    expect(await get().popOut(99, ANCHOR)).toBe(false);
    expect(ipc.callsOf("popOutPoll")).toHaveLength(0);
  });
});

describe("pollHostStore dock (H5, H15, DES-002 2.5.3)", () => {
  it("a native window docks with its own handoff and no request", async () => {
    const id = await poll("Pump 2", "native");
    expect(await get().dock(id)).toBe(true);
    expect(blur).toHaveBeenCalledOnce();
    expect(ipc.callsOf("dockPoll")).toEqual([[id, '{"version":1}', false, null]]);
    expect(ipc.pollSummary(id).host).toBe("workspace");
    expect(get().pending[id]).toBeNull();
    expect(marks).toEqual([
      [id, "dock"],
      [id, null],
    ]);
  });

  it("W1 docks on behalf of the window: no handoff of its own, the request flag, the rectangle", async () => {
    const id = await poll("Pump 2", "native");
    expect(await get().dock(id, { requestHandoff: true, workspaceRect: RECT })).toBe(true);
    expect(ipc.callsOf("dockPoll")).toEqual([[id, null, true, RECT]]);
    expect(blur).not.toHaveBeenCalled();
  });

  it("a failure shows 'Could not dock the poll: {message}'", async () => {
    const id = await poll("Pump 2", "native");
    ipc.failNext("dockPoll", "boom");
    expect(await get().dock(id)).toBe(false);
    expect(toasts.getState().items.at(-1)).toMatchObject({
      text: "Could not dock the poll: boom",
      tone: "error",
    });
    expect(get().pending[id]).toBeNull();
  });

  it("a refused request (a dialog is open there) says to close the dialog first", async () => {
    const id = await poll("Pump 2", "native");
    ipc.failNext("dockPoll", new IpcError("No answer", "validation", "handoff"));
    expect(await get().dock(id, { requestHandoff: true })).toBe(false);
    expect(toasts.getState().items.at(-1)).toMatchObject({
      text: 'Close the dialog in the "Pump 2" window first.',
      tone: "default",
    });
  });

  it("another failure of a request is the dock failure", async () => {
    const id = await poll("Pump 2", "native");
    ipc.failNext("dockPoll", new IpcError("Gone", "internal"));
    await get().dock(id, { requestHandoff: true });
    expect(toastTexts()).toEqual(["Could not dock the poll: Gone"]);
  });

  it("a handoff that is too large from the native window itself is a dock failure", async () => {
    const id = await poll("Pump 2", "native");
    ipc.failNext("dockPoll", new IpcError("Too large", "validation", "handoff"));
    await get().dock(id);
    expect(toastTexts()).toEqual(["Could not dock the poll: Too large"]);
  });

  it("does nothing while a dialog is open in the native window itself", async () => {
    const id = await poll("Pump 2", "native");
    modal = true;
    expect(await get().dock(id)).toBe(false);
    expect(ipc.callsOf("dockPoll")).toHaveLength(0);
  });

  it("ignores a second dock while one runs, and an unknown poll", async () => {
    const id = await poll("Pump 2", "native");
    const held = ipc.hold("dockPoll");
    const first = get().dock(id);
    await vi.waitFor(() => expect(get().pending[id]).toBe("dock"));
    expect(await get().dock(id)).toBe(false);
    held.release();
    await first;
    expect(ipc.callsOf("dockPoll")).toHaveLength(1);
    expect(await get().dock(99)).toBe(false);
  });
});

describe("pollHostStore answerHandoffRequest (DES-002 2.5.4)", () => {
  it("answers with the handoff of the view", async () => {
    const id = await poll("Pump 2", "native");
    await get().answerHandoffRequest(id);
    expect(ipc.callsOf("provideHandoff")).toEqual([[id, '{"version":1}']]);
    expect(blur).toHaveBeenCalledOnce();
  });

  it("refuses (null) while a modal is open", async () => {
    const id = await poll("Pump 2", "native");
    modal = true;
    await get().answerHandoffRequest(id);
    expect(ipc.callsOf("provideHandoff")).toEqual([[id, null]]);
  });

  it("refuses while the Close or Delete dialog is open", async () => {
    const id = await poll("Pump 2", "native");
    get().requestClose(id);
    await get().answerHandoffRequest(id);
    get().cancelClose();
    get().requestDelete(id);
    await get().answerHandoffRequest(id);
    expect(ipc.callsOf("provideHandoff")).toEqual([
      [id, null],
      [id, null],
    ]);
  });

  it("a late answer that Rust rejects is not shown", async () => {
    const id = await poll("Pump 2", "native");
    ipc.failNext("provideHandoff", "late");
    await get().answerHandoffRequest(id);
    expect(toastTexts()).toEqual([]);
  });

  it("answers a real request: the dock of W1 goes through with the handoff", async () => {
    const id = await poll("Pump 2", "native");
    await ipc.attachPollView(id, "native", (event) => {
      if (event.type === "HandoffRequested") void get().answerHandoffRequest(event.pollId);
    });
    expect(await get().dock(id, { requestHandoff: true, workspaceRect: RECT })).toBe(true);
    expect(ipc.pollSummary(id).host).toBe("workspace");
  });
});

describe("focus after a failed pop out or dock (DES-002 2.5.2, 2.5.3, 9)", () => {
  it.each([
    ["button", "workspace", "button"],
    ["shortcut", "workspace", "previous"],
    ["subWindowMenu", "workspace", "menuButton"],
    ["sidebarMenu", "workspace", "sidebarRow"],
    ["titleBarMenu", "workspace", "titleBar"],
    ["dragOut", "workspace", "titleBar"],
    ["button", "native", "button"],
    ["shortcut", "native", "previous"],
    ["subWindowMenu", "native", "menuButton"],
    ["titleBarMenu", "native", "pollName"],
  ] as const)("(%s, %s) -> %s", (origin, host, target) => {
    expect(focusTargetAfterFailure(origin, host)).toBe(target);
  });

  it("the fallback is the title bar in a sub-window and the poll name in a native window", () => {
    expect(fallbackFocusTarget("workspace")).toBe("titleBar");
    expect(fallbackFocusTarget("native")).toBe("pollName");
  });
});
