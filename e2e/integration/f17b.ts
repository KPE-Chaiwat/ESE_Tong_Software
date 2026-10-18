// REPORT-008 round 2: measurements of the native window toolbar (two groups, icon-only below 640 css px), the grid rows and the W1 toolbar.
// Pure measurement helpers (page.evaluate); the assertions live in the spec.
import type { Page } from "@playwright/test";

export interface ControlInfo {
  label: string;
  tag: string;
  aria: string | null;
  title: string | null;
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  offsetTop: number;
}

export interface ToolbarMetrics {
  mode: string | null;
  inner: number;
  toolbarW: number;
  toolbarH: number;
  scrollOver: number;
  groups: Array<{ slot: string; top: number; bottom: number; h: number; w: number; scrollOver: number }>;
  rows: number;
  rowsByRect: number;
  offsets: number[];
  controls: ControlInfo[];
  named: Record<string, { found: boolean; text: string; aria: string | null; title: string | null; w: number; h: number; hasSvg: boolean }>;
  pills: Array<{ text: string; hasSvg: boolean; cut: boolean; left: number; right: number; w: number }>;
  name: { text: string; title: string | null; cut: boolean; overflow: string; w: number } | null;
  clipped: string[];
  issues: string[];
}

/** Clusters sorted values: a new row starts when a value is more than `tol` above the first value of the current row. */
export function countRows(values: number[], tol = 4): number {
  const s = [...values].sort((a, b) => a - b);
  let rows = 0;
  let first = Number.NEGATIVE_INFINITY;
  for (const v of s) {
    if (v - first > tol) {
      rows += 1;
      first = v;
    }
  }
  return rows;
}

