import { memo } from "react";
import { Icon } from "@/shared/ui/icon";
import { SegmentedControl } from "@/shared/ui/segmented";
import { isCombinedFormat } from "../../lib/combined";
import { VALUE_FORMAT_LABELS, VALUE_FORMATS } from "../../lib/format";
import { isBitFunction } from "../../lib/functions";
import { SCALE_REGISTERS_ONLY } from "../../lib/scale-presets";
import { effectiveValueColumns, scaleAvailable } from "../../lib/scaled";
import { CombinedGrid } from "./CombinedGrid";
import { usePoll, usePollViewRuntime } from "./context";
import { DataGrid } from "./DataGrid";
import { FreshnessSlot } from "./FreshnessSlot";
import {
  BITS_FORMAT_TOOLTIP,
  type DataViewInput,
  type DataViewModel,
  NO_SCALE_TITLE,
  pollHeaderText,
  VALUE_COLUMN_LABELS,
} from "./poll-view.logic";

interface DataCardProps {
  view: DataViewModel;
  /** What the freshness chip derives its text from (it reads the update time itself). */
  chipInput: Omit<DataViewInput, "lastOkAt">;
  /** Wide layout: the header row with the segmented controls (DES-002 2.3.4). */
  wideHeader: boolean;
}

/** The data card: the wide header, then the empty text or the grid. */
export const DataCard = memo(function DataCard({ view, chipInput, wideHeader }: DataCardProps) {
  const { actions } = usePollViewRuntime();
  const config = usePoll((s) => s.config);
  if (!config) {
    // The PV "loading (attach)" state.
    return (
      <section
        aria-label="Data"
        className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-sm text-text-muted"
      >
        <Icon name="loader" className="size-6" />
        <p>Loading poll…</p>
      </section>
    );
  }

  const def = config.definition;
  const bits = isBitFunction(def.function);
  const scaleOn = scaleAvailable(config);

  return (
    <section
      aria-label="Data"
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 rounded-lg border bg-card p-3"
    >
      {wideHeader ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="text-[15px] font-semibold" data-testid="poll-summary">
              {pollHeaderText(def, config.display.addressBase)}
            </h2>
            <FreshnessSlot input={chipInput} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold">
            <div className="flex items-center gap-2">
              <span>Show</span>
              <SegmentedControl
                aria-label="Show"
                value={effectiveValueColumns(config)}
                onChange={(v) => void actions.setValueColumns(v)}
                disabled={!scaleOn}
                {...(scaleOn ? {} : { title: bits ? SCALE_REGISTERS_ONLY : NO_SCALE_TITLE })}
                options={(["raw", "scaled", "both"] as const).map((v) => ({
                  value: v,
                  label: VALUE_COLUMN_LABELS[v],
                }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <span>Raw format</span>
              <SegmentedControl
                aria-label="Raw format"
                value={config.display.format}
                onChange={(f) => void actions.setFormat(f)}
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
              <span>Address</span>
              <SegmentedControl
                aria-label="Address base"
                value={config.display.addressBase}
                onChange={(b) => void actions.setAddressBase(b)}
                options={[
                  { value: 0, label: "0", title: "0-based addresses (Ctrl+B)" },
                  { value: 1, label: "1", title: "1-based addresses (Ctrl+B)" },
                ]}
              />
            </div>
          </div>
        </>
      ) : null}

      {view.empty ? (
        <div
          data-testid="data-empty"
          className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-text-muted"
        >
          <Icon name={view.empty.icon} className="size-6" />
          <p>{view.empty.text}</p>
        </div>
      ) : !bits && isCombinedFormat(config.display.format) ? (
        <CombinedGrid format={config.display.format} loading={view.loading} stale={view.stale} />
      ) : (
        <DataGrid
          rowCount={def.quantity}
          startAddress={def.startAddress}
          loading={view.loading}
          stale={view.stale}
          bits={bits}
        />
      )}
    </section>
  );
});
