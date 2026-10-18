import type { ExceptionCode, PollState } from "@/shared/ipc/modbus-master.types";
import { StatusPill } from "@/shared/ui/status-pill";
import { compactChip } from "../lib/status-line";
import { pollPillFor } from "../store/poll.logic";

interface PollChipProps {
  state: PollState;
  exceptionCode: ExceptionCode | null;
  consecutiveFailures: number;
  /** The poll has received values (polling without data is "Waiting"). */
  hasData: boolean;
  className?: string;
}

/**
 * The compact state chip of the sidebar rows, the minimized bar and the compact rail
 * (DES-002 2.2.3): icon and short label ("Live", "Timeout 3", "Exc 02"). Its accessible name is the
 * full pill label ("Exception 02").
 */
export function PollChip({
  state,
  exceptionCode,
  consecutiveFailures,
  hasData,
  className,
}: PollChipProps) {
  const chip = compactChip(state, { consecutiveFailures, exceptionCode, hasData });
  const pill = pollPillFor(state, exceptionCode, hasData);
  return (
    <StatusPill
      size="sm"
      variant={pill.variant}
      icon={chip.icon}
      label={chip.label}
      fullLabel={chip.fullLabel}
      title={chip.fullLabel}
      {...(className ? { className } : {})}
    />
  );
}