export async function nativeToolbarMetrics(page: Page): Promise<ToolbarMetrics> {
  const raw = await page.evaluate(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const de = document.documentElement;
    const tb = document.querySelector('[data-slot="native-toolbar"]') as HTMLElement;
    const tbr = tb.getBoundingClientRect();
    const groups = [...tb.children] as HTMLElement[];
    const vis = (e: Element) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    };
    const inGroups = (e: Element) => groups.some((g) => g.contains(e));
    const interactive = ([...tb.querySelectorAll('button, input, select, a[href], [role="button"]')] as HTMLElement[]).filter((e) => inGroups(e) && vis(e));
    const info = (e: HTMLElement) => {
      const b = e.getBoundingClientRect();
      return {
        label: (e.getAttribute("aria-label") ?? e.innerText.trim()) || e.tagName,
        tag: e.tagName,
        aria: e.getAttribute("aria-label"),
        title: e.getAttribute("title"),
        text: e.innerText.trim(),
        left: Math.round(b.left * 10) / 10,
        right: Math.round(b.right * 10) / 10,
        top: Math.round(b.top * 10) / 10,
        bottom: Math.round(b.bottom * 10) / 10,
        width: Math.round(b.width * 10) / 10,
        height: Math.round(b.height * 10) / 10,
        offsetTop: e.offsetTop,
      };
    };
    const controls = interactive.map(info);
    const byName = (names: string[]) => interactive.find((e) => names.includes(e.getAttribute("aria-label") ?? "") || names.includes(e.innerText.trim()));
    const named: Record<string, unknown> = {};
    for (const [key, names] of [
      ["Pause", ["Pause", "Resume"]],
      ["Write", ["Write…"]],
      ["Connection window", ["Connection window"]],
      ["Dock", ["Dock to workspace"]],
    ] as Array<[string, string[]]>) {
      const e = byName(names);
      const b = e?.getBoundingClientRect();
      named[key] = { found: !!e, text: e?.innerText.trim() ?? "", aria: e?.getAttribute("aria-label") ?? null, title: e?.getAttribute("title") ?? null, w: b ? Math.round(b.width * 10) / 10 : 0, h: b ? Math.round(b.height * 10) / 10 : 0, hasSvg: !!e?.querySelector("svg") };
    }
    const pills = ([...tb.querySelectorAll('[data-slot="status-pill"]')] as HTMLElement[]).map((p) => {
      const b = p.getBoundingClientRect();
      return { text: p.innerText.trim(), hasSvg: !!p.querySelector("svg"), cut: p.scrollWidth > p.clientWidth + 1, left: b.left, right: b.right, w: Math.round(b.width * 10) / 10 };
    });
    const nm = document.querySelector('[data-testid="native-poll-name"]') as HTMLElement | null;
    const name = nm ? { text: nm.textContent ?? "", title: nm.getAttribute("title"), cut: nm.scrollWidth > nm.clientWidth + 1, overflow: getComputedStyle(nm).textOverflow, w: Math.round(nm.getBoundingClientRect().width * 10) / 10 } : null;
    const clipped: string[] = [];
    const all = [...interactive, ...([...tb.querySelectorAll('[data-slot="status-pill"]')] as HTMLElement[])];
    for (const e of all) {
      const b = e.getBoundingClientRect();
      const n = e.getAttribute("aria-label") ?? e.innerText.trim() ?? e.tagName;
      if (b.left < tbr.left - 0.5 || b.right > tbr.right + 0.5 || b.top < tbr.top - 0.5 || b.bottom > tbr.bottom + 0.5) clipped.push(`${n}: outside the toolbar box`);
      if (b.right > de.clientWidth + 0.5) clipped.push(`${n}: right edge ${Math.round(b.right)} beyond the window ${de.clientWidth}`);
      if (e.scrollWidth > e.clientWidth + 1 && e.tagName !== "INPUT") clipped.push(`${n}: own text cut (${e.scrollWidth} > ${e.clientWidth})`);
    }
    const g2 = groups.map((g) => {
      const b = g.getBoundingClientRect();
      return { slot: g.dataset.slot ?? g.tagName, top: Math.round(b.top * 10) / 10, bottom: Math.round(b.bottom * 10) / 10, h: Math.round(b.height * 10) / 10, w: Math.round(b.width * 10) / 10, scrollOver: g.scrollWidth - g.clientWidth };
    });
    return {
      mode: tb.dataset.labelMode ?? null,
      inner: window.innerWidth,
      toolbarW: Math.round(tbr.width * 100) / 100,
      toolbarH: Math.round(tbr.height * 10) / 10,
      scrollOver: tb.scrollWidth - tb.clientWidth,
      groups: g2,
      offsets: interactive.map((e) => e.offsetTop),
      rectTops: interactive.map((e) => e.getBoundingClientRect().top),
      controls,
      named,
      pills,
      name,
      clipped,
    };
  });
  const rows = countRows(raw.offsets);
  const rowsByRect = countRows(raw.rectTops);
  const issues: string[] = [];
  if (rows !== rowsByRect) issues.push(`rows by offsetTop ${rows} != rows by rect ${rowsByRect}`);
  const { rectTops: _ignored, ...rest } = raw;
  void _ignored;
  return { ...(rest as Omit<ToolbarMetrics, "rows" | "rowsByRect" | "issues">), rows, rowsByRect, issues };
}

