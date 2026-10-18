import { fireEvent, screen, within } from "@testing-library/react";
import { sidebarExpanded } from "../lib/sidebar";
import { type Harness, renderWindow } from "./test-utils";

let h: Harness;
afterEach(() => h?.rt.dispose());
const toggle = (name: string) =>
  within(screen.getByRole("toolbar", { name: "Toolbar" })).getByRole("button", { name });
const sidebar = () => document.getElementById("connection-sidebar") as HTMLElement;

it.each([
  [false, false, false, true],
  [false, false, true, false],
  [true, false, false, false],
  [true, true, true, true],
])(
  "derives visibility for compact=%s peek=%s collapsed=%s",
  (compact, peek, collapsed, expected) => {
    expect(sidebarExpanded(compact, peek, collapsed)).toBe(expected);
  },
);

it("preserves the mounted sidebar, width, drafts and profile state, with keyboard focus on the toggle", async () => {
  h = await renderWindow();
  const input = within(sidebar()).getByLabelText("Host");
  await h.user.clear(input);
  await h.user.type(input, "invalid host");
  await h.act(() => h.rt.stores.workspace.getState().setSidebarWidth(400));
  h.clean();
  const button = toggle("Hide sidebar");
  expect(button).toHaveAttribute("title", "Hide sidebar (Ctrl+\\)");
  expect(button).toHaveAttribute("aria-controls", sidebar().id);
  button.focus();
  await h.user.keyboard("{Enter}");
  expect(button).toHaveFocus();
  expect(button).toHaveAccessibleName("Show sidebar");
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(sidebar()).not.toBeVisible();
  await h.user.keyboard(" ");
  expect(button).toHaveFocus();
  expect(sidebar()).toBeVisible();
  expect(input).toHaveValue("invalid host");
  expect(sidebar()).toHaveStyle({ width: "400px" });
  expect(h.rt.stores.profile.getState().modified).toBe(false);
});

it.each([false, true])("compact peek preserves durable collapsed=%s", async (collapsed) => {
  h = await renderWindow();
  if (collapsed) await h.user.click(toggle("Hide sidebar"));
  await h.act(() => h.ipc.setCompactMode(true));
  expect(toggle("Show sidebar")).toHaveAttribute("aria-expanded", "false");
  await h.user.click(toggle("Show sidebar"));
  expect(toggle("Hide sidebar")).toHaveAttribute("aria-expanded", "true");
  expect(h.rt.stores.workspace.getState().sidebar.collapsed).toBe(collapsed);
  await h.act(() => h.ipc.setCompactMode(false));
  expect(h.rt.stores.layout.getState().sidebarPeek).toBe(false);
  expect(toggle(collapsed ? "Show sidebar" : "Hide sidebar")).toHaveAttribute(
    "aria-expanded",
    String(!collapsed),
  );
});

it("toolbar targets W1 after a subwindow, while the shortcut keeps its setup target independent", async () => {
  h = await renderWindow();
  const first = await h.addPoll("First");
  const second = await h.addPoll("Second");
  const titleBar = (id: number) =>
    document.querySelector(`[data-subwindow="${id}"] [data-slot="title-bar"]`) as HTMLElement;
  const firstTitle = titleBar(first);
  await h.act(() => firstTitle.focus());
  fireEvent.keyDown(firstTitle, { key: "\\", code: "Backslash", ctrlKey: true });
  expect(h.rt.views.get(first).stores.ui.getState().setupOpen).toBe(true);
  expect(h.rt.views.get(second).stores.ui.getState().setupOpen).toBe(false);
  await h.user.click(toggle("Hide sidebar"));
  expect(sidebar()).not.toBeVisible();
  expect(h.rt.views.get(first).stores.ui.getState().setupOpen).toBe(true);

  const secondTitle = titleBar(second);
  await h.act(() => secondTitle.focus());
  fireEvent.keyDown(secondTitle, { key: "\\", code: "Backslash", ctrlKey: true });
  expect(h.rt.views.get(first).stores.ui.getState().setupOpen).toBe(true);
  expect(h.rt.views.get(second).stores.ui.getState().setupOpen).toBe(true);
});

it("moves shortcut focus out of hidden contents and keeps rail restore focus visible", async () => {
  h = await renderWindow();
  const input = within(sidebar()).getByLabelText("Host");
  input.focus();
  fireEvent.keyDown(input, { key: "\\", code: "Backslash", ctrlKey: true });
  expect(toggle("Show sidebar")).toHaveFocus();
  const rail = screen.getByRole("navigation", { name: "Polls (rail)" });
  await h.user.click(within(rail).getByRole("button", { name: "Show sidebar" }));
  expect(toggle("Hide sidebar")).toHaveFocus();
});

it("keeps hidden sidebar controls out of the accessibility tree and F6 visits the visible rail", async () => {
  h = await renderWindow();
  const input = within(sidebar()).getByLabelText("Host");
  await h.user.click(toggle("Hide sidebar"));

  expect(sidebar()).toHaveAttribute("hidden");
  expect(screen.queryByRole("complementary", { name: "Sidebar" })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Host" })).not.toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Polls (rail)" })).toBeVisible();

  toggle("Show sidebar").focus();
  fireEvent.keyDown(toggle("Show sidebar"), { key: "F6" });
  expect(
    within(screen.getByRole("navigation", { name: "Polls (rail)" })).getByRole("button", {
      name: "Show sidebar",
    }),
  ).toHaveFocus();

  fireEvent.keyDown(document.activeElement as HTMLElement, { key: "F6" });
  expect(document.activeElement?.closest('[data-region="workspace"]')).not.toBeNull();
  expect(input).not.toHaveFocus();
});
