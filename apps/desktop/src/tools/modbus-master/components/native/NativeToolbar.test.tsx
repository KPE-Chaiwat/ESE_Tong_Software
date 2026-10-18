// The W2 toolbar at the minimum (DES-002 2.6 "Squeeze at the minimum", D-002-36, REPORT-008 D10).
// jsdom has no layout: this checks the structure, the classes, the names and the icons. The real row
// count and the grid rows at 465.6 x 282.4 css px are measured in a real window by QA.
import { screen, within } from "@testing-library/react";
import { WRITE_DISABLED_TITLE } from "./NativeToolbar";
import {
  disposeNativeHarnesses,
  installPollViewEnvironment,
  type NativeHarness,
  renderNativeWindow,
  uninstallPollViewEnvironment,
} from "./test-utils";

beforeAll(installPollViewEnvironment);
afterAll(uninstallPollViewEnvironment);
afterEach(disposeNativeHarnesses);

let h: NativeHarness;
const toolbar = () => screen.getByRole("toolbar", { name: "Poll window toolbar" });

async function connected(width: number) {
  h = await renderNativeWindow();
  await h.connect();
  h.advance(300);
  h.setWidth(width);
}

const buttonNames = () =>
  within(toolbar())
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label") ?? b.textContent);
const icon = (el: HTMLElement) => el.querySelector("[data-icon]")?.getAttribute("data-icon");
const NAMES = ["Pause", "Write…", "Connection window", "Dock to workspace"];

describe.each([466, 520, 560, 639.9])("icon-only toolbar at %s css px", (width) => {
  it("shows no text on the four buttons; aria-label and title are the exact names", async () => {
    await connected(width);
    const bar = within(toolbar());
    expect(toolbar()).toHaveAttribute("data-label-mode", "icon");
    for (const name of NAMES) {
      const button = bar.getByRole("button", { name });
      expect(button, name).toHaveAttribute("aria-label", name);
      expect(button, name).toHaveAttribute("title", name);
      expect(button.textContent, name).toBe("");
      expect(button.querySelector("svg"), name).not.toBeNull();
    }
  });
});

describe("the icon-only toolbar", () => {
  it("uses pause, file-pen-line, app-window and square-arrow-down-left; the menu keeps its name", async () => {
    await connected(466);
    const bar = within(toolbar());
    expect(icon(bar.getByRole("button", { name: "Pause" }))).toBe("pause");
    expect(icon(bar.getByRole("button", { name: "Write…" }))).toBe("file-pen-line");
    expect(icon(bar.getByRole("button", { name: "Connection window" }))).toBe("app-window");
    expect(icon(bar.getByRole("button", { name: "Dock to workspace" }))).toBe(
      "square-arrow-down-left",
    );
    expect(bar.getByRole("button", { name: "Poll window menu" })).toBeVisible();
  });

  it("a paused poll shows Resume with the play icon", async () => {
    h = await renderNativeWindow();
    h.setWidth(466);
    const resume = within(toolbar()).getByRole("button", { name: "Resume" });
    expect(resume).toHaveAttribute("aria-label", "Resume");
    expect(resume).toHaveAttribute("title", "Resume");
    expect(icon(resume)).toBe("play");
  });

  it("the icon buttons are 32 px (size-8), pill-shaped, with the outline tone of the labelled ones", async () => {
    await connected(466);
    for (const name of NAMES) {
      const b = within(toolbar()).getByRole("button", { name });
      expect(b.className, name).toContain("size-8");
      expect(b.className, name).toContain("rounded-pill");
      expect(b.className, name).toContain("border-input");
    }
  });

  it("the pills keep icon and visible text", async () => {
    await connected(466);
    const pills = [...toolbar().querySelectorAll('[data-slot="status-pill"]')];
    expect(pills).toHaveLength(2);
    expect(pills.map((p) => p.textContent)).toContain("Connected");
    for (const p of pills) {
      expect(p.querySelector("[data-icon]")).not.toBeNull();
      expect(p.textContent?.length ?? 0).toBeGreaterThan(0);
      expect(p.querySelector(".sr-only")).toBeNull();
    }
  });

  it("is two groups that do not wrap inside, so it has at most two rows; the name is cut first, min 80 px", async () => {
    await connected(466);
    const bar = toolbar();
    expect(bar.className).toContain("flex-wrap");
    expect(bar.className).not.toContain("min-h-");
    const children = [...bar.children] as HTMLElement[];
    expect(children.map((c) => c.getAttribute("data-slot"))).toEqual([
      "toolbar-main",
      "toolbar-connection",
    ]);
    for (const c of children) expect(c.className).not.toContain("flex-wrap");
    const name = screen.getByTestId("native-poll-name");
    expect(name.className).toContain("min-w-20");
    expect(name.className).toContain("truncate");
    expect(name.className).toContain("max-w-48");
  });

  it("keeps the DOM and the focus order of the full toolbar", async () => {
    await connected(900);
    const full = buttonNames();
    expect(toolbar()).toHaveAttribute("data-label-mode", "full");
    h.setWidth(466);
    expect(toolbar()).toHaveAttribute("data-label-mode", "icon");
    expect(buttonNames()).toEqual(full);
    expect(full).toEqual([
      "Rename poll (F2)",
      "Pause",
      "Write…",
      "Connection window",
      "Dock to workspace",
      "Poll window menu",
    ]);
  });

  it("Write… keeps the reason while the link is down", async () => {
    h = await renderNativeWindow();
    h.setWidth(466);
    const write = within(toolbar()).getByRole("button", { name: "Write…" });
    expect(write).toBeDisabled();
    expect(write).toHaveAttribute("title", WRITE_DISABLED_TITLE);
  });

  it("the buttons still act: Dock to workspace", async () => {
    await connected(466);
    await h.user.click(within(toolbar()).getByRole("button", { name: "Dock to workspace" }));
    expect(h.ipc.callsOf("dockPoll")).toHaveLength(1);
  });

  it("the name is the same element in both modes and keeps its full text", async () => {
    h = await renderNativeWindow({ poll: { name: "A very long poll name that does not fit" } });
    h.setWidth(466);
    expect(screen.getByTestId("native-poll-name")).toHaveTextContent(
      "A very long poll name that does not fit",
    );
  });
});

describe("the full toolbar at 640 css px and above", () => {
  it.each([640, 700, 900])(
    "%s: labels are text, titles carry the shortcuts, 60 px minimum",
    async (width) => {
      await connected(width);
      const bar = within(toolbar());
      expect(toolbar()).toHaveAttribute("data-label-mode", "full");
      expect(toolbar().className).toContain("min-h-[60px]");
      const pause = bar.getByRole("button", { name: "Pause" });
      expect(pause.textContent).toBe("Pause");
      expect(pause).toHaveAttribute("title", "Pause (Ctrl+P)");
      expect(pause).not.toHaveAttribute("aria-label");
      expect(bar.getByRole("button", { name: "Write…" }).textContent).toBe("Write…");
      expect(bar.getByRole("button", { name: "Connection window" }).textContent).toBe(
        "Connection window",
      );
      expect(bar.getByRole("button", { name: "Dock to workspace" }).textContent).toBe(
        "Dock to workspace",
      );
    },
  );

  it("639 -> 640 -> 639.9 switches the mode", async () => {
    await connected(639);
    expect(toolbar()).toHaveAttribute("data-label-mode", "icon");
    h.setWidth(640);
    expect(toolbar()).toHaveAttribute("data-label-mode", "full");
    h.setWidth(639.9);
    expect(toolbar()).toHaveAttribute("data-label-mode", "icon");
  });
});
