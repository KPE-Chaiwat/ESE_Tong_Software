// The status line validator of CHK2-E16..E26 for the REAL app (WebView2, real DPI, DirectWrite metrics).
// Adapted from tests/chk2-e2-status-line.spec.ts: the same rules (DES-002 2.3.2 revision 9), but the counters are
// whatever the real backend counted (Tx 4 digits, Err 0 / small, optional "(effective N ms)" suffix), so the
// expected texts are DERIVED from the counters' tooltip (always the complete text) instead of frozen constants.
// Every width is measured from the DOM (L = getBoundingClientRect of the status line); nothing is relaxed.
import type { Page } from "@playwright/test";

export type Kind = "polling" | "timeout";

export interface Box {
  present: boolean;
  visible: boolean;
  x: number;
  right: number;
  width: number;
  overContent: number;
  clipped: number;
  text: string;
  title: string | null;
}

export interface Measure {
  dpr: number;
  frameOffsetWidth: number;
  frameWidth: number;
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
  counters: Box & { textContent: string; ariaLabel: string | null; need: number; scrollWidth: number; clientWidth: number };
  reason: Box & { hiddenAttr: boolean; need: number };
  fresh: Box & { iconOnly: string | null; icon: string | null; textContent: string };
  header: { present: boolean; text: string; iconOnly: string | null; kind: string | null };
  show: Box & { icons: string[]; ariaLabel: string | null };
  actions: Box;
  active: boolean;
}

/** Runs in the page. Must stay self-contained. */
export const MEASURE = (id: number): Measure => {
  const frame = document.querySelector(`[data-subwindow="${id}"]`) as HTMLElement;
  const fr = frame.getBoundingClientRect();
  const fcs = getComputedStyle(frame);
  const line = frame.querySelector('[data-testid="poll-status-line"]') as HTMLElement;
  const lr = line.getBoundingClientRect();
  const lcs = getComputedStyle(line);
  const contentRight = lr.right - parseFloat(lcs.paddingRight) - parseFloat(lcs.borderRightWidth);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const none = (): Box => ({ present: false, visible: false, x: 0, right: 0, width: 0, overContent: 0, clipped: 0, text: "", title: null });
  const box = (el: Element | null): Box => {
    if (!el) return none();
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || el.getClientRects().length === 0) return { ...none(), present: true, title: el.getAttribute("title") };
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
  const showEl = buttons.find((b) => (b.getAttribute("aria-label") ?? b.innerText).startsWith("Show ")) ?? null;
  const actionsEl = buttons.find((b) => b.getAttribute("aria-label") === "Poll actions") ?? null;
  return {
    dpr: window.devicePixelRatio,
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
      need: need(countersEl),
      scrollWidth: countersEl?.scrollWidth ?? 0,
      clientWidth: countersEl?.clientWidth ?? 0,
      title: countersEl?.getAttribute("title") ?? null,
    },
    reason: { ...box(reasonEl), hiddenAttr: !!reasonEl?.hasAttribute("hidden"), need: need(reasonEl), title: reasonEl?.getAttribute("title") ?? null, text: reasonEl?.textContent ?? "" },
    fresh: {
      ...box(lineChip),
      iconOnly: lineChip?.getAttribute("data-icon-only") ?? null,
      icon: lineChip?.querySelector("[data-icon]")?.getAttribute("data-icon") ?? null,
      textContent: (lineChip?.textContent ?? "").trim(),
    },
    header: { present: !!headerChip, text: (headerChip?.textContent ?? "").trim(), iconOnly: headerChip?.getAttribute("data-icon-only") ?? null, kind: headerChip?.getAttribute("data-kind") ?? null },
    show: { ...box(showEl), icons: showEl ? [...showEl.querySelectorAll("[data-icon]")].map((i) => i.getAttribute("data-icon") ?? "") : [], ariaLabel: showEl?.getAttribute("aria-label") ?? null },
    actions: box(actionsEl),
    active: frame.getAttribute("data-active") === "true",
  };
};

export async function measure(page: Page, id: number): Promise<Measure> {
  return page.evaluate(`(${MEASURE.toString()})(${id})`) as Promise<Measure>;
}

export async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

const T_REASON = 620;
const T_IDS = 606;
const T_SHOW = 500;
const T_ERR = 465;
const T_WIDE = 720;
/** Estimated step-5 fit width of the active FRAME (DES-002 2.3.2): below it the counters may be cut. */
export const FIT_FRAME: Record<Kind, number> = { polling: 393, timeout: 400 };
export const CUT_TOL = 0.5;

export function stepFor(L: number, kind: Kind): number {
  const t1 = kind === "timeout" ? 810 : 720;
  return [L < t1, L < T_REASON, L < T_IDS, L < T_SHOW, L < T_ERR].filter(Boolean).length;
}

export interface Content {
  tx: number;
  err: number;
  id: number;
  fc: string;
  sr: number;
  eff: number | null;
  full: string;
  documentedCut: string[];
}

