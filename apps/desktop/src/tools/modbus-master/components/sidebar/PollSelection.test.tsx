import { fireEvent, screen, within } from "@testing-library/react";
import { type Harness, renderWindow } from "../test-utils";

let h: Harness;
afterEach(() => h?.rt.dispose());
async function setup() {
  h = await renderWindow();
  const ids = [];
  for (const name of ["A", "B", "C", "D"]) ids.push(await h.addPoll(name));
  return ids;
}
const checkbox = (name: string) => screen.getByRole("checkbox", { name: `Select ${name}` });
describe("sidebar bulk selection gestures", () => {
  it("frozen checkboxes preserve Tab and Shift+Tab navigation", async () => {
    await setup();
    await h.act(() => h.rt.stores.pollSelection.getState().setFrozen(true));
    checkbox("A").focus();
    await h.user.keyboard(" ");
    expect(checkbox("A")).not.toBeChecked();
    await h.user.tab();
    expect(checkbox("A")).not.toHaveFocus();
    checkbox("A").focus();
    await h.user.tab({ shift: true });
    expect(checkbox("A")).not.toHaveFocus();
  });
  it("checkbox toggles do not Show or alter the active view", async () => {
    const ids = await setup();
    const active = h.rt.stores.workspace.getState().activeId;
    await h.user.click(checkbox("A"));
    await h.user.click(checkbox("C"));
    expect([...h.rt.stores.pollSelection.getState().selectedIds]).toEqual([ids[0], ids[2]]);
    expect(h.rt.stores.workspace.getState().activeId).toBe(active);
    expect(screen.getByText("2 selected")).toBeVisible();
    expect(h.ipc.callsOf("showPoll")).toHaveLength(0);
  });
  it("Shift click adds the inclusive range and checkbox arrows only move focus", async () => {
    await setup();
    await h.user.click(checkbox("A"));
    fireEvent.click(checkbox("C"), { shiftKey: true });
    expect(checkbox("A")).toBeChecked();
    expect(checkbox("B")).toBeChecked();
    expect(checkbox("C")).toBeChecked();
    expect(checkbox("D")).not.toBeChecked();
    fireEvent.keyDown(checkbox("C"), { key: "ArrowDown" });
    expect(checkbox("D")).toHaveFocus();
    expect(checkbox("D")).not.toBeChecked();
    fireEvent.keyDown(checkbox("D"), { key: "Home", shiftKey: true });
    expect(checkbox("A")).toHaveFocus();
  });
  it("Space toggles and Shift arrows establish a range from the starting checkbox", async () => {
    await setup();
    checkbox("B").focus();
    await h.user.keyboard(" ");
    expect(checkbox("B")).toBeChecked();
    await h.user.click(screen.getByRole("button", { name: "Clear selection" }));
    fireEvent.keyDown(checkbox("B"), { key: "ArrowDown", shiftKey: true });
    expect(checkbox("B")).toBeChecked();
    expect(checkbox("C")).toBeChecked();
    expect(checkbox("A")).not.toBeChecked();
  });
  it("Ctrl+A is scoped to checkbox and Show targets and Ctrl+Shift+A clears", async () => {
    await setup();
    fireEvent.keyDown(checkbox("B"), { key: "a", ctrlKey: true });
    expect(screen.getByText("4 selected")).toBeVisible();
    fireEvent.keyDown(checkbox("B"), { key: "a", ctrlKey: true, shiftKey: true });
    expect(screen.getByText("0 selected")).toBeVisible();
    const list = screen.getByRole("list", { name: "Polls" });
    const show = within(list).getByRole("button", { name: /^B,/ });
    fireEvent.keyDown(show, { key: "a", ctrlKey: true, altKey: true });
    expect(screen.getByText("0 selected")).toBeVisible();
    fireEvent.keyDown(show, { key: "a", ctrlKey: true });
    expect(screen.getByText("4 selected")).toBeVisible();
  });
});
