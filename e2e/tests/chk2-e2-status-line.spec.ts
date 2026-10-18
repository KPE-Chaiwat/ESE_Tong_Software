// CHK-002 E13 (boundary) and E16-E26: the status line of a poll sub-window at narrow widths (DES-002 2.3.2,
// revision 9: steps `data-step` 0..5 on the status line width L, no spacer, counters element with exactly the
// visible text). Everything is checked against ONE validator that turns the designer's rules into
// expectations from the MEASURED L (never from a border constant):
//   - structure: the direct children of the status line, which elements are visible at the measured step,
//     the exact counters text, the freshness chips (header chip keeps its text, line chip is icon only),
//   - step: `data-step` equals the step the thresholds give for the measured L,
//   - fit: no control clips (state chip, freshness chip, Show, `⋯`), the line never scrolls, nothing overlaps,
//   - counters: complete (not cut by the last-resort ellipsis) unless the documented exception applies.
// The step widths are the designer's ESTIMATES (D-002-19): a disagreement is a finding to report with
// numbers. Nothing here relaxes a rule to make a width pass. All measurements are printed as
// `MEASURE ...` / `SWEEP ...` lines and attached to the test as JSON.
import { chromium, type Page, type TestInfo } from "@playwright/test";
import { expect, LAYOUT_SEED, Mm, test } from "../support/mm-fixtures";

type Kind = "polling" | "timeout";

interface Box {
  present: boolean;
  visible: boolean;
  x: number;
  right: number;
  width: number;
  /** right edge minus the line's content right edge: > 0 means the control reaches into the padding or beyond. */
  overContent: number;
  /** px of the control that a clipping ancestor (overflow hidden/clip/auto) hides. */
  clipped: number;
  text: string;
  title: string | null;
}
interface Measure {
  frameOffsetWidth: number;
  frameWidth: number;
  /** Status line width L (getBoundingClientRect, fractional at 125% / 150%). */
  L: number;
  borderPx: number;
  lineScrollWidth: number;
  lineClientWidth: number;
  step: string | null;
  tone: string | null;
  state: string | null;
  kids: string[];
  grows: string[];
  radiogroups: number;
  group: Box;
  pill: Box;
  counters: Box & {
    textContent: string;
    ariaLabel: string | null;
    role: string | null;
    need: number;
    scrollWidth: number;
    clientWidth: number;
  };
  reason: Box & { hiddenAttr: boolean; need: number; scrollWidth: number; clientWidth: number };
  fresh: Box & { iconOnly: string | null; icon: string | null; textContent: string };
  header: { present: boolean; text: string; iconOnly: string | null; width: number; kind: string | null };
  show: Box & { icons: string[]; ariaLabel: string | null };
  actions: Box;
}

/** Runs in the page: measures the status line of one sub-window. */
const MEASURE = (id: number): Measure => {
  const frame = document.querySelector(`[data-subwindow="${id}"]`) as HTMLElement;
  const fr = frame.getBoundingClientRect();
  const fcs = getComputedStyle(frame);
  const line = frame.querySelector('[data-testid="poll-status-line"]') as HTMLElement;
  const lr = line.getBoundingClientRect();
  const lcs = getComputedStyle(line);
  const contentRight = lr.right - parseFloat(lcs.paddingRight) - parseFloat(lcs.borderRightWidth);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const none = (): Box => ({
    present: false,
    visible: false,
    x: 0,
    right: 0,
    width: 0,
    overContent: 0,
    clipped: 0,
    text: "",
    title: null,
  });
  const box = (el: Element | null): Box => {
    if (!el) return none();
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || el.getClientRects().length === 0) {
      return { ...none(), present: true, title: el.getAttribute("title") };
    }
    let clipped = 0;
    for (let a = el.parentElement; a && a !== frame.parentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === "visible") continue;
      const ar = a.getBoundingClientRect();
      const left = ar.left + a.clientLeft;
      const right = left + a.clientWidth;
      clipped = Math.max(clipped, r.right - right, left - r.left, 0);
    }
    return {
      present: true,
      visible: true,
      x: r2(r.left),
      right: r2(r.right),
      width: r2(r.width),
      overContent: r2(r.right - contentRight),
      clipped: r2(clipped),
      text: ((el as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim(),
      title: el.getAttribute("title"),
    };
  };
  const need = (el: Element | null): number => {
    if (!el) return 0;
    const range = document.createRange();
    range.selectNodeContents(el);
    return r2(range.getBoundingClientRect().width);
  };
  const slotOf = (c: Element): string => {
    const slot = c.getAttribute("data-slot");
    if (slot === "status-pill") return "pill";
    if (slot === "counters") return "counters";
    if (slot === "reason") return "reason";
    return c.tagName.toLowerCase() === "div" ? "group" : `other:${c.tagName.toLowerCase()}`;
  };
  const kids = [...line.children];
  const countersEl = line.querySelector('[data-slot="counters"]') as HTMLElement | null;
  const reasonEl = line.querySelector('[data-slot="reason"]') as HTMLElement | null;
  const chips = [...frame.querySelectorAll('[data-slot="freshness-chip"]')];
  const lineChip = chips.find((c) => line.contains(c)) ?? null;
  const headerChip = chips.find((c) => !line.contains(c)) ?? null;
  const buttons = [...line.querySelectorAll("button")] as HTMLElement[];
  const showEl =
    buttons.find((b) => (b.getAttribute("aria-label") ?? b.innerText).startsWith("Show ")) ?? null;
  const actionsEl = buttons.find((b) => b.getAttribute("aria-label") === "Poll actions") ?? null;
  return {
    frameOffsetWidth: frame.offsetWidth,
    frameWidth: r2(fr.width),
    L: r2(lr.width),
    borderPx: parseFloat(fcs.borderLeftWidth),
    lineScrollWidth: line.scrollWidth,
    lineClientWidth: line.clientWidth,
    step: line.getAttribute("data-step"),
    tone: line.getAttribute("data-tone"),
    state: line.getAttribute("data-state"),
    kids: kids.map(slotOf),
    grows: kids.map((c) => `${slotOf(c)}:${getComputedStyle(c).flexGrow}`),
    radiogroups: frame.querySelectorAll('[role="radiogroup"]').length,
    group: box(kids.find((c) => slotOf(c) === "group") ?? null),
    pill: box(line.querySelector('[data-slot="status-pill"]')),
    counters: {
      ...box(countersEl),
      textContent: countersEl?.textContent ?? "",
      ariaLabel: countersEl?.getAttribute("aria-label") ?? null,
      role: countersEl?.getAttribute("role") ?? null,
      need: need(countersEl),
      scrollWidth: countersEl?.scrollWidth ?? 0,
      clientWidth: countersEl?.clientWidth ?? 0,
      title: countersEl?.getAttribute("title") ?? null,
    },
    reason: {
      ...box(reasonEl),
      hiddenAttr: !!reasonEl?.hasAttribute("hidden"),
      need: need(reasonEl),
      scrollWidth: reasonEl?.scrollWidth ?? 0,
      clientWidth: reasonEl?.clientWidth ?? 0,
      title: reasonEl?.getAttribute("title") ?? null,
      text: reasonEl?.textContent ?? "",
    },
    fresh: {
      ...box(lineChip),
      iconOnly: lineChip?.getAttribute("data-icon-only") ?? null,
      icon: lineChip?.querySelector("[data-icon]")?.getAttribute("data-icon") ?? null,
      textContent: (lineChip?.textContent ?? "").trim(),
    },
    header: {
      present: !!headerChip,
      text: (headerChip?.textContent ?? "").trim(),
      iconOnly: headerChip?.getAttribute("data-icon-only") ?? null,
      width: r2(headerChip?.getBoundingClientRect().width ?? 0),
      kind: headerChip?.getAttribute("data-kind") ?? null,
    },
    show: {
      ...box(showEl),
      icons: showEl ? [...showEl.querySelectorAll("[data-icon]")].map((i) => i.getAttribute("data-icon") ?? "") : [],
      ariaLabel: showEl?.getAttribute("aria-label") ?? null,
    },
    actions: box(actionsEl),
  };
};