/** The content the counters tooltip carries (always the complete text). */
export function parseContent(title: string | null): Content | null {
  const m = /^Tx (\d+) · Err (\d+) · ID (\d+) · F (\d\d) · SR (\d+) ms(?: \(effective (\d+) ms\))?$/.exec(title ?? "");
  if (!m) return null;
  const tx = Number(m[1]);
  const err = Number(m[2]);
  const id = Number(m[3]);
  const documentedCut: string[] = [];
  if (String(tx).length >= 5) documentedCut.push("Tx has 5 digits or more");
  if (String(err).length >= 2) documentedCut.push("Err has 2 digits or more");
  if (id > 9) documentedCut.push("ID above 9");
  if (m[6]) documentedCut.push("(effective N ms) suffix shown");
  return { tx, err, id, fc: m[4] as string, sr: Number(m[5]), eff: m[6] ? Number(m[6]) : null, full: title as string, documentedCut };
}

export function visibleCounters(c: Content, step: number): string {
  const suffix = c.eff === null ? "" : ` (effective ${c.eff} ms)`;
  if (step >= 5) return `Tx ${c.tx} · SR ${c.sr} ms${suffix}`;
  if (step >= 3) return `Tx ${c.tx} · Err ${c.err} · SR ${c.sr} ms${suffix}`;
  return c.full;
}

export interface Issues {
  structure: string[];
  step: string[];
  fit: string[];
  counters: string[];
}
const r1 = (n: number): number => Math.round(n * 10) / 10;
export const countersCut = (m: Measure): number => Math.max(0, m.counters.need - m.counters.width);