/** The CHK2-F17 toolbar rules for one measurement (connected, polling, no banner). `pauseName` is "Pause" or "Resume". */
export function toolbarFailures(m: ToolbarMetrics, pauseName: "Pause" | "Resume" = "Pause"): string[] {
  const f: string[] = [...m.issues];
  if (m.rows > 2) f.push(`toolbar has ${m.rows} rows (offsetTops ${m.offsets.join(",")})`);
  const expectedMode = m.toolbarW >= 640 ? "full" : "icon";
  if (m.mode !== expectedMode) f.push(`label mode ${m.mode} but toolbar width ${m.toolbarW} css px wants ${expectedMode}`);
  const wanted: Record<string, string> = { Pause: pauseName, Write: "Write…", "Connection window": "Connection window", Dock: "Dock to workspace" };
  for (const [k, full] of Object.entries(wanted)) {
    const n = m.named[k];
    if (!n?.found) {
      f.push(`button ${k} not found`);
      continue;
    }
    if (m.mode === "icon") {
      if (n.text !== "") f.push(`${k}: icon mode but visible text ${JSON.stringify(n.text)}`);
      if (n.aria !== full) f.push(`${k}: aria-label ${JSON.stringify(n.aria)} != ${JSON.stringify(full)}`);
      if (n.title !== full) f.push(`${k}: title ${JSON.stringify(n.title)} != ${JSON.stringify(full)}`);
      if (!n.hasSvg) f.push(`${k}: no icon`);
    } else if (m.mode === "full") {
      if (!n.text.includes(full)) f.push(`${k}: full mode but text ${JSON.stringify(n.text)}`);
    }
  }
  for (const [i, p] of m.pills.entries()) {
    if (!p.hasSvg) f.push(`pill ${i} (${p.text}) has no icon`);
    if (p.text === "") f.push(`pill ${i} has no text`);
    if (p.cut) f.push(`pill ${i} (${p.text}) text cut`);
  }
  if (m.pills.length !== 2) f.push(`expected 2 pills, found ${m.pills.length}`);
  if (m.name?.cut) {
    if (m.name.title !== m.name.text) f.push(`name cut but title ${JSON.stringify(m.name.title)} != ${JSON.stringify(m.name.text)}`);
    if (m.name.overflow !== "ellipsis") f.push(`name cut without ellipsis (${m.name.overflow})`);
  } else if (m.name && m.name.title) {
    f.push(`name fits but has title ${JSON.stringify(m.name.title)}`);
  }
  for (const c of m.clipped) f.push(`clipped: ${c}`);
  if (m.scrollOver > 1) f.push(`toolbar scrolls horizontally by ${m.scrollOver} px`);
  for (const g of m.groups) if (g.scrollOver > 1) f.push(`group ${g.slot} overflows by ${g.scrollOver} px`);
  return f;
}

export interface GridMetrics {
  gridH: number;
  clientH: number;
  headerH: number;
  hScrollbar: number;
  rendered: number;
  completeStrict: number[];
  completeNaive: number[];
  scrollable: boolean;
  viewH: number | null;
  viewParts: Array<{ part: string; h: number }>;
  clientDocH: number;
  toolbarH: number | null;
  footerH: number | null;
}

export async function gridMetrics(page: Page, gridSelector = '[role="grid"][aria-label="Register values"]'): Promise<GridMetrics> {
  return page.evaluate((sel) => {
    const g = document.querySelector(sel) as HTMLElement;
    const gr = g.getBoundingClientRect();
    const header = g.querySelector('[role="columnheader"]')?.parentElement as HTMLElement | null;
    const headerBottom = header ? header.getBoundingClientRect().bottom : gr.top + g.clientTop;
    const visTop = Math.max(gr.top + g.clientTop, headerBottom);
    const visBottom = gr.top + g.clientTop + g.clientHeight;
    const rows = [...g.querySelectorAll('[role="row"][data-row]')] as HTMLElement[];
    const strict = rows.filter((r) => {
      const b = r.getBoundingClientRect();
      return b.top >= visTop - 0.5 && b.bottom <= visBottom + 0.5;
    });
    const naive = rows.filter((r) => {
      const b = r.getBoundingClientRect();
      return b.top >= gr.top - 0.5 && b.bottom <= gr.bottom + 0.5;
    });
    const pv = document.querySelector('[data-slot="poll-view"]') as HTMLElement | null;
    const parts = pv ? ([...pv.children] as HTMLElement[]).map((c) => ({ part: c.dataset.slot ?? c.dataset.region ?? c.getAttribute("role") ?? c.tagName, h: Math.round(c.getBoundingClientRect().height * 10) / 10 })) : [];
    const tb = (document.querySelector('[data-slot="native-toolbar"]') ?? document.querySelector('[role="toolbar"]')) as HTMLElement | null;
    const ft = document.querySelector('footer[data-region="status"]') as HTMLElement | null;
    return {
      gridH: Math.round(gr.height * 10) / 10,
      clientH: g.clientHeight,
      headerH: header ? Math.round(header.getBoundingClientRect().height * 10) / 10 : 0,
      hScrollbar: g.offsetHeight - g.clientHeight - 2 * g.clientTop,
      rendered: rows.length,
      completeStrict: strict.map((r) => Number(r.dataset.row)),
      completeNaive: naive.map((r) => Number(r.dataset.row)),
      scrollable: g.scrollHeight > g.clientHeight + 1,
      viewH: pv ? Math.round(pv.getBoundingClientRect().height * 10) / 10 : null,
      viewParts: parts,
      clientDocH: document.documentElement.clientHeight,
      toolbarH: tb ? Math.round(tb.getBoundingClientRect().height * 10) / 10 : null,
      footerH: ft ? Math.round(ft.getBoundingClientRect().height * 10) / 10 : null,
    };
  }, gridSelector);
}

