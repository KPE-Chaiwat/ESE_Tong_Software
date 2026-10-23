// Accessibility rules of DES-002 9 that jsdom can check (FE-002 task 28): ARIA of the grid, the
// sub-window, the list and the menus; the focus order and the F6 regions; the live regions and the
// rule that every completed action is announced exactly once. Focus rings, real tab order across
// the browser chrome and screen reader output need a real browser (see the part B2b notes).
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { type Harness, renderWindow } from "./test-utils";

let h: Harness;

// These suites drive a whole window from the fake backend: replies of the fake (an attach snapshot,
// a relayed event) reach the stores a few microtasks after the last act() and update mounted
// components. That is how the app behaves, not a missing act() in a test, and one warning per
// update buries a real one. Everything the tests do runs inside act() (RTL turns the flag on for
// the duration of each act), so only those unwrapped replies are left unwarned.
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
beforeAll(() => {
  actEnv.IS_REACT_ACT_ENVIRONMENT = false;
});
afterAll(() => {
  actEnv.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  // Let the replies still on their way land, then dispose inside act: the runtime's stores change
  // while the view is still mounted, and React warns about updates outside act.
  await act(async () => {});
  act(() => {
    h?.rt.dispose();
  });
});

const frame = (id: PollId) =>
  document.querySelector<HTMLElement>(`[data-subwindow="${id}"]`) as HTMLElement;
const bar = (id: PollId) => frame(id).querySelector('[data-slot="title-bar"]') as HTMLElement;
const grid = (id: PollId) => within(frame(id)).getByRole("grid");
const seq = () => h.rt.stores.announcer.getState().polite.seq;
const text = () => h.rt.stores.announcer.getState().polite.text;

async function two() {
  h = await renderWindow();
  const a = await h.addPoll("A");
  const b = await h.addPoll("B");
  await h.connect();
  h.advance(300);
  return { a, b };
}

