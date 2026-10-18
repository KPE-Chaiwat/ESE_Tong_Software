import type { Counters } from "@/shared/ipc/modbus-master.types";
import { Icon } from "@/shared/ui/icon";
import { filteredCounters } from "../../store/traffic.store";
import { useRuntime, useTraffic } from "../context";

export const LINK_LOAD_WARNING = 90;

/** "link load 72%", or "link load 92% - polls are slowed down" from 90% on (DES-002 2.2.5). */
export function linkLoadText(pct: number): string {
  return pct >= LINK_LOAD_WARNING
    ? `link load ${pct}% - polls are slowed down`
    : `link load ${pct}%`;
}

export function trafficBarText(c: Counters, linkLoadPct: number): string {
  return `Requests ${c.requests} · Responses ${c.responses} · Errors ${c.errors} · Timeouts ${c.timeouts} · ${linkLoadText(linkLoadPct)}`;
}

/** The collapsed traffic bar (DES-002 2.2.5): 34 px, dark, with the counters of the current filter. */
export function TrafficBar() {
  const runtime = useRuntime();
  const counters = useTraffic((s) => filteredCounters(s));
  const load = useTraffic((s) => Math.round(s.counters.linkLoadPct));
  const slowed = load >= LINK_LOAD_WARNING;
  return (
    <section
      aria-label="Traffic"
      data-region="traffic"
      data-testid="traffic-bar"
      className="flex h-[34px] shrink-0 items-center gap-5 bg-dark px-4 text-[13px] text-light"
    >
      <span className="font-bold">Traffic</span>
      <span className="flex min-w-0 items-center gap-1.5 truncate font-mono text-xs">
        {slowed ? <Icon name="gauge" className="size-3.5 text-accent" /> : null}
        {trafficBarText(counters, load)}
      </span>
      <button
        type="button"
        aria-label="Expand traffic panel"
        aria-expanded={false}
        title="Expand (Ctrl+J)"
        onClick={() => runtime.stores.workspace.getState().setTrafficExpanded(true)}
        className="ml-auto inline-flex h-6 items-center gap-1 rounded-pill px-2 text-xs font-semibold outline-none hover:bg-light/15 focus-ring-on-dark"
      >
        Expand
        <Icon name="chevron-up" className="size-3.5" />
      </button>
    </section>
  );
}
