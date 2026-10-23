import { pollConfigInput } from "@/shared/ipc/modbus-master.fake";
import type { FormatOverride, PollConfig } from "@/shared/ipc/modbus-master.types";
import { formatRows, snapRangesToRows } from "../lib/format-overrides";
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
    const fresh = createPollViewUiStore({ getConfig: () => config });
    fresh.getState().moveFocus(-1);
    expect(fresh.getState().focusAddress).toBe(9);
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
    // Esc keeps the focused row and makes it the anchor (DES-009 11.8, D-009-04)
    expect(store.getState()).toMatchObject({
      selection: [],
      anchorAddress: 4,
      focusAddress: 4,
    });
  });

  it("Esc: a second Esc changes nothing, with nothing focused it does nothing", () => {
    store.getState().click(2);
    store.getState().click(5, { shift: true });
    store.getState().clearSelection();
    expect(store.getState()).toMatchObject({ selection: [], anchorAddress: 5, focusAddress: 5 });
    const before = store.getState();
    store.getState().clearSelection();
    expect(store.getState()).toBe(before);
    const fresh = createPollViewUiStore({ getConfig: () => config });
    const none = fresh.getState();
    fresh.getState().clearSelection();
    expect(fresh.getState()).toBe(none);
  });

  it("after Esc the focused row is the target: shift+arrow selects from it, click selects anew", () => {
    store.getState().click(2);
    store.getState().click(5, { shift: true });
    store.getState().clearSelection();
    store.getState().moveFocus(1, { shift: true });
    expect(store.getState().selection).toEqual([{ start: 5, end: 6 }]);
  });

  it("does nothing without a config", () => {
    config = null;
    store.getState().click(1);
    store.getState().moveFocus(1);
    store.getState().moveFocusTo(1);
    store.getState().selectAll();
    store.getState().syncRows();
    expect(store.getState().selection).toEqual([]);
  });

  it("syncRows drops what is outside a changed range, moves a lost focus to the first row and keeps the rest (same object when nothing changes)", () => {
    store.getState().click(2);
    store.getState().click(7, { shift: true });
    store.getState().setTopAddress(3);
    const before = store.getState().selection;
    store.getState().syncRows();
    expect(store.getState().selection).toBe(before);
    config = makeConfig(5, 10); // addresses 5-14
    store.getState().syncRows();
    expect(store.getState()).toMatchObject({
      selection: [{ start: 5, end: 7 }],
      anchorAddress: 5,
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
    store.getState().setColumnWidth("format", 10);
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
      display: { addressBase: 1, showAlias: true, copyAlias: false },
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
    small.columnWidths = { alias: 0, address: 5, format: 2, raw: 10, scaled: 1 };
    const other = createPollViewUiStore({ getConfig: () => config });
    expect(other.getState().applyHandoff(JSON.stringify(small))).toBe(true);
    expect(other.getState().columnWidths).toEqual(POLL_COLUMN_MIN_WIDTHS);
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

// ---- rows with 32/64-bit groups (DES-009 3.3, vectors L1, L3, L11) ----
const f32 = (start: number, end: number): FormatOverride => ({
  start,
  end,
  format: "float32",
  swapBytes: false,
  reverseWords: false,
});
const withOverrides = (start: number, quantity: number, overrides: FormatOverride[]) => {
  config = makeConfig(start, quantity, { formatOverrides: overrides });
  store = createPollViewUiStore({ getConfig: () => config });
};

describe("selection and focus by row", () => {
  it("a click on a group row selects the whole group and focuses its first register (L1)", () => {
    withOverrides(0, 10, [f32(2, 5)]);
    store.getState().click(3);
    expect(store.getState()).toMatchObject({
      selection: [{ start: 2, end: 3 }],
      anchorAddress: 2,
      focusAddress: 2,
    });
    expect(selectIsSelected(3)(store.getState())).toBe(true);
    expect(selectIsFocused(2)(store.getState())).toBe(true);
  });

  it("Shift from a 16-bit row to a group row selects whole rows", () => {
    withOverrides(0, 10, [f32(2, 5)]);
    store.getState().click(1);
    store.getState().moveFocus(1, { shift: true });
    expect(store.getState().selection).toEqual([{ start: 1, end: 3 }]);
    store.getState().click(1);
    store.getState().click(4, { shift: true });
    expect(store.getState().selection).toEqual([{ start: 1, end: 5 }]);
    expect(store.getState().anchorAddress).toBe(1);
    // and back from a group row to the first row
    store.getState().click(3);
    store.getState().click(0, { shift: true });
    expect(store.getState().selection).toEqual([{ start: 0, end: 3 }]);
    expect(store.getState().anchorAddress).toBe(2);
  });

  it("Ctrl+click toggles a whole group", () => {
    withOverrides(0, 10, [f32(2, 5)]);
    store.getState().click(0);
    store.getState().click(5, { ctrl: true });
    expect(store.getState().selection).toEqual([
      { start: 0, end: 0 },
      { start: 4, end: 5 },
    ]);
    store.getState().click(4, { ctrl: true });
    expect(store.getState().selection).toEqual([{ start: 0, end: 0 }]);
    store.getState().click(2, { ctrl: true });
    store.getState().click(1, { ctrl: true });
    expect(store.getState().selection).toEqual([{ start: 0, end: 3 }]);
  });

  it("arrow keys move by row, not by address", () => {
    withOverrides(0, 10, [f32(2, 5)]);
    store.getState().click(1);
    store.getState().moveFocus(1);
    expect(store.getState().focusAddress).toBe(2);
    store.getState().moveFocus(1);
    expect(store.getState().focusAddress).toBe(4);
    store.getState().moveFocus(1);
    expect(store.getState().focusAddress).toBe(6);
    store.getState().moveFocus(-2);
    expect(store.getState().focusAddress).toBe(2);
    store.getState().moveFocus(-1, { shift: true });
    expect(store.getState().selection).toEqual([{ start: 1, end: 3 }]);
    store.getState().moveFocus(50);
    expect(store.getState()).toMatchObject({ focusAddress: 9, selection: [{ start: 9, end: 9 }] });
  });

  it("End goes to the last row and Home to the first (L11, groups cut by the poll)", () => {
    withOverrides(3, 4, [f32(0, 7)]);
    store.getState().moveFocusTo(6);
    expect(store.getState()).toMatchObject({ focusAddress: 6, selection: [{ start: 6, end: 6 }] });
    store.getState().moveFocusTo(99);
    expect(store.getState().focusAddress).toBe(6);
    store.getState().moveFocusTo(0, { shift: true });
    expect(store.getState().selection).toEqual([{ start: 3, end: 6 }]);
  });

  it("Ctrl+A selects the whole poll range", () => {
    withOverrides(3, 4, [f32(0, 7)]);
    store.getState().selectAll();
    expect(store.getState()).toMatchObject({
      selection: [{ start: 3, end: 6 }],
      anchorAddress: 3,
      focusAddress: 3,
    });
  });

  it("a coil poll has plain rows whatever the overrides say", () => {
    config = makeConfig(0, 10, {
      definition: { slaveId: 1, function: 1, startAddress: 0, quantity: 10, scanRateMs: 1000 },
      formatOverrides: [f32(2, 5)],
    });
    store = createPollViewUiStore({ getConfig: () => config });
    store.getState().click(3);
    expect(store.getState().selection).toEqual([{ start: 3, end: 3 }]);
  });

  it("uses the rows handed in by getRows", () => {
    const rows = formatRows(0, 10, [f32(0, 3)]);
    const custom = createPollViewUiStore({ getConfig: () => config, getRows: () => rows });
    custom.getState().click(1);
    expect(custom.getState().selection).toEqual([{ start: 0, end: 1 }]);
  });
});

describe("syncRows after the rows changed", () => {
  it("focus on 3 moves to the row starting at 2 when 2-3 became a group, and the selection widens", () => {
    config = makeConfig(0, 10);
    store = createPollViewUiStore({ getConfig: () => config });
    store.getState().click(3);
    store.getState().click(1, { ctrl: true });
    store.getState().setTopAddress(3);
    config = makeConfig(0, 10, { formatOverrides: [f32(2, 5)] });
    store.getState().syncRows();
    expect(store.getState()).toMatchObject({
      selection: [{ start: 1, end: 3 }],
      focusAddress: 1,
      anchorAddress: 1,
      topAddress: 2,
    });
  });

  it("a click on a group, then the group is removed: the selection stays on its registers", () => {
    withOverrides(0, 10, [f32(2, 5)]);
    store.getState().click(3);
    config = makeConfig(0, 10);
    store.getState().syncRows();
    expect(store.getState().focusAddress).toBe(2);
    expect(store.getState().selection).toEqual([{ start: 2, end: 3 }]);
  });

  it("a selection that cuts a group is widened to the whole group; one outside the poll is clipped", () => {
    config = makeConfig(100, 5, { formatOverrides: [f32(100, 105)] });
    store = createPollViewUiStore({ getConfig: () => config });
    store.setState({
      selection: [
        { start: 101, end: 101 },
        { start: 104, end: 120 },
      ],
    });
    store.getState().syncRows();
    expect(store.getState().selection).toEqual([
      { start: 100, end: 101 },
      { start: 104, end: 104 },
    ]);
  });

  it("does nothing without a config", () => {
    config = null;
    store = createPollViewUiStore({ getConfig: () => config });
    const before = store.getState();
    store.getState().syncRows();
    expect(store.getState().selection).toBe(before.selection);
  });
});

describe("handoff without the removed keys (REQ-009)", () => {
  it("an old handoff with groupWidth and interpretationDraft is applied without them", () => {
    store.getState().click(3);
    const old = {
      ...(JSON.parse(store.getState().toHandoff()) as Record<string, unknown>),
      groupWidth: 2,
      interpretationDraft: { format: "float32", swapBytes: true, reverseWords: false, error: null },
    };
    expect(store.getState().applyHandoff(JSON.stringify(old))).toBe(true);
    expect(store.getState()).not.toHaveProperty("groupWidth");
    expect(store.getState()).not.toHaveProperty("interpretationDraft");
    expect(store.getState().selection).toEqual([{ start: 3, end: 3 }]);
  });

  it("a handoff written now has neither key", () => {
    const written = JSON.parse(store.getState().toHandoff()) as Record<string, unknown>;
    expect(written).not.toHaveProperty("groupWidth");
    expect(written).not.toHaveProperty("interpretationDraft");
    expect(written.columnWidths).toMatchObject({ format: DEFAULT_COLUMN_WIDTHS.format });
  });

  it("a handoff without columnWidths.format restores the default width", () => {
    const old = JSON.parse(store.getState().toHandoff()) as {
      columnWidths: Record<string, number>;
    };
    old.columnWidths = { alias: 200, address: 130, raw: 170, scaled: 180 };
    store.getState().applyHandoff(JSON.stringify(old));
    expect(store.getState().columnWidths).toEqual({
      alias: 200,
      address: 130,
      format: 96,
      raw: 170,
      scaled: 180,
    });
  });
});

describe("R2-03: the selection always holds whole rows (REQ-009 item 13, DES-009 11.2)", () => {
  const s32bs = (start: number, end: number): FormatOverride => ({
    start,
    end,
    format: "signed32",
    swapBytes: true,
    reverseWords: false,
  });
  const whole = () => {
    const list = formatRows(
      config?.definition.startAddress ?? 0,
      config?.definition.quantity ?? 0,
      config?.formatOverrides ?? [],
    );
    return snapRangesToRows(list, store.getState().selection);
  };

  it("the owner's poll [0-9 S32 BS]: click, Shift, Ctrl and Ctrl+A leave whole rows", () => {
    withOverrides(0, 10, [s32bs(0, 9)]);
    store.getState().click(0);
    expect(store.getState().selection).toEqual([{ start: 0, end: 1 }]);
    store.getState().click(2, { shift: true });
    expect(store.getState().selection).toEqual([{ start: 0, end: 3 }]);
    store.getState().click(0, { ctrl: true });
    expect(store.getState().selection).toEqual([{ start: 2, end: 3 }]);
    store.getState().click(0, { ctrl: true });
    expect(store.getState().selection).toEqual([{ start: 0, end: 3 }]);
    store.getState().selectAll();
    expect(store.getState().selection).toEqual([{ start: 0, end: 9 }]);
  });

  it("a selection made before the formats changed is widened by syncRows (Ctrl+A, Signed 32-bit BADC)", () => {
    config = makeConfig(0, 10);
    store = createPollViewUiStore({ getConfig: () => config });
    store.getState().click(0);
    expect(store.getState().selection).toEqual([{ start: 0, end: 0 }]);
    config = makeConfig(0, 10, { formatOverrides: [s32bs(0, 9)] });
    store.getState().syncRows();
    expect(store.getState().selection).toEqual([{ start: 0, end: 1 }]);
    expect(store.getState().focusAddress).toBe(0);
  });

  it("a handoff with the selection [0] restores as [0-1] with no further call", () => {
    withOverrides(0, 10, [s32bs(0, 9)]);
    const json = JSON.parse(store.getState().toHandoff()) as Record<string, unknown>;
    json.selection = [{ start: 0, end: 0 }];
    json.focusAddress = 1;
    json.anchorAddress = 1;
    expect(store.getState().applyHandoff(JSON.stringify(json))).toBe(true);
    expect(store.getState()).toMatchObject({
      selection: [{ start: 0, end: 1 }],
      focusAddress: 0,
      anchorAddress: 0,
    });
  });

  it("a handoff applied before there is a config keeps its selection until the rows exist", () => {
    config = null;
    store = createPollViewUiStore({ getConfig: () => config });
    const json = {
      version: 1,
      inspectedGroupAddress: null,
      ruleDraft: null,
      setupOpen: false,
      setupOverride: false,
      selection: [{ start: 4, end: 4 }],
      anchorAddress: 4,
      focusAddress: 4,
      topAddress: null,
      columnWidths: { alias: 160, address: 120, format: 96, raw: 160, scaled: 160 },
      pollDraft: null,
      scaleDraft: null,
    };
    expect(store.getState().applyHandoff(JSON.stringify(json))).toBe(true);
    expect(store.getState().selection).toEqual([{ start: 4, end: 4 }]);
  });

  it("invariant: after every action the selection equals its own widening (random actions and format changes)", () => {
    let seed = 987654;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const pick = (): FormatOverride[] => {
      const width = [1, 2, 4][rand(3)] as number;
      const format = width === 1 ? "hex" : width === 2 ? "float32" : "float64";
      const start = rand(8);
      return rand(3) === 0
        ? []
        : [
            {
              start,
              end: start + width * (1 + rand(3)) - 1,
              format,
              swapBytes: false,
              reverseWords: false,
            } as FormatOverride,
          ];
    };
    for (let round = 0; round < 300; round += 1) {
      config = makeConfig(2, 12, { formatOverrides: pick() });
      store = createPollViewUiStore({ getConfig: () => config });
      for (let step = 0; step < 15; step += 1) {
        const address = rand(16);
        const s = store.getState();
        switch (rand(8)) {
          case 0:
            s.click(address, { shift: rand(2) === 1, ctrl: rand(2) === 1 });
            break;
          case 1:
            s.moveFocus(address - 8, { shift: rand(2) === 1 });
            break;
          case 2:
            s.moveFocusTo(address, { shift: rand(2) === 1 });
            break;
          case 3:
            s.selectAll();
            break;
          case 4:
            s.clearSelection();
            break;
          case 5:
            s.setFocusRow(address);
            break;
          case 6:
            config = makeConfig(2, 12, { formatOverrides: pick() });
            s.syncRows();
            break;
          default:
            break;
        }
        expect(whole()).toEqual(store.getState().selection);
      }
    }
  });
});
