import { pollConfigInput } from "@/shared/ipc/modbus-master.fake";
import type { PollConfig } from "@/shared/ipc/modbus-master.types";
import { parseHandoff } from "../lib/handoff";
import type { DraftContext } from "./poll-draft.logic";
import {
  createPollViewUiStore,
  DEFAULT_COLUMN_WIDTHS,
  POLL_COLUMN_MIN_WIDTHS,
  type PollViewUiStoreApi,
  selectIsFocused,
  selectIsSelected,
} from "./poll-view-ui.store";

let config: PollConfig | null;
let store: PollViewUiStoreApi;

const makeConfig = (start = 0, quantity = 10, patch: Partial<PollConfig> = {}): PollConfig => ({
  ...pollConfigInput({
    name: "Tank",
    definition: { slaveId: 1, function: 3, startAddress: start, quantity, scanRateMs: 1000 },
  }),
  pollId: 1,
  active: true,
  ...patch,
});

beforeEach(() => {
  config = makeConfig();
  store = createPollViewUiStore({ getConfig: () => config });
});

const ctx: DraftContext = { mode: "tcp", base: 0, others: [] };

describe("initial state", () => {
  it("has nothing selected, the setup closed and the default widths", () => {
    expect(store.getState()).toMatchObject({
      setupOpen: false,
      compact: false,
      setupOverride: false,
      selection: [],
      anchorAddress: null,
      focusAddress: null,
      topAddress: null,
      columnWidths: DEFAULT_COLUMN_WIDTHS,
      pollDraft: null,
      scaleDraft: null,
    });
  });
});

describe("setup presentation and compact mode", () => {
  it("toggleSetup and setSetupOpen", () => {
    store.getState().toggleSetup();
    expect(store.getState().setupOpen).toBe(true);
    store.getState().setSetupOpen(false);
    expect(store.getState().setupOpen).toBe(false);
  });

  it("compact mode closes the setup and keeps it closed", () => {
    store.getState().setSetupOpen(true);
    store.getState().applyCompact(true);
    expect(store.getState()).toMatchObject({
      compact: true,
      setupOpen: false,
      setupOverride: false,
    });
  });

  it("in compact mode the user can still open the setup of this view (a local override)", () => {
    store.getState().applyCompact(true);
    store.getState().toggleSetup();
    expect(store.getState()).toMatchObject({ setupOpen: true, setupOverride: true });
    store.getState().toggleSetup();
    expect(store.getState()).toMatchObject({ setupOpen: false, setupOverride: false });
  });

  it("ending compact mode ends the override and restores the previous presentation", () => {
    store.getState().setSetupOpen(true);
    store.getState().applyCompact(true);
    store.getState().setSetupOpen(false); // user closes it in compact mode
    store.getState().applyCompact(false);
    expect(store.getState()).toMatchObject({
      compact: false,
      setupOpen: true,
      setupOverride: false,
    });
    expect(store.getState().setupBeforeCompact).toBeNull();
  });

  it("an override ends with compact mode: the setup returns to what it was before", () => {
    store.getState().applyCompact(true);
    store.getState().setSetupOpen(true);
    store.getState().applyCompact(false);
    // it was closed before compact mode, so it is closed again; the user can open it again
    expect(store.getState()).toMatchObject({ setupOpen: false, setupOverride: false });
  });

  it("closeSetup closes the setup; in compact mode it also ends the local override (O1)", () => {
    store.getState().setSetupOpen(true);
    store.getState().closeSetup();
    expect(store.getState().setupOpen).toBe(false);
    store.getState().applyCompact(true);
    store.getState().setSetupOpen(true);
    expect(store.getState()).toMatchObject({ setupOpen: true, setupOverride: true });
    store.getState().closeSetup();
    expect(store.getState()).toMatchObject({ setupOpen: false, setupOverride: false });
  });

  it("applying the same compact flag twice changes nothing", () => {
    store.getState().applyCompact(true);
    const before = store.getState();
    store.getState().applyCompact(true);
    expect(store.getState()).toBe(before);
  });
});

