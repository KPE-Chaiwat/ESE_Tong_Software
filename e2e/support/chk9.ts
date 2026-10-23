// Helpers for the CHK-009 (per-row format) specs. Browser mode, fake IPC. Both hosts: the
// workspace sub-window (W1) and the native poll window page (W2) are wrapped in one `Host`.
import { expect, type Locator, type Page } from "@playwright/test";
import { type FormatOverrideSpec, type Mm, type NativeWin, type PollSpec, profileV2 } from "./mm";

/** Simulator registers 0-9 of CHK-009: rows 2-3 and 4-5 decode to 12.5 as Float 32-bit Big-endian. */
export const REG = [0x0001, 0x0002, 0x4148, 0x0000, 0x4148, 0x0000, 0x00a1, 0xfffe, 0x0009, 0x000a];

export type HostKind = "workspace" | "native";

export interface Host {
  kind: HostKind;
  page: Page;
  id: number;
  grid: Locator;
  row(index: number): Locator;
  calls(method: string): Promise<unknown[][]>;
  // biome-ignore lint/suspicious/noExplicitAny: scripting the fake in the page
  script<A, R>(fn: (fake: any, arg: A) => R | Promise<R>, arg?: A): Promise<R>;
  /** The page-level live-region announcements (polite and assertive). */
  announced(): Promise<string[]>;
  mm: Mm;
  win: NativeWin | null;
}

export interface OpenArgs extends Partial<PollSpec> {
  values?: number[] | null;
  /** false: do not connect (idle). */
  connected?: boolean;
  viewport?: { width: number; height: number };
}

/** Opens one poll (default Poll "Fmt", FC03, start 0, quantity 10) in the given host and feeds values. */
export async function openHost(mm: Mm, kind: HostKind, a: OpenArgs = {}): Promise<Host> {
  const spec: PollSpec = {
    name: "Fmt",
    start: 0,
    qty: 10,
    ...a,
  };
  delete (spec as { values?: unknown }).values;
  delete (spec as { connected?: unknown }).connected;
  delete (spec as { viewport?: unknown }).viewport;
  const values = a.values === undefined ? REG : a.values;
  if (kind === "workspace") {
    await mm.open({
      polls: [spec],
      connected: a.connected ?? true,
      ...(a.viewport ? { viewport: a.viewport } : {}),
    });
    const [id] = (await mm.pollIds()) as [number];
    if (values) await mm.script((f, x) => f.emitPollUpdate(x.id, { values: x.values }), { id, values });
    return {
      kind,
      page: mm.page,
      id,
      grid: mm.grid(id),
      row: (i) => mm.gridRow(id, i),
      calls: (m) => mm.calls(m),
      script: (fn, arg) => mm.script(fn, arg),
      announced: async () => (await mm.announcements()).map((x) => x.text),
      mm,
      win: null,
    };
  }
  const win = await mm.openNative({
    polls: [spec],
    connect: a.connected ?? true,
    ...(a.viewport ? { viewport: a.viewport } : {}),
  });
  const id = 1;
  if (values) await win.script((f, x) => f.emitPollUpdate(x.id, { values: x.values }), { id, values });
  return {
    kind,
    page: win.page,
    id,
    grid: win.grid,
    row: (i) => win.gridRow(i),
    calls: (m) => win.calls(m),
    script: (fn, arg) => win.script(fn, arg),
    announced: async () => (await win.announcements()).map((x) => x.text),
    mm,
    win,
  };
}

export interface RowView {
  address: string;
  format: string;
  raw: string;
}

/** What the mixed grid shows, row by row. */
export async function table(h: Host): Promise<RowView[]> {
  return h.grid.locator("[data-row]").evaluateAll((rows) =>
    rows.map((r) => {
      const cell = (name: string) => r.querySelector(`[data-cell="${name}"]`);
      const raw = cell("raw");
      let rawText = "";
      if (raw) {
        for (const n of Array.from(raw.childNodes)) {
          if (n.nodeType === 3) rawText += n.textContent ?? "";
          else if ((n as Element).tagName === "SPAN") rawText += n.textContent ?? "";
        }
      }
      return {
        address: (cell("address")?.textContent ?? "").trim(),
        format: (cell("format")?.textContent ?? "").trim(),
        raw: rawText.trim(),
      };
    }),
  );
}

