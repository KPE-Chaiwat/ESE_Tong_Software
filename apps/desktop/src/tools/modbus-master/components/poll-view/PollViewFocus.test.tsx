import { screen, within } from "@testing-library/react";
import { presetDefaults } from "../../lib/scale-presets";
import {
  disposeHarnesses,
  installPollViewEnvironment,
  type PollViewHarness,
  renderPollView,
  uninstallPollViewEnvironment,
} from "./test-utils";

beforeAll(installPollViewEnvironment);
afterAll(uninstallPollViewEnvironment);
afterEach(disposeHarnesses);

// REV-008 m-3: a live resize across 640 px with a setup control focused keeps the focus on the
// same control (same caret or selection, same draft), in both directions and in both hosts.

const view = () => screen.getByRole("group", { name: "Poll view" });
const popover = () => screen.queryByRole("dialog", { name: "Poll setup" });
const panel = () => screen.queryByRole("complementary", { name: "Poll setup" });
const showRail = () => screen.queryByRole("button", { name: "Show setup (Ctrl+\\)" });
const hideButton = () => screen.queryByRole("button", { name: "Hide setup (Ctrl+\\)" });

/** Types a draft into a text field and selects a range of it, leaving the focus in the field. */
async function editAndSelect(
  h: PollViewHarness,
  label: string,
  text: string,
  start: number,
  end: number,
  direction: "forward" | "backward" = "forward",
) {
  const field = screen.getByLabelText(label) as HTMLInputElement;
  await h.user.clear(field);
  await h.user.type(field, text);
  field.setSelectionRange(start, end, direction);
  expect(field).toHaveFocus();
  return field;
}

