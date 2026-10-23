// Revision 2 of the Format dialog D1 (FE-009 R2-02..R2-10, DES-009 section 11, CHK-009 section L),
// in both hosts: the owner's scenario, group rows always whole, Esc keeps the focused row, the first
// overlay click after pointer use inside, the 466 x 283 layout, the poll going away and the stale
// notice of every retained-values state. Texts follow DES-010 (summary instead of the scope line,
// disabled widths instead of rounding).
import { act, screen, waitFor, within } from "@testing-library/react";
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
const S32_BADC = ov(0, 9, "signed32", { swapBytes: true });

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
const dialog = () => screen.getByRole("dialog", { name: "Format / endian" });
const radio = (name: string) => within(dialog()).getByRole("radio", { name });
const apply = () => within(dialog()).getByRole("button", { name: /^Appl/ });
const messages = () => within(dialog()).getByTestId("format-messages");
const warningLines = () =>
  Array.from(messages().querySelectorAll("[data-kind='warning'] p")).map((p) => p.textContent);
const overlay = () => document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');
const scopeText = () => within(dialog()).getByTestId("format-summary").textContent;
const reason = (bits: 32 | 64) => within(dialog()).queryByTestId(`width-reason-${bits}`);
const closed = () => waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

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

const TEN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const indexOf = (h: PollViewHarness, address: number) => address - (h.rt.rows()[0]?.address ?? 0);

/** Real pointer clicks on the visible register line for an address. */
async function clickRow(
  h: PollViewHarness,
  address: number,
  mods: { shift?: boolean; ctrl?: boolean } = {},
) {
  if (mods.shift) await h.user.keyboard("{Shift>}");
  if (mods.ctrl) await h.user.keyboard("{Control>}");
  await h.user.click(rowOf(indexOf(h, address)));
  if (mods.ctrl) await h.user.keyboard("{/Control}");
  if (mods.shift) await h.user.keyboard("{/Shift}");
}

/** Right-click on a row, then More formats… from its menu. */
async function openFromRowMenu(h: PollViewHarness, address: number) {
  await h.user.pointer({ keys: "[MouseRight]", target: rowOf(indexOf(h, address)) });
  await h.user.click(screen.getByRole("menuitem", { name: "More formats…" }));
  return dialog();
}

