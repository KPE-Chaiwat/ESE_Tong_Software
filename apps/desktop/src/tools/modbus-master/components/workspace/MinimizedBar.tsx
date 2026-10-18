import { useRef } from "react";
import type { PollId } from "@/shared/ipc/modbus-master.types";
import { cn } from "@/shared/lib/utils";
import { Icon } from "@/shared/ui/icon";
import { compactChip } from "../../lib/status-line";
import { pollPillFor } from "../../store/poll.logic";
import { selectPollConfig, selectPollHasData, selectPollStatus } from "../../store/poll-list.store";
import { MINIMIZED_BAR_HEIGHT } from "../../store/workspace.logic";
import { useActions, usePollList, useWorkspace } from "../context";

/** The pill border by state tone (DES-002 2.2.4): the tone is also carried by the icon and the text. */
const PILL_BORDER: Record<string, string> = {
  polling: "border-dark/25",
  waiting: "border-dark/25",
  paused: "border-dark",
  timeout: "border-warning",
  badResponse: "border-warning",
  exception: "border-error",
  offline: "border-dark/25",
};

function Pill({ pollId }: { pollId: PollId }) {
  const actions = useActions();
  const config = usePollList(selectPollConfig(pollId));
  const status = usePollList(selectPollStatus(pollId));
  const hasData = usePollList(selectPollHasData(pollId));
  if (!config || !status) return null;
  const chip = compactChip(status.state, {
    consecutiveFailures: status.consecutiveFailures,
    exceptionCode: status.exceptionCode,
    hasData,
  });
  const pill = pollPillFor(status.state, status.exceptionCode, hasData);
  return (
    <button
      type="button"
      data-slot="minimized-pill"
      data-variant={pill.variant}
      title={`Restore ${config.name}`}
      onClick={() => void actions.showPoll(pollId)}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-pill border-[1.5px] bg-card px-3 text-xs font-semibold text-foreground outline-none hover:bg-neutral-tint focus-ring",
        PILL_BORDER[pill.variant],
      )}
    >
      <Icon name={chip.icon} tone={status.state === "exception" ? "error" : "default"} />
      <span>
        {config.name} · {chip.label}
      </span>
    </button>
  );
}

/**
 * The minimized bar (DES-002 2.2.4): shown only while a sub-window is minimized. One pill per
 * minimized sub-window with its state icon and "{name} · {chip}"; a click restores it. When the
 * pills do not fit, the bar scrolls sideways with its two buttons.
 */
export function MinimizedBar() {
  const order = useWorkspace((s) => s.minimizedOrder);
  const scroller = useRef<HTMLDivElement>(null);
  if (order.length === 0) return null;
  const scrollBy = (dx: number) => scroller.current?.scrollBy?.({ left: dx, behavior: "smooth" });
  return (
    <section
      aria-label="Minimized windows"
      data-region="minimized"
      data-slot="minimized-bar"
      style={{ height: MINIMIZED_BAR_HEIGHT }}
      className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-[10px] border bg-light px-2.5"
    >
      <span className="shrink-0 text-[13px] font-semibold">Minimized</span>
      <button
        type="button"
        aria-label="Scroll minimized windows left"
        onClick={() => scrollBy(-160)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md outline-none hover:bg-neutral-tint focus-ring"
      >
        <Icon name="chevron-left" />
      </button>
      <div ref={scroller} className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        {order.map((id) => (
          <Pill key={id} pollId={id} />
        ))}
      </div>
      <button
        type="button"
        aria-label="Scroll minimized windows right"
        onClick={() => scrollBy(160)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md outline-none hover:bg-neutral-tint focus-ring"
      >
        <Icon name="chevron-right" />
      </button>
    </section>
  );
}