describe("ARIA (DES-002 9)", () => {
  it("a sub-window is a named region with a role description, and only the active one is current", async () => {
    const { a, b } = await two();
    await h.act(() => h.rt.stores.workspace.getState().activate(a));
    for (const id of [a, b]) {
      const el = frame(id);
      expect(el.tagName).toBe("SECTION");
      expect(el).toHaveAttribute("aria-roledescription", "sub-window");
      // DES-002 2.12: "{poll name}, {pill label}, sub-window" (section 9 leaves out the last part).
      expect(el.getAttribute("aria-label")).toMatch(/^(A|B), Polling, sub-window$/);
    }
    expect(frame(a)).toHaveAttribute("aria-current", "true");
    expect(frame(b)).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("region", { name: "A, Polling, sub-window" })).toBe(frame(a));
  });

  it("the title bar is a focusable toolbar with labelled buttons, and Shift+F10 opens its menu", async () => {
    const { a } = await two();
    expect(bar(a)).toHaveAttribute("role", "toolbar");
    expect(bar(a)).toHaveAttribute("tabindex", "0");
    for (const name of [
      "Poll setup (Ctrl+\\)",
      "Open in its own window (Ctrl+Shift+O)",
      "Minimize",
      "Expand on grid",
      "Close (Ctrl+F4)",
    ]) {
      expect(within(bar(a)).getByRole("button", { name })).toBeVisible();
    }
    bar(a).focus();
    fireEvent.keyDown(bar(a), { key: "F10", shiftKey: true });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Expand on grid" })).toBeVisible();
    expect(within(menu).queryByRole("menuitemcheckbox", { name: /^Snap while moving/ })).toBeNull();
  });

  it("the grid has rowcount, rowindex, selected rows and an active descendant", async () => {
    const { a } = await two();
    const g = grid(a);
    expect(g).toHaveAttribute("aria-label", "Register values");
    expect(g).toHaveAttribute("aria-rowcount", "11");
    expect(g).toHaveAttribute("aria-multiselectable", "true");
    const rows = within(g).getAllByRole("row");
    expect(rows[0]).toHaveAttribute("aria-rowindex", "1");
    expect(rows[1]).toHaveAttribute("aria-rowindex", "2");
    await h.user.click(rows[3] as HTMLElement);
    const selected = within(g)
      .getAllByRole("row")
      .filter((r) => r.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(g.getAttribute("aria-activedescendant")).toBe(selected[0]?.id);
    expect(within(g).getAllByRole("columnheader").length).toBe(4);
  });

  it("the poll list has separate Show targets, checkboxes and menu buttons", async () => {
    await two();
    const list = screen.getByRole("list", { name: "Polls" });
    const options = Array.from(list.querySelectorAll<HTMLElement>("[data-poll-show]"));
    expect(options).toHaveLength(2);
    expect(options[0]?.getAttribute("aria-label")).toMatch(/^A, Polling, in workspace$/);
    expect(options.filter((o) => o.getAttribute("aria-current") === "true")).toHaveLength(1);
    // Each Show target has a tab stop, alongside its checkbox and actions.
    expect(options.filter((o) => o.getAttribute("tabindex") === "0")).toHaveLength(2);
  });

  it("a menu has menu roles, and its button says it has a popup", async () => {
    await two();
    const button = screen.getByRole("button", { name: "Window" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    await h.user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Window" });
    expect(within(menu).getByRole("menuitem", { name: /^Reset grid layout/ })).toBeVisible();
    expect(within(menu).queryByRole("menuitemcheckbox", { name: /^Tile mode/ })).toBeNull();
  });

  it("the live regions are a polite status and an assertive alert", async () => {
    await two();
    expect(screen.getByTestId("live-polite")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("live-polite")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("live-assertive")).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("live-assertive")).toHaveAttribute("aria-live", "assertive");
  });

  it("dialogs are modal with a name, and the focus returns to the control that opened them", async () => {
    const { a } = await two();
    const gear = within(bar(a)).getByRole("button", { name: "Close (Ctrl+F4)" });
    gear.focus();
    await h.user.click(gear);
    const dialog = await screen.findByRole("alertdialog", { name: "Close poll window?" });
    expect(within(dialog).getByRole("button", { name: "Keep poll" })).toHaveFocus();
    await h.user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(gear).toHaveFocus();
  });

  it("status is never color only: every poll state chip has text and an icon", async () => {
    const { a } = await two();
    const chip = within(frame(a)).getByText("Polling");
    expect(
      chip.closest("[data-slot]")?.querySelector("[data-icon]") ??
        chip.parentElement?.querySelector("[data-icon]"),
    ).not.toBeNull();
    await h.act(() => h.ipc.emitPollState(a, "timeout", { consecutiveFailures: 1 }));
    expect(within(frame(a)).getByText("Timeout")).toBeVisible();
    expect(frame(a).querySelector('[data-icon="timer-off"]')).not.toBeNull();
  });
});

describe("focus order (DES-002 9)", () => {
  it("W1 regions follow toolbar, sidebar, workspace, traffic in the DOM", async () => {
    await two();
    const names = ["toolbar", "sidebar", "workspace", "traffic"];
    const els = names.map((n) => document.querySelector(`[data-region="${n}"]`) as HTMLElement);
    for (const el of els) expect(el).not.toBeNull();
    for (let i = 1; i < els.length; i += 1) {
      const before = els[i - 1] as HTMLElement;
      const after = els[i] as HTMLElement;
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  // user-event looks through the whole document on every Tab: a full window is slow in jsdom, so the
  // loop stops as soon as the order is proven and the limit is explicit.
  it("Tab visits the regions in that order", { timeout: 60_000 }, async () => {
    await two();
    (document.activeElement as HTMLElement | null)?.blur();
    const seen: string[] = [];
    for (let i = 0; i < 80 && seen.length < 4; i += 1) {
      await h.user.tab();
      const region = document.activeElement?.closest("[data-region]")?.getAttribute("data-region");
      if (region === "polls") continue; // the list inside the sidebar
      if (region && seen.at(-1) !== region) seen.push(region);
    }
    expect(seen.slice(0, 4)).toEqual(["toolbar", "sidebar", "workspace", "traffic"]);
  });

  it("inside a sub-window: title bar, then its buttons, then the status line, then the grid", async () => {
    const { a } = await two();
    const titleBar = bar(a);
    const buttons = within(titleBar).getAllByRole("button");
    const statusLine = within(frame(a)).getByRole("button", { name: "Poll actions" });
    const g = grid(a);
    const chain = [titleBar, ...buttons, statusLine, g];
    for (let i = 1; i < chain.length; i += 1) {
      const prev = chain[i - 1] as HTMLElement;
      const next = chain[i] as HTMLElement;
      expect(prev.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("F6 and Shift+F6 cycle the regions and wrap", async () => {
    await two();
    (
      screen.getByRole("toolbar", { name: "Toolbar" }).querySelector("button") as HTMLElement
    ).focus();
    const region = () =>
      document.activeElement
        ?.closest(
          '[data-region="toolbar"],[data-region="sidebar"],[data-region="workspace"],[data-region="minimized"],[data-region="traffic"]',
        )
        ?.getAttribute("data-region");
    const f6 = (shift = false) =>
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "F6", shiftKey: shift });
    const seen = [region()];
    for (let i = 0; i < 4; i += 1) {
      f6();
      seen.push(region());
    }
    expect(seen).toEqual(["toolbar", "sidebar", "workspace", "traffic", "toolbar"]);
    f6(true);
    expect(region()).toBe("traffic");
  });

  it("the minimized bar joins the cycle only while a window is minimized", async () => {
    const { a } = await two();
    await h.act(() => h.rt.stores.workspace.getState().minimize(a));
    expect(document.querySelector('[data-region="minimized"]')).not.toBeNull();
    (document.querySelector('[data-region="workspace"] [role="grid"]') as HTMLElement).focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "F6" });
    expect(document.activeElement?.closest("[data-region]")?.getAttribute("data-region")).toBe(
      "minimized",
    );
  });
});

describe("every completed action is announced exactly once (DES-002 2.10.8)", () => {
  it("announces keyboard grid movement and resizing", async () => {
    const { a } = await two();
    bar(a).focus();
    let before = seq();
    fireEvent.keyDown(bar(a), { key: "ArrowRight", altKey: true });
    expect(seq() - before).toBe(1);
    expect(text()).toBe("A moved.");

    before = seq();
    fireEvent.keyDown(bar(a), { key: "ArrowDown", altKey: true, ctrlKey: true });
    expect(seq() - before).toBe(1);
    expect(text()).toBe("A resized on grid.");
  });

  it("tile slot, list reorder, pop out and dock", async () => {
    const { a, b } = await two();
    await h.act(() => h.rt.stores.workspace.getState().tile());
    let before = seq();
    await h.act(() => h.rt.stores.drag.getState().moveToSlot(a, 1));
    expect(seq() - before).toBe(1);
    expect(text()).toBe("A moved to slot 2 of 2.");

    before = seq();
    await h.act(() => h.rt.actions.movePoll(a, "up"));
    expect(seq() - before).toBe(1);
    expect(text()).toBe("A moved to position 1 of 2.");

    before = seq();
    await h.act(() => h.rt.actions.popOutPoll(b));
    expect(seq() - before).toBe(1);
    expect(text()).toBe("B opened in its own window.");

    before = seq();
    await h.act(() => h.rt.actions.dockPoll(b));
    expect(seq() - before).toBe(1);
    expect(text()).toBe("B docked in the workspace.");
  });

  it("poll failures: one message for a burst, one per single failure, none for a recovery", async () => {
    const { a, b } = await two();
    const ids = [a, b];
    for (const n of ["C", "D", "E"]) ids.push(await h.addPoll(n));
    await h.act(async () => {
      for (const id of ids.slice(0, 4))
        h.ipc.emitPollState(id, "timeout", { consecutiveFailures: 1 });
    });
    await waitFor(() => expect(text()).toBe("4 polls are failing."));
    const before = seq();
    await h.act(() => h.ipc.emitPollState(ids[0] as PollId, "polling"));
    expect(seq()).toBe(before);
  });
});
