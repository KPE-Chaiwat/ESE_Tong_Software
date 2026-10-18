import type { MonitorInfo, WindowPlacement } from "@/shared/ipc/modbus-master.types";
import { cascadePlacement, intersection, restorePlacement } from "./placement";

const monitor = (id: string, x: number): MonitorInfo => ({
  id,
  label: `Display ${id}`,
  name: `\\\\.\\DISPLAY${id}`,
  primary: id === "1",
  workArea: { x, y: 0, width: 1920, height: 1032 },
  scaleFactor: 1,
});
const monitors = [monitor("1", 0), monitor("2", 1920)];
const fallback: WindowPlacement = {
  x: 24,
  y: 24,
  width: 900,
  height: 640,
  maximized: false,
  monitor: "1",
};
const saved = (patch: Partial<WindowPlacement> = {}): WindowPlacement => ({
  x: 2000,
  y: 100,
  width: 900,
  height: 640,
  maximized: false,
  monitor: "2",
  ...patch,
});

describe("intersection", () => {
  it("returns the overlap or null", () => {
    expect(
      intersection(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 50, y: 50, width: 100, height: 100 },
      ),
    ).toEqual({
      x: 50,
      y: 50,
      width: 50,
      height: 50,
    });
    expect(
      intersection({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }),
    ).toBeNull();
  });
});

describe("restorePlacement (DES-002 2.13)", () => {
  it("uses the saved placement when its monitor exists and it is visible", () => {
    const out = restorePlacement(saved(), monitors, fallback);
    expect(out.restored).toBe(true);
    expect(out.placement).toEqual(saved());
  });

  it("matches the monitor by name as well as by id", () => {
    const out = restorePlacement(saved({ monitor: "\\\\.\\DISPLAY2" }), monitors, fallback);
    expect(out.restored).toBe(true);
  });

  it("falls back when the saved monitor is gone", () => {
    const out = restorePlacement(saved({ monitor: "3" }), monitors, fallback);
    expect(out).toEqual({ placement: fallback, restored: false });
  });

  it("falls back when less than 100 x 60 px is visible", () => {
    // Overlap with monitor 2's work area (x 1920..3840): 1920 + 90 = 2010 visible width ... place it so only 99 px show.
    const narrow = saved({ x: 3840 - 99 });
    expect(restorePlacement(narrow, monitors, fallback).restored).toBe(false);
    const short = saved({ y: 1032 - 59 });
    expect(restorePlacement(short, monitors, fallback).restored).toBe(false);
  });

  it("accepts exactly 100 x 60 visible", () => {
    expect(
      restorePlacement(saved({ x: 3840 - 100, y: 1032 - 60 }), monitors, fallback).restored,
    ).toBe(true);
  });

  it("falls back for no saved placement", () => {
    expect(restorePlacement(null, monitors, fallback)).toEqual({
      placement: fallback,
      restored: false,
    });
  });

  it("keeps maximized", () => {
    const out = restorePlacement(saved({ maximized: true }), monitors, fallback);
    expect(out.placement.maximized).toBe(true);
  });
});

describe("cascadePlacement", () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1032 };
  const anchor = { x: 100, y: 100, width: 1280, height: 800 };

  it("steps 24 px from the connection window's top-left", () => {
    expect(cascadePlacement(anchor, 0, { width: 900, height: 640 }, workArea, "1")).toMatchObject({
      x: 100,
      y: 100,
    });
    expect(cascadePlacement(anchor, 2, { width: 900, height: 640 }, workArea, "1")).toMatchObject({
      x: 148,
      y: 148,
    });
  });

  it("wraps to the work area top-left + 24 px when it would leave the work area", () => {
    const out = cascadePlacement(anchor, 40, { width: 900, height: 640 }, workArea, "1");
    expect(out.x).toBeGreaterThanOrEqual(24);
    expect(out.x).toBeLessThan(workArea.width);
    expect(out.y).toBeLessThan(workArea.height);
    expect(out.monitor).toBe("1");
    expect(out.maximized).toBe(false);
  });
});
