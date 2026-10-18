// CHK2-E12 (REPORT-004): a sub-window decides dock or popover on the real width of its FRAME
// element (borders included), so the default 640 x 368 sub-window shows the dock and an inactive
// 639 px frame (1 px border in Chromium, 637 px body) never flips to the dock when it turns inactive.
import { act, screen, within } from "@testing-library/react";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import {
  fireFrameWidth,
  installPollViewEnvironment,
  uninstallPollViewEnvironment,
} from "../poll-view/test-utils";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;

beforeAll(installPollViewEnvironment);
afterAll(uninstallPollViewEnvironment);
afterEach(() => h?.rt.dispose());

const frame = (id: PollId) =>
  document.querySelector<HTMLElement>(`[data-subwindow="${id}"]`) as HTMLElement;

/** Reports `width` as the measured body of every poll view (what ResizeObserver does in a browser). */
function measureBodies(width: number) {
  const Ctor = globalThis.ResizeObserver as unknown as {
    all: Set<{ fire(width: number): void }>;
  };
  act(() => {
    for (const ro of Ctor.all) ro.fire(width);
  });
}

/** What a browser reports for the frames: the real frame width and the narrower body of each view. */
function measure(frameWidth: number, bodyWidth: number) {
  act(() => fireFrameWidth(frameWidth));
  measureBodies(bodyWidth);
}

async function openSetup(id: PollId) {
  await h.act(() => h.rt.views.get(id).stores.ui.getState().setSetupOpen(true));
}

const dockOf = (id: PollId) =>
  within(frame(id)).queryByRole("complementary", { name: "Poll setup" });
const popoverOf = (id: PollId) => within(frame(id)).queryByRole("dialog", { name: "Poll setup" });

describe("setup presentation of a sub-window (frame width)", () => {
  it("the default sub-window is 640 px wide with a 636 px body and shows the 300 px dock", async () => {
    h = await renderWindow();
    const id = await h.addPoll("A");
    expect(frame(id).style.width).toBe("640px");
    expect(frame(id).className).toContain("border-2");
    await openSetup(id);
    measure(640, 636);
    const dock = within(frame(id)).getByRole("complementary", { name: "Poll setup" });
    expect(dock).toHaveAttribute("data-presentation", "dock");
    expect(dock).toHaveStyle({ width: "300px" });
    expect(popoverOf(id)).toBeNull();
  });

  it("900 px: the dock; 600 px: the popover", async () => {
    h = await renderWindow();
    const id = await h.addPoll("A");
    await openSetup(id);
    measure(900, 896);
    expect(within(frame(id)).getByRole("complementary", { name: "Poll setup" })).toBeVisible();
    measure(600, 596);
    expect(dockOf(id)).toBeNull();
    expect(within(frame(id)).getByRole("dialog", { name: "Poll setup" })).toBeVisible();
  });

  it("an inactive 640 px frame (1 px border, 638 px body) shows the dock; 639 px the popover", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    await h.addPoll("B");
    expect(frame(a).className).toContain("border-[1.5px]");
    await openSetup(a);
    measure(640, 638);
    expect(within(frame(a)).getByRole("complementary", { name: "Poll setup" })).toBeVisible();
    measure(639, 637);
    expect(within(frame(a)).getByRole("dialog", { name: "Poll setup" })).toBeVisible();
    expect(screen.getAllByRole("dialog", { name: "Poll setup" })).toHaveLength(1);
  });

  it("activating another sub-window never changes the presentation (frame 639 stays a popover, 640 a dock)", async () => {
    h = await renderWindow();
    const a = await h.addPoll("A");
    const b = await h.addPoll("B");
    // B is active, A is inactive. A is 639 px wide with its setup open.
    await openSetup(a);
    measure(639, 637);
    expect(popoverOf(a)).not.toBeNull();
    // A becomes active: its border grows, its body is 635 px.
    await h.act(() => h.rt.stores.workspace.getState().activate(a));
    expect(frame(a).className).toContain("border-2");
    measure(639, 635);
    expect(popoverOf(a)).not.toBeNull();
    expect(dockOf(a)).toBeNull();
    // B becomes active again: A is inactive again, body 637 px (the old "body + 3" read 640).
    await h.act(() => h.rt.stores.workspace.getState().activate(b));
    expect(frame(a).className).toContain("border-[1.5px]");
    measure(639, 637);
    expect(popoverOf(a)).not.toBeNull();
    expect(dockOf(a)).toBeNull();
    // The same at 640 px: always the dock.
    measure(640, 638);
    expect(dockOf(a)).not.toBeNull();
    await h.act(() => h.rt.stores.workspace.getState().activate(a));
    measure(640, 636);
    expect(dockOf(a)).not.toBeNull();
    expect(popoverOf(a)).toBeNull();
  });
});