describe.each(["workspace", "native"] as const)(
  "CHK9-94..96 the owner's scenario in %s",
  (host) => {
    it("CHK9-94: row 0-1 of [0-9 S32 BADC] opens on its own format with Apply on and a whole-row scope", async () => {
      const h = await live(host, TEN, { formatOverrides: [S32_BADC] });
      await clickRow(h, 0);
      await openFromRowMenu(h, 0);
      expect(scopeText()).toBe("Selected 2 registers (0-1)");
      expect(radio("Signed 32-bit")).toBeChecked();
      expect(radio("Big-endian byte swap")).toBeChecked();
      expect(
        within(messages()).getByText("The selected rows already use this format."),
      ).toBeVisible();
      expect(warningLines()).toEqual([]);
      expect(apply()).not.toHaveAttribute("aria-disabled");
      expect(dialog().textContent).not.toContain("1 register is selected");
      await h.user.click(apply());
      await closed();
      expect(h.ipc.callsOf("setPollView")).toEqual([]);
    });

    it("CHK9-94: a right-click alone (no click first) opens on the whole row too", async () => {
      const h = await live(host, TEN, { formatOverrides: [S32_BADC] });
      await openFromRowMenu(h, 0);
      expect(scopeText()).toBe("Selected 2 registers (0-1)");
      expect(apply()).not.toHaveAttribute("aria-disabled");
    });

    it("CHK9-95: row 0 alone after the group became two rows: Unsigned, 32-bit disabled with the reason, then row 1 selected too", async () => {
      const h = await live(host, TEN, { formatOverrides: [S32_BADC] });
      // 1. row 0-1 gets Unsigned (Apply): rows 0 and 1 are separate registers again
      await clickRow(h, 0);
      await openFromRowMenu(h, 0);
      await h.user.click(radio("Unsigned"));
      await h.user.click(apply());
      await closed();
      expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([
        ov(2, 9, "signed32", { swapBytes: true }),
      ]);
      // 2. row 0 alone
      await clickRow(h, 0);
      await openFromRowMenu(h, 0);
      expect(scopeText()).toBe("Selected 1 register (0)");
      expect(radio("Unsigned")).toBeChecked();
      expect(apply()).not.toHaveAttribute("aria-disabled");
      // One selected register can form a 32-bit value with the next poll register.
      expect(radio("Signed 32-bit")).toBeEnabled();
      expect(reason(32)).toBeNull();
      expect(warningLines()).toEqual([]);
      expect(apply()).not.toHaveAttribute("aria-disabled");
      // 3. Cancel, Shift+click row 1, reopen, Signed 32-bit: fits
      await h.user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
      await clickRow(h, 0);
      await clickRow(h, 1, { shift: true });
      await openFromRowMenu(h, 1);
      expect(scopeText()).toBe("Selected 2 registers (0-1)");
      expect(radio("Signed 32-bit")).toBeEnabled();
      await h.user.click(radio("Signed 32-bit"));
      expect(warningLines()).toEqual([]);
      expect(apply()).not.toHaveAttribute("aria-disabled");
    });

    it("CHK9-95: with address base 1 the summary and added register use base 1", async () => {
      const h = await live(host, TEN);
      await h.act(() => h.rt.actions.setAddressBase(1));
      await clickRow(h, 0);
      await openFromRowMenu(h, 0);
      expect(scopeText()).toBe("Selected 1 register (1)");
      expect(radio("Signed 32-bit")).toBeEnabled();
      await h.user.click(radio("Signed 32-bit"));
      expect(
        within(dialog()).getByText("Also includes register 2 to complete the selected values."),
      ).toBeVisible();
      expect(within(dialog()).getByText("Address (1-based)")).toBeVisible();
    });

    describe("CHK9-96 every path leaves the D1 scope at whole rows (REQ-009 item 13)", () => {
      it("click, right-click outside the selection, Shift+click, Ctrl+click and Ctrl+A", async () => {
        const h = await live(host, TEN, { formatOverrides: [S32_BADC] });
        // click 0-1
        await clickRow(h, 0);
        await openFromRowMenu(h, 0);
        expect(scopeText()).toBe("Selected 2 registers (0-1)");
        await h.user.keyboard("{Escape}");
        await closed();
        // right-click 4-5 while 0-1 is selected: the menu row becomes the selection
        await openFromRowMenu(h, 4);
        expect(scopeText()).toBe("Selected 2 registers (4-5)");
        await h.user.keyboard("{Escape}");
        await closed();
        // Shift+click from 0-1 to 2-3
        await clickRow(h, 0);
        await clickRow(h, 2, { shift: true });
        await openFromRowMenu(h, 2);
        expect(scopeText()).toBe("Selected 4 registers (0-3)");
        await h.user.keyboard("{Escape}");
        await closed();
        // Ctrl+click 0-1 and 4-5
        await clickRow(h, 0);
        await clickRow(h, 4, { ctrl: true });
        await openFromRowMenu(h, 4);
        expect(scopeText()).toBe("Selected 4 registers (0-1, 4-5)");
        await h.user.keyboard("{Escape}");
        await closed();
        // Ctrl+A
        await clickRow(h, 0);
        await h.user.keyboard("{Control>}a{/Control}");
        await openFromRowMenu(h, 0);
        expect(scopeText()).toBe("Selected 10 registers (0-9)");
      });

      it("Ctrl+A, Signed 32-bit BADC with row 0 selected before, then Format… without touching the grid", async () => {
        const h = await live(host, TEN);
        await clickRow(h, 0);
        await clickRow(h, 1, { shift: true });
        await h.user.click(screen.getByRole("button", { name: "Format…" }));
        await h.user.click(radio("Signed 32-bit"));
        await h.user.click(radio("Big-endian byte swap"));
        await h.user.click(apply());
        await closed();
        expect(h.rt.stores.ui.getState().selection).toEqual([{ start: 0, end: 1 }]);
        await h.user.click(screen.getByRole("button", { name: "Format…" }));
        expect(scopeText()).toBe("Selected 2 registers (0-1)");
        expect(radio("Signed 32-bit")).toBeChecked();
        expect(apply()).not.toHaveAttribute("aria-disabled");
      });

      it("a selection made before the formats changed is widened by the change", async () => {
        const h = await live(host, TEN);
        await clickRow(h, 0);
        expect(h.rt.stores.ui.getState().selection).toEqual([{ start: 0, end: 0 }]);
        await h.act(() => h.ipc.setPollView(h.pollId, { formatOverrides: [S32_BADC] }));
        expect(h.rt.stores.ui.getState().selection).toEqual([{ start: 0, end: 1 }]);
        await h.user.click(screen.getByRole("button", { name: "Format…" }));
        expect(scopeText()).toBe("Selected 2 registers (0-1)");
      });

      it("Esc, then Format… with the focus on 2-3", async () => {
        const h = await live(host, TEN, { formatOverrides: [S32_BADC] });
        await clickRow(h, 2);
        await h.user.keyboard("{Escape}");
        expect(h.rt.stores.ui.getState().selection).toEqual([]);
        await h.user.click(screen.getByRole("button", { name: "Format…" }));
        expect(scopeText()).toBe("Selected 2 registers (2-3)");
      });

      it("the scope handed to the store is widened even when a caller passes half a group", async () => {
        const h = await live(host, TEN, { formatOverrides: [S32_BADC] });
        act(() => {
          h.rt.stores.formatDialog.getState().openFor([{ start: 0, end: 0 }], "header", 0);
        });
        expect(scopeText()).toBe("Selected 2 registers (0-1)");
        expect(apply()).not.toHaveAttribute("aria-disabled");
      });

      it("a handoff with the selection [0] arrives as 0-1 and opens D1 on the whole row", async () => {
        const h = await renderPollView({
          host,
          mode: "manual",
          poll: { definition: def(0, 10), formatOverrides: [S32_BADC] },
          holdAttach: true,
          handoff: JSON.stringify({
            version: 1,
            inspectedGroupAddress: null,
            ruleDraft: null,
            setupOpen: false,
            setupOverride: false,
            selection: [{ start: 0, end: 0 }],
            anchorAddress: 0,
            focusAddress: 0,
            topAddress: null,
            columnWidths: { alias: 160, address: 120, format: 96, raw: 160, scaled: 160 },
            pollDraft: null,
            scaleDraft: null,
          }),
        });
        await h.release();
        expect(h.rt.stores.ui.getState().selection).toEqual([{ start: 0, end: 1 }]);
        await h.user.click(screen.getByRole("button", { name: "Format…" }));
        expect(scopeText()).toBe("Selected 2 registers (0-1)");
      });
    });
  },
);

