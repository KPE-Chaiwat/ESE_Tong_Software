import { act, fireEvent, screen, within } from "@testing-library/react";
import type { PollConfigInput } from "@/shared/ipc/modbus-master.types";
import { presetDefaults } from "../../lib/scale-presets";
import type { ScaledProviderFactory } from "../../lib/scaled";
import type { PollClipboard } from "../../runtime/clipboard";
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

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);

const rowOf = (index: number): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-row="${index}"]`);
  if (!el) throw new Error(`row ${index} is not rendered`);
  return el;
};
const aliasCell = (index: number): HTMLElement => {
  const cell = rowOf(index).querySelector<HTMLElement>('[data-cell="alias"]');
  if (!cell) throw new Error(`no alias cell in row ${index}`);
  return cell;
};
const rawCell = (index: number): HTMLElement =>
  rowOf(index).querySelector('[data-cell="raw"]') as HTMLElement;
const grid = () => screen.getByRole("grid", { name: "Register values" });
const toastTexts = (h: PollViewHarness) => h.toasts.getState().items.map((t) => t.text);

/** A poll with live values (0, 65535, 32768, then the row number), driven by hand. */
async function liveRows(
  extra: {
    poll?: Partial<PollConfigInput>;
    createScaled?: ScaledProviderFactory;
    clipboard?: PollClipboard;
  } = {},
  quantity = 3,
) {
  const h = await renderPollView({
    host: "workspace",
    mode: "manual",
    poll: {
      definition: { slaveId: 1, function: 3, startAddress: 0, quantity, scanRateMs: 100 },
      ...extra.poll,
    },
    ...(extra.createScaled ? { createScaled: extra.createScaled } : {}),
    ...(extra.clipboard ? { clipboard: extra.clipboard } : {}),
  });
  act(() => {
    h.ipc.emitConnectionState("connected");
    h.ipc.emitPollState(h.pollId, "polling");
    h.ipc.emitPollUpdate(h.pollId, {
      values: Array.from({ length: quantity }, (_, i) => [0, 65535, 32768][i] ?? i),
    });
  });
  return h;
}

const threeRows = liveRows;
/** A 10-row poll (addresses 0-9), for paste. */
const tenRows = () => liveRows({}, 10);

const mA: ScaledProviderFactory = () => (raw) => ({
  text: (4 + (raw / 65535) * 16).toFixed(2),
  unit: "mA",
  marker: "none",
  tooltip: null,
  label: "",
  override: null,
});

describe("alias editing (DES-002 2.3.5)", () => {
  it("double-click on an alias cell opens an editor labelled for its address", async () => {
    const h = await threeRows();
    await h.user.dblClick(aliasCell(1));
    const input = screen.getByRole("textbox", { name: "Alias for address 1" });
    expect(input).toHaveFocus();
    expect(input).toHaveValue("");
  });

  it("typing in the grid does not start editing", async () => {
    const h = await threeRows();
    await h.user.click(rawCell(0));
    await h.user.keyboard("abc");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("the editor shows the current alias with its text selected", async () => {
    const h = await threeRows({ poll: { aliases: [{ address: 0, alias: "Tank top" }] } });
    await h.user.dblClick(aliasCell(0));
    const input = screen.getByRole("textbox", { name: "Alias for address 0" }) as HTMLInputElement;
    expect(input).toHaveValue("Tank top");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Tank top".length);
  });

  it("F2 with grid focus edits the alias of the focused row", async () => {
    const h = await threeRows();
    await h.user.click(rawCell(2));
    await h.user.keyboard("{F2}");
    expect(screen.getByRole("textbox", { name: "Alias for address 2" })).toHaveFocus();
  });

  it("the context menu entry Edit alias (F2) does the same", async () => {
    const h = await threeRows();
    await h.user.pointer({ keys: "[MouseRight]", target: rawCell(1) });
    await h.user.click(screen.getByRole("menuitem", { name: /Edit alias/ }));
    expect(screen.getByRole("textbox", { name: "Alias for address 1" })).toBeInTheDocument();
  });

  it("Edit alias in the context menu edits the right-clicked row, not the focused one (REV-005 m-6)", async () => {
    const h = await threeRows();
    // Rows 0-2 are selected with the focus on row 2; the menu opens on row 0.
    await h.user.click(rawCell(0));
    await h.user.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}");
    expect(h.rt.stores.ui.getState().focusAddress).toBe(2);
    await h.user.pointer({ keys: "[MouseRight]", target: rawCell(0) });
    await h.user.click(screen.getByRole("menuitem", { name: /Edit alias/ }));
    expect(screen.getByRole("textbox", { name: "Alias for address 0" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Alias for address 2" })).not.toBeInTheDocument();
  });

  it("the keyboard menu key opens the menu on the focused row", async () => {
    const h = await threeRows();
    await h.user.click(rawCell(1));
    await h.user.keyboard("{ContextMenu}");
    await h.user.click(screen.getByRole("menuitem", { name: /Edit alias/ }));
    expect(screen.getByRole("textbox", { name: "Alias for address 1" })).toBeInTheDocument();
  });

  it("Enter saves the alias and opens the next row's editor; the profile settings carry only the aliases", async () => {
    const h = await threeRows();
    await h.user.dblClick(aliasCell(0));
    await h.user.keyboard("Tank top{Enter}");
    expect(h.ipc.callsOf("setPollView")).toEqual([
      [h.pollId, { aliases: [{ address: 0, alias: "Tank top" }] }],
    ]);
    expect(screen.getByRole("textbox", { name: "Alias for address 1" })).toHaveFocus();
    expect(aliasCell(0)).toHaveTextContent("Tank top");
  });

  it("Enter on the last row saves and ends editing; focus returns to the grid", async () => {
    const h = await threeRows();
    await h.user.dblClick(aliasCell(2));
    await h.user.keyboard("Last{Enter}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(aliasCell(2)).toHaveTextContent("Last");
    expect(grid()).toHaveFocus();
  });

  it("Shift+Enter saves and opens the previous row's editor", async () => {
    const h = await threeRows();
    await h.user.dblClick(aliasCell(1));
    await h.user.keyboard("B{Shift>}{Enter}{/Shift}");
    expect(screen.getByRole("textbox", { name: "Alias for address 0" })).toBeInTheDocument();
    expect(aliasCell(1)).toHaveTextContent("B");
  });

  it("Tab saves and ends editing", async () => {
    const h = await threeRows();
    await h.user.dblClick(aliasCell(0));
    await h.user.keyboard("A{Tab}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(aliasCell(0)).toHaveTextContent("A");
  });

  it("Esc cancels and restores the previous text", async () => {
    const h = await threeRows({ poll: { aliases: [{ address: 0, alias: "Old" }] } });
    await h.user.dblClick(aliasCell(0));
    await h.user.keyboard("{Control>}a{/Control}New{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(aliasCell(0)).toHaveTextContent("Old");
    expect(h.ipc.callsOf("setPollView")).toHaveLength(0);
  });

  it("Enter on the next row and Esc there leaves it empty", async () => {
    const h = await threeRows();
    await h.user.dblClick(aliasCell(0));
    await h.user.keyboard("A{Enter}B{Escape}");
    expect(aliasCell(0)).toHaveTextContent("A");
    expect(aliasCell(1)).not.toHaveAttribute("title");
  });

  it("blur saves a valid text", async () => {
    const h = await threeRows();
    await h.user.dblClick(aliasCell(0));
    await h.user.keyboard("Blurred");
    await h.user.click(rawCell(2));
    expect(aliasCell(0)).toHaveTextContent("Blurred");
    expect(h.ipc.callsOf("setPollView")).toHaveLength(1);
  });

  it("blur reverts an invalid text silently", async () => {
    const h = await threeRows();
    await h.user.dblClick(aliasCell(0));
    await h.user.keyboard("x".repeat(33));
    await h.user.click(rawCell(2));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(aliasCell(0)).not.toHaveAttribute("title");
    expect(h.ipc.callsOf("setPollView")).toHaveLength(0);
  });

  it("an empty or spaces-only text removes the alias", async () => {
    const h = await threeRows({ poll: { aliases: [{ address: 1, alias: "Old" }] } });
    await h.user.dblClick(aliasCell(1));
    await h.user.keyboard("{Control>}a{/Control}   {Enter}");
    expect(h.ipc.callsOf("setPollView")).toEqual([[h.pollId, { aliases: [] }]]);
    expect(aliasCell(1)).not.toHaveAttribute("title");
  });

  it("the focused row without an alias shows the placeholder Alias…", async () => {
    const h = await threeRows();
    expect(screen.queryByText("Alias…")).not.toBeInTheDocument();
    await h.user.click(rawCell(1));
    expect(within(aliasCell(1)).getByText("Alias…")).toBeInTheDocument();
    await h.user.click(rawCell(2));
    expect(within(aliasCell(1)).queryByText("Alias…")).not.toBeInTheDocument();
  });

  it("the Alias column is the first column and can be hidden", async () => {
    const h = await threeRows({
      poll: { display: { format: "unsigned", addressBase: 0, showAlias: false, copyAlias: false } },
    });
    expect(rowOf(0).querySelector('[data-cell="alias"]')).toBeNull();
    await h.act(() => h.rt.actions.setShowAlias(true));
    const first = rowOf(0).querySelector("[data-cell]");
    expect(first).toHaveAttribute("data-cell", "alias");
  });

  it("a long alias is truncated, with the whole text in the tooltip", async () => {
    const long = "Boiler outlet temperature sensor 12";
    const h = await threeRows({ poll: { aliases: [{ address: 0, alias: long.slice(0, 32) }] } });
    expect(aliasCell(0)).toHaveAttribute("title", long.slice(0, 32));
    expect(aliasCell(0).className).toContain("truncate");
    expect(h.ipc.pollSummary(h.pollId).config.aliases).toHaveLength(1);
  });
});

describe("alias validation (DES-002 section 4)", () => {
  async function editing() {
    const h = await threeRows();
    await h.user.dblClick(aliasCell(0));
    return { h, input: screen.getByRole("textbox", { name: "Alias for address 0" }) };
  }

  it("33 characters: the message shows, the field is invalid, Enter does nothing", async () => {
    const { h, input } = await editing();
    fireEvent.change(input, { target: { value: "x".repeat(33) } });
    expect(screen.getByText("Alias must be at most 32 characters.")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(
      screen.getByText("Alias must be at most 32 characters.").closest("p")?.id,
    );
    await h.user.keyboard("{Enter}");
    expect(screen.getByRole("textbox", { name: "Alias for address 0" })).toBeInTheDocument();
    expect(h.ipc.callsOf("setPollView")).toHaveLength(0);
  });

  it("32 characters are accepted", async () => {
    const { h, input } = await editing();
    fireEvent.change(input, { target: { value: "x".repeat(32) } });
    expect(screen.queryByText("Alias must be at most 32 characters.")).not.toBeInTheDocument();
    await h.user.keyboard("{Enter}");
    expect(h.ipc.callsOf("setPollView")).toHaveLength(1);
  });

  it("leading or trailing space", async () => {
    const { input } = await editing();
    fireEvent.change(input, { target: { value: " a" } });
    expect(screen.getByText("Alias cannot start or end with a space.")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "a " } });
    expect(screen.getByText("Alias cannot start or end with a space.")).toBeInTheDocument();
  });

  it("a control character (a tab) in the text", async () => {
    const { input } = await editing();
    fireEvent.change(input, { target: { value: `a${TAB}b` } });
    expect(screen.getByText("Alias cannot contain control characters.")).toBeInTheDocument();
  });

  it("the message clears when the text becomes valid", async () => {
    const { input } = await editing();
    fireEvent.change(input, { target: { value: "x".repeat(33) } });
    fireEvent.change(input, { target: { value: "ok" } });
    expect(screen.queryByText("Alias must be at most 32 characters.")).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("duplicate aliases are allowed (no message)", async () => {
    const h = await threeRows({ poll: { aliases: [{ address: 0, alias: "PT-201" }] } });
    await h.user.dblClick(aliasCell(1));
    await h.user.keyboard("PT-201{Enter}");
    expect(h.ipc.pollSummary(h.pollId).config.aliases).toHaveLength(2);
    expect(screen.queryByText(/already/)).not.toBeInTheDocument();
  });

  it("a backend rejection rolls the alias back and shows an error toast", async () => {
    const h = await threeRows();
    h.ipc.failNext("setPollView", "Rust said no");
    await h.user.dblClick(aliasCell(0));
    await h.user.keyboard("A{Tab}");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(aliasCell(0)).not.toHaveAttribute("title");
    expect(toastTexts(h)).toEqual(["Rust said no"]);
  });
});

describe("paste aliases (Ctrl+V and the menu)", () => {
  it("Ctrl+V with 'A' and 'B' on row 8 sets aliases 8 and 9 and shows the toast", async () => {
    const h = await tenRows();
    await h.user.click(rawCell(8));
    await h.user.paste(`A${LF}B`);
    expect(h.ipc.pollSummary(h.pollId).config.aliases).toEqual([
      { address: 8, alias: "A" },
      { address: 9, alias: "B" },
    ]);
    expect(toastTexts(h)).toEqual(["Pasted 2 aliases."]);
    expect(aliasCell(8)).toHaveTextContent("A");
    expect(aliasCell(9)).toHaveTextContent("B");
  });

  it("lines past the range and invalid lines are counted in the toast", async () => {
    const h = await tenRows();
    await h.user.click(rawCell(7));
    await h.user.paste(["A", "x".repeat(40), "C", "D", "E"].join(LF));
    // rows 7, 8, 9 are in range (8 is invalid), D and E are beyond
    expect(toastTexts(h)).toEqual([
      "Pasted 2 aliases. Skipped 1 invalid lines. 2 lines were beyond the poll range.",
    ]);
  });

  it("the example of CHK2-J6: A, B, empty, C on row 8", async () => {
    const h = await tenRows();
    await h.user.click(rawCell(8));
    await h.user.paste(["A", "B", "", "C"].join(LF));
    expect(toastTexts(h)).toEqual(["Pasted 2 aliases. 2 lines were beyond the poll range."]);
  });

  it("text after the first tab of a line is ignored", async () => {
    const h = await tenRows();
    await h.user.click(rawCell(0));
    await h.user.paste(`PT-201${TAB}12.5${TAB}mA`);
    expect(h.ipc.pollSummary(h.pollId).config.aliases).toEqual([{ address: 0, alias: "PT-201" }]);
  });

  it("the menu entry Paste aliases reads the clipboard", async () => {
    const h = await liveRows(
      { clipboard: { writeText: async () => {}, readText: async () => ["X", "Y"].join(LF) } },
      10,
    );
    await h.user.click(rawCell(3));
    await h.user.pointer({ keys: "[MouseRight]", target: rawCell(3) });
    await h.user.click(screen.getByRole("menuitem", { name: /Paste aliases/ }));
    expect(h.ipc.pollSummary(h.pollId).config.aliases).toEqual([
      { address: 3, alias: "X" },
      { address: 4, alias: "Y" },
    ]);
  });

  it("pasting while the editor is open leaves the paste to the editor", async () => {
    const h = await tenRows();
    await h.user.dblClick(aliasCell(0));
    await h.user.paste("Pasted text");
    expect(screen.getByRole("textbox", { name: "Alias for address 0" })).toHaveValue("Pasted text");
    expect(h.ipc.callsOf("setPollView")).toHaveLength(0);
  });
});

describe("Clear alias", () => {
  it("removes the aliases of every selected row, without a confirm", async () => {
    const h = await liveRows(
      {
        poll: {
          aliases: [
            { address: 0, alias: "A" },
            { address: 1, alias: "B" },
            { address: 2, alias: "C" },
            { address: 3, alias: "D" },
          ],
        },
      },
      10,
    );
    await h.user.click(rawCell(0));
    await h.user.keyboard("{Shift>}");
    await h.user.click(rawCell(2));
    await h.user.keyboard("{/Shift}");
    await h.user.pointer({ keys: "[MouseRight]", target: rawCell(1) });
    await h.user.click(screen.getByRole("menuitem", { name: "Clear alias" }));
    expect(h.ipc.pollSummary(h.pollId).config.aliases).toEqual([{ address: 3, alias: "D" }]);
  });

  it("a right click on an unselected row selects it first", async () => {
    const h = await liveRows({ poll: { aliases: [{ address: 5, alias: "F" }] } }, 10);
    await h.user.click(rawCell(0));
    await h.user.pointer({ keys: "[MouseRight]", target: rawCell(5) });
    await h.user.click(screen.getByRole("menuitem", { name: "Clear alias" }));
    expect(h.ipc.pollSummary(h.pollId).config.aliases).toEqual([]);
  });
});

describe("copy with alias (DES-003 3.4)", () => {
  async function selected() {
    const h = await threeRows({
      createScaled: mA,
      poll: {
        valueColumns: "both",
        scale: presetDefaults("current4to20"),
        aliases: [{ address: 0, alias: "PT-201" }],
        display: { format: "unsigned", addressBase: 0, showAlias: true, copyAlias: true },
      },
    });
    await h.user.click(rawCell(0));
    await h.user.keyboard("{Shift>}");
    await h.user.click(rawCell(1));
    await h.user.keyboard("{/Shift}");
    return h;
  }

  it("Ctrl+C on rows 0-1 with Include alias in copy (Both, 4-20 mA)", async () => {
    const h = await selected();
    await h.user.keyboard("{Control>}c{/Control}");
    expect(h.copied).toEqual([`PT-201${TAB}0${TAB}0${TAB}4.00${LF}${TAB}1${TAB}65535${TAB}20.00`]);
    expect(toastTexts(h)).toEqual(["Copied 2 rows."]);
  });

  it("the Include alias in copy checkbox of the context menu toggles it", async () => {
    const h = await selected();
    await h.user.pointer({ keys: "[MouseRight]", target: rawCell(0) });
    const box = screen.getByRole("menuitemcheckbox", { name: "Include alias in copy" });
    expect(box).toHaveAttribute("aria-checked", "true");
    await h.user.click(box);
    expect(h.ipc.pollSummary(h.pollId).config.display.copyAlias).toBe(false);
    await h.user.keyboard("{Control>}c{/Control}");
    expect(h.copied.at(-1)).toBe([`0${TAB}0${TAB}4.00`, `1${TAB}65535${TAB}20.00`].join(LF));
  });

  it("Copy aliases copies only the aliases, one per row", async () => {
    const h = await selected();
    await h.user.pointer({ keys: "[MouseRight]", target: rawCell(0) });
    await h.user.click(screen.getByRole("menuitem", { name: "Copy aliases" }));
    expect(h.copied).toEqual([["PT-201", ""].join(LF)]);
  });

  it("Copy with header starts with the names of the columns that are present", async () => {
    const h = await selected();
    await h.user.pointer({ keys: "[MouseRight]", target: rawCell(0) });
    await h.user.click(screen.getByRole("menuitem", { name: "Copy with header" }));
    expect(h.copied[0]?.split(LF)[0]).toBe(
      ["Alias", "Address (0-based)", "Raw (Unsigned)", "Scaled"].join(TAB),
    );
  });

  it("Copy raw and Copy scaled follow the menu choice", async () => {
    const h = await selected();
    await h.user.pointer({ keys: "[MouseRight]", target: rawCell(0) });
    // a scale exists only through the provider; the entries are enabled when the poll has one
    expect(screen.getByRole("menuitem", { name: "Copy raw" })).not.toHaveAttribute("aria-disabled");
    await h.user.click(screen.getByRole("menuitem", { name: "Copy raw" }));
    expect(h.copied[0]).toBe([`PT-201${TAB}0${TAB}0`, `${TAB}1${TAB}65535`].join(LF));
  });

  it("Copy scaled is disabled while the poll has no scale", async () => {
    const h = await threeRows();
    await h.user.click(rawCell(0));
    await h.user.pointer({ keys: "[MouseRight]", target: rawCell(0) });
    const entry = screen.getByRole("menuitem", { name: "Copy scaled" });
    expect(entry).toHaveAttribute("aria-disabled", "true");
    expect(entry).toHaveAttribute("title", "Set a scale to show scaled values.");
  });

  it("Ctrl+A selects every row; Esc clears the selection", async () => {
    const h = await threeRows();
    await h.user.click(rawCell(1));
    await h.user.keyboard("{Control>}a{/Control}");
    expect(rowOf(0)).toHaveAttribute("aria-selected", "true");
    expect(rowOf(2)).toHaveAttribute("aria-selected", "true");
    await h.user.keyboard("{Escape}");
    expect(rowOf(0)).toHaveAttribute("aria-selected", "false");
  });

  it("the arrow keys move the selection; Home and End jump", async () => {
    const h = await threeRows();
    await h.user.click(rawCell(0));
    await h.user.keyboard("{ArrowDown}{ArrowDown}");
    expect(rowOf(2)).toHaveAttribute("aria-selected", "true");
    expect(grid()).toHaveAttribute("aria-activedescendant", rowOf(2).id);
    await h.user.keyboard("{Home}");
    expect(rowOf(0)).toHaveAttribute("aria-selected", "true");
    await h.user.keyboard("{End}");
    expect(rowOf(2)).toHaveAttribute("aria-selected", "true");
  });
});
