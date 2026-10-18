// The poll summary chip of the connection window (DES-002 1.5 rule 2): the counts text, the worst
// state and its icon and tone. Pure.
import type { PollState } from "@/shared/ipc/modbus-master.types";
import type { IconName } from "@/shared/ui/icon";

/** The buckets of the chip text, worst first. `polling` counts as "live". */
export type SummaryBucket = "exception" | "badResponse" | "timeout" | "live" | "paused";

export const SUMMARY_ORDER: readonly SummaryBucket[] = [
  "exception",
  "badResponse",
  "timeout",
  "live",
  "paused",
];

const BUCKET_LABEL: Record<SummaryBucket, string> = {
  exception: "exception",
  badResponse: "bad response",
  timeout: "timeout",
  live: "live",
  paused: "paused",
};

export type SummaryTone = "error" | "warning" | "success" | "outline";

const BUCKET_STYLE: Record<SummaryBucket, { icon: IconName; tone: SummaryTone }> = {
  exception: { icon: "octagon-x", tone: "error" },
  badResponse: { icon: "triangle-alert", tone: "warning" },
  timeout: { icon: "timer-off", tone: "warning" },
  live: { icon: "activity", tone: "success" },
  paused: { icon: "pause", tone: "outline" },
};

export interface PollSummaryResult {
  /** "1 exception · 2 timeout · 5 live", or "No polls". */
  text: string;
  /** The worst bucket present, null with no polls. */
  worst: SummaryBucket | null;
  icon: IconName | null;
  tone: SummaryTone;
  counts: Record<SummaryBucket, number>;
  /** How many polls are counted (offline polls are not). */
  total: number;
  /** Narrow variant (below 1100 px): the worst count and "+{others}", for example "1 exception +3". */
  short: string;
}

function bucketOf(state: PollState): SummaryBucket | null {
  switch (state) {
    case "exception":
      return "exception";
    case "badResponse":
      return "badResponse";
    case "timeout":
      return "timeout";
    case "polling":
      return "live";
    case "paused":
      return "paused";
    case "offline":
      return null;
  }
}

/**
 * Summarizes the polls of a connected connection. Counts come in the fixed order exception,
 * bad response, timeout, live, paused; zeros are left out. Icon and tone come from the worst
 * state present. While the connection is not connected the chip is hidden by the caller, so
 * offline polls are not counted here.
 */
export function pollSummary(polls: ReadonlyArray<{ state: PollState }>): PollSummaryResult {
  const counts: Record<SummaryBucket, number> = {
    exception: 0,
    badResponse: 0,
    timeout: 0,
    live: 0,
    paused: 0,
  };
  for (const p of polls) {
    const bucket = bucketOf(p.state);
    if (bucket) counts[bucket] += 1;
  }
  const present = SUMMARY_ORDER.filter((b) => counts[b] > 0);
  const total = present.reduce((sum, b) => sum + counts[b], 0);
  const worst = present[0] ?? null;
  if (worst === null) {
    return {
      text: "No polls",
      worst,
      icon: null,
      tone: "outline",
      counts,
      total,
      short: "No polls",
    };
  }
  const text = present.map((b) => `${counts[b]} ${BUCKET_LABEL[b]}`).join(" · ");
  const others = total - counts[worst];
  const short = `${counts[worst]} ${BUCKET_LABEL[worst]}${others > 0 ? ` +${others}` : ""}`;
  const style = BUCKET_STYLE[worst];
  return { text, worst, icon: style.icon, tone: style.tone, counts, total, short };
}
