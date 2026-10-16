import { createLayoutStore, type LayoutStoreApi } from "./layout.store";

let store: LayoutStoreApi;
const get = () => store.getState();

beforeEach(() => {
  store = createLayoutStore();
});

describe("initial state", () => {
  it("opens the setup panel and the traffic panel at 35%", () => {
    expect(get()).toMatchObject({
      setupOpen: true,
      trafficCollapsed: false,
      trafficHeightPct: 35,
      columnWidths: {},
      modalOpen: false,
    });
  });
});

describe("toggles", () => {
  it("toggles the setup panel", () => {
    get().toggleSetup();
    expect(get().setupOpen).toBe(false);
    get().toggleSetup();
    expect(get().setupOpen).toBe(true);
  });

  it("toggles the traffic panel", () => {
    get().toggleTraffic();
    expect(get().trafficCollapsed).toBe(true);
    get().toggleTraffic();
    expect(get().trafficCollapsed).toBe(false);
  });
});

describe("traffic height clamping (viewport 800px)", () => {
  it("clamps 119px up to the 120px minimum", () => {
    get().setTrafficHeightPx(119);
    expect(get().trafficHeightPct).toBeCloseTo(15, 5);
    get().setTrafficHeightPx(120);
    expect(get().trafficHeightPct).toBeCloseTo(15, 5);
  });

  it("clamps 71% down to 70%", () => {
    get().setTrafficHeight(71);
    expect(get().trafficHeightPct).toBe(70);
    get().setTrafficHeight(70);
    expect(get().trafficHeightPct).toBe(70);
  });

  it("keeps values inside the range", () => {
    get().setTrafficHeight(50);
    expect(get().trafficHeightPct).toBe(50);
  });

  it("reset gives 35", () => {
    get().setTrafficHeight(60);
    get().resetTrafficHeight();
    expect(get().trafficHeightPct).toBe(35);
  });

  it("nudges by 16px steps and stops at the limits", () => {
    get().nudgeTrafficHeight(16);
    expect(get().trafficHeightPct).toBeCloseTo(37, 5);
    get().nudgeTrafficHeight(-16);
    expect(get().trafficHeightPct).toBeCloseTo(35, 5);
    for (let i = 0; i < 100; i += 1) get().nudgeTrafficHeight(16);
    expect(get().trafficHeightPct).toBe(70);
    for (let i = 0; i < 100; i += 1) get().nudgeTrafficHeight(-16);
    expect(get().trafficHeightPct).toBeCloseTo(15, 5);
  });

  it("re-applies the 120px minimum when the window gets smaller", () => {
    get().setTrafficHeight(16);
    get().setViewportHeight(600);
    expect(get().viewportHeight).toBe(600);
    expect(get().trafficHeightPct).toBeCloseTo(20, 5);
  });
});

describe("column widths", () => {
  it.each([
    ["data.address", 72],
    ["data.value", 96],
    ["traffic.time", 104],
    ["traffic.dir", 56],
    ["traffic.len", 40],
    ["traffic.bytes", 160],
    ["traffic.info", 120],
  ])("applies the minimum of %s (%ipx)", (id, min) => {
    get().setColumnWidth(id, 1);
    expect(get().columnWidths[id]).toBe(min);
    get().setColumnWidth(id, min + 50);
    expect(get().columnWidths[id]).toBe(min + 50);
  });

  it("keeps other columns when one changes", () => {
    get().setColumnWidth("data.address", 100);
    get().setColumnWidth("data.value", 200);
    expect(get().columnWidths).toEqual({ "data.address": 100, "data.value": 200 });
  });
});

describe("modal tracking (one lock per modal)", () => {
  it("is open while any modal holds a lock", () => {
    const first = get().lockModal();
    expect(get().modalOpen).toBe(true);
    const second = get().lockModal();
    second();
    expect(get().modalOpen).toBe(true);
    expect(get().modalCount).toBe(1);
    first();
    expect(get().modalOpen).toBe(false);
    expect(get().modalCount).toBe(0);
  });

  it("a nested modal closing does not unlock the shortcuts under the outer one (REV-002 m3)", () => {
    const dialog = get().lockModal();
    const confirm = get().lockModal();
    confirm();
    expect(get().modalOpen).toBe(true);
    dialog();
    expect(get().modalOpen).toBe(false);
  });

  it("releasing the same lock twice never frees another modal's lock", () => {
    const a = get().lockModal();
    const b = get().lockModal();
    a();
    a();
    expect(get().modalOpen).toBe(true);
    expect(get().modalCount).toBe(1);
    b();
    expect(get().modalOpen).toBe(false);
  });
});