describe.each(["workspace", "native"] as const)("CHK9-97 mixed acceptance in %s", (host) => {
  it("four Applies from a fresh poll, each leaving the other rows as they were, none opening stuck", async () => {
    const h = await live(host, [0x4148, 0x0000, 16712, 16712, 161, 161, 0xfffe, 9, 10, 1]);
    const requests = h.ipc.requestLog.length;
    const formatColumn = () =>
      h.rt
        .rows()
        .map((row) => `${row.address}${row.endAddress > row.address ? "-" : ""}${row.format}`);

    // 1. rows 0-1, Float 32-bit, Big-endian
    await clickRow(h, 0);
    await clickRow(h, 1, { shift: true });
    await openFromRowMenu(h, 1);
    expect(radio("Unsigned")).toBeChecked();
    expect(apply()).not.toHaveAttribute("aria-disabled");
    await h.user.click(radio("Float 32-bit"));
    await h.user.click(apply());
    await closed();
    expect(h.ipc.callsOf("setPollView").at(-1)).toEqual([
      h.pollId,
      { formatOverrides: [ov(0, 1, "float32")] },
    ]);

    // 2. row 2, Unsigned (preselected): Apply closes and sends nothing
    const callsBefore = h.ipc.callsOf("setPollView").length;
    await clickRow(h, 2);
    await openFromRowMenu(h, 2);
    expect(radio("Unsigned")).toBeChecked();
    expect(apply()).not.toHaveAttribute("aria-disabled");
    await h.user.click(apply());
    await closed();
    expect(h.ipc.callsOf("setPollView")).toHaveLength(callsBefore);

    // 3. rows 3-6, Signed 32-bit, Big-endian
    await clickRow(h, 3);
    await clickRow(h, 6, { shift: true });
    await openFromRowMenu(h, 6);
    expect(radio("Unsigned")).toBeChecked();
    await h.user.click(radio("Signed 32-bit"));
    await h.user.click(apply());
    await closed();
    expect(h.ipc.callsOf("setPollView").at(-1)).toEqual([
      h.pollId,
      { formatOverrides: [ov(0, 1, "float32"), ov(3, 6, "signed32")] },
    ]);

    // 4. rows 7-9, Hex
    await clickRow(h, 7);
    await clickRow(h, 9, { shift: true });
    await openFromRowMenu(h, 9);
    expect(radio("Unsigned")).toBeChecked();
    await h.user.click(radio("Hex"));
    await h.user.click(apply());
    await closed();
    expect(h.ipc.callsOf("setPollView").at(-1)).toEqual([
      h.pollId,
      { formatOverrides: [ov(0, 1, "float32"), ov(3, 6, "signed32"), ov(7, 9, "hex")] },
    ]);
    expect(formatColumn()).toEqual([
      "0-float32",
      "2unsigned",
      "3-signed32",
      "5-signed32",
      "7hex",
      "8hex",
      "9hex",
    ]);
    expect(h.ipc.requestLog).toHaveLength(requests);
  });

  it("CHK9-98: from the owner's state, row 6-7 to Hex splits the S32 block without a reset (P48)", async () => {
    const h = await live(host, TEN, {
      formatOverrides: [ov(0, 1, "float32"), ov(4, 9, "signed32", { swapBytes: true })],
    });
    await clickRow(h, 6);
    await openFromRowMenu(h, 6);
    expect(scopeText()).toBe("Selected 2 registers (6-7)");
    await h.user.click(radio("Hex"));
    await h.user.click(apply());
    await closed();
    expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([
      ov(0, 1, "float32"),
      ov(4, 5, "signed32", { swapBytes: true }),
      ov(6, 7, "hex"),
      ov(8, 9, "signed32", { swapBytes: true }),
    ]);
  });

  it("CHK9-98: rows 3 to 6 over groups open on Unsigned with the mixed note, and Apply stays on", async () => {
    const h = await live(host, TEN, {
      formatOverrides: [
        ov(0, 1, "float32"),
        ov(4, 5, "signed32", { swapBytes: true }),
        ov(6, 7, "hex"),
        ov(8, 9, "signed32", { swapBytes: true }),
      ],
    });
    await clickRow(h, 3);
    await clickRow(h, 6, { shift: true });
    await openFromRowMenu(h, 6);
    expect(scopeText()).toBe("Selected 4 registers (3-6) · mixed formats");
    expect(radio("Unsigned")).toBeChecked();
    expect(
      within(messages()).getByText(
        "The selected rows use different formats. The format you apply replaces all of them.",
      ),
    ).toBeVisible();
    expect(warningLines()).toEqual([]);
    await h.user.click(radio("Signed 32-bit"));
    expect(apply()).not.toHaveAttribute("aria-disabled");
  });
});

