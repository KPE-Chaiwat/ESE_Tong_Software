// CHK2-F1/F2 (REPORT-003): the first visible address of a handoff survives the focus that comes with it.
// jsdom has no scrolling: `scrollTo` writes `scrollTop`, and the viewport is 600 px high (vitest.setup).
import { act, screen } from "@testing-library/react";
import { type PollViewHandoffV1, serializeHandoff } from "../../lib/handoff";
import {
  disposeHarnesses,
  installPollViewEnvironment,
  type PollViewHarness,
  renderPollView,
  uninstallPollViewEnvironment,
} from "./test-utils";

const ROW = 24;
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
const VIEWPORT = 600;
const layoutProps = ["clientHeight", "scrollHeight"] as const;
const originalLayout = layoutProps.map(
  (p) => [p, Object.getOwnPropertyDescriptor(Element.prototype, p)] as const,
);

beforeAll(() => {
  installPollViewEnvironment();
  // The harness runs animation frames at once; the virtualizer's reconcile loop re-arms itself in
  // every frame and would never end. Frames are dropped here: the writes that matter are synchronous.
  globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
  // The virtualizer clamps a scroll to `scrollHeight - clientHeight`, which jsdom reports as 0.
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get(this: Element) {
      return this.hasAttribute("data-virtual-viewport") ? VIEWPORT : 0;
    },
  });
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get(this: Element) {
      return this.hasAttribute("data-virtual-viewport")
        ? Number(this.getAttribute("aria-rowcount")) * ROW
        : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    writable: true,
    value(this: HTMLElement, options?: ScrollToOptions | number) {
      if (typeof options === "object" && options.top !== undefined) this.scrollTop = options.top;
    },
  });
});
afterAll(() => {
  uninstallPollViewEnvironment();
  for (const [prop, descriptor] of originalLayout) {
    if (descriptor) Object.defineProperty(Element.prototype, prop, descriptor);
  }
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});
afterEach(disposeHarnesses);

function handoff(patch: Partial<PollViewHandoffV1>): string {
  return serializeHandoff({
    version: 1,
    setupOpen: false,
    setupOverride: false,
    selection: [],
    anchorAddress: null,
    focusAddress: null,
    topAddress: null,
    columnWidths: { alias: 160, address: 90, raw: 120, scaled: 140 },
    pollDraft: null,
    scaleDraft: null,
    ...patch,
  });
}

async function arrive(host: "workspace" | "native", json: string): Promise<PollViewHarness> {
  const h = await renderPollView({
    host,
    holdAttach: true,
    connect: true,
    handoff: json,
    poll: {
      name: "Tank 1",
      definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 100, scanRateMs: 100 },
    },
  });
  await h.release();
  return h;
}

const grid = () => screen.getByRole("grid", { name: "Register values" });

describe.each(["workspace", "native"] as const)(
  "scroll restore after a host change (%s)",
  (host) => {
    it("selection only: the top address is the first visible row", async () => {
      await arrive(
        host,
        handoff({ topAddress: 2, selection: [{ start: 3, end: 5 }], anchorAddress: 3 }),
      );
      expect(grid().scrollTop).toBe(2 * ROW);
    });

    it("with a focused row inside the restored viewport the top address still wins", async () => {
      await arrive(
        host,
        handoff({
          topAddress: 2,
          selection: [{ start: 3, end: 5 }],
          anchorAddress: 3,
          focusAddress: 5,
        }),
      );
      expect(grid().scrollTop).toBe(2 * ROW);
    });

    it("focus only, no selection: the top address wins as well", async () => {
      await arrive(host, handoff({ topAddress: 2, anchorAddress: 5, focusAddress: 5 }));
      expect(grid().scrollTop).toBe(2 * ROW);
    });

    it("a focused row far below the restored viewport does not undo the restore", async () => {
      await arrive(host, handoff({ topAddress: 2, anchorAddress: 80, focusAddress: 80 }));
      expect(grid().scrollTop).toBe(2 * ROW);
    });

    it("moving the focus afterwards still scrolls it into view", async () => {
      const h = await arrive(
        host,
        handoff({
          topAddress: 2,
          anchorAddress: 5,
          focusAddress: 5,
          selection: [{ start: 5, end: 5 }],
        }),
      );
      expect(grid().scrollTop).toBe(2 * ROW);
      act(() => h.rt.stores.ui.getState().moveFocusTo(90, { shift: false }));
      expect(grid().scrollTop).toBeGreaterThan(2 * ROW);
    });

    it("without a handoff the grid starts at the top", async () => {
      await arrive(host, handoff({}));
      expect(grid().scrollTop).toBe(0);
    });
  },
);