describe("selection by address", () => {
  it("click selects one row, anchor and focus", () => {
    store.getState().click(3);
    expect(store.getState()).toMatchObject({
      selection: [{ start: 3, end: 3 }],
      anchorAddress: 3,
      focusAddress: 3,
    });
  });

  it("shift-click selects a range from the anchor", () => {
    store.getState().click(3);
    store.getState().click(6, { shift: true });
    expect(store.getState().selection).toEqual([{ start: 3, end: 6 }]);
    expect(store.getState().anchorAddress).toBe(3);
    store.getState().click(1, { shift: true });
    expect(store.getState().selection).toEqual([{ start: 1, end: 3 }]);
  });

  it("shift-click without an anchor selects just that row", () => {
    store.getState().click(4, { shift: true });
    expect(store.getState().selection).toEqual([{ start: 4, end: 4 }]);
  });

  it("ctrl-click toggles", () => {
    store.getState().click(1);
    store.getState().click(5, { ctrl: true });
    store.getState().click(2, { ctrl: true });
    expect(store.getState().selection).toEqual([
      { start: 1, end: 2 },
      { start: 5, end: 5 },
    ]);
    store.getState().click(1, { ctrl: true });
    expect(store.getState().selection).toEqual([
      { start: 2, end: 2 },
      { start: 5, end: 5 },
    ]);
    expect(store.getState().focusAddress).toBe(1);
  });

  it("ignores addresses outside the poll range", () => {
    store.getState().click(10);
    store.getState().click(-1);
    expect(store.getState().selection).toEqual([]);
  });

  it("works with a start address other than 0", () => {
    config = makeConfig(100, 5);
    store.getState().click(100);
    store.getState().click(104, { shift: true });
    expect(store.getState().selection).toEqual([{ start: 100, end: 104 }]);
    store.getState().click(105);
    expect(store.getState().selection).toEqual([{ start: 100, end: 104 }]);
  });

  it("moveFocus starts at the first row going down and at the last going up", () => {
    store.getState().moveFocus(1);
    expect(store.getState().focusAddress).toBe(0);
    store.getState().clearSelection();
    store.getState().moveFocus(-1);
    expect(store.getState().focusAddress).toBe(9);
  });

  it("moveFocus clamps at both ends and moves the selection with it", () => {
    store.getState().click(8);
    store.getState().moveFocus(5);
    expect(store.getState()).toMatchObject({ focusAddress: 9, selection: [{ start: 9, end: 9 }] });
    store.getState().moveFocus(-50);
    expect(store.getState().focusAddress).toBe(0);
  });

  it("shift+arrow extends from the anchor", () => {
    store.getState().click(2);
    store.getState().moveFocus(1, { shift: true });
    store.getState().moveFocus(1, { shift: true });
    expect(store.getState().selection).toEqual([{ start: 2, end: 4 }]);
    store.getState().moveFocus(-3, { shift: true });
    expect(store.getState().selection).toEqual([{ start: 1, end: 2 }]);
  });

  it("moveFocusTo (Home, End)", () => {
    store.getState().moveFocusTo(0);
    expect(store.getState().focusAddress).toBe(0);
    store.getState().moveFocusTo(99, { shift: true });
    expect(store.getState().selection).toEqual([{ start: 0, end: 9 }]);
  });

  it("selectAll and clearSelection", () => {
    store.getState().selectAll();
    expect(store.getState()).toMatchObject({
      selection: [{ start: 0, end: 9 }],
      anchorAddress: 0,
      focusAddress: 0,
    });
    store.getState().click(4);
    store.getState().selectAll();
    expect(store.getState().focusAddress).toBe(4);
    store.getState().clearSelection();
    expect(store.getState()).toMatchObject({
      selection: [],
      anchorAddress: null,
      focusAddress: null,
    });
  });

  it("does nothing without a config", () => {
    config = null;
    store.getState().click(1);
    store.getState().moveFocus(1);
    store.getState().moveFocusTo(1);
    store.getState().selectAll();
    store.getState().syncRange();
    expect(store.getState().selection).toEqual([]);
  });

  it("syncRange drops what is outside a changed range and keeps the rest (same object when nothing changes)", () => {
    store.getState().click(2);
    store.getState().click(7, { shift: true });
    store.getState().setTopAddress(3);
    const before = store.getState().selection;
    store.getState().syncRange();
    expect(store.getState().selection).toBe(before);
    config = makeConfig(5, 10); // addresses 5-14
    store.getState().syncRange();
    expect(store.getState()).toMatchObject({
      selection: [{ start: 5, end: 7 }],
      anchorAddress: null,
      focusAddress: 7,
      topAddress: null,
    });
  });

  it("the row selectors return primitives", () => {
    store.getState().click(2);
    store.getState().click(4, { ctrl: true });
    const s = store.getState();
    expect(selectIsSelected(2)(s)).toBe(true);
    expect(selectIsSelected(3)(s)).toBe(false);
    expect(selectIsSelected(4)(s)).toBe(true);
    expect(selectIsFocused(4)(s)).toBe(true);
    expect(selectIsFocused(2)(s)).toBe(false);
  });
});