/** Frame-accurate recorder for the drag across 640 css px: width, toolbar height, label mode, document scrollbars. */
export async function installDragRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __dr?: { frames: Array<{ t: number; w: number; h: number; mode: string | null; docOver: boolean }>; modeMut: Array<{ t: number; mode: string | null; w: number }>; on: boolean } };
    w.__dr = { frames: [], modeMut: [], on: true };
    const dr = w.__dr;
    const tb = document.querySelector('[data-slot="native-toolbar"]') as HTMLElement;
    const t0 = performance.now();
    let last = "";
    const frame = () => {
      if (!dr.on) return;
      const r = tb.getBoundingClientRect();
      const de = document.documentElement;
      const s = `${Math.round(r.width * 100)}|${Math.round(r.height * 10)}|${tb.dataset.labelMode}`;
      if (s !== last) {
        last = s;
        dr.frames.push({ t: Math.round(performance.now() - t0), w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 10) / 10, mode: tb.dataset.labelMode ?? null, docOver: de.scrollHeight > de.clientHeight || de.scrollWidth > de.clientWidth });
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    new MutationObserver(() => dr.modeMut.push({ t: Math.round(performance.now() - t0), mode: tb.dataset.labelMode ?? null, w: Math.round(tb.getBoundingClientRect().width * 100) / 100 })).observe(tb, { attributes: true, attributeFilter: ["data-label-mode"] });
  });
}

export interface DragLog {
  frames: Array<{ t: number; w: number; h: number; mode: string | null; docOver: boolean }>;
  modeMut: Array<{ t: number; mode: string | null; w: number }>;
}

export async function readDragRecorder(page: Page, clear = true): Promise<DragLog> {
  return page.evaluate((c) => {
    const w = window as unknown as { __dr: { frames: unknown[]; modeMut: unknown[] } };
    const out = { frames: [...w.__dr.frames], modeMut: [...w.__dr.modeMut] } as unknown as DragLog;
    if (c) {
      w.__dr.frames.length = 0;
      w.__dr.modeMut.length = 0;
    }
    return out;
  }, clear);
}

export interface W1ToolbarMetrics {
  inner: number;
  clientW: number;
  toolbarH: number;
  toolbarW: number;
  scrollOver: number;
  rows: number;
  items: Array<{ label: string; kind: string; left: number; right: number; width: number; cut: boolean; clipped: string | null }>;
  childWidths: Array<{ child: string; width: number }>;
  sumChildren: number;
  contentWidth: number;
  gap: number;
  clipped: string[];
  overlaps: string[];
  docOver: boolean;
}