async function measure(page: Page, id: number): Promise<Measure> {
  return page.evaluate(`(${MEASURE.toString()})(${id})`) as Promise<Measure>;
}

/** Two animation frames: the ResizeObserver of the view and its React commit have run (an observable wait, no sleep). */
async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

// ---------------------------------------------------------------------------------------------------------
// The designer's rules (DES-002 2.3.2 revision 9)
// ---------------------------------------------------------------------------------------------------------
const TX = 1234;
const ERR: Record<Kind, number> = { polling: 0, timeout: 3 };
const T_REASON = 620;
const T_IDS = 606;
const T_SHOW = 500;
const T_ERR = 465;
const T_WIDE = 720;
/** Estimated step-5 fit width of the active FRAME (DES-002 2.3.2): below it the counters may be cut. */
const FIT_FRAME: Record<Kind, number> = { polling: 393, timeout: 400 };
/** Measurement tolerance for "the counters are not cut": half a pixel (Range width vs element width). */
const CUT_TOL = 0.5;

/** The step DES-002 gives for a measured L: live chip text T1 = 720, long chip text (stale) T1 = 810. */
function stepFor(L: number, kind: Kind): number {
  const t1 = kind === "timeout" ? 810 : 720;
  return [L < t1, L < T_REASON, L < T_IDS, L < T_SHOW, L < T_ERR].filter(Boolean).length;
}
const fullCounters = (kind: Kind): string => `Tx ${TX} · Err ${ERR[kind]} · ID 1 · F 03 · SR 100 ms`;
function visibleCounters(step: number, kind: Kind): string {
  if (step >= 5) return `Tx ${TX} · SR 100 ms`;
  if (step >= 3) return `Tx ${TX} · Err ${ERR[kind]} · SR 100 ms`;
  return fullCounters(kind);
}

interface Issues {
  structure: string[];
  step: string[];
  fit: string[];
  counters: string[];
}
const noIssues = (): Issues => ({ structure: [], step: [], fit: [], counters: [] });
const countersCut = (m: Measure): number => Math.max(0, m.counters.need - m.counters.width);

/** Validates one measurement against the rules; `mustBeComplete`: the counters check applies at this width. */
function validate(m: Measure, kind: Kind, mustBeComplete: boolean): Issues {
  const o = noIssues();
  const S = (s: string) => o.structure.push(s);
  const expStep = stepFor(m.L, kind);
  const wide = m.L >= T_WIDE;
  // ---- step ----
  if (m.step !== String(expStep)) o.step.push(`data-step ${m.step} but L ${m.L} gives ${expStep}`);
  // ---- structure ----
  const wantKids = ["pill", "counters", ...(kind === "timeout" ? ["reason"] : []), "group"];
  if (JSON.stringify(m.kids) !== JSON.stringify(wantKids)) S(`direct children ${m.kids.join(",")} (want ${wantKids.join(",")})`);
  const growWant = wantKids.map((k) => `${k}:${k === "reason" ? 1 : 0}`);
  if (JSON.stringify(m.grows) !== JSON.stringify(growWant)) S(`flex-grow ${m.grows.join(",")} (want ${growWant.join(",")}: the reason is the only growing item)`);
  if (m.state !== (kind === "polling" ? "polling" : "timeout")) S(`state ${m.state}`);
  if (m.pill.text !== (kind === "polling" ? "Polling" : "Timeout")) S(`chip text "${m.pill.text}"`);
  if (kind === "timeout" && m.tone !== "warning") S(`tone ${m.tone} (want warning)`);
  // counters element: exactly the visible text, tooltip always complete, name complete from step 3
  const vis = visibleCounters(expStep, kind);
  const full = fullCounters(kind);
  if (m.counters.text !== vis) S(`counters innerText "${m.counters.text}" (want "${vis}")`);
  if (m.counters.textContent !== vis) S(`counters textContent "${m.counters.textContent}" (want "${vis}")`);
  if (m.counters.title !== full) S(`counters title "${m.counters.title}" (want "${full}")`);
  if (expStep >= 3 && m.counters.ariaLabel !== full) S(`counters aria-label "${m.counters.ariaLabel}" at step ${expStep} (want "${full}")`);
  // reason
  if (kind === "timeout") {
    if (expStep < 2) {
      if (m.reason.hiddenAttr || !m.reason.visible || m.reason.width <= 0) S(`reason not rendered at step ${expStep} (hidden=${m.reason.hiddenAttr}, width ${m.reason.width})`);
      else {
        if (!/^No response within 1000 m?s?/.test(m.reason.text.replace(/…$/, ""))) S(`reason text "${m.reason.text}"`);
        if (m.group.visible && m.group.x - m.reason.right > 8.5) S(`reason right ${m.reason.right} is ${r1(m.group.x - m.reason.right)} px before the right group (want <= 8): empty space`);
        if (m.reason.x < m.counters.right - 0.5) S("reason starts before the end of the counters");
      }
      if (!/^Timeout: slave 1 did not respond within 1000 ms\. Retrying every 100 ms \(\d+ in a row\)\.$/.test(m.reason.title ?? "")) S(`reason title "${m.reason.title}"`);
    } else if (m.reason.visible || !m.reason.hiddenAttr) {
      S(`reason still visible at step ${expStep} (hidden attr ${m.reason.hiddenAttr}, visible ${m.reason.visible})`);
    }
    if (!/^Timeout: slave 1 did not respond within 1000 ms\. Retrying every 100 ms \(\d+ in a row\)\.$/.test(m.pill.title ?? "")) S(`chip tooltip "${m.pill.title}"`);
  }
  // wide / compact layout
  if (wide) {
    if (m.fresh.present) S("freshness chip in the status line at L >= 720");
    if (m.show.present) S("Show control in the status line at L >= 720");
    if (m.radiogroups < 1) S("no segmented controls in the data card header at L >= 720");
  } else {
    if (m.radiogroups !== 0) S(`${m.radiogroups} segmented control groups at L < 720`);
    if (m.header.present) S("data card header chip at L < 720");
    if (!m.fresh.visible) S("no freshness chip in the status line at L < 720");
    else {
      if (m.fresh.iconOnly !== "true") S("status line freshness chip is not icon only");
      const t = kind === "polling" ? /^Updated \d\d:\d\d:\d\d\.\d{3}$/ : /^No response - values from \d\d:\d\d:\d\d\.\d{3}$/;
      if (!t.test(m.fresh.textContent)) S(`line chip text "${m.fresh.textContent}"`);
      if (!(m.fresh.title ?? "").startsWith(m.fresh.textContent)) S(`line chip tooltip "${m.fresh.title}"`);
      if (m.fresh.width >= 48) S(`icon-only chip is ${m.fresh.width} px wide`);
      if (kind === "polling" && m.fresh.icon !== "circle-check") S(`chip icon ${m.fresh.icon}`);
    }
    if (!m.show.visible) S("no Show control in the status line at L < 720");
    else if (expStep < 4) {
      if (m.show.text !== "Show Raw") S(`Show text "${m.show.text}" at step ${expStep}`);
    } else {
      if (m.show.text !== "") S(`Show shows text "${m.show.text}" at step ${expStep}`);
      if (JSON.stringify(m.show.icons) !== JSON.stringify(["columns-3", "chevron-down"])) S(`Show icons ${m.show.icons.join(",")}`);
      if (m.show.ariaLabel !== "Show Raw" || m.show.title !== "Show Raw") S(`Show name "${m.show.ariaLabel}" / tooltip "${m.show.title}"`);
    }
  }
  if (wide) {
    const t = kind === "polling" ? /^Updated \d\d:\d\d:\d\d\.\d{3}$/ : /^No response - values from \d\d:\d\d:\d\d\.\d{3}$/;
    if (!m.header.present) S("no data card header freshness chip at L >= 720");
    else {
      if (m.header.iconOnly === "true") S("header chip is icon only (it keeps its text at every width)");
      if (!t.test(m.header.text)) S(`header chip text "${m.header.text}"`);
    }
  }
  // right group is pushed right; order without overlap
  if (!m.group.visible || Math.abs(m.group.overContent) > 0.5) S(`right group right edge is ${m.group.overContent} px from the content edge (want 0)`);
  const seq: Array<[string, Box]> = [["chip", m.pill], ["counters", m.counters], ["reason", m.reason], ["fresh", m.fresh], ["show", m.show], ["actions", m.actions]];
  const shown = seq.filter(([, b]) => b.visible);
  for (let i = 1; i < shown.length; i += 1) {
    const [pn, p] = shown[i - 1] as [string, Box];
    const [qn, q] = shown[i] as [string, Box];
    if (q.x < p.right - 0.5) S(`${qn} (x ${q.x}) overlaps ${pn} (right ${p.right})`);
  }
  // ---- fit: no control clips ----
  if (m.lineScrollWidth > m.lineClientWidth) o.fit.push(`status line scrollWidth ${m.lineScrollWidth} > clientWidth ${m.lineClientWidth}`);
  if (!m.actions.visible) o.fit.push("⋯ not rendered");
  for (const [n, b] of [["state chip", m.pill], ["freshness chip", m.fresh], ["Show control", m.show], ["⋯", m.actions]] as const) {
    if (!b.visible) continue;
    if (b.clipped > 0.5) o.fit.push(`${n} clipped by ${b.clipped} px (box ${b.x}..${b.right})`);
    if (b.overContent > 0.5) o.fit.push(`${n} right edge ${b.right} passes the content edge by ${b.overContent} px`);
  }
  // ---- counters ----
  const cut = countersCut(m);
  const scrollCut = m.counters.scrollWidth - m.counters.clientWidth;
  const isCut = cut > CUT_TOL || scrollCut > 1;
  if (mustBeComplete && isCut) o.counters.push(`counters cut by ${r1(cut)} px (needs ${m.counters.need}, gets ${m.counters.width}; scrollWidth ${m.counters.scrollWidth} vs clientWidth ${m.counters.clientWidth}): "${m.counters.text}"`);
  return o;
}
const r1 = (n: number): number => Math.round(n * 10) / 10;
const flat = (o: Issues): string[] => [...o.step.map((s) => `[step] ${s}`), ...o.structure.map((s) => `[elements] ${s}`), ...o.fit.map((s) => `[fit] ${s}`), ...o.counters.map((s) => `[counters] ${s}`)];

