import { useEffect } from "react";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { toDisplayAddress } from "../../lib/address";
import { combinedText, rawWordsText } from "../../lib/combined";
import { INSPECTOR_SCALE_NOTE, outsidePollNote } from "../../lib/format-messages";
import { formatName, rowAt } from "../../lib/format-overrides";
import { groupValueOfWords } from "../../lib/row-value";
import { hasAnyScale } from "../../lib/scaled";
import { usePoll, usePollAlias, usePollData, usePollUi, usePollViewRuntime } from "./context";
import { rowRangeText } from "./DataGrid";

/**
 * The raw registers inspector D2 (DES-006, DES-009 3.2): the registers of one group row with their
 * aliases, unsigned and hex values. It lists only the registers that lie inside the poll and says
 * when the rest of the value is outside it.
 */
export function RawRegistersDialog() {
  const runtime = usePollViewRuntime();
  const config = usePoll((s) => s.config);
  const inspected = usePollUi((s) => s.inspectedGroupAddress);
  const values = usePollData((s) => s.values);
  const aliases = usePollAlias((s) => s.aliases);
  const rows = runtime.rows();
  const row = inspected === null ? undefined : rows[rowAt(rows, inspected)];
  const open = row !== undefined && row.width > 1;

  // The inspector is a modal of the window: shortcuts are off while it is open.
  useEffect(() => (open ? runtime.lockModal() : undefined), [runtime, open]);

  if (!config || !row || !open) return null;
  const base = config.display.addressBase;
  const { startAddress: start, quantity } = config.definition;
  const snapshot = values?.length === quantity ? values : null;
  const words = snapshot ? snapshot.slice(row.address - start, row.endAddress - start + 1) : null;
  const shown = groupValueOfWords(row, words);
  const outside = [
    ...(row.groupStart < row.address ? [{ start: row.groupStart, end: row.address - 1 }] : []),
    ...(row.groupEnd > row.endAddress ? [{ start: row.endAddress + 1, end: row.groupEnd }] : []),
  ];
  const outsideNote = outsidePollNote(outside, base);
  const range = rowRangeText(row, base);
  const registers = Array.from({ length: row.endAddress - row.address + 1 }, (_, i) => ({
    address: row.address + i,
    word: words?.[i],
  }));
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) runtime.stores.ui.getState().setInspectedGroupAddress(null);
      }}
      title={`Raw registers · ${range}`}
    >
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-xs text-text-muted">
          {formatName(row.format, row.order)}
          {shown.value.kind === "missing" ? "" : ` · ${combinedText(shown.value)}`}
        </p>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs">
                <th className="px-1">Address</th>
                <th className="px-1">Alias</th>
                <th className="px-1">Unsigned</th>
                <th className="px-1">Hex</th>
              </tr>
            </thead>
            <tbody>
              {registers.map((r) => (
                <tr key={r.address}>
                  <td className="px-1 font-mono">{toDisplayAddress(r.address, base)}</td>
                  <td className="px-1">{aliases.get(r.address)}</td>
                  <td className="px-1 font-mono">{r.word === undefined ? "—" : r.word}</td>
                  <td className="px-1 font-mono">
                    {r.word === undefined ? "—" : rawWordsText([r.word])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {outsideNote ? <p className="text-xs">{outsideNote}</p> : null}
        {hasAnyScale(config) ? <p className="text-xs">{INSPECTOR_SCALE_NOTE}</p> : null}
        {shown.value.kind === "float" && Object.is(shown.value.value, -0) ? (
          <p className="text-xs">Negative zero</p>
        ) : null}
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void runtime.actions.copyRows({ registers: true, addresses: [row.address] })
            }
          >
            Copy raw registers
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
