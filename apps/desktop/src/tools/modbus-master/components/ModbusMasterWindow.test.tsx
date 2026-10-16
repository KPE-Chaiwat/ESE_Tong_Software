import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { type Harness, renderWindow } from "./test-utils";

let h: Harness;

function ctrl(key: string) {
  act(() => {
    fireEvent.keyDown(window, { key, ctrlKey: true });
  });
}

afterEach(() => {
  h?.rt.dispose();
});

describe("window shell (task 08)", () => {
  it("renders the regions and the initial title", async () => {
    h = await renderWindow();
    expect(screen.getByRole("toolbar", { name: "Toolbar" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Setup" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Data" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Communication Traffic" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(document.title).toBe("Modbus Master - Untitled - Not connected");
    await waitFor(() => expect(h.win.titles.at(-1)).toBe(document.title));
  });

  it("Ctrl+\\ hides and shows the setup panel", async () => {
    h = await renderWindow();
    ctrl("\\");
    expect(h.rt.stores.layout.getState().setupOpen).toBe(false);
    expect(document.querySelector("aside[aria-label=Setup]")).not.toBeVisible();
    ctrl("\\");
    expect(screen.getByRole("complementary", { name: "Setup" })).toBeVisible();
  });

  it("Ctrl+J leaves the traffic header and counters visible", async () => {
    h = await renderWindow();
    h.emit(() => h.ipc.emitCounters({ requests: 1204, responses: 1198, errors: 2, timeouts: 4 }));
    await h.user.keyboard("{Control>}j{/Control}");
    expect(h.rt.stores.layout.getState().trafficCollapsed).toBe(true);
    const panel = screen.getByRole("region", { name: "Communication Traffic" });
    expect(within(panel).getByText("Requests")).toBeVisible();
    expect(within(panel).getByText("1204")).toBeVisible();
    expect(within(panel).getByText("Timeouts")).toBeVisible();
    expect(within(panel).queryByRole("grid")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand traffic panel" })).toBeVisible();
  });

  it("suppresses the browser defaults: Ctrl+P does not print, Ctrl+S/O/N/R are prevented", async () => {
    h = await renderWindow();
    for (const key of ["p", "s", "o", "n", "r"]) {
      const notPrevented = fireEvent.keyDown(window, { key, ctrlKey: true });
      expect(notPrevented, `Ctrl+${key}`).toBe(false);
    }
    expect(fireEvent.keyDown(window, { key: "F5" })).toBe(false);
  });

  it("does not run shortcut actions while a modal is open", async () => {
    h = await renderWindow();
    const unlock = h.rt.stores.layout.getState().lockModal();
    ctrl("\\");
    expect(h.rt.stores.layout.getState().setupOpen).toBe(true);
    unlock();
  });

  it("the splitter works with the keyboard and resets on double-click", async () => {
    h = await renderWindow();
    const splitter = screen.getByRole("separator", { name: "Resize traffic panel" });
    const before = h.rt.stores.layout.getState().trafficHeightPct;
    splitter.focus();
    await h.user.keyboard("{ArrowUp}");
    expect(h.rt.stores.layout.getState().trafficHeightPct).toBeGreaterThan(before);
    await h.user.keyboard("{ArrowDown}{ArrowDown}");
    expect(h.rt.stores.layout.getState().trafficHeightPct).toBeLessThan(before);
    await h.user.dblClick(splitter);
    expect(h.rt.stores.layout.getState().trafficHeightPct).toBe(35);
    expect(splitter).toHaveAttribute("aria-valuenow", "35");
  });

  it("shows the profile name with the Modified marker as text", async () => {
    h = await renderWindow();
    expect(screen.queryByText("Modified")).not.toBeInTheDocument();
    h.emit(() => h.rt.stores.config.getState().setFormat("hex"));
    expect(screen.getByText("Modified")).toBeVisible();
    expect(document.title).toBe("Modbus Master - Untitled * - Not connected");
  });

  it("shows the status bar summary", async () => {
    h = await renderWindow();
    const bar = screen.getByRole("contentinfo");
    expect(within(bar).getByText("Not connected")).toBeVisible();
    expect(within(bar).getByText(/Last OK/)).toBeVisible();
    expect(within(bar).getByText(/Round trip/)).toBeVisible();
  });
});
