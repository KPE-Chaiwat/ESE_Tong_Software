import { act, fireEvent, screen, within } from "@testing-library/react";
import { createPollViewUiStore } from "../../store/poll-view-ui.store";
import {
  disposeHarnesses,
  installPollViewEnvironment,
  renderPollView,
  uninstallPollViewEnvironment,
} from "./test-utils";

beforeAll(installPollViewEnvironment);
afterAll(uninstallPollViewEnvironment);
afterEach(disposeHarnesses);

describe.each(["workspace", "native"] as const)("combined grid in %s", (host) => {
  it("shows exact u64 and remainder, copies interpreted and every raw word", async () => {
    const h = await renderPollView({
      host,
      mode: "manual",
      poll: {
        display: {
          format: "unsigned64",
          swapBytes: false,
          reverseWords: false,
          addressBase: 0,
          showAlias: true,
          copyAlias: false,
        },
        definition: { slaveId: 1, function: 3, startAddress: 1, quantity: 5, scanRateMs: 100 },
        aliases: [{ address: 2, alias: "Second" }],
      },
    });
    act(() => {
      h.ipc.emitConnectionState("connected");
      h.ipc.emitPollState(h.pollId, "polling");
      h.ipc.emitPollUpdate(h.pollId, { values: [0xffff, 0xffff, 0xffff, 0xffff, 1] });
    });
    expect(screen.getByText("18446744073709551615")).toBeInTheDocument();
    expect(screen.getByText("Incomplete")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Needs 4 registers; only 1 available." }),
    ).toBeInTheDocument();
    await h.act(() => h.rt.actions.copyRows());
    expect(h.copied.at(-1)).toBe("1\t18446744073709551615");
    act(() => h.rt.stores.ui.getState().click(5));
    await h.user.click(screen.getByRole("button", { name: "Inspect raw registers 1–4" }));
    const dialog = screen.getByRole("dialog", { name: "Raw registers · 1–4" });
    expect(within(dialog).getByText("Second")).toBeInTheDocument();
    expect(within(dialog).getAllByText("65535")).toHaveLength(4);
    await h.user.click(within(dialog).getByRole("button", { name: "Copy raw registers" }));
    expect(h.rt.stores.ui.getState().focusAddress).toBe(5);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => h.rt.stores.ui.getState().click(1));
    await h.act(() => h.rt.actions.copyRows({ columns: "raw" }));
    expect(h.copied.at(-1)).toBe("1\t65535\n2\t65535\n3\t65535\n4\t65535");
  });
});
it("keeps alias editing focus and scrolls keyboard focus to the active combined row", async () => {
  const h = await renderPollView({
    mode: "manual",
    poll: {
      display: {
        format: "unsigned32",
        swapBytes: false,
        reverseWords: false,
        addressBase: 0,
        showAlias: true,
        copyAlias: false,
      },
    },
  });
  act(() => {
    h.ipc.emitConnectionState("connected");
    h.ipc.emitPollState(h.pollId, "polling");
    h.ipc.emitPollUpdate(h.pollId, { values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  });
  const grid = screen.getByRole("grid", { name: "Register values" });
  await h.act(() => h.rt.actions.editAlias(0, "f2"));
  const editor = screen.getByRole("textbox", { name: "Alias for address 0" });
  await h.user.click(editor);
  expect(editor).toHaveFocus();
  await h.user.type(editor, "Pressure");
  expect(editor).toHaveValue("Pressure");
  fireEvent.keyDown(editor, { key: "Escape" });
  const lastRow = grid.querySelector("tbody tr:last-child");
  if (!lastRow) throw new Error("Missing last row");
  grid.getBoundingClientRect = () => ({ top: 0, bottom: 100 }) as DOMRect;
  lastRow.getBoundingClientRect = () => ({ top: 120, bottom: 140 }) as DOMRect;
  fireEvent.keyDown(grid, { key: "End" });
  expect(grid.getAttribute("aria-activedescendant")).toBe(lastRow.id);
  expect(grid.scrollTop).toBe(40);
});
it("resets a previous multi-selection when entering combined mode at an aligned focus", async () => {
  const h = await renderPollView({ mode: "manual" });
  act(() => {
    h.ipc.emitConnectionState("connected");
    h.ipc.emitPollState(h.pollId, "polling");
    h.ipc.emitPollUpdate(h.pollId, { values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  });
  act(() => {
    h.rt.stores.ui.getState().selectAll();
    h.rt.stores.ui.setState({ focusAddress: 0 });
  });
  const config = h.rt.stores.poll.getState().config;
  if (!config) throw new Error("Missing config");
  await h.act(() =>
    h.rt.stores.poll.getState().setView({ display: { ...config.display, format: "unsigned32" } }),
  );
  expect(h.rt.stores.ui.getState().selection).toEqual([{ start: 0, end: 0 }]);
});

it("preserves transferred combined multiselection when a new host mounts", async () => {
  const ui = createPollViewUiStore({ getConfig: () => null });
  ui.setState({
    groupWidth: 2,
    focusAddress: 0,
    selection: [{ start: 0, end: 4 }],
    anchorAddress: 0,
  });
  const h = await renderPollView({
    mode: "manual",
    host: "native",
    holdAttach: true,
    handoff: ui.getState().toHandoff(),
    poll: {
      display: {
        format: "unsigned32",
        swapBytes: false,
        reverseWords: false,
        addressBase: 0,
        showAlias: true,
        copyAlias: false,
      },
    },
  });
  await h.release();
  act(() => {
    h.ipc.emitConnectionState("connected");
    h.ipc.emitPollState(h.pollId, "polling");
    h.ipc.emitPollUpdate(h.pollId, { values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  });
  expect(h.rt.stores.ui.getState().selection).toEqual([{ start: 0, end: 4 }]);
});
