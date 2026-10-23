// The Value format section of the value-row menu (DES-010 10, FE-010 task 05), in both hosts: the
// four quick 16-bit formats with their Ctrl+1..4 hints, the checked state, `More formats…`, the split
// rule and the coil / discrete polls.
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { FormatOverride, PollConfigInput } from "@/shared/ipc/modbus-master.types";
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

const ov = (
  start: number,
  end: number,
  format: FormatOverride["format"],
  flags: Partial<FormatOverride> = {},
): FormatOverride => ({ start, end, format, swapBytes: false, reverseWords: false, ...flags });

const def = (start: number, quantity: number) => ({
  slaveId: 1,
  function: 3 as const,
  startAddress: start,
  quantity,
  scanRateMs: 100,
});

const rowOf = (index: number): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-row="${index}"]`);
  if (!el) throw new Error(`row ${index} is not rendered`);
  return el;
};
const grid = () => screen.getByRole("grid", { name: "Register values" });
const indexOf = (h: PollViewHarness, address: number) =>
  h.rt.rows().findIndex((r) => r.address === address);

async function live(
  host: "workspace" | "native",
  values: number[],
  poll: Partial<PollConfigInput> = {},
): Promise<PollViewHarness> {
  const h = await renderPollView({
    host,
    mode: "manual",
    poll: { definition: def(0, values.length), ...poll },
  });
  act(() => {
    h.ipc.emitConnectionState("connected");
    h.ipc.emitPollState(h.pollId, "polling");
    h.ipc.emitPollUpdate(h.pollId, { values });
  });
  return h;
}

/** Selects rows (by first address). */
function select(h: PollViewHarness, from: number, to = from) {
  act(() => {
    h.rt.stores.ui.getState().click(from);
    if (to !== from) h.rt.stores.ui.getState().click(to, { shift: true });
  });
}

/** Right-clicks the row with this first address and returns the row menu. */
async function menuOn(h: PollViewHarness, address: number) {
  await h.user.pointer({ keys: "[MouseRight]", target: rowOf(indexOf(h, address)) });
  return screen.getByRole("menu", { name: "Row actions" });
}

const QUICK = ["Unsigned", "Signed", "Hex", "Binary"] as const;
const quick = (menu: HTMLElement, name: (typeof QUICK)[number]) =>
  within(menu).getByRole("menuitemradio", { name: new RegExp(`^${name}`) });
const checkedQuick = (menu: HTMLElement) =>
  QUICK.filter((name) => quick(menu, name).getAttribute("aria-checked") === "true");
const heading = (menu: HTMLElement) => within(menu).getByText(/^Value format/).textContent;

describe.each(["workspace", "native"] as const)(
  "Value format section of the row menu in %s",
  (host) => {
    const TEN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    it("lists Unsigned (checked), Signed, Hex, Binary and More formats…, with hints and no old format entry", async () => {
      const h = await live(host, TEN);
      const menu = await menuOn(h, 0);
      // the section is the top of the menu: heading, four radios, More formats…, separator
      const items = Array.from(menu.querySelectorAll('[role^="menuitem"]'))
        .slice(0, 5)
        .map((el) => el.getAttribute("data-menu-id"));
      expect(items).toEqual([
        "format-unsigned",
        "format-signed",
        "format-hex",
        "format-binary",
        "more-formats",
      ]);
      expect(heading(menu)).toBe("Value format");
      QUICK.forEach((name, i) => {
        const item = quick(menu, name);
        expect(item).toHaveTextContent(`Ctrl+${i + 1}`);
        expect(item.getAttribute("aria-checked")).toBe(name === "Unsigned" ? "true" : "false");
        // never colour only: the check mark is an icon
        expect(item.querySelector("[data-icon='check']") !== null).toBe(name === "Unsigned");
      });
      expect(within(menu).getByRole("menuitem", { name: "More formats…" })).not.toHaveAttribute(
        "aria-disabled",
      );
      expect(within(menu).queryByRole("menuitem", { name: /Format \/ endian/ })).toBeNull();
      // the section is one labelled group (heading first), followed by a separator
      const roles = Array.from(menu.children).map((el) => el.getAttribute("role"));
      expect(roles[0]).toBe("group");
      expect(roles[1]).toBe("separator");
      expect(menu.children[0]?.firstElementChild?.getAttribute("role")).toBe("presentation");
      expect(menu.children[0]?.children).toHaveLength(6);
      // the focus lands on the first enabled entry
      expect(quick(menu, "Unsigned")).toHaveFocus();
    });

    it("Hex on rows 2-3 sets the selection without a dialog and sends no Modbus request", async () => {
      const h = await live(host, TEN);
      const requests = h.ipc.requestLog.length;
      select(h, 2, 3);
      const menu = await menuOn(h, 2);
      await h.user.click(quick(menu, "Hex"));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(h.ipc.callsOf("setPollView")).toEqual([
        [h.pollId, { formatOverrides: [ov(2, 3, "hex")] }],
      ]);
      expect(h.ipc.requestLog).toHaveLength(requests);
      // the only command the quick format sent is the view setting
      expect(h.ipc.calls.map((c) => c.method).filter((m) => m === "setPollView")).toHaveLength(1);
      expect(h.ipc.calls.some((c) => /write|read/i.test(c.method))).toBe(false);
      expect(h.announced).toEqual(["Format applied: Hex to 2-3."]);
      // the menu is gone and the focus is back on the grid
      expect(screen.queryByRole("menu")).toBeNull();
      expect(grid()).toHaveFocus();
    });

    it.each([
      ["Signed", "signed"],
      ["Hex", "hex"],
      ["Binary", "binary"],
      ["Unsigned", "unsigned"],
    ] as const)("%s sends the payload of the matching Ctrl+N shortcut", async (name, format) => {
      // the menu item
      const viaMenu = await live(host, TEN, { formatOverrides: [ov(0, 9, "hex")] });
      select(viaMenu, 4, 5);
      const menu = await menuOn(viaMenu, 4);
      await viaMenu.user.click(quick(menu, name));
      const fromMenu = viaMenu.ipc.callsOf("setPollView");
      // the shortcut action on the same state
      const viaKey = await live(host, TEN, { formatOverrides: [ov(0, 9, "hex")] });
      select(viaKey, 4, 5);
      await viaKey.act(() => viaKey.rt.actions.setSelectedFormat(format));
      expect(fromMenu.map(([, patch]) => patch)).toEqual(
        viaKey.ipc.callsOf("setPollView").map(([, patch]) => patch),
      );
    });

    it("a click on a row outside the selection formats that row only", async () => {
      const h = await live(host, TEN);
      select(h, 2, 3);
      const menu = await menuOn(h, 7);
      await h.user.click(quick(menu, "Binary"));
      expect(h.ipc.callsOf("setPollView")).toEqual([
        [h.pollId, { formatOverrides: [ov(7, 7, "binary")] }],
      ]);
    });

    it("a group row has no checked item and says its format; Signed makes two Signed rows without a toast", async () => {
      const h = await live(host, TEN, { formatOverrides: [ov(2, 3, "float32")] });
      select(h, 2);
      const menu = await menuOn(h, 2);
      expect(checkedQuick(menu)).toEqual([]);
      expect(heading(menu)).toBe("Value format: F32 ABCD");
      await h.user.click(quick(menu, "Signed"));
      expect(h.ipc.callsOf("setPollView")).toEqual([
        [h.pollId, { formatOverrides: [ov(2, 3, "signed")] }],
      ]);
      expect(h.toasts.getState().items).toEqual([]);
    });

    it("an edge-cut group row: Signed resets the register outside the poll and says so (Q-010-02)", async () => {
      const h = await live(host, [1, 2, 3, 4], {
        definition: def(101, 4),
        formatOverrides: [ov(100, 101, "float32")],
      });
      select(h, 101);
      const menu = await menuOn(h, 101);
      await h.user.click(quick(menu, "Signed"));
      expect(h.ipc.callsOf("setPollView")).toEqual([
        [h.pollId, { formatOverrides: [ov(101, 101, "signed")] }],
      ]);
      expect(h.toasts.getState().items.map((t) => t.text)).toEqual([
        "Signed applied to 101. Also reset 100 to Unsigned because a combined value was split.",
      ]);
    });

    it("mixed formats check nothing and say so", async () => {
      const h = await live(host, TEN, { formatOverrides: [ov(0, 1, "float32"), ov(2, 3, "hex")] });
      select(h, 0, 3);
      const menu = await menuOn(h, 0);
      expect(checkedQuick(menu)).toEqual([]);
      expect(heading(menu)).toBe("Value format: mixed");
    });

    it("the item of the common 16-bit format is checked; choosing it again sends nothing", async () => {
      const h = await live(host, TEN, { formatOverrides: [ov(0, 9, "hex")] });
      select(h, 0, 9);
      const menu = await menuOn(h, 0);
      expect(checkedQuick(menu)).toEqual(["Hex"]);
      await h.user.click(quick(menu, "Hex"));
      expect(h.ipc.callsOf("setPollView")).toEqual([]);
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("Signed next to Unsigned is mixed", async () => {
      const h = await live(host, TEN, { formatOverrides: [ov(6, 6, "signed")] });
      select(h, 6, 7);
      const menu = await menuOn(h, 6);
      expect(checkedQuick(menu)).toEqual([]);
      expect(heading(menu)).toBe("Value format: mixed");
    });

    it("More formats… opens the dialog for the same selection", async () => {
      const h = await live(host, TEN);
      select(h, 0, 3);
      const menu = await menuOn(h, 0);
      await h.user.click(within(menu).getByRole("menuitem", { name: "More formats…" }));
      const dialog = screen.getByRole("dialog", { name: "Format / endian" });
      expect(within(dialog).getByTestId("format-summary")).toHaveTextContent(
        "Selected 4 registers (0-3)",
      );
      // Esc returns the focus to the grid row that opened it
      fireEvent.keyDown(dialog, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(grid()).toHaveFocus();
      expect(grid().getAttribute("aria-activedescendant")).toBe(rowOf(indexOf(h, 0)).id);
    });

    it("keyboard: Shift+F10 focuses Unsigned, ArrowDown x4 reaches More formats…, Enter opens the dialog", async () => {
      const h = await live(host, TEN);
      select(h, 2);
      grid().focus();
      await h.user.keyboard("{Shift>}{F10}{/Shift}");
      const menu = screen.getByRole("menu", { name: "Row actions" });
      expect(quick(menu, "Unsigned")).toHaveFocus();
      await h.user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
      expect(within(menu).getByRole("menuitem", { name: "More formats…" })).toHaveFocus();
      await h.user.keyboard("{Enter}");
      expect(screen.getByRole("dialog", { name: "Format / endian" })).toBeVisible();
    });

    it("keyboard: Space on Signed applies it, Esc closes the menu and keeps the focused row", async () => {
      const h = await live(host, TEN);
      select(h, 2);
      grid().focus();
      await h.user.keyboard("{Shift>}{F10}{/Shift}");
      await h.user.keyboard("{ArrowDown}{ }");
      expect(h.ipc.callsOf("setPollView")).toEqual([
        [h.pollId, { formatOverrides: [ov(2, 2, "signed")] }],
      ]);
      expect(grid()).toHaveFocus();
      const active = grid().getAttribute("aria-activedescendant");
      await h.user.keyboard("{Shift>}{F10}{/Shift}");
      await h.user.keyboard("{Escape}");
      expect(screen.queryByRole("menu")).toBeNull();
      expect(grid()).toHaveFocus();
      expect(grid().getAttribute("aria-activedescendant")).toBe(active);
      expect(h.ipc.callsOf("setPollView")).toHaveLength(1);
    });

    it("with nothing selected the focused row is the target (Shift+F10 after Esc)", async () => {
      const h = await live(host, TEN, { formatOverrides: [ov(5, 5, "binary")] });
      select(h, 5);
      grid().focus();
      await h.user.keyboard("{Escape}");
      expect(h.rt.stores.ui.getState().selection).toEqual([]);
      await h.user.keyboard("{Shift>}{F10}{/Shift}");
      const menu = screen.getByRole("menu", { name: "Row actions" });
      expect(checkedQuick(menu)).toEqual(["Binary"]);
    });

    it("a coil poll shows only More formats…, disabled with its reason, and no heading", async () => {
      const h = await live(host, [1, 0, 1, 1], {
        definition: { slaveId: 1, function: 1, startAddress: 0, quantity: 4, scanRateMs: 100 },
      });
      const menu = await menuOn(h, 0);
      const more = within(menu).getByRole("menuitem", { name: "More formats…" });
      expect(more).toHaveAttribute("aria-disabled", "true");
      expect(more).toHaveAttribute("title", "Coils and discrete inputs are shown as 0 or 1.");
      for (const name of QUICK) {
        expect(
          within(menu).queryByRole("menuitemradio", { name: new RegExp(`^${name}`) }),
        ).toBeNull();
      }
      expect(within(menu).queryByText(/^Value format/)).toBeNull();
      // choosing the disabled entry does nothing; the first enabled entry has the focus
      expect(within(menu).getByRole("menuitem", { name: /^Edit alias/ })).toHaveFocus();
      await h.user.click(more);
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  },
);
