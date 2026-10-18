// Value scaling in the connection window (FE-003 tasks 06, 08 and 09): shortcuts, the S8 dialog as a
// modal of W1, the scaled preview of the Write dialog, and "Modified".
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type {
  PollConfigInput,
  PollId,
  ScaleOverride,
  ScaleSettings,
} from "@/shared/ipc/modbus-master.types";
import { presetDefaults } from "../lib/scale-presets";
import { disposeNativeHarnesses, renderNativeWindow } from "./native/test-utils";
import { type Harness, renderWindow } from "./test-utils";

let h: Harness;
afterEach(() => {
  h?.rt.dispose();
  disposeNativeHarnesses();
});

const divide = (divisor: number, patch: Partial<ScaleSettings> = {}): ScaleSettings => ({
  ...presetDefaults("divide"),
  divisor,
  ...patch,
});
const mA = (patch: Partial<ScaleSettings> = {}): ScaleSettings => ({
  ...presetDefaults("current4to20"),
  ...patch,
});

const POLL: Partial<PollConfigInput> = {
  definition: { slaveId: 5, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
};

const frame = (id: PollId) =>
  document.querySelector<HTMLElement>(`[data-subwindow="${id}"]`) as HTMLElement;
const grid = (id: PollId) => within(frame(id)).getByRole("grid");
const rowOf = (id: PollId, index: number) =>
  within(grid(id))
    .getAllByRole("row")
    .find((r) => r.getAttribute("data-row") === String(index)) as HTMLElement;
const modified = () => h.rt.stores.profile.getState().modified;

async function connected(patch: Partial<PollConfigInput> = POLL): Promise<PollId> {
  h = await renderWindow();
  const id = await h.addPoll("Pump 2", patch);
  await h.connect();
  h.advance(300);
  return id;
}

describe("shortcuts", () => {
  it("Ctrl+Shift+E opens S8 for the selected rows, as a modal of the connection window (D1)", async () => {
    const id = await connected({ ...POLL, scale: divide(10), valueColumns: "both" });
    await h.user.click(rowOf(id, 0));
    await h.user.keyboard("{Control>}");
    await h.user.click(rowOf(id, 1));
    await h.user.click(rowOf(id, 5));
    await h.user.keyboard("{/Control}");
    grid(id).focus();
    fireEvent.keyDown(grid(id), { key: "E", ctrlKey: true, shiftKey: true });
    const d = await screen.findByRole("dialog", { name: "Scale override" });
    expect(within(d).getByTestId("applies-to")).toHaveTextContent("Applies to 0-1, 5");
    // modal: shortcuts are off and pop out and dock wait
    expect(h.rt.stores.layout.getState().modalOpen).toBe(true);
    await h.user.click(within(d).getByRole("radio", { name: "100" }));
    await h.user.click(within(d).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.rt.stores.layout.getState().modalOpen).toBe(false);
    expect(h.ipc.pollSummary(id).config.scaleOverrides.map((o) => [o.start, o.end])).toEqual([
      [0, 1],
      [5, 5],
    ]);
    // the grid has the focus back (the dialog returns it to where it was)
    expect(modified()).toBe(true);
  });

  it("m-1: keys typed in S8 do not move the sub-window behind it, but Tab still wraps inside the dialog", {
    timeout: 60_000,
  }, async () => {
    const id = await connected({ ...POLL, scale: divide(10), valueColumns: "both" });
    await h.user.click(rowOf(id, 0));
    grid(id).focus();
    fireEvent.keyDown(grid(id), { key: "E", ctrlKey: true, shiftKey: true });
    const d = await screen.findByRole("dialog", { name: "Scale override" });
    const rect = () => h.rt.stores.workspace.getState().items[id]?.rect;
    const before = { ...rect() };
    const save = within(d).getByRole("button", { name: "Save" });
    save.focus();
    // the window keys act on a sub-window, not through a dialog of its poll
    fireEvent.keyDown(save, { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(save, { key: "ArrowDown", altKey: true, ctrlKey: true });
    expect(rect()).toEqual(before);
    // Tab on the last control wraps to the first one, Shift+Tab goes back (the focus trap)
    const close = within(d).getByRole("button", { name: "Close dialog" });
    await h.user.tab();
    expect(close).toHaveFocus();
    await h.user.tab({ shift: true });
    expect(save).toHaveFocus();
    // two full cycles forward (back on the close button twice), then one backward: the focus
    // never leaves the dialog
    let wraps = 0;
    for (let i = 0; i < 60 && wraps < 2; i += 1) {
      await h.user.tab();
      expect(d.contains(document.activeElement)).toBe(true);
      if (document.activeElement === close) wraps += 1;
    }
    expect(wraps).toBe(2);
    await h.user.tab({ shift: true });
    expect(save).toHaveFocus();
    expect(rect()).toEqual(before);
  });

  it("Ctrl+Shift+E with nothing selected does nothing", async () => {
    const id = await connected();
    grid(id).focus();
    fireEvent.keyDown(grid(id), { key: "E", ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Ctrl+Shift+V cycles Raw, Scaled, Both (B6)", async () => {
    const id = await connected({ ...POLL, scale: mA(), valueColumns: "raw" });
    grid(id).focus();
    const press = () => fireEvent.keyDown(grid(id), { key: "V", ctrlKey: true, shiftKey: true });
    const columns = () => h.ipc.pollSummary(id).config.valueColumns;
    press();
    await waitFor(() => expect(columns()).toBe("scaled"));
    press();
    await waitFor(() => expect(columns()).toBe("both"));
    press();
    await waitFor(() => expect(columns()).toBe("raw"));
  });

  it("Ctrl+Shift+V does nothing while the poll has no scale", async () => {
    const id = await connected();
    grid(id).focus();
    fireEvent.keyDown(grid(id), { key: "V", ctrlKey: true, shiftKey: true });
    await act(async () => {});
    expect(h.ipc.pollSummary(id).config.valueColumns).toBe("raw");
    expect(
      h.ipc.callsOf("setPollView").filter(([, v]) => "valueColumns" in (v as object)),
    ).toHaveLength(0);
  });
});

describe("Modified (DES-002 6.1, CHK3-C10, G1)", () => {
  it("an applied scale, an override and the value columns mark the profile modified", async () => {
    const id = await connected();
    h.clean();
    expect(modified()).toBe(false);
    await h.act(() => h.rt.views.get(id).stores.scale.getState().applyScale(mA()));
    expect(modified()).toBe(true);
    h.clean();
    await h.act(() => h.rt.views.get(id).stores.scale.getState().setValueColumns("scaled"));
    expect(modified()).toBe(true);
    h.clean();
    await h.act(() =>
      h.rt.views
        .get(id)
        .stores.scale.getState()
        .addOverrides([{ start: 2, end: 3 }], divide(10)),
    );
    expect(modified()).toBe(true);
  });

  it("an unapplied scale draft does not mark the profile modified but counts as an unapplied edit", async () => {
    const id = await connected();
    h.clean();
    const view = h.rt.views.get(id);
    await h.act(async () => view.stores.scaleDraft.getState().setPreset("divide"));
    expect(modified()).toBe(false);
    await waitFor(() =>
      expect(h.rt.stores.pollList.getState().polls[id]?.hasUnappliedEdits).toBe(true),
    );
    await h.act(async () => view.stores.scaleDraft.getState().reset());
    await waitFor(() =>
      expect(h.rt.stores.pollList.getState().polls[id]?.hasUnappliedEdits).toBe(false),
    );
  });
});

describe("the scaled preview of the Write dialog (DES-003 3.5)", () => {
  async function openWrite(id: PollId, address: number) {
    await h.user.click(rowOf(id, address));
    grid(id).focus();
    fireEvent.keyDown(grid(id), { key: "Enter" });
    return screen.findByRole("dialog", { name: "Write · Pump 2" });
  }
  const type = async (el: HTMLElement, text: string) => {
    await h.user.clear(el);
    if (text) await h.user.type(el, text);
  };

  it("F1, F9: FC06 shows 'Scaled: 12.00 mA' in a neutral box and sends the raw value only", async () => {
    const id = await connected({ ...POLL, scale: mA() });
    const d = await openWrite(id, 0);
    await type(within(d).getByLabelText("Value"), "32768");
    const preview = within(d).getByTestId("write-preview");
    expect(preview).toHaveTextContent("Scaled: 12.00 mA");
    expect(preview).toHaveClass("bg-neutral-tint");
    expect(preview.querySelector("[data-icon]")).toBeNull();
    expect(within(d).getByTestId("write-preview-note")).toHaveTextContent(
      "Writes send the raw value only. The preview shows what it means under the scale for address 0.",
    );
    await h.user.click(within(d).getByRole("button", { name: "Send" }));
    h.advance(100);
    await waitFor(() => expect(h.ipc.callsOf("write")).toHaveLength(1));
    expect(h.ipc.callsOf("write")[0]?.[0]).toMatchObject({
      function: 6,
      address: 0,
      values: [32768],
    });
  });

  it("the preview updates as the user types, and an invalid raw value shows none (F2)", async () => {
    const id = await connected({ ...POLL, scale: mA() });
    const d = await openWrite(id, 0);
    const value = within(d).getByLabelText("Value");
    await type(value, "0");
    expect(within(d).getByTestId("write-preview")).toHaveTextContent("Scaled: 4.00 mA");
    await type(value, "65535");
    expect(within(d).getByTestId("write-preview")).toHaveTextContent("Scaled: 20.00 mA");
    await type(value, "70000");
    expect(within(d).queryByTestId("write-preview")).not.toBeInTheDocument();
    expect(within(d).queryByTestId("write-preview-note")).not.toBeInTheDocument();
    await type(value, "abc");
    expect(within(d).queryByTestId("write-preview")).not.toBeInTheDocument();
  });

  it("F4: out of range is flagged or clamped as the scale says", async () => {
    const id = await connected({
      ...POLL,
      scale: mA({ xMin: 4000, xMax: 20000 }),
    });
    const d = await openWrite(id, 0);
    await type(within(d).getByLabelText("Value"), "0");
    const flagged = within(d).getByTestId("write-preview");
    expect(flagged).toHaveTextContent("Scaled: 0.00 mA (out of range)");
    expect(flagged).toHaveClass("bg-warning-tint");
    expect(flagged.querySelector('[data-icon="triangle-alert"]')).not.toBeNull();
    await type(within(d).getByLabelText("Value"), "3600");
    expect(within(d).getByTestId("write-preview")).toHaveTextContent(
      "Scaled: 3.60 mA (out of range)",
    );
  });

  it("F4: with clamp it reads '(clamped)', in the neutral box with the arrow icon", async () => {
    const id = await connected({
      ...POLL,
      scale: mA({ xMin: 4000, xMax: 20000, outOfRange: "clamp" }),
    });
    const d = await openWrite(id, 0);
    await type(within(d).getByLabelText("Value"), "0");
    const clamped = within(d).getByTestId("write-preview");
    expect(clamped).toHaveTextContent("Scaled: 4.00 mA (clamped)");
    expect(clamped).toHaveClass("bg-neutral-tint");
    expect(clamped.querySelector('[data-icon="arrow-down-to-line"]')).not.toBeNull();
    await type(within(d).getByLabelText("Value"), "30000");
    expect(
      within(d).getByTestId("write-preview").querySelector('[data-icon="arrow-up-to-line"]'),
    ).not.toBeNull();
  });

  it("F9: the note names the address of the dialog (display base)", async () => {
    const id = await connected({
      ...POLL,
      scale: mA(),
      display: {
        format: "unsigned",
        addressBase: 1,
        showAlias: true,
        copyAlias: false,
        swapBytes: false,
        reverseWords: false,
      },
    });
    const d = await openWrite(id, 3);
    expect(within(d).getByTestId("write-preview-note")).toHaveTextContent("for address 4.");
  });

  it("F6: an address without a scale has no preview; the override wins over the poll scale", async () => {
    const overrides: ScaleOverride[] = [{ start: 2, end: 3, scale: divide(10, { unit: "°C" }) }];
    const id = await connected({ ...POLL, scaleOverrides: overrides });
    const d = await openWrite(id, 5);
    await type(within(d).getByLabelText("Value"), "100");
    expect(within(d).queryByTestId("write-preview")).not.toBeInTheDocument();
    // the same dialog moved to an address inside the override
    await type(within(d).getByLabelText("Start address"), "2");
    expect(within(d).getByTestId("write-preview")).toHaveTextContent("Scaled: 10.0 °C");
  });

  it("F3: FC16 at an override range with Divide by 10 shows the values with the unit once; seven values show five and an ellipsis", async () => {
    const overrides: ScaleOverride[] = [{ start: 0, end: 9, scale: divide(10, { unit: "°C" }) }];
    const id = await connected({ ...POLL, scaleOverrides: overrides });
    const d = await openWrite(id, 0);
    await h.user.selectOptions(within(d).getByLabelText("Function"), "16");
    await type(within(d).getByLabelText(/^Values/), "253 254");
    expect(within(d).getByTestId("write-preview")).toHaveTextContent("Scaled: 25.3, 25.4 °C");
    await type(within(d).getByLabelText(/^Values/), "10 20 30 40 50 60 70");
    const text = within(d).getByTestId("write-preview").textContent as string;
    expect(text).toBe("Scaled: 1.0, 2.0, 3.0, 4.0, 5.0 … °C");
    expect(text.split(",")).toHaveLength(5);
  });

  it("F10: FC16 over two overrides with different units shows each unit, a dash for an address without a scale, and sends the raw values", async () => {
    const overrides: ScaleOverride[] = [
      { start: 2, end: 2, scale: divide(10, { unit: "°C" }) },
      { start: 3, end: 3, scale: divide(100, { unit: "bar", decimals: 2 }) },
    ];
    const id = await connected({ ...POLL, scaleOverrides: overrides });
    const d = await openWrite(id, 2);
    await h.user.selectOptions(within(d).getByLabelText("Function"), "16");
    await type(within(d).getByLabelText(/^Values/), "253 1234");
    const preview = within(d).getByTestId("write-preview");
    expect(preview).toHaveTextContent("Scaled: 25.3 °C, 12.34 bar");
    expect(preview).toHaveClass("bg-neutral-tint");
    expect(preview.querySelector("[data-icon]")).toBeNull();
    await type(within(d).getByLabelText(/^Values/), "253 1234 5");
    expect(within(d).getByTestId("write-preview").textContent).toBe(
      "Scaled: 25.3 °C, 12.34 bar, —",
    );
    await h.user.click(within(d).getByRole("button", { name: "Send" }));
    h.advance(100);
    await waitFor(() => expect(h.ipc.callsOf("write")).toHaveLength(1));
    expect(h.ipc.callsOf("write")[0]?.[0]).toMatchObject({
      function: 16,
      address: 2,
      values: [253, 1234, 5],
    });
  });

  it("F11: FC16 with out-of-range values marks them, and the box is warning only for flag", async () => {
    const id = await connected({ ...POLL, scale: mA({ xMin: 4000, xMax: 20000 }) });
    const d = await openWrite(id, 0);
    await h.user.selectOptions(within(d).getByLabelText("Function"), "16");
    await type(within(d).getByLabelText(/^Values/), "0 12000");
    const preview = within(d).getByTestId("write-preview");
    expect(preview).toHaveTextContent("Scaled: 0.00 (out of range), 12.00 mA");
    expect(preview).toHaveClass("bg-warning-tint");
    expect(preview.querySelector("[data-icon]")).not.toBeNull();
    // clamp: the same values are marked as clamped in a neutral box with no icon
    await h.act(() =>
      h.rt.views
        .get(id)
        .stores.scale.getState()
        .applyScale(mA({ xMin: 4000, xMax: 20000, outOfRange: "clamp" })),
    );
    const clamped = within(d).getByTestId("write-preview");
    expect(clamped).toHaveTextContent("Scaled: 4.00 (clamped), 12.00 mA");
    expect(clamped).toHaveClass("bg-neutral-tint");
    expect(clamped.querySelector("[data-icon]")).toBeNull();
  });

  it("FC05 and FC15 show no preview", async () => {
    const id = await connected({ ...POLL, scale: mA() });
    const d = await openWrite(id, 0);
    await h.user.selectOptions(within(d).getByLabelText("Function"), "5");
    expect(within(d).queryByTestId("write-preview")).not.toBeInTheDocument();
    await h.user.selectOptions(within(d).getByLabelText("Function"), "15");
    await type(within(d).getByLabelText(/^Values/), "1 0 1");
    expect(within(d).queryByTestId("write-preview")).not.toBeInTheDocument();
  });

  it("F5: the dialog has no engineering-unit input, only raw fields", async () => {
    const id = await connected({ ...POLL, scale: mA() });
    const d = await openWrite(id, 0);
    expect(within(d).queryByLabelText(/engineering/i)).not.toBeInTheDocument();
    expect(within(d).getByLabelText("Value")).toBeInTheDocument();
  });

  it("m-2: Ctrl+Shift+V in a field of the open Write dialog is left to the field, and runs no action", async () => {
    const id = await connected({ ...POLL, scale: mA(), valueColumns: "raw" });
    const d = await openWrite(id, 0);
    const value = within(d).getByLabelText("Value");
    value.focus();
    const paste = new KeyboardEvent("keydown", {
      key: "V",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      value.dispatchEvent(paste);
    });
    expect(paste.defaultPrevented).toBe(false);
    await act(async () => {});
    expect(h.ipc.pollSummary(id).config.valueColumns).toBe("raw");
    // a browser default is still suppressed behind the modal
    const find = new KeyboardEvent("keydown", {
      key: "E",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      value.dispatchEvent(find);
    });
    expect(find.defaultPrevented).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Scale override" })).not.toBeInTheDocument();
  });

  it("the preview follows a scale change made while the dialog is open", async () => {
    const id = await connected({ ...POLL, scale: mA() });
    const d = await openWrite(id, 0);
    await type(within(d).getByLabelText("Value"), "32768");
    expect(within(d).getByTestId("write-preview")).toHaveTextContent("Scaled: 12.00 mA");
    await h.act(() =>
      h.rt.views
        .get(id)
        .stores.scale.getState()
        .applyScale(divide(100, { decimals: 2 })),
    );
    expect(within(d).getByTestId("write-preview")).toHaveTextContent("Scaled: 327.68");
  });
});

describe("the native poll window", () => {
  it("shows the scaled preview in its Write dialog and keeps its scale section", async () => {
    const n = await renderNativeWindow();
    await n.connect();
    n.advance(300);
    await act(async () => {
      await n.ipc.setPollView(n.pollId, { scale: mA(), valueColumns: "both" });
    });
    expect(screen.getByRole("region", { name: "Scale" })).toBeInTheDocument();
    await n.user.click(within(screen.getByRole("toolbar")).getByRole("button", { name: "Write…" }));
    const d = await screen.findByRole("dialog");
    await n.user.clear(within(d).getByLabelText("Value"));
    await n.user.type(within(d).getByLabelText("Value"), "32768");
    expect(within(d).getByTestId("write-preview")).toHaveTextContent("Scaled: 12.00 mA");
  });
});
