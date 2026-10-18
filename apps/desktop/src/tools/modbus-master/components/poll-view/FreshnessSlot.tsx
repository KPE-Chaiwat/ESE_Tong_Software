import { FreshnessChip } from "@/shared/ui/freshness-chip";
import { usePollData } from "./context";
import { type DataViewInput, deriveDataView } from "./poll-view.logic";

/**
 * The freshness chip (DES-001 2.4). It is the only part of the poll view that reads the time of the
 * last update, so a PollUpdate renders this chip and the rows, and nothing around them.
 */
export function FreshnessSlot({
  input,
  iconOnly = false,
}: {
  input: Omit<DataViewInput, "lastOkAt">;
  /** Only the icon shows (the status line is narrow). */
  iconOnly?: boolean;
}) {
  const lastOkAt = usePollData((s) => s.lastOkAt);
  const chip = deriveDataView({ ...input, lastOkAt }).chip;
  if (!chip) return null;
  return (
    <FreshnessChip
      kind={chip.kind}
      iconOnly={iconOnly}
      {...(chip.title === undefined ? {} : { title: chip.title })}
    >
      {chip.text}
    </FreshnessChip>
  );
}
