import { createTableSelectionStore, type SelectionStoreApi } from "./table-selection.store";

let store: SelectionStoreApi;
const get = () => store.getState();

beforeEach(() => {
  store = createTableSelectionStore();
  get().setRowCount(10);
});

describe("initial state", () => {
  it("has no selection", () => {
    const fresh = createTableSelectionStore().getState();
    expect(fresh.anchor).toBeNull();
    expect(fresh.focused).toBeNull();
    expect(fresh.selectedRows()).toEqual([]);
  });
});

describe("click", () => {
  it("selects a single row and sets the anchor and focus", () => {
    get().click(3);
    expect(get().selectedRows()).toEqual([3]);
    expect(get()).toMatchObject({ anchor: 3, focused: 3 });
    get().click(5);
    expect(get().selectedRows()).toEqual([5]);
  });

  it("shift-click selects the range from the anchor in both directions", () => {
    get().click(3);
    get().click(6, { shift: true });
    expect(get().selectedRows()).toEqual([3, 4, 5, 6]);
    expect(get().anchor).toBe(3);
    get().click(1, { shift: true });
    expect(get().selectedRows()).toEqual([1, 2, 3]);
    expect(get().focused).toBe(1);
  });

  it("shift-click without an anchor selects just that row", () => {
    get().click(4, { shift: true });
    expect(get().selectedRows()).toEqual([4]);
  });

  it("ctrl-click toggles rows and moves the anchor", () => {
    get().click(1);
    get().click(4, { ctrl: true });
    get().click(6, { ctrl: true });
    expect(get().selectedRows()).toEqual([1, 4, 6]);
    get().click(4, { ctrl: true });
    expect(get().selectedRows()).toEqual([1, 6]);
    expect(get().anchor).toBe(4);
  });

  it("ignores clicks outside the rows", () => {
    get().click(-1);
    get().click(10);
    expect(get().selectedRows()).toEqual([]);
  });
});

describe("move", () => {
  it("starts from the first row on Down and the last row on Up when nothing is focused", () => {
    get().move(1);
    expect(get().focused).toBe(0);
    store = createTableSelectionStore();
    get().setRowCount(10);
    get().move(-1);
    expect(get().focused).toBe(9);
  });

  it("moves and selects a single row", () => {
    get().click(3);
    get().move(1);
    expect(get().selectedRows()).toEqual([4]);
    get().move(-2);
    expect(get().selectedRows()).toEqual([2]);
  });

  it("clamps at 0 and count - 1", () => {
    get().click(1);
    get().move(-5);
    expect(get().focused).toBe(0);
    get().move(100);
    expect(get().focused).toBe(9);
    get().move(1);
    expect(get().focused).toBe(9);
  });

  it("shift extends the selection from the anchor", () => {
    get().click(3);
    get().move(2, { shift: true });
    expect(get().selectedRows()).toEqual([3, 4, 5]);
    get().move(-3, { shift: true });
    expect(get().selectedRows()).toEqual([2, 3]);
    expect(get().anchor).toBe(3);
  });

  it("does nothing without rows", () => {
    get().setRowCount(0);
    get().move(1);
    get().moveTo(0);
    expect(get().focused).toBeNull();
  });

  it("moveTo handles Home and End, with shift extending", () => {
    get().click(4);
    get().moveTo(0);
    expect(get().selectedRows()).toEqual([0]);
    get().moveTo(999, { shift: true });
    expect(get().selectedRows()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("selectAll and clear", () => {
  it("selects every row", () => {
    get().selectAll(4);
    expect(get().selectedRows()).toEqual([0, 1, 2, 3]);
    expect(get().rowCount).toBe(4);
  });

  it("uses the known row count by default and ignores an empty table", () => {
    get().selectAll();
    expect(get().selectedRows()).toHaveLength(10);
    get().setRowCount(0);
    get().clear();
    get().selectAll();
    expect(get().selectedRows()).toEqual([]);
  });

  it("clear drops selection, anchor and focus", () => {
    get().click(2);
    get().clear();
    expect(get()).toMatchObject({ anchor: null, focused: null });
    expect(get().selectedRows()).toEqual([]);
  });
});

describe("setRowCount", () => {
  it("drops selected rows that no longer exist", () => {
    get().selectAll();
    get().click(8, { ctrl: true });
    get().setRowCount(5);
    expect(get().selectedRows()).toEqual([0, 1, 2, 3, 4]);
    get().click(4);
    get().setRowCount(3);
    expect(get().selectedRows()).toEqual([]);
    expect(get().focused).toBeNull();
    expect(get().anchor).toBeNull();
  });

  it("keeps the same selection set when nothing is dropped", () => {
    get().click(2);
    const before = get().selected;
    get().setRowCount(20);
    expect(get().selected).toBe(before);
  });
});