describe.each(["workspace", "native"] as const)(
  "CHK9-109 Esc keeps the focused row in %s",
  (host) => {
    it("Esc empties the selection but keeps the focus; the Format… button and the quick format act on that row", async () => {
      const h = await live(host, TEN);
      await clickRow(h, 2);
      await clickRow(h, 5, { shift: true });
      expect(h.rt.stores.ui.getState().selection).toEqual([{ start: 2, end: 5 }]);
      const active = grid().getAttribute("aria-activedescendant");
      expect(active).toBe(rowOf(indexOf(h, 5)).id);
      await h.user.keyboard("{Escape}");
      expect(h.rt.stores.ui.getState().selection).toEqual([]);
      expect(h.rt.stores.ui.getState().focusAddress).toBe(5);
      expect(grid().getAttribute("aria-activedescendant")).toBe(active);
      // the quick 16-bit format (Ctrl+2) acts on row 5 only
      await h.act(() => h.rt.actions.setSelectedFormat("signed"));
      expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([ov(5, 5, "signed")]);
      // Format… is enabled and opens for row 5
      const button = screen.getByRole("button", { name: "Format…" });
      expect(button).not.toHaveAttribute("aria-disabled");
      await h.user.click(button);
      expect(scopeText()).toBe("Selected 1 register (5)");
      await h.user.keyboard("{Escape}");
      await closed();
      // a second Esc changes nothing; the selection is unchanged by Esc inside D1
      await h.user.click(grid());
      await h.user.keyboard("{Escape}");
      expect(h.rt.stores.ui.getState().focusAddress).toBe(5);
      expect(grid().getAttribute("aria-activedescendant")).toBe(active);
    });

    it("Esc inside D1 closes D1 only and the selection stays", async () => {
      const h = await live(host, TEN);
      await clickRow(h, 2);
      await clickRow(h, 5, { shift: true });
      await h.user.click(screen.getByRole("button", { name: "Format…" }));
      await h.user.keyboard("{Escape}");
      await closed();
      expect(h.rt.stores.ui.getState().selection).toEqual([{ start: 2, end: 5 }]);
    });
  },
);

