import { useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import type { ValueFormat } from "@/shared/ipc/modbus-master.types";
import { KEEP_FOCUS_ON_PRESS } from "@/shared/lib/keep-focus";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { Icon, type IconName } from "@/shared/ui/icon";
import { countAddresses, formatRanges } from "../../lib/address-ranges";
import { VALUE_FORMAT_LABELS } from "../../lib/format";
import {
  firstValueText,
  previewLines,
  previewNotice,
  selectionSummaryParts,
  type WidthAvailability,
  widthAvailability,
  widthHeading,
} from "../../lib/format-dialog-model";
import {
  cutMessages,
  DIALOG_DESCRIPTION,
  limitCutLines,
  MIXED_NOTE,
  ORDER_HELP,
  SCALED_ONLY_NOTE,
  tooManyMessage,
  UNCHANGED_NOTE,
} from "../../lib/format-messages";
import {
  FORMATS_16,
  FORMATS_32,
  FORMATS_64,
  formatWidth,
  ORDER_IDS,
  ORDER_NAMES,
  type OrderId,
  orderPattern,
} from "../../lib/format-overrides";
import { effectiveValueColumns } from "../../lib/scaled";
import { selectPlan } from "../../store/format-dialog.store";
import {
  useFormatDialog,
  usePoll,
  usePollConnection,
  usePollData,
  usePollViewRuntime,
} from "./context";
import { FormatPreview } from "./FormatPreview";
import { KEEP_INSIDE } from "./keep-inside";

/** A focused radio scrolls into view inside the body (jsdom has no `scrollIntoView`). */
const scrollIntoView = (e: { currentTarget: HTMLElement }) =>
  e.currentTarget.scrollIntoView?.({ block: "nearest" });

/**
 * One message of the message area (DES-009 4.5): icon plus 13 px dark text, never color only. A
 * message of several lines is one paragraph per line, 4 px apart.
 */
function Message({
  id,
  kind,
  lines,
}: {
  id: string;
  kind: "warning" | "error" | "info";
  lines: readonly string[];
}) {
  const icon: IconName =
    kind === "warning" ? "triangle-alert" : kind === "error" ? "circle-x" : "info";
  return (
    <div
      id={id}
      data-kind={kind}
      className={cn(
        "flex items-start gap-2 text-[13px]",
        kind === "info" ? "text-text-muted" : "text-foreground",
        kind === "warning" && "rounded-md border-l-[3px] border-warning bg-warning-tint px-3 py-2",
        kind === "error" && "rounded-md border-l-[3px] border-error bg-error-tint px-3 py-2",
      )}
    >
      <Icon name={icon} tone={kind === "error" ? "error" : "default"} className="mt-px size-4" />
      <div className="flex min-w-0 flex-col gap-1">
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  );
}

/**
 * The Format dialog D1 (DES-010, DES-009 section 4): a modal of the poll's host that sets the format
 * and the byte and word order of the selected rows only. Everything it decides is derived from the
 * draft in `formatDialogStore` and the applied config; Apply sends one `setPollView({ formatOverrides })`.
 * Multi-register values use following poll registers to complete the selected runs.
 *
 * This shell only watches the draft's `open` and `pending` flags and the config; the body (poll data
 * subscriptions, preview, sections) is mounted by the dialog only while it is open, so a closed
 * dialog does no work on a poll update.
 */
export function FormatDialog() {
  const uid = useId();
  const runtime = usePollViewRuntime();
  const store = runtime.stores.formatDialog;
  const config = usePoll((s) => s.config);
  const open = useFormatDialog((s) => s.open);
  const pending = useFormatDialog((s) => s.pending);

  // The dialog is modal: shortcuts are off and pop out, dock and bulk actions wait while it is open.
  useEffect(() => {
    if (!open) return;
    return runtime.lockModal();
  }, [open, runtime]);

  // The poll went away (deleted, or this view was detached): close without applying. The runtime
  // watches the removal event, the detach and the range; this covers a config that is gone.
  useEffect(() => {
    if (open && config === null) store.getState().closeForRemoval();
  }, [open, config, store]);

  if (!config) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) store.getState().close();
      }}
      title="Format / endian"
      widthClass="w-[min(600px,calc(100vw-16px))]"
      // DES-009 11.10: a column of fixed header, scrolling body and fixed footer that fits a
      // 466 x 283 client; compact spacing below 480 px of viewport height.
      contentClassName="flex max-h-[calc(100vh-16px)] max-w-[calc(100vw-16px)] flex-col [@media(max-height:479px)]:p-3"
      headerClassName="[@media(max-height:479px)]:mb-2"
      titleClassName="[@media(max-height:479px)]:text-base"
      initialFocus="[data-autofocus]"
      describedBy={`${uid}-desc ${uid}-summary`}
      onEscapeKeyDown={(e) => {
        if (pending) e.preventDefault();
      }}
    >
      <FormatDialogBody uid={uid} />
    </Dialog>
  );
}