// ---------------------------------------------------------------------------------------------------------
// Setup: one poll FC03 slave 1 start 0 qty 10 scan 100 ms, connected, optional second sub-window B
// ---------------------------------------------------------------------------------------------------------
const POLL = { name: "Poll 1", fc: 3 as const, start: 0, qty: 10, scan: 100 };

interface Setup {
  a: number;
  b: number | null;
}

/** Opens A (frame width as given) and optionally B (to the right of A's widest frame 900, so no edge snapping ever touches A's right edge), Polling with live values, counters frozen at Tx 1234 / Err 0. */
async function openAt(mm: Mm, frameWidth: number, opts: { inactive?: boolean } = {}): Promise<Setup> {
  const two = opts.inactive === true;
  await mm.open({
    polls: two ? [POLL, { name: "Poll 2" }] : [POLL],
    seed: LAYOUT_SEED,
    seedArg: {
      items: [
        { index: 0, x: 8, y: 8, width: frameWidth, height: 368 },
        ...(two ? [{ index: 1, x: 940, y: 8, width: 376, height: 368 }] : []),
      ],
    },
    connected: true,
  });
  const ids = (await mm.pollIds()) as number[];
  const a = ids[0] as number;
  const b = two ? (ids[1] as number) : null;
  if (two) await mm.titleBar(a).click({ position: { x: 40, y: 15 } });
  await expect(mm.sub(a)).toHaveAttribute("aria-current", "true");
  expect((await mm.domRect(a)).width, "frame width as seeded").toBe(frameWidth);
  await mm.advance(1000);
  await expect(mm.statusLine(a)).toHaveAttribute("data-state", "polling");
  await mm.script((f, id) => f.freezePollCounters(id, { requests: 1234, errors: 0 }), a);
  await expect(mm.statusLine(a).getByTestId("status-counters")).toHaveAttribute("title", fullCounters("polling"));
  if (two && b !== null) await deactivate(mm, a, b);
  return { a, b };
}

/** Presses B's title bar: A becomes inactive (border 1.5 px by design). */
async function deactivate(mm: Mm, a: number, b: number): Promise<void> {
  await mm.titleBar(b).click({ position: { x: 40, y: 15 } });
  await expect(mm.sub(a)).not.toHaveAttribute("aria-current", "true");
  await expect(mm.sub(b)).toHaveAttribute("aria-current", "true");
}

/** The Timeout case: the same poll goes into Timeout (3 in a row or more), counters frozen at Tx 1234 / Err 3. */
async function intoTimeout(mm: Mm, id: number): Promise<void> {
  await mm.script((f, pollId) => f.scriptFault(pollId, { kind: "timeout" }), id);
  await mm.advance(4500);
  await expect(mm.statusLine(id)).toHaveAttribute("data-state", "timeout");
  await mm.script((f, pollId) => f.freezePollCounters(pollId, { requests: 1234, errors: 3 }), id);
  await expect(mm.statusLine(id).getByTestId("status-counters")).toHaveAttribute("title", fullCounters("timeout"));
}

/**
 * Measures after the view had time to react: waits (animation frames, observable) until the step and the
 * structure agree with the rules, up to 8 tries; the last measurement is returned either way, so a
 * product that never gets there is reported with its numbers.
 */
async function measureSettled(page: Page, id: number, kind: Kind): Promise<Measure> {
  let m = await measure(page, id);
  for (let i = 0; i < 8; i += 1) {
    const v = validate(m, kind, false);
    if (v.step.length === 0 && v.structure.length === 0) break;
    await twoFrames(page);
    m = await measure(page, id);
  }
  return m;
}

async function record(testInfo: TestInfo, label: string, m: Measure): Promise<void> {
  const json = JSON.stringify(m);
  console.log(`MEASURE ${testInfo.title.split(" ")[0]} ${label} ${json}`);
  await testInfo.attach(`measure-${label}`, { body: json, contentType: "application/json" });
}