describe.each(["workspace", "native"] as const)(
  "CHK9-108 the first overlay click in %s",
  (host) => {
    type Prepare = (h: PollViewHarness) => Promise<void>;
    const sequences: Array<[string, Prepare]> = [
      ["a format radio", async (h) => h.user.click(radio("Hex"))],
      [
        "an order radio",
        async (h) => {
          await h.user.click(radio("Float 32-bit"));
          await h.user.click(radio("Little-endian"));
        },
      ],
      [
        "the background of the body",
        async (h) => h.user.click(within(dialog()).getByTestId("format-body")),
      ],
      [
        "a text selection dragged over the summary",
        async (h) => {
          const line = within(dialog()).getByTestId("format-summary");
          await h.user.pointer([
            { keys: "[MouseLeft>]", target: line, offset: 0 },
            { target: line, offset: 5 },
            { keys: "[/MouseLeft]" },
          ]);
        },
      ],
      [
        "the heading of a wider format",
        async (h) => {
          await h.user.click(within(dialog()).getByTestId("width-heading-64"));
        },
      ],
      [
        "the Preview region",
        async (h) => {
          await h.user.click(within(dialog()).getByRole("region", { name: "Preview" }));
        },
      ],
      [
        "the Format legend",
        async (h) => h.user.click(within(dialog()).getByText("Format", { selector: "legend" })),
      ],
    ];

    it.each(sequences)("one click on the overlay closes D1 after %s", async (_name, prepare) => {
      // 6 rows: 32-bit fits (three values), 64-bit does not (its reason can be clicked)
      const h = await live(host, [1, 2, 3, 4, 5, 6]);
      await clickRow(h, 0);
      await clickRow(h, 5, { shift: true });
      await openFromRowMenu(h, 5);
      await prepare(h);
      expect(dialog()).toBeVisible();
      const before = h.rt.stores.ui.getState().selection;
      const target = overlay();
      expect(target).not.toBeNull();
      await h.user.click(target as HTMLElement);
      await closed();
      expect(h.ipc.callsOf("setPollView")).toEqual([]);
      // the grid behind got no click, and the focus is back on the grid at the origin row
      expect(h.rt.stores.ui.getState().selection).toEqual(before);
      expect(grid()).toHaveFocus();
      expect(grid().getAttribute("aria-activedescendant")).toBe(rowOf(indexOf(h, 5)).id);
    });

    it("an overlay click while Apply is pending does nothing", async () => {
      const h = await live(host, [1, 2, 3, 4]);
      await clickRow(h, 0);
      await openFromRowMenu(h, 0);
      await h.user.click(radio("Hex"));
      const held = h.ipc.holdReply("setPollView");
      await h.user.click(apply());
      expect(apply()).toHaveAttribute("aria-busy", "true");
      await h.user.click(overlay() as HTMLElement);
      expect(dialog()).toBeVisible();
      await h.act(async () => held.release());
      await closed();
      expect(h.ipc.pollSummary(h.pollId).config.formatOverrides).toEqual([ov(0, 0, "hex")]);
    });

    it("events inside D1 never reach the React ancestors (pointerdown, click, context menu)", async () => {
      const seen: string[] = [];
      const h = await renderPollView({
        host,
        mode: "manual",
        poll: { definition: def(0, 5) },
        wrapper: (view) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: a test probe on an ancestor of the portal content
          <div
            onPointerDown={() => seen.push("pointerdown")}
            onClick={() => seen.push("click")}
            onContextMenu={() => seen.push("contextmenu")}
            onDoubleClick={() => seen.push("dblclick")}
          >
            {view}
          </div>
        ),
      });
      act(() => {
        h.rt.stores.ui.getState().click(0);
      });
      act(() => {
        h.rt.actions.openFormatDialog("header");
      });
      seen.length = 0;
      await h.user.click(radio("Hex"));
      await h.user.pointer({ keys: "[MouseRight]", target: radio("Signed") });
      await h.user.dblClick(within(dialog()).getByTestId("format-body"));
      expect(seen).toEqual([]);
    });

    it("the same first overlay click works in the scale override dialog", async () => {
      const h = await live(host, [1, 2, 3, 4]);
      await clickRow(h, 1);
      act(() => {
        h.rt.actions.openOverrideForSelection();
      });
      const override = screen.getByRole("dialog", { name: "Scale override" });
      await h.user.click(within(override).getAllByRole("radio")[0] as HTMLElement);
      await h.user.click(overlay() as HTMLElement);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });
  },
);