/** Expect the grid to show exactly these `address format raw` triples. */
export async function expectTable(h: Host, want: Array<[string, string, string]>): Promise<void> {
  await expect
    .poll(async () => (await table(h)).map((r) => [r.address, r.format, r.raw]), {
      message: "grid rows (address, format, raw)",
    })
    .toEqual(want);
}

/** Click row `a`, Shift+click row `b` (grid row indexes, not addresses). */
export async function select(h: Host, a: number, b: number = a): Promise<void> {
  await h.row(a).click();
  if (b !== a) await h.row(b).click({ modifiers: ["Shift"] });
}

export async function ctrlClick(h: Host, i: number): Promise<void> {
  await h.row(i).click({ modifiers: ["Control"] });
}

export function formatDialog(h: Host): Locator {
  return h.page.getByRole("dialog", { name: "Format / endian" });
}

/** Opens the Format dialog from the context menu of grid row `onRow` (right click keeps a selection that contains it). */
export async function openFromMenu(h: Host, onRow: number): Promise<Locator> {
  await h.row(onRow).click({ button: "right" });
  await h.page.getByRole("menuitem", { name: "More formats…" }).click();
  const d = formatDialog(h);
  await expect(d).toBeVisible();
  return d;
}

/** Opens the Format dialog from the keyboard: Shift+F10 on the focused grid row, then the menu entry. */
export async function openFromKeyboard(h: Host): Promise<Locator> {
  await h.grid.focus();
  await h.page.keyboard.press("Shift+F10");
  await h.page.getByRole("menuitem", { name: "More formats…" }).click();
  const d = formatDialog(h);
  await expect(d).toBeVisible();
  return d;
}

export const radio = (d: Locator, name: string): Locator => d.getByRole("radio", { name, exact: true });
export const applyButton = (d: Locator): Locator => d.getByRole("button", { name: /^(Apply|Applying…)$/ });
export const messages = (d: Locator): Locator => d.getByTestId("format-messages");
/** The lines of the warning boxes of the dialog, one entry per paragraph (DES-009 11.4). */
export async function warningLines(d: Locator): Promise<string[]> {
  return messages(d).locator("[data-kind='warning'] p").allTextContents();
}

/** The lines of the info boxes of the dialog: the mixed note and the unchanged note (REQ-010 removed the rounding notices). */
export async function infoLines(d: Locator): Promise<string[]> {
  return messages(d).locator("[data-kind='info'] p").allTextContents();
}

/** The selection summary of the dialog, e.g. `Selected 10 registers (0-9)` (DES-010 4). */
export const summary = (d: Locator): Locator => d.getByTestId("format-summary");

/** The computed heading of a width section, e.g. `32-bit · 5 values (2 registers each)` (DES-010 5.2). */
export const widthHeading = (d: Locator, bits: 16 | 32 | 64): Locator => d.getByTestId(`width-heading-${bits}`);

/** The reason a width is unavailable (32 and 64 only; absent when the width fits, DES-010 5.3). */
export const widthReason = (d: Locator, bits: 32 | 64): Locator => d.getByTestId(`width-reason-${bits}`);

/** The preview table rows as `[address text, value]` pairs, in order (DES-010 7.2). */
export async function previewRows(d: Locator): Promise<Array<[string, string]>> {
  return d.getByTestId("format-preview-row").evaluateAll((rows) =>
    rows.map((r) => {
      const cells = Array.from(r.querySelectorAll("td")).map((c) => (c.textContent ?? "").trim());
      return [cells[0] ?? "", cells[1] ?? ""] as [string, string];
    }),
  );
}

/** The Preview notice element (stale or empty, DES-010 7.3); `data-kind` tells which. */
export const previewNotice = (d: Locator): Locator => d.getByTestId("format-preview-notice");