/** Compact one-line summary used in the tables of the report. */
function summary(m: Measure, kind: Kind): Record<string, unknown> {
  return {
    kind,
    frame: m.frameOffsetWidth,
    L: m.L,
    border: m.borderPx,
    step: m.step,
    counters: m.counters.text,
    need: m.counters.need,
    given: m.counters.width,
    cut: r1(countersCut(m)),
    scrollCut: m.counters.scrollWidth - m.counters.clientWidth,
    reasonW: m.reason.visible ? m.reason.width : 0,
    reasonNeed: m.reason.need,
    /** Free px between the counters and the right group (gap 8 px excluded) while no reason text is shown; null with a reason (it absorbs the space). */
    spare: m.reason.visible ? null : r1(m.group.x - 8 - m.counters.right),
    chipW: m.pill.width,
    freshW: m.fresh.width,
    showW: m.show.width,
    actionsW: m.actions.width,
    actionsRight: m.actions.right,
    actionsOver: m.actions.overContent,
    clipped: Math.max(m.pill.clipped, m.fresh.clipped, m.show.clipped, m.actions.clipped),
    headerChip: m.header.present ? m.header.text : null,
  };
}

/** Item-level check: measure both cases at one frame width and assert the validator is clean. */
async function checkBothCases(
  mm: Mm,
  testInfo: TestInfo,
  a: number,
  tag: string,
  only: Kind | null = null,
): Promise<{ polling: Measure | null; timeout: Measure | null }> {
  const out: { polling: Measure | null; timeout: Measure | null } = { polling: null, timeout: null };
  if (only !== "timeout") {
    const m = await measureSettled(mm.page, a, "polling");
    await record(testInfo, `${tag}-polling`, m);
    expect.soft(flat(validate(m, "polling", true)), `${tag} Polling (frame ${m.frameOffsetWidth}, L ${m.L}, step ${m.step})`).toEqual([]);
    out.polling = m;
  }
  if (only !== "polling") {
    await intoTimeout(mm, a);
    const m = await measureSettled(mm.page, a, "timeout");
    await record(testInfo, `${tag}-timeout`, m);
    expect.soft(flat(validate(m, "timeout", true)), `${tag} Timeout (frame ${m.frameOffsetWidth}, L ${m.L}, step ${m.step})`).toEqual([]);
    out.timeout = m;
  }
  return out;
}


/**
 * Runs `fn` at a Windows-like scale factor. Playwright's `deviceScaleFactor` emulation does NOT change the layout
 * (probe: a 1.5 px border stays 1 px at 125% and 150%), so for 125% / 150% a browser is started with
 * `--force-device-scale-factor`, where borders snap to device pixels like on Windows (1.5 px -> 0.8 px at 125%,
 * 1.33 px at 150%). At 100% the normal fixture page is used.
 */
async function atScale(dpr: number, mm: Mm, fn: (m: Mm) => Promise<void>): Promise<void> {
  if (dpr === 1) {
    await fn(mm);
    return;
  }
  const browser = await chromium.launch({ args: [`--force-device-scale-factor=${dpr}`] });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1618, height: 834 },
      baseURL: "http://localhost:1420",
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const m = new Mm(await ctx.newPage());
    await fn(m);
    expect(m.pageErrors, "uncaught page errors").toEqual([]);
  } finally {
    await browser.close();
  }
}

/** Proof that the scale really changes the layout: the computed width of a 1.5 px border (the inactive frame border). */
async function scaleProbe(page: Page, dpr: number): Promise<string> {
  const border = await page.evaluate(() => {
    const t = document.createElement("div");
    t.style.cssText = "border:1.5px solid black;width:50px;height:20px;position:absolute";
    document.body.appendChild(t);
    const w = getComputedStyle(t).borderLeftWidth;
    t.remove();
    return w;
  });
  console.log(`SCALE dpr=${dpr} border1.5px=${border}`);
  return border;
}
const EXPECTED_BORDER: Record<number, string> = { 1: "1px", 1.25: "0.8px", 1.5: "1.33333px" };

type Pair = { polling: Measure | null; timeout: Measure | null };

/** Runs `fn` for each frame width, every width on its own fresh page (one fake per page), and closes the extra pages. */
async function eachFrame(mm: Mm, widths: number[], fn: (m: Mm, a: number, width: number) => Promise<void>): Promise<void> {
  for (const [i, width] of widths.entries()) {
    const m = i === 0 ? mm : new Mm(await mm.page.context().newPage());
    const { a } = await openAt(m, width);
    await fn(m, a, width);
    if (i > 0) {
      expect(m.pageErrors, `uncaught page errors at frame ${width}`).toEqual([]);
      await m.page.close();
    }
  }
}

/** Both cases at each width: measured, validated (counters complete), keyed by the width. */
async function measurePairs(mm: Mm, testInfo: TestInfo, widths: number[], only: Kind | null = null): Promise<Record<string, Pair>> {
  const r: Record<string, Pair> = {};
  await eachFrame(mm, widths, async (m, a, width) => {
    r[String(width)] = await checkBothCases(m, testInfo, a, String(width), only);
  });
  return r;
}