describe("native window: the panel (640 px and wider) and the popover (below 640 px)", () => {
  it("639 -> 640: the focused field, its draft and its selection survive the move to the panel", async () => {
    const h = await renderPollView({ host: "native", mode: "manual", width: 639 });
    const old = await editAndSelect(h, "Scan rate (ms)", "2500", 1, 3, "backward");
    h.setWidth(640);
    expect(view()).toHaveAttribute("data-presentation", "panel");
    const field = screen.getByLabelText("Scan rate (ms)") as HTMLInputElement;
    expect(field).not.toBe(old);
    expect(panel()).toContainElement(field);
    expect(field).toHaveFocus();
    expect(field).toHaveValue("2500");
    expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([
      1,
      3,
      "backward",
    ]);
    expect(h.rt.stores.ui.getState().pollDraft?.scanRateMs).toBe("2500");
  });

  it("640 -> 639: the focus does not jump to Name or the first invalid field", async () => {
    const h = await renderPollView({ host: "native", mode: "manual", width: 640 });
    // Quantity is invalid, but the user is typing in Scan rate.
    const quantity = screen.getByLabelText("Quantity");
    await h.user.clear(quantity);
    await h.user.type(quantity, "200");
    await h.user.tab();
    expect(quantity).toHaveAttribute("aria-invalid", "true");
    await editAndSelect(h, "Scan rate (ms)", "750", 0, 3);
    h.setWidth(639);
    expect(view()).toHaveAttribute("data-presentation", "popover");
    const field = screen.getByLabelText("Scan rate (ms)") as HTMLInputElement;
    expect(popover()).toContainElement(field);
    expect(field).toHaveFocus();
    expect(screen.getByLabelText("Quantity")).not.toHaveFocus();
    expect(screen.getByLabelText("Name")).not.toHaveFocus();
    expect(field).toHaveValue("750");
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 3]);
    // the draft and its message are kept as well
    expect(screen.getByLabelText("Quantity")).toHaveValue("200");
    expect(screen.getByText("Quantity for FC03 must be from 1 to 125.")).toBeInTheDocument();
  });

  it("goes back and forth: a collapsed caret stays where it was every time", async () => {
    const h = await renderPollView({ host: "native", mode: "manual", width: 639 });
    await editAndSelect(h, "Slave ID", "123", 2, 2);
    for (const width of [640, 639, 700, 600]) {
      h.setWidth(width);
      const field = screen.getByLabelText("Slave ID") as HTMLInputElement;
      expect(field).toHaveFocus();
      expect(field).toHaveValue("123");
      expect([field.selectionStart, field.selectionEnd]).toEqual([2, 2]);
    }
  });

  it("a select keeps the focus and its draft value", async () => {
    const h = await renderPollView({ host: "native", mode: "manual", width: 639 });
    const select = screen.getByLabelText("Function");
    await h.user.selectOptions(select, "4");
    expect(screen.getByLabelText("Function")).toHaveFocus();
    h.setWidth(640);
    expect(screen.getByLabelText("Function")).toHaveFocus();
    expect(screen.getByLabelText("Function")).toHaveValue("4");
    h.setWidth(639);
    expect(screen.getByLabelText("Function")).toHaveFocus();
    expect(screen.getByLabelText("Function")).toHaveValue("4");
  });

  it("a control of the SCALE section keeps the focus too (the same position in the content)", async () => {
    const h = await renderPollView({
      host: "native",
      mode: "manual",
      width: 639,
      poll: { scale: presetDefaults("current4to20") },
    });
    const old = screen.getByLabelText("Raw min") as HTMLInputElement;
    await h.user.clear(old);
    await h.user.type(old, "12");
    old.setSelectionRange(1, 2);
    h.setWidth(640);
    const field = screen.getByLabelText("Raw min") as HTMLInputElement;
    expect(field).not.toBe(old);
    expect(field).toHaveFocus();
    expect(field).toHaveValue("12");
    expect([field.selectionStart, field.selectionEnd]).toEqual([1, 2]);
    h.setWidth(639);
    expect(screen.getByLabelText("Raw min")).toHaveFocus();
  });

  it("the focused rail button moves to the hide button of the panel and comes back to the rail", async () => {
    const h = await renderPollView({ host: "native", mode: "manual", width: 639 });
    showRail()?.focus();
    expect(showRail()).toHaveFocus();
    h.setWidth(640);
    expect(showRail()).not.toBeInTheDocument();
    expect(hideButton()).toHaveFocus();
    h.setWidth(639);
    expect(hideButton()).not.toBeInTheDocument();
    expect(showRail()).toHaveFocus();
  });

  it("the open state is kept in both directions and the draft is not reset", async () => {
    const h = await renderPollView({ host: "native", mode: "manual", width: 639 });
    await editAndSelect(h, "Quantity", "20", 0, 2);
    for (const width of [640, 639, 640]) {
      h.setWidth(width);
      expect(h.rt.stores.ui.getState().setupOpen).toBe(true);
      expect(h.rt.stores.ui.getState().pollDraft).not.toBeNull();
      expect(screen.getByLabelText("Quantity")).toHaveValue("20");
    }
    expect(view()).toHaveAttribute("data-presentation", "panel");
  });

  it("a closed setup stays closed across 640 px and the focused rail keeps the focus", async () => {
    const h = await renderPollView({ host: "native", mode: "manual", width: 639 });
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(false));
    showRail()?.focus();
    for (const width of [640, 639]) {
      h.setWidth(width);
      expect(view()).toHaveAttribute("data-presentation", "rail");
      expect(h.rt.stores.ui.getState().setupOpen).toBe(false);
      expect(showRail()).toHaveAttribute("aria-expanded", "false");
      expect(showRail()).not.toHaveAttribute("aria-controls");
      expect(showRail()).toHaveFocus();
      expect(popover()).not.toBeInTheDocument();
      expect(panel()).not.toBeInTheDocument();
    }
  });

  it("the rail and popover aria is right after every switch", async () => {
    const h = await renderPollView({ host: "native", mode: "manual", width: 639 });
    const check = (width: number) => {
      h.setWidth(width);
      if (width >= 640) {
        expect(panel()).toBeInTheDocument();
        expect(popover()).not.toBeInTheDocument();
        expect(showRail()).not.toBeInTheDocument();
        expect(hideButton()).toBeInTheDocument();
      } else {
        const dialog = screen.getByRole("dialog", { name: "Poll setup" });
        expect(dialog).toHaveAttribute("aria-modal", "false");
        expect(panel()).not.toBeInTheDocument();
        expect(showRail()).toHaveAttribute("aria-expanded", "true");
        expect(showRail()).toHaveAttribute("aria-controls", dialog.id);
        expect(dialog.id).not.toBe("");
        expect(document.getElementById(dialog.id)).toBe(dialog);
      }
    };
    check(639);
    check(640);
    check(639);
    check(900);
    check(466);
  });

  it("with the focus outside the setup the resize leaves it where it is", async () => {
    const h = await renderPollView({ host: "native", mode: "manual", width: 700 });
    const actions = screen.getByRole("button", { name: "Poll actions" });
    actions.focus();
    h.setWidth(639);
    expect(actions).toHaveFocus();
    h.setWidth(640);
    expect(actions).toHaveFocus();
  });

  it("the popover still takes the focus when the rail opens it (first invalid field, else Name)", async () => {
    const h = await renderPollView({ host: "native", mode: "manual", width: 639 });
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(false));
    await h.user.click(showRail() as HTMLElement);
    expect(within(screen.getByRole("dialog")).getByLabelText("Name")).toHaveFocus();
  });

  it("a new poll (focusName) is not pulled back to Name by a resize", async () => {
    const h = await renderPollView({
      host: "native",
      mode: "manual",
      width: 639,
      focusName: true,
    });
    await editAndSelect(h, "Scan rate (ms)", "300", 3, 3);
    h.setWidth(640);
    expect(screen.getByLabelText("Scan rate (ms)")).toHaveFocus();
    h.setWidth(639);
    expect(screen.getByLabelText("Scan rate (ms)")).toHaveFocus();
  });
});

