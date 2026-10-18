import { type ReactNode, useEffect, useId, useRef } from "react";
import { KEEP_FOCUS_ON_PRESS } from "@/shared/lib/keep-focus";
import { Button } from "@/shared/ui/button";
import { Icon } from "@/shared/ui/icon";
import { Input, Select } from "@/shared/ui/input";
import { toProtocolAddress } from "../../lib/address";
import { QUANTITY_LIMITS, READ_FUNCTION_LABELS, READ_FUNCTIONS } from "../../lib/functions";
import { draftHasEdits, draftTexts, type PollDraftField } from "../../store/poll-draft.logic";
import { wholeNumber } from "../../validation/schemas";
import { describedBy, Field } from "../form/field";
import { usePoll, usePollUi, usePollViewRuntime } from "./context";
import { SETUP_CONTENT_ANCHOR } from "./setup-focus";

interface PollSetupProps {
  /** The SCALE and OVERRIDES sections (`ScaleSection`), drawn below the POLL section. */
  scaleSection?: ReactNode;
  /** Focus the Name field with its text selected when the setup appears (a new poll). */
  focusName?: boolean;
}

/**
 * The setup content (DES-002 2.3.3): the POLL section, then whatever the host adds below it. One
 * component for the dock, the popover and the native panel. The typed texts are a draft in the poll
 * view's UI store, so closing the dock, switching presentation or moving the poll to another host
 * never loses an edit; nothing is sent until [Apply].
 */
export function PollSetup({ scaleSection, focusName }: PollSetupProps) {
  const uid = useId();
  const runtime = usePollViewRuntime();
  const { actions, stores } = runtime;
  const config = usePoll((s) => s.config);
  const pending = usePoll((s) => s.pending);
  const draft = usePollUi((s) => s.pollDraft);
  const refs = useRef<Partial<Record<PollDraftField, HTMLElement | null>>>({});
  const nameInput = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // A new poll opens its setup with the focus in Name and the text selected. When the setup only
  // moved to another presentation (the width crossed 640 px) the view already put the focus back in
  // the equivalent field, which stays (REV-008 m-3).
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the setup appears.
  useEffect(() => {
    if (!focusName) return;
    if (rootRef.current?.contains(document.activeElement)) return;
    nameInput.current?.focus();
    nameInput.current?.select();
  }, []);

  if (!config) return null;
  const texts = draft ?? draftTexts(config);
  const errors = draft?.errors ?? {};
  const busy = pending === "apply" || pending === "rename";
  const unapplied = draftHasEdits(draft);
  const base = config.display.addressBase;

  const id = (name: string) => `${uid}-${name}`;
  const fc = Number(texts.function);
  const maxQuantity = QUANTITY_LIMITS[(fc >= 1 && fc <= 4 ? fc : 3) as 1 | 2 | 3 | 4];
  const start = wholeNumber(texts.startAddress);
  const protocolAddress = start === null ? null : toProtocolAddress(start, base);

  const field = (name: PollDraftField) => ({
    value: texts[name],
    "aria-invalid": errors[name] ? (true as const) : undefined,
    "aria-describedby": describedBy(id(name), {
      error: errors[name],
      helper: name === "startAddress" ? protocolAddress : name === "quantity" ? true : null,
    }),
    onChange: (e: { target: { value: string } }) =>
      stores.ui.getState().patchPollDraft(name, e.target.value),
    onBlur: () => stores.ui.getState().checkPollDraftField(name, runtime.draftContext()),
    ref: (el: HTMLInputElement | HTMLSelectElement | null) => {
      refs.current[name] = el;
    },
  });

  const submit = async () => {
    const result = await actions.applySetup();
    if (!result.ok && result.firstInvalid) refs.current[result.firstInvalid]?.focus();
  };

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-4"
      data-testid="poll-setup"
      data-focus-anchor={SETUP_CONTENT_ANCHOR}
    >
      <section aria-labelledby={id("heading")} className="flex flex-col gap-2">
        <h3 id={id("heading")} className="text-base font-semibold">
          Poll
        </h3>
        <form
          className="flex flex-col gap-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field id={id("name")} label="Name" error={errors.name}>
            <Input
              id={id("name")}
              {...field("name")}
              ref={(el) => {
                nameInput.current = el;
                refs.current.name = el;
              }}
            />
          </Field>
          <Field id={id("slaveId")} label="Slave ID" error={errors.slaveId}>
            <Input id={id("slaveId")} mono inputMode="numeric" {...field("slaveId")} />
          </Field>
          <Field id={id("function")} label="Function" error={errors.function}>
            <Select id={id("function")} {...field("function")}>
              {READ_FUNCTIONS.map((f) => (
                <option key={f} value={String(f)}>
                  {READ_FUNCTION_LABELS[f]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id={id("startAddress")}
            label="Start address"
            error={errors.startAddress}
            helper={protocolAddress === null ? undefined : `Protocol address ${protocolAddress}`}
          >
            <Input id={id("startAddress")} mono inputMode="numeric" {...field("startAddress")} />
          </Field>
          <Field
            id={id("quantity")}
            label="Quantity"
            error={errors.quantity}
            helper={`1-${maxQuantity}`}
          >
            <Input id={id("quantity")} mono inputMode="numeric" {...field("quantity")} />
          </Field>
          <Field id={id("scanRateMs")} label="Scan rate (ms)" error={errors.scanRateMs}>
            <Input id={id("scanRateMs")} mono inputMode="numeric" {...field("scanRateMs")} />
          </Field>
          <div className="flex flex-col gap-1">
            <div>
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={busy}
                {...KEEP_FOCUS_ON_PRESS}
              >
                {busy ? <Icon name="loader" /> : null}
                Apply
              </Button>
            </div>
            {unapplied ? (
              <p className="text-xs text-text-muted" data-testid="unapplied-text">
                Unapplied changes
              </p>
            ) : null}
          </div>
        </form>
      </section>
      {scaleSection}
    </div>
  );
}
