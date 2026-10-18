import { useId, useState } from "react";
import type { ValueFormat } from "@/shared/ipc/modbus-master.types";
import { Button } from "@/shared/ui/button";
import { Select } from "@/shared/ui/input";
import { isCombinedFormat, orderedBytes, orderLabel, registerWidth } from "../../lib/combined";
import { formatHexBytes, VALUE_FORMAT_LABELS, VALUE_FORMATS } from "../../lib/format";
import { isBitFunction } from "../../lib/functions";
import { usePoll, usePollUi, usePollViewRuntime } from "./context";

const formats: readonly ValueFormat[] = [
  ...VALUE_FORMATS,
  "signed32",
  "unsigned32",
  "float32",
  "signed64",
  "unsigned64",
  "float64",
];
const endianChoices = [
  { id: "big", name: "Big-endian", swapBytes: false, reverseWords: false },
  { id: "little", name: "Little-endian", swapBytes: true, reverseWords: true },
  { id: "bigByteSwap", name: "Big-endian byte swap", swapBytes: true, reverseWords: false },
  { id: "littleByteSwap", name: "Little-endian byte swap", swapBytes: false, reverseWords: true },
] as const;
const endianChoice = (order: { swapBytes: boolean; reverseWords: boolean }) =>
  endianChoices.find(
    (choice) => choice.swapBytes === order.swapBytes && choice.reverseWords === order.reverseWords,
  ) ?? endianChoices[0];
const endianLabel = (width: number, order: { swapBytes: boolean; reverseWords: boolean }) =>
  `${endianChoice(order).name} (${orderLabel(width, order)})`;
export function InterpretationSection() {
  const id = useId();
  const { stores } = usePollViewRuntime();
  const config = usePoll((s) => s.config);
  const draft = usePollUi((s) => s.interpretationDraft);
  const [pending, setPending] = useState(false);
  if (!config) return null;
  const current = draft ?? { ...config.display, error: null };
  const bits = isBitFunction(config.definition.function);
  const combined = isCombinedFormat(current.format);
  const width = isCombinedFormat(current.format) ? registerWidth(current.format) : 2;
  const raw = width === 2 ? [0x1234, 0x5678] : [0x1234, 0x5678, 0x9abc, 0xdef0];
  const patch = (change: Partial<typeof current>) =>
    stores.ui.getState().setInterpretationDraft({ ...current, ...change, error: null });
  const apply = async () => {
    if (pending) return;
    setPending(true);
    const submitted = stores.ui.getState().interpretationDraft;
    const ok = await stores.poll.getState().setView({
      display: {
        ...config.display,
        format: current.format as ValueFormat,
        swapBytes: current.swapBytes,
        reverseWords: current.reverseWords,
      },
    });
    if (stores.ui.getState().interpretationDraft === submitted) {
      stores.ui.getState().setInterpretationDraft(
        ok
          ? null
          : {
              ...current,
              error: `Could not apply interpretation. ${stores.poll.getState().commandError ?? "Try again."}`,
            },
      );
    }
    setPending(false);
  };
  return (
    <section className="flex flex-col gap-2" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} className="text-base font-semibold">
        Interpretation
      </h3>
      {bits ? (
        <p className="text-xs text-text-muted">
          Combined values apply to registers (FC03 and FC04) only. Register interpretation and order
          are kept for FC03 or FC04.
        </p>
      ) : null}
      <fieldset disabled={bits || pending} className="flex min-w-0 flex-col gap-2">
        <label className="sr-only" htmlFor={id}>
          Interpretation
        </label>
        <Select
          id={id}
          data-interpretation-format=""
          value={current.format}
          onChange={(event) => patch({ format: event.target.value })}
        >
          {formats.map((format) => (
            <option key={format} value={format}>
              {VALUE_FORMAT_LABELS[format]}
            </option>
          ))}
        </Select>
        {combined ? (
          <>
            <label htmlFor={`${id}-order`} className="text-xs">
              Byte order
            </label>
            <Select
              id={`${id}-order`}
              value={endianChoice(current).id}
              onChange={(event) => {
                const choice = endianChoices.find((entry) => entry.id === event.target.value);
                if (choice)
                  patch({ swapBytes: choice.swapBytes, reverseWords: choice.reverseWords });
              }}
            >
              {endianChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {endianLabel(width, choice)}
                </option>
              ))}
            </Select>
            <p className="overflow-x-auto whitespace-nowrap font-mono text-xs">
              Raw: {formatHexBytes(orderedBytes(raw, { swapBytes: false, reverseWords: false }))} →
              Decode: {formatHexBytes(orderedBytes(raw, current))}
            </p>
            <p className="text-xs">{width} registers per value. Quantity counts registers.</p>
          </>
        ) : null}
        {current.error ? (
          <p role="alert" className="text-xs">
            {current.error}
          </p>
        ) : null}
        <Button size="sm" variant="outline" aria-busy={pending} onClick={() => void apply()}>
          {pending ? "Applying…" : "Apply interpretation"}
        </Button>
      </fieldset>
      <p className="text-xs text-text-muted">
        Applied: {VALUE_FORMAT_LABELS[config.display.format]}
        {isCombinedFormat(config.display.format)
          ? ` · ${endianLabel(registerWidth(config.display.format), config.display)}`
          : ""}
      </p>
    </section>
  );
}