/** The Preview summary line, e.g. `2 Float 32-bit values, Big-endian (ABCD)`. */
export const previewSummary = (d: Locator): Locator => d.getByTestId("format-preview-summary");

export async function chooseAndApply(d: Locator, format: string, order?: string): Promise<void> {
  await radio(d, format).check();
  if (order) await radio(d, order).check();
  await applyButton(d).click();
}

/** The overrides Rust (the fake) holds for the poll. */
export async function storedOverrides(h: Host): Promise<FormatOverrideSpec[]> {
  return h.script(
    (f, id) =>
      JSON.parse(
        JSON.stringify(
          f.snapshot().polls.find((p: { config: { pollId: number } }) => p.config.pollId === id).config
            .formatOverrides,
        ),
      ),
    h.id,
  );
}

/** The patches sent with setPollView, as `[pollId, patch]`. */
export async function viewCalls(h: Host): Promise<Array<[number, Record<string, unknown>]>> {
  return (await h.calls("setPollView")) as Array<[number, Record<string, unknown>]>;
}

export const ov = (
  start: number,
  end: number,
  format: FormatOverrideSpec["format"],
  swapBytes = false,
  reverseWords = false,
): FormatOverrideSpec => ({ start, end, format, swapBytes, reverseWords });

/** Waits until the Format dialog is gone. */
export async function expectClosed(h: Host): Promise<void> {
  await expect(formatDialog(h)).toHaveCount(0);
}

export interface ProfilePoll {
  name?: string;
  definition?: Record<string, unknown>;
  display?: Record<string, unknown>;
  formatOverrides?: unknown[];
  extra?: Record<string, unknown>;
}

/** A saved-profile object of the given schema with one poll (schema < 6: pass `display.format` etc.). */
export function profileWith(
  profileName: string,
  schemaVersion: number,
  poll: ProfilePoll,
  top: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = profileV2(profileName) as { polls: Array<Record<string, unknown>> };
  const p0 = base.polls[0] as Record<string, unknown>;
  const p: Record<string, unknown> = {
    ...p0,
    name: poll.name ?? "Poll 1",
    definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000, ...(poll.definition ?? {}) },
    display: { addressBase: 0, showAlias: true, copyAlias: false, ...(poll.display ?? {}) },
    ...(poll.extra ?? {}),
  };
  if (poll.formatOverrides !== undefined) p.formatOverrides = poll.formatOverrides;
  else if (schemaVersion < 6) delete p.formatOverrides;
  return { ...base, schemaVersion, polls: [p], ...top };
}

async function openProfileFile(mm: Mm, name: string): Promise<void> {
  await mm.openMenu("File");
  await mm.menuItem("Open profile…").click();
  await mm.openDialog.getByRole("row", { name: new RegExp(name) }).dblclick();
  await expect(mm.openDialog).toHaveCount(0);
}

/** W1 starts empty with this profile saved in the fake; File > Open profile loads it (not Modified). */
export async function openProfileHost(
  mm: Mm,
  profile: Record<string, unknown>,
  values: number[] | null = REG,
  connect = true,
): Promise<Host> {
  await mm.open({ seed: (f, a) => f.seedProfiles([a]), seedArg: profile });
  await openProfileFile(mm, String(profile.name));
  const polls = profile.polls as Array<{ name: string }>;
  const id = await mm.idOf(polls[0]?.name ?? "Poll 1");
  await expect(mm.sub(id)).toBeVisible();
  if (connect) await mm.connectVirtual();
  if (values) await mm.script((f, x) => f.emitPollUpdate(x.id, { values: x.values }), { id, values });
  return {
    kind: "workspace",
    page: mm.page,
    id,
    grid: mm.grid(id),
    row: (i) => mm.gridRow(id, i),
    calls: (m) => mm.calls(m),
    script: (fn, arg) => mm.script(fn, arg),
    announced: async () => (await mm.announcements()).map((x) => x.text),
    mm,
    win: null,
  };
}