test.describe("E narrow status line (revision 9)", () => {
  for (const [width, wide] of [
    [723, false],
    [724, true],
  ] as const) {
    test(`CHK2-E13 (boundary) frame ${width} (PollView ${width - 4}): ${wide ? "segmented controls in the data card" : "the Show menu in the status line"}`, async ({
      mm,
    }) => {
      await mm.open({
        polls: [{ name: "Poll 1" }],
        seed: LAYOUT_SEED,
        seedArg: { items: [{ index: 0, x: 8, y: 8, width, height: 368 }] },
      });
      const [id] = (await mm.pollIds()) as [number];
      await expect(mm.sub(id)).toHaveAttribute("aria-current", "true");
      if (wide) {
        await expect(mm.sub(id).getByRole("radiogroup", { name: "Show" })).toBeVisible();
        await expect(mm.statusLine(id).getByRole("button", { name: /^Show / })).toHaveCount(0);
      } else {
        await expect(mm.sub(id).getByRole("radiogroup")).toHaveCount(0);
        await expect(mm.statusLine(id).getByRole("button", { name: /^Show / })).toBeVisible();
      }
    });
  }

  test("CHK2-E16 frame 640 (L 636), data-step 1: chip, full counters, icon-only freshness chip, Show with text, ⋯; Timeout adds the reason taking all the leftover space", async ({
    mm,
  }, testInfo) => {
    const a = (await openAt(mm, 640)).a;
    const line = mm.statusLine(a);
    const counters = line.getByTestId("status-counters");
    const polling = await measureSettled(mm.page, a, "polling");
    await record(testInfo, "640-polling", polling);
    expect.soft(polling.L, "status line width L").toBe(636);
    expect.soft(polling.step, "data-step").toBe("1");
    expect.soft(polling.kids, "direct children, no wrapper and no spacer").toEqual(["pill", "counters", "group"]);
    expect.soft(polling.pill.text).toBe("Polling");
    await expect(line.locator('[data-slot="status-pill"] [data-icon="activity"]')).toHaveCount(1);
    await expect(counters).toHaveText(`Tx ${TX} · Err 0 · ID 1 · F 03 · SR 100 ms`, { useInnerText: true });
    expect.soft(polling.fresh.iconOnly, "freshness chip is icon only").toBe("true");
    expect.soft(polling.fresh.icon).toBe("circle-check");
    expect.soft(polling.fresh.title ?? "", "tooltip").toMatch(/^Updated \d\d:\d\d:\d\d\.\d{3}/);
    await expect(line.locator('[data-slot="freshness-chip"]')).toHaveAccessibleName(/^Updated \d\d:\d\d:\d\d\.\d{3}/);
    expect.soft(polling.show.text).toBe("Show Raw");
    expect.soft(polling.reason.present, "no reason text while Polling").toBe(false);
    expect.soft(polling.group.right - polling.actions.right, "the right group is right-aligned").toBeLessThanOrEqual(0.5);
    expect.soft(flat(validate(polling, "polling", true)), "Polling: validator").toEqual([]);

    await intoTimeout(mm, a);
    const timeout = await measureSettled(mm.page, a, "timeout");
    await record(testInfo, "640-timeout", timeout);
    expect.soft(timeout.step, "data-step").toBe("1");
    expect.soft(timeout.tone).toBe("warning");
    expect.soft(timeout.kids).toEqual(["pill", "counters", "reason", "group"]);
    expect.soft(timeout.pill.text).toBe("Timeout");
    await expect(counters).toHaveText(`Tx ${TX} · Err 3 · ID 1 · F 03 · SR 100 ms`, { useInnerText: true });
    expect.soft(timeout.reason.visible, "reason rendered").toBe(true);
    expect.soft(timeout.reason.text.replace(/…$/, "")).toMatch(/^No response within 1000 m?s?/);
    expect.soft(timeout.group.x - timeout.reason.right, "reason's right edge to the freshness chip (<= 8 px: no spacer)").toBeLessThanOrEqual(8.5);
    expect.soft(timeout.fresh.x - timeout.reason.right, "reason to the freshness chip").toBeLessThanOrEqual(8.5);
    expect.soft(timeout.reason.title ?? "", "reason tooltip has the banner text").toMatch(/^Timeout: slave 1 did not respond within 1000 ms\. Retrying every 100 ms \(\d+ in a row\)\.$/);
    expect.soft(timeout.fresh.iconOnly).toBe("true");
    expect.soft(timeout.fresh.title ?? "", "stale tooltip").toMatch(/^No response - values from \d\d:\d\d:\d\d\.\d{3}/);
    await expect(line.locator('[data-slot="freshness-chip"]')).toHaveAccessibleName(/^No response - values from \d\d:\d\d:\d\d\.\d{3}/);
    expect.soft(timeout.show.text).toBe("Show Raw");
    expect.soft(flat(validate(timeout, "timeout", true)), "Timeout: validator").toEqual([]);
    // ⋯ opens the Poll actions menu.
    await line.getByRole("button", { name: "Poll actions" }).click();
    await expect(mm.page.getByRole("menu").last().getByRole("menuitem", { name: /^Reset counters for this poll/ })).toBeVisible();
    await mm.page.keyboard.press("Escape");
  });

  test("CHK2-E17 frame 600 (L 596), data-step 3: counters without ID and F (complete, also in the Timeout case), no reason text, tooltip and name carry the complete text", async ({
    mm,
  }, testInfo) => {
    const a = (await openAt(mm, 600)).a;
    const line = mm.statusLine(a);
    const counters = line.getByTestId("status-counters");
    const polling = await measureSettled(mm.page, a, "polling");
    await record(testInfo, "600-polling", polling);
    expect.soft(polling.L).toBe(596);
    expect.soft(polling.step, "data-step").toBe("3");
    expect.soft(polling.kids).toEqual(["pill", "counters", "group"]);
    await expect(counters).toHaveText(`Tx ${TX} · Err 0 · SR 100 ms`, { useInnerText: true });
    await expect(counters).toHaveAttribute("title", "Tx 1234 · Err 0 · ID 1 · F 03 · SR 100 ms");
    await expect(counters).toHaveAccessibleName("Tx 1234 · Err 0 · ID 1 · F 03 · SR 100 ms");
    expect.soft(polling.fresh.iconOnly).toBe("true");
    expect.soft(polling.show.text).toBe("Show Raw");
    expect.soft(countersCut(polling), "Polling counters cut by (px)").toBeLessThanOrEqual(CUT_TOL);
    expect.soft(flat(validate(polling, "polling", true)), "Polling: validator").toEqual([]);

    await intoTimeout(mm, a);
    const timeout = await measureSettled(mm.page, a, "timeout");
    await record(testInfo, "600-timeout", timeout);
    expect.soft(timeout.step, "data-step").toBe("3");
    expect.soft(timeout.tone, "the line keeps the warning fill").toBe("warning");
    expect.soft(timeout.kids).toEqual(["pill", "counters", "reason", "group"]);
    await expect(line.getByTestId("status-reason"), "no reason text visible").toBeHidden();
    expect.soft(timeout.pill.title ?? "", "the chip's tooltip").toMatch(/^Timeout: slave 1 did not respond within 1000 ms\. Retrying every 100 ms \(\d+ in a row\)\.$/);
    await expect(counters).toHaveText(`Tx ${TX} · Err 3 · SR 100 ms`, { useInnerText: true });
    await expect(counters).toHaveAttribute("title", "Tx 1234 · Err 3 · ID 1 · F 03 · SR 100 ms");
    await expect(counters).toHaveAccessibleName("Tx 1234 · Err 3 · ID 1 · F 03 · SR 100 ms");
    expect.soft(countersCut(timeout), "Timeout counters cut by (px): REPORT-004 failure 3 must be gone").toBeLessThanOrEqual(CUT_TOL);
    expect.soft(flat(validate(timeout, "timeout", true)), "Timeout: validator").toEqual([]);
  });

  test("CHK2-E18 frame 560 (L 556), data-step 3: the same visible elements as E17, counters complete", async ({ mm }, testInfo) => {
    const a = (await openAt(mm, 560)).a;
    const line = mm.statusLine(a);
    const counters = line.getByTestId("status-counters");
    const polling = await measureSettled(mm.page, a, "polling");
    await record(testInfo, "560-polling", polling);
    expect.soft(polling.L).toBe(556);
    expect.soft(polling.step).toBe("3");
    expect.soft(polling.kids).toEqual(["pill", "counters", "group"]);
    await expect(counters).toHaveText(`Tx ${TX} · Err 0 · SR 100 ms`, { useInnerText: true });
    expect.soft(polling.fresh.iconOnly).toBe("true");
    expect.soft(polling.show.text).toBe("Show Raw");
    expect.soft(flat(validate(polling, "polling", true)), "Polling: validator").toEqual([]);
    await intoTimeout(mm, a);
    const timeout = await measureSettled(mm.page, a, "timeout");
    await record(testInfo, "560-timeout", timeout);
    expect.soft(timeout.step).toBe("3");
    expect.soft(timeout.tone).toBe("warning");
    await expect(line.getByTestId("status-reason"), "no reason text").toBeHidden();
    await expect(counters).toHaveText(`Tx ${TX} · Err 3 · SR 100 ms`, { useInnerText: true });
    await expect(counters).toHaveAccessibleName("Tx 1234 · Err 3 · ID 1 · F 03 · SR 100 ms");
    expect.soft(timeout.show.text).toBe("Show Raw");
    expect.soft(flat(validate(timeout, "timeout", true)), "Timeout: validator").toEqual([]);
  });

  test("CHK2-E19 frame 430 (L 426), data-step 5: counters Tx and SR only (complete), Show icon only and still opens the Show menu", async ({
    mm,
  }, testInfo) => {
    const a = (await openAt(mm, 430)).a;
    const line = mm.statusLine(a);
    const counters = line.getByTestId("status-counters");
    const polling = await measureSettled(mm.page, a, "polling");
    await record(testInfo, "430-polling", polling);
    expect.soft(polling.L).toBe(426);
    expect.soft(polling.step, "data-step").toBe("5");
    expect.soft(polling.kids).toEqual(["pill", "counters", "group"]);
    await expect(counters).toHaveText(`Tx ${TX} · SR 100 ms`, { useInnerText: true });
    await expect(counters).toHaveAttribute("title", "Tx 1234 · Err 0 · ID 1 · F 03 · SR 100 ms");
    await expect(counters).toHaveAccessibleName("Tx 1234 · Err 0 · ID 1 · F 03 · SR 100 ms");
    expect.soft(countersCut(polling), "Polling counters cut by (px): REPORT-004 failure 4 must be gone").toBeLessThanOrEqual(CUT_TOL);
    expect.soft(polling.fresh.iconOnly).toBe("true");
    expect.soft(polling.show.icons, "icon only: columns-3 + chevron-down").toEqual(["columns-3", "chevron-down"]);
    expect.soft(polling.show.text, "no text").toBe("");
    expect.soft(polling.show.ariaLabel, "accessible name").toBe("Show Raw");
    expect.soft(polling.show.title, "tooltip").toBe("Show Raw");
    expect.soft(flat(validate(polling, "polling", true)), "Polling: validator").toEqual([]);
    // It opens the same Show menu.
    await line.getByRole("button", { name: "Show Raw", exact: true }).click();
    const menu = mm.page.getByRole("menu").last();
    await expect(menu.getByRole("menuitemradio", { name: /^Raw/ }).first()).toBeVisible();
    await expect(menu.getByRole("menuitemcheckbox", { name: "Alias column" })).toBeVisible();
    await expect(menu.getByRole("menuitemcheckbox", { name: "Include alias in copy" })).toBeVisible();
    await mm.page.keyboard.press("Escape");
    await intoTimeout(mm, a);
    const timeout = await measureSettled(mm.page, a, "timeout");
    await record(testInfo, "430-timeout", timeout);
    expect.soft(timeout.step).toBe("5");
    expect.soft(timeout.tone).toBe("warning");
    await expect(line.getByTestId("status-reason"), "no reason text").toBeHidden();
    await expect(counters).toHaveText(`Tx ${TX} · SR 100 ms`, { useInnerText: true });
    await expect(counters).toHaveAccessibleName("Tx 1234 · Err 3 · ID 1 · F 03 · SR 100 ms");
    expect.soft(countersCut(timeout), "Timeout counters cut by (px)").toBeLessThanOrEqual(CUT_TOL);
    expect.soft(timeout.show.icons).toEqual(["columns-3", "chevron-down"]);
    expect.soft(flat(validate(timeout, "timeout", true)), "Timeout: validator").toEqual([]);
  });

  test("CHK2-E19 (last resort) frame 430 with Tx 1000000 and the effective rate: the counters end with an ellipsis, tooltip and name have the full text, controls do not clip", async ({
    mm,
  }, testInfo) => {
    const a = (await openAt(mm, 430)).a;
    // The fake's own counters stay frozen; this event replaces them with the documented last-resort content.
    await mm.script(
      (f, pollId) =>
        f.emitView(pollId, {
          type: "PollCounters",
          pollId,
          counters: { requests: 1_000_000, responses: 999_990, errors: 0, timeouts: 0 },
          effectiveScanMs: 180,
          lastOkAt: f.now(),
        }),
      a,
    );
    const counters = mm.statusLine(a).getByTestId("status-counters");
    await expect(counters).toHaveText("Tx 1000000 · SR 100 ms (effective 180 ms)", { useInnerText: true });
    const m = await measureSettled(mm.page, a, "polling");
    await record(testInfo, "430-last-resort", m);
    const cut = m.counters.scrollWidth - m.counters.clientWidth;
    expect.soft(cut > 1 || countersCut(m) > CUT_TOL, `counters are cut with an ellipsis (needs ${m.counters.need}, gets ${m.counters.width}; scrollWidth ${m.counters.scrollWidth} vs clientWidth ${m.counters.clientWidth})`).toBe(true);
    expect.soft(m.counters.title, "tooltip has the full text").toBe("Tx 1000000 · Err 0 · ID 1 · F 03 · SR 100 ms (effective 180 ms)");
    await expect(counters).toHaveAccessibleName("Tx 1000000 · Err 0 · ID 1 · F 03 · SR 100 ms (effective 180 ms)");
    expect.soft(m.kids).toEqual(["pill", "counters", "group"]);
    // The fit check still passes (controls never clip); the counters check is not applied here.
    expect.soft(flat(validate(m, "polling", false)).filter((s) => s.startsWith("[fit]")), "fit check").toEqual([]);
  });

  // -------------------------------------------------------------------------------------------------------
  // E20-E25: one boundary per item. Active frames: frame = L + 4.
  // -------------------------------------------------------------------------------------------------------
  test("CHK2-E20 boundary step 1, live kind (L 720/719), Polling case: frame 724 is step 0 with the header chip text, frame 723 is step 1 with the icon-only line chip", async ({
    mm,
  }, testInfo) => {
    const r = await measurePairs(mm, testInfo, [724, 723], "polling");
    const m0 = r["724"]?.polling as Measure;
    const m1 = r["723"]?.polling as Measure;
    expect.soft(m0.L).toBe(720);
    expect.soft(m0.step, "data-step at frame 724").toBe("0");
    expect.soft(m0.kids).toEqual(["pill", "counters", "group"]);
    expect.soft(m0.fresh.present, "no freshness chip in the line").toBe(false);
    expect.soft(m0.show.present, "no Show menu in the line").toBe(false);
    expect.soft(m0.header.text, "header chip has its text").toMatch(/^Updated \d\d:\d\d:\d\d\.\d{3}$/);
    expect.soft(m0.header.iconOnly).toBeNull();
    expect.soft(m0.radiogroups, "segmented controls in the header").toBeGreaterThan(0);
    expect.soft(m0.counters.text).toBe("Tx 1234 · Err 0 · ID 1 · F 03 · SR 100 ms");
    expect.soft(m1.L).toBe(719);
    expect.soft(m1.step, "data-step at frame 723").toBe("1");
    expect.soft(m1.header.present, "no header row").toBe(false);
    expect.soft(m1.radiogroups).toBe(0);
    expect.soft(m1.fresh.iconOnly).toBe("true");
    expect.soft(m1.fresh.title ?? "").toMatch(/^Updated \d\d:\d\d:\d\d\.\d{3}/);
    expect.soft(m1.show.text).toBe("Show Raw");
    expect.soft(m1.counters.text).toBe("Tx 1234 · Err 0 · ID 1 · F 03 · SR 100 ms");
  });

  test("CHK2-E20 (accessible name) frame 723: the line freshness chip's accessible name is 'Updated {time}'", async ({ mm }) => {
    const a = (await openAt(mm, 723)).a;
    await expect(mm.statusLine(a).locator('[data-slot="freshness-chip"]')).toHaveAccessibleName(/^Updated \d\d:\d\d:\d\d\.\d{3}/);
  });

  test("CHK2-E21 boundary step 1, long kind (L 810/809), Timeout case: frame 814 is step 0, frame 813 is step 1 and nothing visible changes (the header chip keeps its text); the header chip keeps its text at 724 and 900", async ({
    mm,
  }, testInfo) => {
    const r = await measurePairs(mm, testInfo, [814, 813, 724, 900]);
    const t814 = r["814"]?.timeout as Measure;
    const t813 = r["813"]?.timeout as Measure;
    const p813 = r["813"]?.polling as Measure;
    expect.soft(t814.L).toBe(810);
    expect.soft(t814.step, "Timeout frame 814").toBe("0");
    expect.soft(t813.L).toBe(809);
    expect.soft(t813.step, "Timeout frame 813").toBe("1");
    expect.soft(p813.step, "Polling frame 813 (live kind, T1 = 720)").toBe("0");
    expect.soft(t814.header.text, "header chip at 814").toMatch(/^No response - values from \d\d:\d\d:\d\d\.\d{3}$/);
    expect.soft(t813.header.text, "header chip at 813 keeps its full text").toMatch(/^No response - values from \d\d:\d\d:\d\d\.\d{3}$/);
    expect.soft(t813.header.iconOnly, "header chip is never icon only").toBeNull();
    expect.soft(p813.header.text, "Polling header chip at 813").toMatch(/^Updated \d\d:\d\d:\d\d\.\d{3}$/);
    // Nothing visible changes between 814 and 813 in the status line.
    expect.soft(t813.kids).toEqual(t814.kids);
    expect.soft(t813.counters.text).toBe(t814.counters.text);
    expect.soft(t813.counters.text).toBe("Tx 1234 · Err 3 · ID 1 · F 03 · SR 100 ms");
    expect.soft(t813.fresh.present, "no freshness chip in the line at 813").toBe(false);
    expect.soft(t814.reason.text, "reason complete at 814").toBe("No response within 1000 ms");
    expect.soft(t813.reason.text, "reason complete at 813").toBe("No response within 1000 ms");
    expect.soft(t814.reason.scrollWidth - t814.reason.clientWidth, "reason not cut at 814").toBeLessThanOrEqual(1);
    expect.soft(t813.reason.scrollWidth - t813.reason.clientWidth, "reason not cut at 813").toBeLessThanOrEqual(1);
    for (const w of ["724", "900"]) {
      expect.soft(r[w]?.polling?.header.text, `Polling header chip at ${w}`).toMatch(/^Updated \d\d:\d\d:\d\d\.\d{3}$/);
      expect.soft(r[w]?.timeout?.header.text, `Timeout header chip at ${w}`).toMatch(/^No response - values from \d\d:\d\d:\d\d\.\d{3}$/);
      expect.soft(r[w]?.timeout?.header.iconOnly).toBeNull();
    }
  });

  test("CHK2-E22 boundary step 2 (L 620/619): frame 624 is step 1 with the reason rendered (Timeout), frame 623 is step 2 without reason, warning fill kept; counters complete", async ({
    mm,
  }, testInfo) => {
    const r = await measurePairs(mm, testInfo, [624, 623]);
    const t624 = r["624"]?.timeout as Measure;
    const t623 = r["623"]?.timeout as Measure;
    expect.soft(t624.L).toBe(620);
    expect.soft(t624.step).toBe("1");
    expect.soft(t624.reason.visible, `reason rendered at 624 (given ${t624.reason.width} px, needs ${t624.reason.need} px)`).toBe(true);
    expect.soft(t623.L).toBe(619);
    expect.soft(t623.step).toBe("2");
    expect.soft(t623.reason.visible, "reason not visible at 623").toBe(false);
    expect.soft(t623.tone, "warning fill kept").toBe("warning");
    expect.soft(t623.counters.text).toBe("Tx 1234 · Err 3 · ID 1 · F 03 · SR 100 ms");
    expect.soft(r["624"]?.polling?.step).toBe("1");
    expect.soft(r["623"]?.polling?.step).toBe("2");
    expect.soft(r["624"]?.polling?.reason.present).toBe(false);
    expect.soft(r["623"]?.polling?.reason.present).toBe(false);
    expect.soft(r["624"]?.polling?.kids).toEqual(r["623"]?.polling?.kids);
  });

  test("CHK2-E23 boundary step 3 (L 606/605), both cases: frame 610 is step 2 with ID and F, frame 609 is step 3 without; counters complete at both", async ({
    mm,
  }, testInfo) => {
    const r = await measurePairs(mm, testInfo, [610, 609]);
    for (const k of ["polling", "timeout"] as const) {
      const e = ERR[k];
      expect.soft(r["610"]?.[k]?.L).toBe(606);
      expect.soft(r["610"]?.[k]?.step, `${k} frame 610`).toBe("2");
      expect.soft(r["610"]?.[k]?.counters.text).toBe(`Tx 1234 · Err ${e} · ID 1 · F 03 · SR 100 ms`);
      expect.soft(r["609"]?.[k]?.L).toBe(605);
      expect.soft(r["609"]?.[k]?.step, `${k} frame 609`).toBe("3");
      expect.soft(r["609"]?.[k]?.counters.text).toBe(`Tx 1234 · Err ${e} · SR 100 ms`);
    }
  });

  test("CHK2-E24 boundary step 4 (L 500/499), both cases: frame 504 is step 3 with 'Show Raw', frame 503 is step 4 with the Show icon only; counters complete at both", async ({
    mm,
  }, testInfo) => {
    const r = await measurePairs(mm, testInfo, [504, 503]);
    for (const k of ["polling", "timeout"] as const) {
      expect.soft(r["504"]?.[k]?.L).toBe(500);
      expect.soft(r["504"]?.[k]?.step, `${k} frame 504`).toBe("3");
      expect.soft(r["504"]?.[k]?.show.text).toBe("Show Raw");
      expect.soft(r["504"]?.[k]?.counters.text).toBe(`Tx 1234 · Err ${ERR[k]} · SR 100 ms`);
      expect.soft(r["503"]?.[k]?.L).toBe(499);
      expect.soft(r["503"]?.[k]?.step, `${k} frame 503`).toBe("4");
      expect.soft(r["503"]?.[k]?.show.text).toBe("");
      expect.soft(r["503"]?.[k]?.show.ariaLabel).toBe("Show Raw");
      expect.soft(r["503"]?.[k]?.show.title).toBe("Show Raw");
      expect.soft(r["503"]?.[k]?.counters.text).toBe(`Tx 1234 · Err ${ERR[k]} · SR 100 ms`);
    }
  });

  test("CHK2-E25 boundary step 5 (L 465/464), both cases: frame 469 is step 4 with Err, frame 468 is step 5 with Tx and SR only; the tooltip and name keep the full text; counters complete at both", async ({
    mm,
  }, testInfo) => {
    const r = await measurePairs(mm, testInfo, [469, 468]);
    for (const k of ["polling", "timeout"] as const) {
      expect.soft(r["469"]?.[k]?.L).toBe(465);
      expect.soft(r["469"]?.[k]?.step, `${k} frame 469`).toBe("4");
      expect.soft(r["469"]?.[k]?.counters.text).toBe(`Tx 1234 · Err ${ERR[k]} · SR 100 ms`);
      expect.soft(r["468"]?.[k]?.L).toBe(464);
      expect.soft(r["468"]?.[k]?.step, `${k} frame 468`).toBe("5");
      expect.soft(r["468"]?.[k]?.counters.text).toBe("Tx 1234 · SR 100 ms");
      expect.soft(r["468"]?.[k]?.counters.title).toBe(fullCounters(k));
      expect.soft(r["468"]?.[k]?.counters.ariaLabel).toBe(fullCounters(k));
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
// E26 re-measurement: reference frames 640 / 600 / 560 / 430, both cases, 100% / 125% / 150% scale
// ---------------------------------------------------------------------------------------------------------
for (const dpr of [1, 1.25, 1.5]) {
  for (const width of [640, 600, 560, 430]) {
    test(`CHK2-E26 (reference frame ${width}, ${dpr * 100}%) re-measurement: widths of every control, counters need/given, reason width; the rules hold`, async ({ mm }, testInfo) => {
      await atScale(dpr, mm, async (m) => {
        const a = (await openAt(m, width)).a;
        expect(await scaleProbe(m.page, dpr), "the scale changes the layout (1.5 px border)").toBe(EXPECTED_BORDER[dpr]);
        const out = await checkBothCases(m, testInfo, a, `${width}-dpr${dpr}`);
        const rows = [out.polling, out.timeout].map((x, i) => summary(x as Measure, i === 0 ? "polling" : "timeout"));
        console.log(`E26ROW dpr=${dpr} ${JSON.stringify(rows)}`);
        await testInfo.attach("e26-rows", { body: JSON.stringify(rows), contentType: "application/json" });
      });
    });
  }
}

// ---------------------------------------------------------------------------------------------------------
// E26 inactive: every boundary frame of E20-E25 on both sides, measured L decides (never a border constant).
// For an inactive frame the border renders 1 px (1.5 px by design), so the frames T+4, T+3 (the active frames) and
// T+2, T+1 (L = T, T-1 at 100% scale) are measured.
// ---------------------------------------------------------------------------------------------------------
const THRESHOLDS: Array<[number, Kind | "both", string]> = [
  [720, "polling", "720 live"],
  [810, "timeout", "810 long"],
  [620, "both", "620"],
  [606, "both", "606"],
  [500, "both", "500"],
  [465, "both", "465"],
];
for (const [T, who, name] of THRESHOLDS) {
  for (const offset of [4, 3, 2, 1]) {
    const width = T + offset;
    test(`CHK2-E26 (inactive boundary ${name}) frame ${width}: data-step follows the measured L, no control clips, counters complete`, async ({ mm }, testInfo) => {
      const { a } = await openAt(mm, width, { inactive: true });
      const out = await checkBothCases(mm, testInfo, a, `inactive-${width}`, who === "both" ? null : who);
      for (const m of [out.polling, out.timeout]) {
        if (m) expect.soft(m.frameOffsetWidth, "inactive frame offsetWidth").toBe(width);
      }
      const rows = [out.polling, out.timeout].filter((m): m is Measure => m !== null).map((m) => summary(m, m.state === "polling" ? "polling" : "timeout"));
      console.log(`E26INACTIVE ${JSON.stringify(rows)}`);
    });
  }
}

// ---------------------------------------------------------------------------------------------------------
// E26 sweep: the right-edge resize handle from frame 900 down to 320 and back in 4 px steps; at every width the
// sub-window is measured ACTIVE (while the handle is held, a live resize) and INACTIVE (after another sub-window was
// pressed). Both cases (Polling, then Timeout) in one page each.
// ---------------------------------------------------------------------------------------------------------
interface SweepRow {
  w: number;
  active: boolean;
  dir: "down" | "up";
  s: Record<string, unknown>;
  issues: string[];
  counterCut: number;
}

async function sweep(mm: Mm, a: number, b: number, kind: Kind, widths: number[], dir: "down" | "up", rows: SweepRow[]): Promise<void> {
  const page = mm.page;
  let cur = (await mm.domRect(a)).width;
  for (const w of widths) {
    const handle = (await mm.sub(a).locator('[data-resize-handle="e"]').boundingBox()) as { x: number; y: number; width: number; height: number };
    const x0 = handle.x + handle.width / 2;
    const y0 = handle.y + handle.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    // Closed loop on the pointer: at 125% / 150% the pointer snaps to device pixels, so one move may land a few px off.
    let px = x0 + (w - cur);
    if (w !== cur) await page.mouse.move(px, y0, { steps: 2 });
    await twoFrames(page);
    let reached = (await mm.domRect(a)).width;
    for (let i = 0; i < 8 && reached !== w; i += 1) {
      px += w - reached;
      await page.mouse.move(px, y0);
      await twoFrames(page);
      reached = (await mm.domRect(a)).width;
    }
    if (reached !== w) console.log(`SWEEPNOTE requested ${w}, reached ${reached}`);
    cur = reached;
    for (const active of [true, false]) {
      if (!active) {
        await page.mouse.up();
        await deactivate(mm, a, b);
        expect((await mm.domRect(a)).width, `inactive frame width ${reached}`).toBe(reached);
      }
      const m = await measureSettled(page, a, kind);
      const fit = FIT_FRAME[kind];
      const v = validate(m, kind, m.frameOffsetWidth >= fit);
      rows.push({ w: reached, active, dir, s: summary(m, kind), issues: flat(v), counterCut: r1(countersCut(m)) });
    }
  }
}

const range = (from: number, to: number, stride: number): number[] => {
  const out: number[] = [];
  for (let w = from; stride < 0 ? w >= to : w <= to; w += stride) out.push(w);
  return out;
};

for (const dpr of [1, 1.25, 1.5]) {
  for (const kind of ["polling", "timeout"] as const) {
    test(`CHK2-E26 (sweep ${kind}, ${dpr * 100}%) frame 900 -> 320${dpr === 1 ? " -> 900" : ""} in 4 px steps, active and inactive: no control clips, step follows L, counters complete from the fit width`, async ({ mm }, testInfo) => {
      test.setTimeout(420_000);
      await atScale(dpr, mm, async (m) => {
        const { a, b } = await openAt(m, 900, { inactive: true });
        if (b === null) throw new Error("second sub-window missing");
        expect(await scaleProbe(m.page, dpr), "the scale changes the layout (1.5 px border)").toBe(EXPECTED_BORDER[dpr]);
        if (kind === "timeout") await intoTimeout(m, a);
        // A is inactive after openAt; the first iteration presses its handle which activates it.
        const rows: SweepRow[] = [];
        await sweep(m, a, b, kind, range(900, 320, -4), "down", rows);
        if (dpr === 1) await sweep(m, a, b, kind, range(324, 900, 4), "up", rows);
        console.log(`SWEEP dpr=${dpr} kind=${kind} ${JSON.stringify(rows.map((r) => ({ w: r.w, a: r.active ? 1 : 0, d: r.dir, ...r.s, issues: r.issues })))}`);
        await testInfo.attach(`sweep-${kind}-${dpr}`, { body: JSON.stringify(rows), contentType: "application/json" });
        const bad = rows.filter((r) => r.issues.length > 0);
        const byCat = (cat: string) => bad.filter((r) => r.issues.some((i) => i.startsWith(cat))).map((r) => `${r.w}${r.active ? "A" : "I"}${r.dir === "up" ? "^" : ""}`);
        console.log(`SWEEPSUM dpr=${dpr} kind=${kind} widths=${rows.length} fit=[${byCat("[fit]").join(" ")}] step=[${byCat("[step]").join(" ")}] elements=[${byCat("[elements]").join(" ")}] counters=[${byCat("[counters]").join(" ")}]`);
        expect.soft(byCat("[fit]"), "widths (A active, I inactive) where a control clips or the line scrolls").toEqual([]);
        expect.soft(byCat("[step]"), "widths where data-step disagrees with the thresholds for the measured L").toEqual([]);
        expect.soft(byCat("[elements]"), "widths where the visible elements disagree with the step").toEqual([]);
        expect.soft(byCat("[counters]"), `widths at or above the fit frame (${FIT_FRAME[kind]}) where the counters are cut`).toEqual([]);
        // Below the fit frame the cut is the documented last resort: the end of the counters, the tooltip keeps the full text.
        const lastResort = rows.filter((r) => Number(r.s.frame) < FIT_FRAME[kind] && r.counterCut > CUT_TOL);
        for (const r of lastResort) expect.soft(r.issues.filter((i) => !i.startsWith("[counters]")), `frame ${r.w} (last resort)`).toEqual([]);
      });
    });
  }
}