describe.each(["workspace", "native"] as const)("CHK9-58 the layout regions in %s", (host) => {
  it("title and Close, a scrolling body, and a footer with the messages and the buttons (DES-009 11.10)", async () => {
    const h = await live(host, TEN);
    await clickRow(h, 0);
    await clickRow(h, 3, { shift: true });
    await openFromRowMenu(h, 3);
    await h.user.click(radio("Float 32-bit")); // shows the order group and the preview
    const d = dialog();
    const body = within(d).getByTestId("format-body");
    const footer = within(d).getByTestId("format-footer");
    expect(d.className).toContain("max-h-[calc(100vh-16px)]");
    expect(d.className).toContain("flex-col");
    expect(d.className).not.toContain("max-h-[70vh]");
    expect(body.className).toContain("overflow-y-auto");
    expect(body.className).toContain("min-h-0");
    expect(body.className).not.toContain("max-h-[70vh]");
    // fixed regions are outside the scrolling body
    for (const el of [
      within(d).getByRole("button", { name: "Close dialog" }),
      within(d).getByRole("heading", { name: "Format / endian" }),
      within(d).getByRole("button", { name: "Cancel" }),
      apply(),
      messages(),
    ]) {
      expect(body.contains(el)).toBe(false);
    }
    expect(footer.contains(apply())).toBe(true);
    expect(footer.contains(within(d).getByRole("button", { name: "Cancel" }))).toBe(true);
    expect(footer.contains(messages())).toBe(true);
    // the message area scrolls on its own when it is long, and is capped
    expect(within(d).getByTestId("format-message-area").className).toContain("max-h-[30vh]");
    // compact spacing below 480 px of height
    expect(d.className).toContain("[@media(max-height:479px)]:p-3");
  });
});