/** The content of the open dialog: mounted by the `Dialog` only while it is open. */
function FormatDialogBody({ uid }: { uid: string }) {
  const runtime = usePollViewRuntime();
  const store = runtime.stores.formatDialog;
  const config = usePoll((s) => s.config);
  const pollState = usePoll((s) => s.state);
  const scope = useFormatDialog((s) => s.scope);
  const format = useFormatDialog((s) => s.format);
  const order = useFormatDialog((s) => s.order);
  const mixed = useFormatDialog((s) => s.mixed);
  const pending = useFormatDialog((s) => s.pending);
  const error = useFormatDialog((s) => s.error);
  const values = usePollData((s) => s.values);
  const dataStatus = usePollData((s) => s.status);
  const connectionState = usePollConnection((s) => s.state);
  const formRef = useRef<HTMLFormElement>(null);

  const base = config?.display.addressBase ?? 0;
  const pollEnd = config ? config.definition.startAddress + config.definition.quantity - 1 : 65535;
  const derived = useMemo(
    () => (config ? selectPlan({ scope, format, order }, config) : null),
    [config, scope, format, order],
  );
  // Value counts include following poll registers needed to complete selected runs.
  const availability = useMemo(
    () => ({
      16: widthAvailability({ scope, width: 1, base, pollEnd }),
      32: widthAvailability({ scope, width: 2, base, pollEnd }),
      64: widthAvailability({ scope, width: 4, base, pollEnd }),
    }),
    [scope, base, pollEnd],
  );

  const width = formatWidth(format);
  const showOrder = width > 1;
  // Showing or hiding the order group never loses the focus (DES-010 6.3): the group sits outside the
  // Format fieldset, so the focused radio stays; if the focus was lost anyway it goes back to the
  // checked format. The focused element stays visible inside the body. It acts only after a change
  // (not when the dialog opens: Radix has not moved the focus yet and the active element is still the
  // grid behind the modal) and only on elements inside this form.
  const shown = useRef({ format, showOrder });
  useLayoutEffect(() => {
    if (shown.current.format === format && shown.current.showOrder === showOrder) return;
    shown.current = { format, showOrder };
    const form = formRef.current;
    if (!form) return;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      form.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (form.contains(active)) {
      (active as HTMLElement).scrollIntoView?.({ block: "nearest" });
    }
  }, [format, showOrder]);

  if (!config || !derived) return null;

  const id = (name: string) => `${uid}-${name}`;
  const { plan, status, applyEnabled } = derived;

  // ---- preview (DES-010 7): the latest snapshot, nothing is requested ----
  const start = config.definition.startAddress;
  const quantity = config.definition.quantity;
  const snapshot = values !== null && values.length === quantity ? values : null;
  const preview = previewLines({ scope, format, order, snapshot, pollStart: start, pollEnd, base });
  const selection = selectionSummaryParts({ scope, base, mixed });
  const notice = previewNotice({
    connectionState,
    pollState,
    status: dataStatus,
    hasValues: snapshot !== null,
  });
  const optionPreview = (f: ValueFormat, o: OrderId): string =>
    firstValueText({ scope, format: f, order: o, snapshot, pollStart: start, pollEnd, base });

  // ---- messages (DES-010 8) ----
  const live: Array<{ key: string; kind: "warning" | "info"; lines: string[] }> = [];
  if (mixed) live.push({ key: "mixed", kind: "info", lines: [MIXED_NOTE] });
  if (plan.kind === "ok") {
    if (plan.added.length > 0) {
      const count = countAddresses(plan.added);
      live.push({
        key: "added",
        kind: "info",
        lines: [
          `Also includes ${count === 1 ? "register" : "registers"} ${formatRanges(plan.added, base)} to complete the selected values.`,
        ],
      });
    }
    if (plan.tails.length > 0) {
      live.push({
        key: "tail",
        kind: "info",
        lines: [
          `${countAddresses(plan.tails) === 1 ? "Register" : "Registers"} ${formatRanges(plan.tails, base)} ${countAddresses(plan.tails) === 1 ? "stays" : "stay"} Unsigned 16-bit: there are not enough following registers in this poll.`,
        ],
      });
    }
    const cuts = cutMessages(plan.cuts, base);
    if (cuts.length > 0) live.push({ key: "cut", kind: "warning", lines: limitCutLines(cuts) });
    if (status === "U" && plan.tails.length === 0)
      live.push({ key: "same", kind: "info", lines: [UNCHANGED_NOTE] });
    if (width > 1 && effectiveValueColumns(config) === "scaled") {
      live.push({ key: "scaled", kind: "info", lines: [SCALED_ONLY_NOTE] });
    }
  }
  const tooMany = plan.kind === "tooMany" ? tooManyMessage(plan.count) : null;
  const messageIds = [
    ...live.map((m) => id(`msg-${m.key}`)),
    ...(tooMany ? [id("msg-many")] : []),
    ...(error ? [id("msg-error")] : []),
  ];

  const apply = () => void store.getState().apply();
  const cancel = () => store.getState().close();

  const formatSection = (
    bits: 16 | 32 | 64,
    formats: readonly ValueFormat[],
    av: WidthAvailability,
  ) => {
    const headingId = id(`h${bits}`);
    return (
      // biome-ignore lint/a11y/useSemanticElements: DES-010 5.4 asks for a labelled group inside the single Format fieldset, so all ten radios keep one name and one arrow-key ring.
      <div role="group" aria-labelledby={headingId} className="flex flex-col">
        <p
          id={headingId}
          data-testid={`width-heading-${bits}`}
          className="mt-1 text-xs text-text-muted"
        >
          {widthHeading(av)}
        </p>
        {formats.map((f) => {
          const checked = format === f;
          return (
            <label
              key={f}
              className="flex min-h-7 cursor-pointer flex-wrap items-center gap-x-2 rounded-md px-2 py-0.5 hover:bg-neutral-tint has-[:checked]:bg-selected"
            >
              <input
                type="radio"
                name={id("format")}
                value={f}
                checked={checked}
                disabled={pending}
                {...(checked ? { "data-autofocus": "" } : {})}
                onFocus={scrollIntoView}
                aria-labelledby={id(`label-${f}`)}
                aria-describedby={`${headingId} ${id(`preview-${f}`)}`}
                onChange={() => store.getState().setFormat(f)}
                className="size-4 accent-dark"
              />
              <span id={id(`label-${f}`)} className="shrink-0 whitespace-nowrap text-sm">
                {VALUE_FORMAT_LABELS[f]}
              </span>
              <span
                id={id(`preview-${f}`)}
                data-testid={`preview-${f}`}
                className="ml-auto min-w-0 max-w-full truncate font-mono text-[13px] text-text-muted"
              >
                {optionPreview(f, order)}
              </span>
            </label>
          );
        })}
      </div>
    );
  };

  const patternWidth: 2 | 4 = width === 4 ? 4 : 2;

  return (
    <div {...KEEP_INSIDE} data-testid="format-dialog" className="flex min-h-0 flex-1 flex-col">
      <form
        ref={formRef}
        noValidate
        className="flex min-h-0 flex-1 flex-col gap-3 [@media(max-height:479px)]:gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
        onKeyDown={(e) => {
          // Enter applies from anywhere except the buttons, which do their own thing.
          if (e.key !== "Enter" || (e.target as HTMLElement).closest("button")) return;
          e.preventDefault();
          apply();
        }}
      >
        <div
          data-testid="format-body"
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1"
        >
          <p id={id("desc")} className="text-[13px] text-text-muted">
            {DIALOG_DESCRIPTION}
          </p>
          <p id={id("summary")} data-testid="format-summary" className="text-sm">
            {selection.lead}
            <span className="font-mono">{selection.runs}</span>
            {selection.tail}
          </p>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 min-[632px]:grid-cols-2">
            <fieldset className="flex min-w-0 flex-col gap-0.5">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide">Format</legend>
              {formatSection(16, FORMATS_16, availability[16])}
              {formatSection(32, FORMATS_32, availability[32])}
              {formatSection(64, FORMATS_64, availability[64])}
            </fieldset>
            <div className="flex min-w-0 flex-col gap-3">
              {showOrder ? (
                <div className="flex min-w-0 flex-col gap-2">
                  <fieldset
                    disabled={pending}
                    className="flex min-w-0 flex-col gap-0.5"
                    data-testid="order-group"
                  >
                    <legend className="mb-1 text-xs font-semibold uppercase tracking-wide">
                      Byte and word order
                    </legend>
                    {ORDER_IDS.map((o) => (
                      <label
                        key={o}
                        className="flex min-h-7 cursor-pointer flex-wrap items-center gap-x-2 rounded-md px-2 py-0.5 hover:bg-neutral-tint has-[:checked]:bg-selected"
                      >
                        <input
                          type="radio"
                          name={id("order")}
                          value={o}
                          checked={order === o}
                          aria-labelledby={id(`order-${o}`)}
                          aria-describedby={`${id(`pattern-${o}`)} ${id(`opreview-${o}`)}`}
                          onChange={() => store.getState().setOrder(o)}
                          onFocus={scrollIntoView}
                          className="size-4 accent-dark"
                        />
                        <span id={id(`order-${o}`)} className="shrink-0 whitespace-nowrap text-sm">
                          {ORDER_NAMES[o]}
                        </span>
                        <span id={id(`pattern-${o}`)} className="shrink-0 font-mono text-[13px]">
                          {orderPattern(patternWidth, o)}
                        </span>
                        <span
                          id={id(`opreview-${o}`)}
                          data-testid={`order-preview-${o}`}
                          className="ml-auto min-w-0 max-w-full truncate text-right font-mono text-[13px] text-text-muted"
                        >
                          {optionPreview(format, o)}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <p className="text-xs text-text-muted">{ORDER_HELP}</p>
                </div>
              ) : null}
              <FormatPreview idPrefix={uid} base={base} preview={preview} notice={notice} />
            </div>
          </div>
        </div>
        <div
          data-testid="format-footer"
          className="flex shrink-0 flex-col gap-2 border-t border-border pt-3 [@media(max-height:479px)]:pt-2"
        >
          <div
            data-testid="format-message-area"
            className="flex max-h-[30vh] flex-col gap-2 overflow-y-auto empty:hidden"
          >
            {/* The polite region exists from the start, so what is written into it is announced. */}
            <div
              aria-live="polite"
              data-testid="format-messages"
              className="flex flex-col gap-2 empty:hidden"
            >
              {live.map((m) => (
                <Message key={m.key} id={id(`msg-${m.key}`)} kind={m.kind} lines={m.lines} />
              ))}
            </div>
            {tooMany ? (
              <div role="alert">
                <Message id={id("msg-many")} kind="error" lines={[tooMany]} />
              </div>
            ) : null}
            {error ? (
              <div role="alert" data-testid="format-error">
                <Message id={id("msg-error")} kind="error" lines={[error.text]} />
              </div>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              {...KEEP_FOCUS_ON_PRESS}
              onClick={cancel}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              aria-disabled={!applyEnabled || undefined}
              aria-busy={pending || undefined}
              aria-describedby={messageIds.length > 0 ? messageIds.join(" ") : undefined}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
              {...KEEP_FOCUS_ON_PRESS}
            >
              {pending ? "Applying…" : "Apply"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