/** `mustBeComplete`: the counters-complete rule applies at this frame; the documented exceptions switch it off. */
export function validate(m: Measure, kind: Kind, mustBeComplete: boolean, timeoutMs = 5000): Issues & { content: Content | null; cutDocumented: boolean } {
  const o: Issues = { structure: [], step: [], fit: [], counters: [] };
  const S = (s: string) => o.structure.push(s);
  const content = parseContent(m.counters.title);
  const expStep = stepFor(m.L, kind);
  const wide = m.L >= T_WIDE;
  if (m.step !== String(expStep)) o.step.push(`data-step ${m.step} but L ${m.L} gives ${expStep}`);
  const wantKids = ["pill", "counters", ...(kind === "timeout" ? ["reason"] : []), "group"];
  if (JSON.stringify(m.kids) !== JSON.stringify(wantKids)) S(`direct children ${m.kids.join(",")} (want ${wantKids.join(",")})`);
  const growWant = wantKids.map((k) => `${k}:${k === "reason" ? 1 : 0}`);
  if (JSON.stringify(m.grows) !== JSON.stringify(growWant)) S(`flex-grow ${m.grows.join(",")} (want ${growWant.join(",")})`);
  if (m.state !== (kind === "polling" ? "polling" : "timeout")) S(`state ${m.state}`);
  if (m.pill.text !== (kind === "polling" ? "Polling" : "Timeout")) S(`chip text "${m.pill.text}"`);
  if (kind === "timeout" && m.tone !== "warning") S(`tone ${m.tone} (want warning)`);
  if (!content) S(`counters tooltip "${m.counters.title}" is not the complete format`);
  else {
    const vis = visibleCounters(content, expStep);
    if (m.counters.text !== vis) S(`counters text "${m.counters.text}" (want "${vis}")`);
    if (m.counters.textContent !== vis) S(`counters textContent "${m.counters.textContent}" (want "${vis}")`);
    if (expStep >= 3 && m.counters.ariaLabel !== content.full) S(`counters aria-label "${m.counters.ariaLabel}" at step ${expStep} (want "${content.full}")`);
  }
  if (kind === "timeout") {
    const bannerRe = new RegExp(`^Timeout: slave 1 did not respond within ${timeoutMs} ms\\. Retrying every \\d+ ms \\(\\d+ in a row\\)\\.$`);
    if (expStep < 2) {
      if (m.reason.hiddenAttr || !m.reason.visible || m.reason.width <= 0) {
        // Documented last resort: the counters carry the "(effective N ms)" suffix and take every pixel, the reason gets 0 px
        // (its text stays in the tooltip). Without the suffix a reason that is not rendered is a defect.
        if (!(content?.eff !== null && content !== null && !m.reason.hiddenAttr)) S(`reason not rendered at step ${expStep}`);
      } else {
        if (!new RegExp(`^No response within ${timeoutMs}`).test(m.reason.text.replace(/…$/, ""))) S(`reason text "${m.reason.text}"`);
        if (m.group.visible && m.group.x - m.reason.right > 8.5) S(`reason right ${m.reason.right} is ${r1(m.group.x - m.reason.right)} px before the right group (want <= 8)`);
        if (m.reason.x < m.counters.right - 0.5) S("reason starts before the end of the counters");
      }
      if (!bannerRe.test(m.reason.title ?? "")) S(`reason title "${m.reason.title}"`);
    } else if (m.reason.visible || !m.reason.hiddenAttr) {
      S(`reason still visible at step ${expStep}`);
    }
    if (!bannerRe.test(m.pill.title ?? "")) S(`chip tooltip "${m.pill.title}"`);
  }
  const freshRe = kind === "polling" ? /^Updated \d\d:\d\d:\d\d\.\d{3}$/ : /^No response - values from \d\d:\d\d:\d\d\.\d{3}$/;
  if (wide) {
    if (m.fresh.present) S("freshness chip in the status line at L >= 720");
    if (m.show.present) S("Show control in the status line at L >= 720");
    if (m.radiogroups < 1) S("no segmented controls in the data card header at L >= 720");
    if (!m.header.present) S("no data card header freshness chip at L >= 720");
    else {
      if (m.header.iconOnly === "true") S("header chip is icon only");
      if (!freshRe.test(m.header.text)) S(`header chip text "${m.header.text}"`);
    }
  } else {
    if (m.radiogroups !== 0) S(`${m.radiogroups} segmented control groups at L < 720`);
    if (m.header.present) S("data card header chip at L < 720");
    if (!m.fresh.visible) S("no freshness chip in the status line at L < 720");
    else {
      if (m.fresh.iconOnly !== "true") S("status line freshness chip is not icon only");
      if (!freshRe.test(m.fresh.textContent)) S(`line chip text "${m.fresh.textContent}"`);
      if (!(m.fresh.title ?? "").startsWith(m.fresh.textContent)) S(`line chip tooltip "${m.fresh.title}"`);
      if (m.fresh.width >= 48) S(`icon-only chip is ${m.fresh.width} px wide`);
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
  if (!m.group.visible || Math.abs(m.group.overContent) > 0.5) S(`right group right edge is ${m.group.overContent} px from the content edge (want 0)`);
  const seq: Array<[string, Box]> = [["chip", m.pill], ["counters", m.counters], ["reason", m.reason], ["fresh", m.fresh], ["show", m.show], ["actions", m.actions]];
  const shown = seq.filter(([, b]) => b.visible);
  for (let i = 1; i < shown.length; i += 1) {
    const [pn, p] = shown[i - 1] as [string, Box];
    const [qn, q] = shown[i] as [string, Box];
    if (q.x < p.right - 0.5) S(`${qn} (x ${q.x}) overlaps ${pn} (right ${p.right})`);
  }
  if (m.lineScrollWidth > m.lineClientWidth) o.fit.push(`status line scrollWidth ${m.lineScrollWidth} > clientWidth ${m.lineClientWidth}`);
  if (!m.actions.visible) o.fit.push("⋯ not rendered");
  for (const [n, b] of [["state chip", m.pill], ["freshness chip", m.fresh], ["Show control", m.show], ["⋯", m.actions]] as const) {
    if (!b.visible) continue;
    if (b.clipped > 0.5) o.fit.push(`${n} clipped by ${b.clipped} px (box ${b.x}..${b.right})`);
    if (b.overContent > 0.5) o.fit.push(`${n} right edge ${b.right} passes the content edge by ${b.overContent} px`);
  }
  const cut = countersCut(m);
  const scrollCut = m.counters.scrollWidth - m.counters.clientWidth;
  const isCut = cut > CUT_TOL || scrollCut > 1;
  const cutDocumented = isCut && ((content?.documentedCut.length ?? 0) > 0 || !mustBeComplete);
  if (mustBeComplete && isCut && !(content?.documentedCut.length)) {
    o.counters.push(`counters cut by ${r1(cut)} px (needs ${m.counters.need}, gets ${m.counters.width}): "${m.counters.text}"`);
  }
  return { ...o, content, cutDocumented };
}

export const flat = (o: Issues): string[] => [
  ...o.step.map((s) => `[step] ${s}`),
  ...o.structure.map((s) => `[elements] ${s}`),
  ...o.fit.map((s) => `[fit] ${s}`),
  ...o.counters.map((s) => `[counters] ${s}`),
];

/** One row of the measured tables (report). */
export function row(m: Measure, kind: Kind): Record<string, unknown> {
  return {
    kind,
    active: m.active,
    frame: m.frameOffsetWidth,
    L: m.L,
    border: m.borderPx,
    dpr: m.dpr,
    step: m.step,
    counters: m.counters.text,
    need: m.counters.need,
    given: m.counters.width,
    cut: r1(countersCut(m)),
    reasonW: m.reason.visible ? m.reason.width : 0,
    reasonNeed: m.reason.need,
    chipW: m.pill.width,
    freshW: m.fresh.width,
    showW: m.show.width,
    actionsW: m.actions.width,
    actionsOver: m.actions.overContent,
    clipped: Math.max(m.pill.clipped, m.fresh.clipped, m.show.clipped, m.actions.clipped),
  };
}
