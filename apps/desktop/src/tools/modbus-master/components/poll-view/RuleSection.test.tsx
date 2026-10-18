import { act, fireEvent, screen, within } from "@testing-library/react";
import type { ValueColorRule } from "@/shared/bindings/ValueColorRule";
import {
  disposeHarnesses,
  installPollViewEnvironment,
  renderPollView,
  uninstallPollViewEnvironment,
} from "./test-utils";

const colorRule: ValueColorRule = {
  name: "High",
  enabled: true,
  range: null,
  source: "displayed",
  comparison: "greaterThan",
  threshold: "25",
  upperThreshold: null,
  highlight: "lime",
};
beforeAll(installPollViewEnvironment);
afterAll(uninstallPollViewEnvironment);
afterEach(disposeHarnesses);
it.each(["unsigned", "unsigned32"] as const)(
  "opens value color rules from the %s grid context menu",
  async (format) => {
    const h = await renderPollView({
      mode: "manual",
      poll: {
        display: {
          format,
          swapBytes: false,
          reverseWords: false,
          addressBase: 0,
          showAlias: true,
          copyAlias: false,
        },
        colorRules: [colorRule],
      },
    });
    act(() => {
      h.ipc.emitConnectionState("connected");
      h.ipc.emitPollState(h.pollId, "polling");
      h.ipc.emitPollUpdate(h.pollId, { values: [26, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
    });
    act(() => h.rt.stores.ui.getState().setSetupOpen(false));
    const grid = screen.getByRole("grid", { name: "Register values" });
    const row = within(grid).getAllByRole("row")[1];
    if (!row) throw new Error("Missing data row");
    fireEvent.contextMenu(row);
    await h.user.click(screen.getByRole("menuitem", { name: "Value color rules…" }));
    const dialog = screen.getByRole("dialog", { name: "Value color rules · Tank 1" });
    expect(within(dialog).getByText("High")).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "greater than (>)" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "less than (<)" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "between (inclusive)" })).toBeInTheDocument();
    expect(h.rt.stores.ui.getState().setupOpen).toBe(true);
    expect(h.rt.stores.ui.getState().ruleDraft?.entries).toHaveLength(1);
    expect(h.rt.stores.ui.getState().ruleDraft?.entries[0]?.rule.range).toEqual({
      start: 0,
      end: 0,
    });
    await h.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(h.rt.stores.ui.getState().ruleDraft).toBeNull();
    expect(h.rt.stores.poll.getState().config?.colorRules).toEqual([colorRule]);
  },
);
it("shows accessible matches, clears on pause and reevaluates current readings on rule changes", async () => {
  const h = await renderPollView({ mode: "manual", poll: { colorRules: [colorRule] } });
  act(() => {
    h.ipc.emitConnectionState("connected");
    h.ipc.emitPollState(h.pollId, "polling");
    h.ipc.emitPollUpdate(h.pollId, { values: [26, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  });
  expect(screen.getByRole("img", { name: /Rule: High/ })).toBeInTheDocument();
  const before = h.ipc.callsOf("updatePoll").length;
  await h.act(() => h.rt.stores.poll.getState().setView({ colorRules: [] }));
  expect(screen.queryByRole("img", { name: /Rule: High/ })).not.toBeInTheDocument();
  await h.act(() => h.rt.stores.poll.getState().setView({ colorRules: [colorRule] }));
  expect(screen.getByRole("img", { name: /Rule: High/ })).toBeInTheDocument();
  act(() => h.ipc.emitPollState(h.pollId, "paused"));
  expect(screen.queryByRole("img", { name: /Rule: High/ })).not.toBeInTheDocument();
  expect(h.ipc.callsOf("updatePoll")).toHaveLength(before);
});
it("selects custom background and text colors, applies them to live values, and preserves the draft until Apply", async () => {
  const h = await renderPollView({
    mode: "manual",
    poll: { colorRules: [{ ...colorRule, highlight: "warning" }] },
  });
  act(() => {
    h.ipc.emitConnectionState("connected");
    h.ipc.emitPollState(h.pollId, "polling");
    h.ipc.emitPollUpdate(h.pollId, { values: [26, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  });
  const grid = screen.getByRole("grid", { name: "Register values" });
  const row = within(grid).getAllByRole("row")[1];
  if (!row) throw new Error("Missing data row");
  fireEvent.contextMenu(row);
  await h.user.click(screen.getByRole("menuitem", { name: "Value color rules…" }));
  const dialog = screen.getByRole("dialog", { name: /Value color rules/ });
  await h.user.selectOptions(within(dialog).getByLabelText("Highlight"), "custom");
  expect(within(dialog).getByLabelText("Background color")).toHaveValue("#edeff2");
  expect(within(dialog).getByLabelText("Text color")).toHaveValue("#312f2e");
  expect(h.rt.stores.poll.getState().config?.colorRules[0]?.colors).toBeUndefined();
  fireEvent.change(within(dialog).getByLabelText("Text color"), { target: { value: "#EDEFF2" } });
  expect(
    within(dialog).getByText(
      "Low contrast may make values hard to read. You can still apply this rule.",
    ),
  ).toBeVisible();
  await h.user.click(within(dialog).getByRole("button", { name: "Apply rules" }));
  expect(h.rt.stores.poll.getState().config?.colorRules[0]?.colors).toEqual({
    background: "#EDEFF2",
    foreground: "#edeff2",
  });
  expect(h.rt.stores.poll.getState().config?.colorRules[0]?.highlight).toBe("lime");
  const marker = screen.getByRole("img", { name: /Rule: High/ });
  const cell = marker.closest('[role="gridcell"]');
  expect(cell).not.toBeNull();
  expect(cell).toHaveClass("value-rule-custom");
  expect(cell).toHaveStyle({ "--rule-bg": "#EDEFF2", "--rule-fg": "#edeff2" });
});
it("sets a color directly for the clicked register without a numeric condition", async () => {
  const h = await renderPollView({ mode: "manual" });
  act(() => {
    h.ipc.emitConnectionState("connected");
    h.ipc.emitPollState(h.pollId, "polling");
    h.ipc.emitPollUpdate(h.pollId, { values: [70, 70, 0, 0, 0, 0, 0, 0, 0, 0] });
  });
  const grid = screen.getByRole("grid", { name: "Register values" });
  const rows = within(grid).getAllByRole("row");
  const row = rows[2];
  if (!row) throw new Error("Missing register row");
  fireEvent.contextMenu(row);
  await h.user.click(screen.getByRole("menuitem", { name: "Set colors for register 1…" }));
  const dialog = screen.getByRole("dialog", { name: /Value color rules/ });
  expect(within(dialog).getByLabelText("Addresses")).toHaveValue("single");
  expect(within(dialog).getByLabelText("Register address")).toHaveValue("1");
  expect(within(dialog).getByLabelText("Comparison")).toHaveValue("always");
  expect(within(dialog).queryByLabelText("Threshold")).not.toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText("Background color"), {
    target: { value: "#337bd6" },
  });
  await h.user.click(within(dialog).getByRole("button", { name: "Apply rules" }));
  expect(h.rt.stores.poll.getState().config?.colorRules[0]).toMatchObject({
    comparison: "always",
    range: { start: 1, end: 1 },
    colors: { background: "#337bd6" },
  });
  expect(
    within(rows[1] as HTMLElement).queryByRole("img", { name: /Rule: Register 1/ }),
  ).toBeNull();
  expect(within(row).getByRole("img", { name: /Rule: Register 1/ })).toBeVisible();
});
it("scopes Value color rules from register 1 to that row even when register 0 has the same value", async () => {
  const h = await renderPollView({ mode: "manual" });
  act(() => {
    h.ipc.emitConnectionState("connected");
    h.ipc.emitPollState(h.pollId, "polling");
    h.ipc.emitPollUpdate(h.pollId, { values: [200, 200, 0, 0, 0, 0, 0, 0, 0, 0] });
  });
  const grid = screen.getByRole("grid", { name: "Register values" });
  const rows = within(grid).getAllByRole("row");
  const row = rows[2];
  if (!row) throw new Error("Missing register row");
  fireEvent.contextMenu(row);
  await h.user.click(screen.getByRole("menuitem", { name: "Value color rules…" }));
  const dialog = screen.getByRole("dialog", { name: /Value color rules/ });
  expect(within(dialog).getByLabelText("Addresses")).toHaveValue("single");
  expect(within(dialog).getByLabelText("Register address")).toHaveValue("1");
  await h.user.type(within(dialog).getByLabelText("Threshold"), "50");
  await h.user.click(within(dialog).getByRole("button", { name: "Apply rules" }));
  expect(h.rt.stores.poll.getState().config?.colorRules[0]?.range).toEqual({ start: 1, end: 1 });
  expect(
    within(rows[1] as HTMLElement).queryByRole("img", { name: /Rule: Register 1/ }),
  ).toBeNull();
  expect(within(row).getByRole("img", { name: /Rule: Register 1/ })).toBeVisible();
});
it("validates drafts, retains last applied list on IPC failure, and cancels with focus return", async () => {
  const h = await renderPollView({ mode: "manual", host: "native" });
  await h.user.click(screen.getByRole("button", { name: "Edit rules…" }));
  const dialog = screen.getByRole("dialog", { name: /Value color rules/ });
  await h.user.click(within(dialog).getByRole("button", { name: "Add rule" }));
  await h.user.click(within(dialog).getByRole("button", { name: "Apply rules" }));
  expect(
    within(dialog).getByText("Rules not applied. Fix the highlighted fields."),
  ).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Threshold")).toHaveFocus();
  await h.user.type(within(dialog).getByLabelText("Threshold"), "25");
  h.ipc.failNext("setPollView", "Rejected");
  await h.user.click(within(dialog).getByRole("button", { name: "Apply rules" }));
  expect(
    within(dialog).getByText("Could not apply value color rules. Rejected"),
  ).toBeInTheDocument();
  expect(h.rt.stores.poll.getState().config?.colorRules).toEqual([]);
  await h.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit rules…" })).toHaveFocus();
});
it("keeps applied rules unchanged while a valid rules mutation is awaiting acknowledgment", async () => {
  const h = await renderPollView({ mode: "manual", poll: { colorRules: [colorRule] } });
  const held = h.ipc.hold("setPollView");
  let result: Promise<boolean>;
  act(() => {
    result = h.rt.stores.poll.getState().setView({ colorRules: [] });
  });
  expect(h.rt.stores.poll.getState().config?.colorRules).toEqual([colorRule]);
  await h.act(async () => {
    held.release();
    await result;
  });
  expect(h.rt.stores.poll.getState().config?.colorRules).toEqual([]);
});
it("does not publish a pending rejected interpretation and leaves rules unchanged", async () => {
  const h = await renderPollView({ mode: "manual", poll: { colorRules: [colorRule] } });
  const previous = h.rt.stores.poll.getState().config;
  if (!previous) throw new Error("Missing config");
  const held = h.ipc.hold("setPollView");

  let result: Promise<boolean>;
  act(() => {
    result = h.rt.stores.poll
      .getState()
      .setView({ display: { ...previous.display, format: "unsigned64" } });
  });
  expect(h.rt.stores.poll.getState().config).toBe(previous);
  await h.act(async () => {
    held.fail("Incompatible rules");
    expect(await result).toBe(false);
  });
  expect(h.rt.stores.poll.getState().config).toBe(previous);
  expect(h.rt.stores.poll.getState().config?.colorRules).toEqual([colorRule]);
});