describe("scroll and columns", () => {
  it("remembers the first visible address", () => {
    store.getState().setTopAddress(5);
    expect(store.getState().topAddress).toBe(5);
    store.getState().setTopAddress(null);
    expect(store.getState().topAddress).toBeNull();
  });

  it("column widths respect the minimums of DES-002 2.3.4", () => {
    store.getState().setColumnWidth("alias", 10);
    store.getState().setColumnWidth("address", 10);
    store.getState().setColumnWidth("raw", 10);
    store.getState().setColumnWidth("scaled", 10);
    expect(store.getState().columnWidths).toEqual(POLL_COLUMN_MIN_WIDTHS);
    store.getState().setColumnWidth("alias", 200.4);
    expect(store.getState().columnWidths.alias).toBe(200);
  });
});

describe("poll draft", () => {
  it("typing creates a draft; typing the applied value again removes it", () => {
    store.getState().patchPollDraft("quantity", "200");
    expect(store.getState().pollDraft).toMatchObject({ quantity: "200", dirty: ["quantity"] });
    store.getState().patchPollDraft("quantity", "10");
    expect(store.getState().pollDraft).toBeNull();
  });

  it("an invalid draft keeps its text and its message", () => {
    store.getState().patchPollDraft("quantity", "200");
    store.getState().checkPollDraftField("quantity", ctx);
    expect(store.getState().pollDraft?.errors.quantity).toBe(
      "Quantity for FC03 must be from 1 to 125.",
    );
    expect(store.getState().pollDraft?.quantity).toBe("200");
  });

  it("checking a field without a draft does nothing", () => {
    store.getState().checkPollDraftField("quantity", ctx);
    expect(store.getState().pollDraft).toBeNull();
  });

  it("a rename from elsewhere keeps the draft (reconcileConfig)", () => {
    store.getState().patchPollDraft("quantity", "200");
    store.getState().reconcileConfig(makeConfig(0, 10, { name: "Tank 1" }));
    expect(store.getState().pollDraft).toMatchObject({ name: "Tank 1", quantity: "200" });
  });

  it("a changed display base converts the start text of the draft", () => {
    store.getState().patchPollDraft("startAddress", "5");
    const oneBased = makeConfig(0, 10, {
      display: {
        format: "unsigned",
        addressBase: 1,
        showAlias: true,
        copyAlias: false,
        swapBytes: false,
        reverseWords: false,
      },
    });
    config = oneBased;
    store.getState().reconcileConfig(oneBased, 0);
    expect(store.getState().pollDraft?.startAddress).toBe("6");
  });

  it("an Apply that matches the draft ends it", () => {
    store.getState().patchPollDraft("quantity", "20");
    config = makeConfig(0, 20);
    store.getState().reconcileConfig(config);
    expect(store.getState().pollDraft).toBeNull();
  });

  it("reconcileConfig without a draft does nothing", () => {
    const before = store.getState();
    store.getState().reconcileConfig(makeConfig());
    expect(store.getState().pollDraft).toBe(before.pollDraft);
  });

  it("patchPollDraft without a config does nothing; setPollDraft replaces", () => {
    config = null;
    store.getState().patchPollDraft("quantity", "1");
    expect(store.getState().pollDraft).toBeNull();
    config = makeConfig();
    store.getState().patchPollDraft("quantity", "20");
    store.getState().setPollDraft(null);
    expect(store.getState().pollDraft).toBeNull();
  });

  it("setScaleDraft stores the scale draft for FE-003", () => {
    store.getState().setScaleDraft({ dirty: true, fields: { xMin: "0" } });
    expect(store.getState().scaleDraft).toEqual({ dirty: true, fields: { xMin: "0" } });
    store.getState().setScaleDraft(null);
    expect(store.getState().scaleDraft).toBeNull();
  });
});

