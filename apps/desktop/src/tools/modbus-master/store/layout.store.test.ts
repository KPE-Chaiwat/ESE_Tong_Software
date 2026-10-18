import { clampColumnWidth } from "./layout.logic";
import { createLayoutStore } from "./layout.store";

describe("layout logic", () => {
  it("keeps the DES-001 5.3 minimum widths and a 24 px floor for unknown columns", () => {
    expect(clampColumnWidth("traffic.time", 10)).toBe(104);
    expect(clampColumnWidth("traffic.poll", 10)).toBe(80);
    expect(clampColumnWidth("traffic.unknown", 1)).toBe(24);
    expect(clampColumnWidth("traffic.bytes", 400)).toBe(400);
  });
});

describe("layoutStore", () => {
  it("clamps a column width", () => {
    const s = createLayoutStore();
    s.getState().setColumnWidth("traffic.len", 5);
    expect(s.getState().columnWidths["traffic.len"]).toBe(40);
  });

  it("every modal has its own lock (REV-002 m3)", () => {
    const s = createLayoutStore();
    const first = s.getState().lockModal();
    const second = s.getState().lockModal();
    expect(s.getState()).toMatchObject({ modalOpen: true, modalCount: 2 });
    first();
    first();
    expect(s.getState()).toMatchObject({ modalOpen: true, modalCount: 1 });
    second();
    expect(s.getState()).toMatchObject({ modalOpen: false, modalCount: 0 });
  });

  it("the sidebar peek is local state", () => {
    const s = createLayoutStore();
    expect(s.getState().sidebarPeek).toBe(false);
    s.getState().setSidebarPeek(true);
    expect(s.getState().sidebarPeek).toBe(true);
  });
});