export async function w1ToolbarMetrics(page: Page): Promise<W1ToolbarMetrics> {
  const raw = await page.evaluate(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const de = document.documentElement;
    const tb = document.querySelector('[role="toolbar"][aria-label="Toolbar"]') as HTMLElement;
    const tbr = tb.getBoundingClientRect();
    const cs = getComputedStyle(tb);
    const padL = Number.parseFloat(cs.paddingLeft);
    const padR = Number.parseFloat(cs.paddingRight);
    const vis = (e: Element) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    };
    const leafs = ([...tb.querySelectorAll('button, [data-slot="status-pill"], [data-testid="summary-chip"], [data-testid="profile"], input, select, a[href]')] as HTMLElement[]).filter(vis);
    const items = leafs.map((e) => {
      const b = e.getBoundingClientRect();
      let clipped: string | null = null;
      if (b.left < tbr.left - 0.5) clipped = "left of the toolbar";
      else if (b.right > tbr.right + 0.5) clipped = `right edge ${Math.round(b.right * 10) / 10} beyond the toolbar ${Math.round(tbr.right * 10) / 10}`;
      else if (b.right > de.clientWidth + 0.5) clipped = `right edge ${Math.round(b.right)} beyond the window ${de.clientWidth}`;
      return { label: (e.getAttribute("aria-label") ?? e.innerText.trim().replace(/\s+/g, " ")).slice(0, 60) || e.tagName, kind: e.tagName === "BUTTON" ? "button" : (e.dataset.slot ?? e.dataset.testid ?? e.tagName), left: Math.round(b.left * 10) / 10, right: Math.round(b.right * 10) / 10, width: Math.round(b.width * 10) / 10, cut: e.scrollWidth > e.clientWidth + 1, clipped };
    });
    const kids = [...tb.children] as HTMLElement[];
    const childWidths = kids.map((k) => ({ child: (k.dataset.testid ?? k.dataset.slot ?? k.getAttribute("class")?.split(" ")[0] ?? k.tagName) + ":" + (k.innerText.trim().replace(/\s+/g, " ").slice(0, 24) || k.tagName), width: Math.round(k.getBoundingClientRect().width * 10) / 10 }));
    const gap = Number.parseFloat(cs.columnGap) || 0;
    const tops = leafs.map((e) => e.offsetTop);
    return { inner: window.innerWidth, clientW: de.clientWidth, toolbarH: Math.round(tbr.height * 10) / 10, toolbarW: Math.round(tbr.width * 10) / 10, scrollOver: tb.scrollWidth - tb.clientWidth, items, childWidths, gap, contentWidth: Math.round((tbr.width - padL - padR) * 10) / 10, tops, docOver: de.scrollWidth > de.clientWidth || de.scrollHeight > de.clientHeight };
  });
  const rows = countRows(raw.tops);
  const clipped = raw.items.filter((i) => i.clipped).map((i) => `${i.label}: ${i.clipped}`);
  const cutItems = raw.items.filter((i) => i.cut && !i.clipped).map((i) => `${i.label}: text cut`);
  const overlaps: string[] = [];
  const sorted = [...raw.items].filter((i) => i.kind === "button" || i.kind === "status-pill").sort((a, b) => a.left - b.left);
  for (let i = 1; i < sorted.length; i += 1) {
    const p = sorted[i - 1];
    const c = sorted[i];
    if (p && c && c.left < p.right - 1) overlaps.push(`${p.label} / ${c.label} overlap by ${Math.round((p.right - c.left) * 10) / 10}`);
  }
  const sumChildren = Math.round(raw.childWidths.reduce((a, b) => a + b.width, 0) * 10) / 10;
  return { inner: raw.inner, clientW: raw.clientW, toolbarH: raw.toolbarH, toolbarW: raw.toolbarW, scrollOver: raw.scrollOver, rows, items: raw.items, childWidths: raw.childWidths, sumChildren, contentWidth: raw.contentWidth, gap: raw.gap, clipped: [...clipped, ...cutItems], overlaps, docOver: raw.docOver };
}

// ---- document metrics (copied from tests-integration/19-report008.spec.ts) ----
export interface DocMetrics {
  inner: number;
  innerH: number;
  clientW: number;
  clientH: number;
  scrollW: number;
  scrollH: number;
  gutterX: number;
  gutterY: number;
  viewOffsetWidth: number | null;
  viewExactWidth: number | null;
  statusTextH: number | null;
  versionH: number | null;
  footerH: number | null;
  statusCut: boolean | null;
  statusTitle: string | null;
  statusText: string | null;
  statusOverflow: string | null;
  versionText: string | null;
  versionCut: boolean | null;
  versionRightInFooter: boolean | null;
}