describe("handoff", () => {
  function prepared() {
    store.getState().setSetupOpen(true);
    store.getState().click(3);
    store.getState().click(5, { shift: true });
    store.getState().setTopAddress(2);
    store.getState().setColumnWidth("alias", 220);
    store.getState().patchPollDraft("quantity", "200");
    store.getState().checkPollDraftField("quantity", ctx);
    store
      .getState()
      .setScaleDraft({ dirty: true, fields: { xMax: "abc", errors: { xMax: "bad" } } });
  }

  it("column widths below the minimum are raised, so no column can be hidden (REV-005 n-7)", () => {
    const json = store.getState().toHandoff();
    const small = JSON.parse(json) as { columnWidths: Record<string, number> };
    small.columnWidths = { alias: 0, address: 5, raw: 10, scaled: 1 };
    const other = createPollViewUiStore({ getConfig: () => config });
    expect(other.getState().applyHandoff(JSON.stringify(small))).toBe(true);
    expect(other.getState().columnWidths).toEqual({ alias: 96, address: 72, raw: 96, scaled: 120 });
  });

  it("toHandoff then applyHandoff round-trips selection, focus, top address, widths, setup and both drafts", () => {
    prepared();
    const json = store.getState().toHandoff();
    const other = createPollViewUiStore({ getConfig: () => config });
    expect(other.getState().applyHandoff(json)).toBe(true);
    const a = store.getState();
    const b = other.getState();
    expect(b.selection).toEqual(a.selection);
    expect(b.anchorAddress).toBe(a.anchorAddress);
    expect(b.focusAddress).toBe(a.focusAddress);
    expect(b.topAddress).toBe(a.topAddress);
    expect(b.columnWidths).toEqual(a.columnWidths);
    expect(b.setupOpen).toBe(true);
    expect(b.pollDraft).toEqual(a.pollDraft);
    expect(b.scaleDraft).toEqual(a.scaleDraft);
    // including the invalid text and its message
    expect(b.pollDraft).toMatchObject({
      quantity: "200",
      errors: { quantity: "Quantity for FC03 must be from 1 to 125." },
    });
  });

  it("the handoff is valid JSON of schema version 1", () => {
    prepared();
    expect(parseHandoff(store.getState().toHandoff())).toMatchObject({
      version: 1,
      selection: [{ start: 3, end: 5 }],
    });
  });

  it("an invalid, malformed or missing handoff is ignored without throwing", () => {
    prepared();
    const before = store.getState();
    for (const bad of ["not json", '{"version":2}', "", null, undefined, "[]"]) {
      expect(store.getState().applyHandoff(bad)).toBe(false);
    }
    expect(store.getState().selection).toBe(before.selection);
    expect(store.getState().pollDraft).toBe(before.pollDraft);
  });

  it("compact rules apply on arrival: the setup stays closed unless it was an override", () => {
    prepared();
    const json = store.getState().toHandoff();
    const compact = createPollViewUiStore({ getConfig: () => config });
    compact.getState().applyCompact(true);
    compact.getState().applyHandoff(json);
    expect(compact.getState()).toMatchObject({ setupOpen: false, setupOverride: false });
    // when compact mode ends, the setup returns to what it was in the source host
    compact.getState().applyCompact(false);
    expect(compact.getState().setupOpen).toBe(true);

    const source = createPollViewUiStore({ getConfig: () => config });
    source.getState().applyCompact(true);
    source.getState().setSetupOpen(true); // an override
    const overridden = createPollViewUiStore({ getConfig: () => config });
    overridden.getState().applyCompact(true);
    overridden.getState().applyHandoff(source.getState().toHandoff());
    expect(overridden.getState()).toMatchObject({ setupOpen: true, setupOverride: true });
  });

  it("the handoff does not alias the store's objects", () => {
    prepared();
    const json = store.getState().toHandoff();
    const other = createPollViewUiStore({ getConfig: () => config });
    other.getState().applyHandoff(json);
    other.getState().patchPollDraft("slaveId", "5");
    expect(store.getState().pollDraft?.dirty).toEqual(["quantity"]);
  });
});
