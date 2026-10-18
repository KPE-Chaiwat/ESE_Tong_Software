import { useEffect, useId, useRef } from "react";
import { KEEP_FOCUS_ON_PRESS } from "@/shared/lib/keep-focus";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { Icon } from "@/shared/ui/icon";
import { Input } from "@/shared/ui/input";
import { toProtocolAddress } from "../../lib/address";
import { formatRanges } from "../../lib/address-ranges";
import { overrideExampleText } from "../../lib/scale-example";
import { SCALE_PRESETS } from "../../lib/scale-presets";
import { SCALE_FIELDS, type ScaleFieldName } from "../../lib/scale-validation";
import { wholeNumber } from "../../validation/schemas";
import { describedBy, Field } from "../form/field";
import { useOverrideDialog, usePoll, usePollData, usePollViewRuntime } from "./context";
import { ScaleEditor } from "./ScaleEditor";

type Stoppable = { stopPropagation(): void };
const stop = (e: Stoppable) => e.stopPropagation();

/**
 * The dialog sits in a portal, but React still bubbles its events to the sub-window frame behind
 * it. Pointer and context-menu events are stopped here. Keys are stopped too, except Tab: the
 * focus trap of the dialog (Radix FocusScope, an ancestor of this element) wraps the focus in its
 * own keydown handler and must see it (REV-007 m-1). The frame's capture handlers ignore events
 * that did not start inside the frame, so the keys that reach them are not the dialog's.
 */
const KEEP_INSIDE = {
  onKeyDown: (e: { key: string; stopPropagation(): void }) => {
    if (e.key !== "Tab") e.stopPropagation();
  },
  onPointerDown: stop,
  onClick: stop,
  onContextMenu: stop,
  onDoubleClick: stop,
};

function RangeMessage({ children }: { children: string }) {
  return (
    <p role="alert" data-testid="override-range-error" className="flex items-start gap-1 text-xs">
      <Icon name="circle-x" tone="error" className="mt-px size-3.5" />
      <span>{children}</span>
    </p>
  );
}

/** The S8 scale override dialog (DES-003 3.2): a modal of the poll's host, 480 px wide. */
export function OverrideDialog() {
  const uid = useId();
  const runtime = usePollViewRuntime();
  const store = runtime.stores.overrides;
  const config = usePoll((s) => s.config);
  const open = useOverrideDialog((s) => s.open);
  const mode = useOverrideDialog((s) => s.mode);
  const ranges = useOverrideDialog((s) => s.ranges);
  const form = useOverrideDialog((s) => s.form);
  const errors = useOverrideDialog((s) => s.errors);
  const startText = useOverrideDialog((s) => s.startText);
  const endText = useOverrideDialog((s) => s.endText);
  const startError = useOverrideDialog((s) => s.startError);
  const endError = useOverrideDialog((s) => s.endError);
  const rangeError = useOverrideDialog((s) => s.rangeError);
  const pending = useOverrideDialog((s) => s.pending);
  const firstAddress = useOverrideDialog((s) => s.ranges[0]?.start ?? null);
  const pollStart = usePoll((s) => s.config?.definition.startAddress ?? 0);
  const pollQuantity = usePoll((s) => s.config?.definition.quantity ?? 0);
  // The raw value of the first address, for the example line (none: the example uses 1000).
  const firstRaw = usePollData((s) =>
    firstAddress === null || firstAddress < pollStart || firstAddress >= pollStart + pollQuantity
      ? undefined
      : s.values?.[firstAddress - pollStart],
  );
  const fields = useRef<Partial<Record<ScaleFieldName | "preset", HTMLElement | null>>>({});

  // The dialog is modal: shortcuts are off and pop out and dock wait while it is open.
  useEffect(() => {
    if (!open) return;
    return runtime.lockModal();
  }, [open, runtime]);

  if (!config) return null;
  const base = config.display.addressBase;
  const id = (name: string) => `${uid}-${name}`;
  const startNumber = wholeNumber(startText);
  const protocolStart = startNumber === null ? null : toProtocolAddress(startNumber, base);

  const save = async () => {
    const done = await store.getState().save();
    if (done) return;
    // The focus goes to the first field with a message.
    const state = store.getState();
    const first = SCALE_FIELDS.find((f) => state.errors[f] !== undefined);
    if (state.startError) document.getElementById(id("start"))?.focus();
    else if (state.endError || state.rangeError) document.getElementById(id("end"))?.focus();
    else if (first) fields.current[first]?.focus();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) store.getState().close();
      }}
      title={mode === "edit" ? "Edit scale override" : "Scale override"}
      widthClass="w-[480px]"
      initialFocus="[data-autofocus]"
    >
      <div {...KEEP_INSIDE} data-testid="override-dialog">
        <form
          noValidate
          className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {mode === "selection" ? (
            <>
              <p className="text-sm" data-testid="applies-to">
                Applies to {formatRanges(ranges, base)}
              </p>
              {rangeError ? <RangeMessage>{rangeError}</RangeMessage> : null}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-3">
                <Field id={id("start")} label="Start" error={startError ?? undefined}>
                  <Input
                    id={id("start")}
                    mono
                    inputMode="numeric"
                    data-autofocus=""
                    value={startText}
                    aria-invalid={startError ? true : undefined}
                    aria-describedby={describedBy(id("start"), {
                      error: startError,
                      helper: protocolStart !== null,
                    })}
                    onChange={(e) => store.getState().setStart(e.target.value)}
                    onBlur={() => store.getState().blurRange()}
                  />
                </Field>
                <Field id={id("end")} label="End" error={endError ?? undefined}>
                  <Input
                    id={id("end")}
                    mono
                    inputMode="numeric"
                    value={endText}
                    aria-invalid={endError || rangeError ? true : undefined}
                    aria-describedby={describedBy(id("end"), { error: endError })}
                    onChange={(e) => store.getState().setEnd(e.target.value)}
                    onBlur={() => store.getState().blurRange()}
                  />
                </Field>
              </div>
              {protocolStart !== null ? (
                <p id={id("start-helper")} className="text-xs text-text-muted">
                  Protocol address {protocolStart}
                </p>
              ) : null}
              {rangeError ? <RangeMessage>{rangeError}</RangeMessage> : null}
            </div>
          )}

          <ScaleEditor
            idPrefix={id("scale")}
            form={form}
            errors={errors}
            presets={SCALE_PRESETS.filter((p) => p !== "none")}
            stacked={false}
            autoFocusPreset={mode === "selection"}
            onPreset={(p) => store.getState().setPreset(p)}
            onField={(f, v) => store.getState().setField(f, v)}
            onBlur={(f) => store.getState().blur(f)}
            onRawSigned={(b) => store.getState().setRawSigned(b)}
            onDivisorMode={(m) => store.getState().setDivisorMode(m)}
            onOutOfRange={(m) => store.getState().setOutOfRange(m)}
            onQuickPick={(l) => store.getState().quickPick(l)}
            register={(field, el) => {
              fields.current[field] = el;
            }}
          />
          <p className="text-[13px] text-text-muted" data-testid="override-example">
            {overrideExampleText(form, firstRaw)}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              {...KEEP_FOCUS_ON_PRESS}
              onClick={() => store.getState().close()}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending} {...KEEP_FOCUS_ON_PRESS}>
              Save
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
