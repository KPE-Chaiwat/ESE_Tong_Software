import { FreshnessChip } from "@/shared/ui/freshness-chip";
import { Icon } from "@/shared/ui/icon";
import { SegmentedControl } from "@/shared/ui/segmented";
import { VALUE_FORMAT_LABELS, VALUE_FORMATS } from "../../lib/format";
import { isBitFunction } from "../../lib/functions";
import { useConfig, usePollData, useSession, useSetupStatus } from "../context";
import { DataTable } from "./DataTable";
import { deriveDataView } from "./data-view.logic";

export const BITS_FORMAT_TOOLTIP = "Coils and discrete inputs are shown as 0 or 1.";

/** The data card: poll summary, freshness chip, Format and Base controls, and the table. */
export function DataCard() {
  const state = useSession((s) => s.state);
  const exceptionCode = useSession((s) => s.exceptionCode);
  const status = usePollData((s) => s.status);
  const hasValues = usePollData((s) => s.values !== null);
  const lastOkAt = usePollData((s) => s.lastOkAt);
  const clearedBecause = usePollData((s) => s.clearedBecause);
  const definition = usePollData((s) => s.definition);
  const poll = useConfig((s) => s.poll);
  const connection = useConfig((s) => s.connection);
  const format = useConfig((s) => s.display.format);
  const base = useConfig((s) => s.display.addressBase);
  const setFormat = useConfig((s) => s.setFormat);
  const setBase = useConfig((s) => s.setBase);
  const pollInvalid = useSetupStatus((s) => s.pollInvalid);

  const view = deriveDataView({
    state,
    exceptionCode,
    status,
    hasValues,
    lastOkAt,
    clearedBecause,
    definition,
    poll,
    connection,
    addressBase: base,
    pollInvalid,
  });

  const fn = (definition ?? poll).function;
  const bits = isBitFunction(fn);

  return (
    <section
      aria-label="Data"
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 rounded-lg border bg-card p-3"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-base font-semibold" data-testid="poll-summary">
          {view.header}
        </h2>
        {view.chip ? (
          <FreshnessChip
            kind={view.chip.kind}
            {...(view.chip.title === undefined ? {} : { title: view.chip.title })}
          >
            {view.chip.text}
          </FreshnessChip>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold">
        <div className="flex items-center gap-2">
          <span>Format</span>
          <SegmentedControl
            aria-label="Format"
            value={format}
            onChange={setFormat}
            disabled={bits}
            {...(bits ? { title: BITS_FORMAT_TOOLTIP } : {})}
            options={VALUE_FORMATS.map((f, i) => ({
              value: f,
              label: VALUE_FORMAT_LABELS[f],
              title: `${VALUE_FORMAT_LABELS[f]} (Ctrl+${i + 1})`,
            }))}
          />
        </div>
        <div className="flex items-center gap-2">
          <span>Base</span>
          <SegmentedControl
            aria-label="Address base"
            value={base}
            onChange={setBase}
            options={[
              { value: 0, label: "0", title: "0-based addresses (Ctrl+B)" },
              { value: 1, label: "1", title: "1-based addresses (Ctrl+B)" },
            ]}
          />
        </div>
      </div>

      {view.emptyText ? (
        <div
          data-testid="data-empty"
          className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-text-muted"
        >
          <Icon name={view.emptyText.icon} className="size-6" />
          <p>{view.emptyText.text}</p>
        </div>
      ) : (
        <DataTable
          rowCount={view.rowCount}
          startAddress={(definition ?? poll).startAddress}
          loading={view.loading}
          stale={view.stale}
          bits={bits}
        />
      )}
    </section>
  );
}
