import { screen } from "@testing-library/react";
import { sessionReason } from "@/shared/ipc/modbus-master.fake";
import { type Harness, renderWindow, TCP } from "./test-utils";

let h: Harness;

afterEach(() => {
  h?.rt.dispose();
});

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Regions in the tab order required by DES-001 7. */
const REGIONS: [string, (el: Element) => boolean][] = [
  ["toolbar", (el) => el.closest('[role="toolbar"]') !== null],
  ["banner", (el) => el.closest("[data-slot=state-banner]") !== null],
  ["setup", (el) => el.closest("aside[aria-label=Setup]") !== null],
  ["data", (el) => el.closest("section[aria-label=Data]") !== null],
  ["splitter", (el) => el.matches("[data-testid=splitter]")],
  ["traffic", (el) => el.closest('section[aria-label="Communication Traffic"]') !== null],
];

function regionOf(el: Element): number {
  return REGIONS.findIndex(([, test]) => test(el));
}

describe("accessibility (DES-001 7)", () => {
  it("the tab order is toolbar, banner, setup panel, data card, splitter, traffic", async () => {
    h = await renderWindow({
      prepare: ({ rt, ipc }) => {
        rt.stores.config.getState().setConnection(TCP);
        ipc.emitFrames([]);
      },
    });
    h.state("connecting");
    h.state("connected");
    h.state("polling");
    h.emit(() => h.ipc.emitPollUpdate({ values: Array.from({ length: 10 }, (_, i) => i) }));
    h.emit(() =>
      h.ipc.emitFrames([
        {
          seq: 1,
          at: 0,
          direction: "tx",
          bytes: [1, 2, 3],
          slaveId: 1,
          function: 3,
          exceptionCode: null,
          note: null,
        },
      ]),
    );
    h.state("disconnected", { reason: sessionReason("closedByPeer", "x") });

    const focusable = [...document.querySelectorAll(FOCUSABLE)].filter(
      (el) => !el.closest("[hidden]"),
    );
    const sequence = focusable.map(regionOf);
    expect(
      sequence.every((r) => r >= 0),
      "every focusable element belongs to a region",
    ).toBe(true);
    expect(sequence).toEqual([...sequence].sort((a, b) => a - b));
    // All the regions are present in this state.
    for (const region of [0, 1, 2, 3, 4, 5]) expect(sequence).toContain(region);
    expect(screen.getByRole("contentinfo").querySelector(FOCUSABLE)).toBeNull();
  });

  it("no element uses a positive tabindex", async () => {
    h = await renderWindow();
    expect(
      document.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])'),
    ).toHaveLength(0);
  });

  it("icon-only controls have an accessible name", async () => {
    h = await renderWindow();
    for (const el of document.querySelectorAll("button:not([hidden])")) {
      const name = el.getAttribute("aria-label") || el.textContent?.trim();
      expect(name, el.outerHTML.slice(0, 80)).toBeTruthy();
    }
  });

  it("the grids are labelled and expose their size", async () => {
    h = await renderWindow();
    h.state("connecting");
    h.state("connected");
    h.state("polling");
    expect(screen.getByRole("grid", { name: "Register values" })).toHaveAttribute("aria-rowcount");
    expect(screen.getByRole("grid", { name: "Frames" })).toHaveAttribute("aria-rowcount", "1");
  });

  it("target sizes: toolbar buttons are at least 24px tall", async () => {
    h = await renderWindow();
    // Buttons use h-8 (32px) and the traffic panel buttons h-6 (24px).
    for (const el of document.querySelectorAll("button:not([hidden])")) {
      expect(el.className).toMatch(/\bh-(6|7|8|10|12)\b|\bsize-(6|7|10)\b|\bh-\[/);
    }
  });
});