describe.each(["workspace", "native"] as const)("CHK9-116 the poll goes away in %s", (host) => {
  it("deleting the poll closes D1 without applying", async () => {
    const h = await live(host, TEN);
    await clickRow(h, 0);
    await openFromRowMenu(h, 0);
    await h.user.click(radio("Hex"));
    await h.act(() => h.ipc.removePoll(h.pollId));
    await closed();
    expect(h.ipc.callsOf("setPollView")).toEqual([]);
    expect(h.rt.stores.formatDialog.getState().open).toBe(false);
  });

  it("deleting the poll while Apply is pending closes at once; the late reply shows nothing", async () => {
    const h = await live(host, TEN);
    await clickRow(h, 0);
    await openFromRowMenu(h, 0);
    await h.user.click(radio("Hex"));
    const held = h.ipc.holdReply("setPollView");
    await h.user.click(apply());
    expect(apply()).toHaveAttribute("aria-busy", "true");
    await h.act(() => h.ipc.removePoll(h.pollId));
    await closed();
    await h.act(async () => held.release());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.rt.stores.formatDialog.getState()).toMatchObject({
      open: false,
      pending: false,
      error: null,
    });
    expect(h.announced).toEqual([]);
    expect(h.toasts.getState().items ?? []).toEqual([]);
  });

  it("a range change that excludes the whole scope closes D1", async () => {
    const h = await live(host, TEN);
    await clickRow(h, 8);
    await clickRow(h, 9, { shift: true });
    await openFromRowMenu(h, 9);
    expect(dialog()).toBeVisible();
    await h.act(() => h.ipc.updatePoll(h.pollId, def(0, 5)));
    await closed();
    expect(h.ipc.callsOf("setPollView")).toEqual([]);
  });

  it("a range change that keeps part of the scope leaves D1 open on its plan", async () => {
    const h = await live(host, TEN);
    await clickRow(h, 3);
    await clickRow(h, 6, { shift: true });
    await openFromRowMenu(h, 6);
    await h.act(() => h.ipc.updatePoll(h.pollId, def(0, 5)));
    expect(dialog()).toBeVisible();
  });
});

describe.each(["workspace", "native"] as const)("CHK9-112 the stale notice in %s", (host) => {
  const STALE = "Preview uses the last values received (stale).";
  const notice = () => within(dialog()).queryByTestId("format-preview-notice");

  async function openOnRetainedValues(h: PollViewHarness) {
    act(() => h.rt.stores.ui.getState().click(0));
    await h.user.click(screen.getByRole("button", { name: "Format…" }));
  }

  it("is live while polling", async () => {
    const h = await live(host, [1, 2, 3, 4]);
    await openOnRetainedValues(h);
    expect(notice()).toBeNull();
    expect(within(dialog()).getByTestId("format-preview-summary")).toHaveTextContent(
      "1 Unsigned value",
    );
  });

  it.each([
    ["paused", (h: PollViewHarness) => h.ipc.emitPollState(h.pollId, "paused")],
    ["timeout", (h: PollViewHarness) => h.ipc.emitPollState(h.pollId, "timeout")],
    [
      "exception response",
      (h: PollViewHarness) => h.ipc.emitPollState(h.pollId, "exception", { exceptionCode: 2 }),
    ],
    [
      "bad response",
      (h: PollViewHarness) =>
        h.ipc.emitPollState(h.pollId, "badResponse", { badResponseKind: "crc" }),
    ],
    [
      "link lost",
      (h: PollViewHarness) => {
        h.ipc.emitConnectionState("disconnected");
        h.ipc.emitPollState(h.pollId, "offline");
      },
    ],
  ])("%s before the dialog opens shows the stale notice", async (_name, drive) => {
    const h = await live(host, [1, 2, 3, 4]);
    act(() => drive(h));
    await openOnRetainedValues(h);
    expect(notice()).toHaveAttribute("data-kind", "stale");
    expect(notice()).toHaveTextContent(STALE);
    // the retained value is still listed
    expect(
      within(within(dialog()).getByTestId("format-preview-row"))
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["0", "1"]);
  });

  it.each([
    ["paused", (h: PollViewHarness) => h.ipc.emitPollState(h.pollId, "paused")],
    ["timeout", (h: PollViewHarness) => h.ipc.emitPollState(h.pollId, "timeout")],
    [
      "exception response",
      (h: PollViewHarness) => h.ipc.emitPollState(h.pollId, "exception", { exceptionCode: 2 }),
    ],
  ])("%s while the dialog is open switches the notice to stale", async (_name, drive) => {
    const h = await live(host, [1, 2, 3, 4]);
    await openOnRetainedValues(h);
    expect(notice()).toBeNull();
    act(() => drive(h));
    expect(notice()).toHaveTextContent(STALE);
    // a good cycle makes it live again
    act(() => {
      h.ipc.emitPollState(h.pollId, "polling");
      h.ipc.emitPollUpdate(h.pollId, { values: [1, 2, 3, 4] });
    });
    expect(notice()).toBeNull();
  });
});
