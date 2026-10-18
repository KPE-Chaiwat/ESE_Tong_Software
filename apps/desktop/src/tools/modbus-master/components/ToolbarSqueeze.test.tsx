// The W1 toolbar must never clip a control (REPORT-008 D12). jsdom has no layout: this checks the
// structure and the classes of the shrink rule at 960, 1000, 1100 and 1300 css px with a long
// connection text and a long chip. The pixels (scrollWidth <= clientWidth, every right edge inside
// the window at 960 css px) are measured in a real window by QA.
import { screen, within } from "@testing-library/react";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow } from "./test-utils";

let h: Harness;
afterEach(() => {
  h?.rt.dispose();
  window.innerWidth = 1280;
});

const toolbar = () => screen.getByRole("toolbar", { name: "Toolbar" });
const LONG_HOST = "plc-line-7.boiler-house.example.net"; // 35 chars, 39 with ":502"
const FULL_CHIP = "1 exception · 1 bad response · 1 timeout · 2 live · 1 paused";
const hasClass = (el: Element, cls: string) => el.className.split(/\s+/).includes(cls);

async function longToolbar(width: number) {
  h = await renderWindow();
  const ids: PollId[] = [];
  for (let i = 1; i <= 6; i += 1) ids.push(await h.addPoll(`Poll ${i}`));
  await h.act(async () => {
    window.innerWidth = width;
    window.dispatchEvent(new Event("resize"));
  });
  await h.act(() =>
    h.rt.stores.connection
      .getState()
      .connect({ mode: "tcp", host: LONG_HOST, port: 502, timeoutMs: 1000 }),
  );
  h.advance(300);
  // A long chip: exception, bad response, timeout, paused and live at once.
  await h.act(() => h.ipc.emitPollState(ids[0] as PollId, "exception", {}));
  await h.act(() => h.ipc.emitPollState(ids[1] as PollId, "badResponse", {}));
  await h.act(() => h.ipc.emitPollState(ids[2] as PollId, "timeout", { consecutiveFailures: 1 }));
  await h.act(() => h.ipc.emitPollState(ids[3] as PollId, "paused", {}));
}

const pill = () => toolbar().querySelector<HTMLElement>('[data-slot="status-pill"]') as HTMLElement;
const chip = () => screen.getByTestId("summary-chip");
const actionGroup = () =>
  screen.getByRole("button", { name: "Disconnect" }).parentElement as HTMLElement;
const weight = (el: Element) => {
  const m = /(?:^|\s)shrink(?:-\[(\d+)\])?(?:\s|$)/.exec(el.className);
  return m ? Number(m[1] ?? 1) : 0;
};

describe.each([960, 1000, 1100, 1300])(
  "the W1 toolbar at %s css px with a long connection and chip",
  (width) => {
    it("is one row of fixed height 56 px that does not wrap", async () => {
      await longToolbar(width);
      expect(hasClass(toolbar(), "h-14")).toBe(true);
      expect(toolbar().className).not.toContain("wrap");
    });

    it("the connection pill is cut with an ellipsis and keeps the full text in its title", async () => {
      await longToolbar(width);
      const p = pill();
      expect(p).toHaveAttribute("title", `Connected · ${LONG_HOST}:502`);
      expect(p).toHaveTextContent(`Connected · ${LONG_HOST}:502`);
      expect(hasClass(p, "min-w-0")).toBe(true);
      const text = p.querySelector("span") as HTMLElement;
      expect(hasClass(text, "truncate")).toBe(true);
      expect(hasClass(text, "min-w-0")).toBe(true);
      expect(p.querySelector("svg")?.getAttribute("class")).toContain("shrink-0");
    });

    it("the chip text is cut; its title and its accessible name hold the full text", async () => {
      await longToolbar(width);
      const wrap = chip();
      expect(wrap).toHaveAttribute("title", FULL_CHIP);
      expect(wrap.querySelector(".sr-only")).toHaveTextContent(FULL_CHIP);
      expect(hasClass(wrap, "min-w-0")).toBe(true);
      const visible = wrap.querySelector('[aria-hidden="true"]:not(svg)') as HTMLElement;
      expect(hasClass(visible, "truncate")).toBe(true);
      expect(visible).toHaveTextContent(width < 1100 ? "1 exception +5" : FULL_CHIP);
    });

    it("the menus, New poll and the action buttons never shrink", async () => {
      await longToolbar(width);
      for (const name of ["File", "Connection", "New poll", "Window"]) {
        expect(hasClass(within(toolbar()).getByRole("button", { name }), "shrink-0"), name).toBe(
          true,
        );
      }
      for (const name of ["Pause all", "Disconnect"]) {
        const b = within(toolbar()).getByRole("button", { name });
        expect(hasClass(b, "shrink-0"), name).toBe(true);
        expect(hasClass(b, "whitespace-nowrap"), name).toBe(true);
      }
      expect(hasClass(actionGroup(), "shrink-0")).toBe(true);
    });

    it("the squeeze order is profile, then chip, then pill (weights), then the gaps", async () => {
      await longToolbar(width);
      const profile = screen.queryByTestId("profile");
      if (width < 1100) {
        expect(profile).toBeNull();
      } else {
        expect(profile).not.toBeNull();
        expect(weight(profile as HTMLElement)).toBeGreaterThan(weight(chip()));
        expect(hasClass(profile as HTMLElement, "min-w-0")).toBe(true);
      }
      expect(weight(chip())).toBeGreaterThan(weight(pill()));
      expect(weight(pill())).toBeGreaterThan(0);
      expect(weight(actionGroup())).toBe(0);
      expect(hasClass(toolbar(), width < 1100 ? "gap-1.5" : "gap-2")).toBe(true);
    });
  },
);

describe("the profile label at 1300 css px", () => {
  it("is cut with an ellipsis and keeps its full name in the title", async () => {
    await longToolbar(1300);
    const name = screen.getByTestId("profile").firstElementChild as HTMLElement;
    expect(hasClass(name, "truncate")).toBe(true);
    expect(name).toHaveAttribute("title", "Untitled");
  });
});