describe("sub-window: the dock (frame 640 px and wider) and the popover (below)", () => {
  async function open(width = 636) {
    const h = await renderPollView({ host: "workspace", mode: "manual", inFrame: true });
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    h.setFrameWidth(width + 4);
    h.setWidth(width);
    return h;
  }
  const resize = (h: PollViewHarness, frame: number) => {
    h.setFrameWidth(frame);
    h.setWidth(frame - 4);
  };

  it("dock -> popover -> dock: the field, the draft and the selection are kept", async () => {
    const h = await open(636);
    expect(view()).toHaveAttribute("data-presentation", "dock");
    const old = await editAndSelect(h, "Start address", "4096", 1, 4);
    resize(h, 639);
    expect(view()).toHaveAttribute("data-presentation", "popover");
    const inPopover = screen.getByLabelText("Start address") as HTMLInputElement;
    expect(inPopover).not.toBe(old);
    expect(popover()).toContainElement(inPopover);
    expect(inPopover).toHaveFocus();
    expect(inPopover).toHaveValue("4096");
    expect([inPopover.selectionStart, inPopover.selectionEnd]).toEqual([1, 4]);
    resize(h, 640);
    expect(view()).toHaveAttribute("data-presentation", "dock");
    const inDock = screen.getByLabelText("Start address") as HTMLInputElement;
    expect(panel()).toContainElement(inDock);
    expect(inDock).toHaveFocus();
    expect([inDock.selectionStart, inDock.selectionEnd]).toEqual([1, 4]);
  });

  it("the open state is kept and the popover aria is right after the switch", async () => {
    const h = await open(636);
    await editAndSelect(h, "Quantity", "30", 2, 2);
    resize(h, 639);
    const dialog = screen.getByRole("dialog", { name: "Poll setup" });
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(h.rt.stores.ui.getState().setupOpen).toBe(true);
    resize(h, 640);
    expect(panel()).toBeInTheDocument();
    expect(popover()).not.toBeInTheDocument();
    expect(h.rt.stores.ui.getState().setupOpen).toBe(true);
  });

  it("the Done button has no twin in the dock: the focus goes to the first field", async () => {
    const h = await open(600);
    expect(popover()).toBeInTheDocument();
    within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }).focus();
    resize(h, 640);
    expect(panel()).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  it("a closed setup stays closed across 640 px", async () => {
    const h = await open(636);
    await h.act(() => h.rt.stores.ui.getState().setSetupOpen(false));
    resize(h, 639);
    resize(h, 640);
    expect(panel()).not.toBeInTheDocument();
    expect(popover()).not.toBeInTheDocument();
    expect(h.rt.stores.ui.getState().setupOpen).toBe(false);
  });
});