export async function docMetrics(page: Page, o: { status: string | null; view: boolean }): Promise<DocMetrics> {
  return page.evaluate(
    async ({ status, view }) => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const de = document.documentElement;
      const st = status ? (document.querySelector(`[data-testid="${status}"]`) as HTMLElement | null) : null;
      const ver = document.querySelector('[data-testid="app-version"]') as HTMLElement | null;
      const foot = document.querySelector('footer[data-region="status"]') as HTMLElement | null;
      const pv = view ? (document.querySelector('[data-slot="poll-view"]') as HTMLElement | null) : null;
      const h = (e: HTMLElement | null) => (e ? Math.round(e.getBoundingClientRect().height * 10) / 10 : null);
      return {
        inner: window.innerWidth,
        innerH: window.innerHeight,
        clientW: de.clientWidth,
        clientH: de.clientHeight,
        scrollW: de.scrollWidth,
        scrollH: de.scrollHeight,
        gutterX: window.innerWidth - de.clientWidth,
        gutterY: window.innerHeight - de.clientHeight,
        viewOffsetWidth: pv ? pv.offsetWidth : null,
        viewExactWidth: pv ? Math.round(pv.getBoundingClientRect().width * 100) / 100 : null,
        statusTextH: h(st),
        versionH: h(ver),
        footerH: h(foot),
        statusCut: st ? st.scrollWidth > st.clientWidth : null,
        statusTitle: st ? st.getAttribute("title") : null,
        statusText: st ? st.textContent : null,
        statusOverflow: st ? `${getComputedStyle(st).textOverflow}/${getComputedStyle(st).overflow}/${getComputedStyle(st).whiteSpace}` : null,
        versionText: ver ? ver.textContent : null,
        versionCut: ver ? ver.scrollWidth > ver.clientWidth : null,
        versionRightInFooter: ver && foot ? ver.getBoundingClientRect().right <= foot.getBoundingClientRect().right + 0.5 : null,
      };
    },
    { status: o.status, view: o.view },
  );
}

/** The CHK2-F17 checks for one measurement. Returns the failures (empty = pass). */
export function f17Failures(m: DocMetrics, base: { statusH: number | null; versionH: number | null }, o: { view: boolean; footer28: boolean }): string[] {
  const f: string[] = [];
  if (m.scrollH !== m.clientH) f.push(`scrollHeight ${m.scrollH} != clientHeight ${m.clientH}`);
  if (m.scrollW !== m.clientW) f.push(`scrollWidth ${m.scrollW} != clientWidth ${m.clientW}`);
  if (m.gutterX !== 0) f.push(`vertical scrollbar gutter ${m.gutterX} px`);
  if (m.gutterY !== 0) f.push(`horizontal scrollbar gutter ${m.gutterY} px`);
  if (o.view && m.viewOffsetWidth !== m.clientW) f.push(`PollView offsetWidth ${m.viewOffsetWidth} != client width ${m.clientW} (exact ${m.viewExactWidth})`);
  if (base.statusH !== null && m.statusTextH !== null && Math.abs(m.statusTextH - base.statusH) > 0.5) f.push(`status text height ${m.statusTextH} != one line ${base.statusH} (wrapped)`);
  if (base.versionH !== null && m.versionH !== null && Math.abs(m.versionH - base.versionH) > 0.5) f.push(`version label height ${m.versionH} != one line ${base.versionH} (wrapped)`);
  if (o.footer28 && m.footerH !== 28) f.push(`status bar height ${m.footerH} != 28`);
  if (m.statusCut === true) {
    if (m.statusTitle !== m.statusText) f.push(`status text is cut but its title is ${JSON.stringify(m.statusTitle)} not the complete text`);
    if (!(m.statusOverflow ?? "").startsWith("ellipsis")) f.push(`status text is cut without text-overflow: ellipsis (${m.statusOverflow})`);
  } else if (m.statusCut === false && m.statusTitle) {
    f.push(`status text fits but has a title ${JSON.stringify(m.statusTitle)} (the title must appear only when cut)`);
  }
  if (m.versionText !== null && !/^ESEfact v\d/.test(m.versionText)) f.push(`version label text ${JSON.stringify(m.versionText)}`);
  if (m.versionCut === true) f.push("version label is cut");
  if (m.versionRightInFooter === false) f.push("version label sticks out of the status bar");
  return f;
}
