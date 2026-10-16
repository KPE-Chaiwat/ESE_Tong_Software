import { useEffect, useId, useRef } from "react";
import type { WriteFunction } from "@/shared/ipc/modbus-master.types";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { FieldMessage } from "@/shared/ui/field-message";
import { Icon } from "@/shared/ui/icon";
import { Input, Label, Select, Textarea } from "@/shared/ui/input";
import { SegmentedControl } from "@/shared/ui/segmented";
import { toProtocolAddress } from "../../lib/address";
import { VALUE_FORMAT_LABELS, VALUE_FORMATS } from "../../lib/format";
import { WRITE_FUNCTION_LABELS, WRITE_FUNCTIONS } from "../../lib/functions";
import { splitValues } from "../../lib/parse";
import { actionsFor, isLinkUp, reasonText } from "../../store/session.logic";
import {
  describeWriteResult,
  LINK_LOST_VIEW,
  NOT_CONNECTED_VIEW,
  SENDING_VIEW,
  validateDraft,
  visibleErrors,
  type WriteResultView,
} from "../../store/write.logic";
import { wholeNumber, writeWarnings } from "../../validation/schemas";
import {
  useConfig,
  useModalLock,
  useRunningSetup,
  useRuntime,
  useSession,
  useWrite,
} from "../context";
import { describedBy } from "../setup/field";

const TONE_STYLES: Record<WriteResultView["tone"], string> = {
  sending: "text-foreground",
  success: "border border-dark/15 bg-success text-dark",
  outline: "border border-dark/25 text-foreground",
  error: "border-[1.5px] border-error bg-error-tint text-foreground",
  warning: "border border-dark/15 bg-warning text-dark",
};

/** S2 Write dialog (DES-001): function, address, value(s), result area. Stays open after a send. */
export function WriteDialog() {
  const uid = useId();
  const runtime = useRuntime();
  const write = runtime.stores.write;
  const open = useWrite((s) => s.open);
  const draft = useWrite((s) => s.draft);
  const status = useWrite((s) => s.status);
  const result = useWrite((s) => s.result);
  const request = useWrite((s) => s.request);
  const requestBase = useWrite((s) => s.requestBase);
  const ipcError = useWrite((s) => s.ipcError);
  const submitted = useWrite((s) => s.submitted);
  const touched = useWrite((s) => s.touched);
  const base = useConfig((s) => s.display.addressBase);
  // The connection the session has: its mode decides about broadcast, its timeout is in the text.
  const { connection } = useRunningSetup();
  const { mode, timeoutMs } = connection;
  const ipcErrorField = useWrite((s) => s.ipcErrorField);
  const state = useSession((s) => s.state);
  const linkUp = isLinkUp(state);
  useModalLock(open);

  const fn = Number(draft.function) as WriteFunction;
  const validation = validateDraft(draft, base);
  const allErrors = visibleErrors(validation.ok ? {} : validation.errors, fn);
  const shownErrors = Object.fromEntries(
    Object.entries(allErrors).filter(([name]) => submitted || touched[name]),
  ) as Record<string, string>;
  const warnings = writeWarnings(draft, mode);

  const id = (name: string) => `${uid}-${name}`;
  const update = write.getState().updateDraft;
  const touch = (name: string) => () => write.getState().touch(name);

  const startNumber = wholeNumber(draft.address);
  const protocol = startNumber === null ? null : toProtocolAddress(startNumber, base);
  const items = splitValues(draft.valuesText);
  const listFunction = fn === 15 || fn === 16;
  const lastAddress =
    listFunction && startNumber !== null && items.length > 0
      ? startNumber + items.length - 1
      : null;

  // A backend `validation` rejection names the input: move the focus there.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new field name moves the focus.
  useEffect(() => {
    if (!ipcErrorField) return;
    const target =
      ipcErrorField === "values"
        ? fn === 6
          ? "value"
          : "values"
        : ipcErrorField === "slaveId" || ipcErrorField === "function"
          ? ipcErrorField
          : "address";
    document.getElementById(`${uid}-${target}`)?.focus();
  }, [ipcErrorField]);

  const reason = useSession((s) => s.reason);
  const sessionPending = useSession((s) => s.pending);
  const sendRef = useRef<HTMLButtonElement>(null);
  const reconnectRef = useRef<HTMLButtonElement>(null);

  let view: WriteResultView | null = null;
  const linkLost = result?.status === "linkLost";
  // The [Reconnect] button belongs to link lost and to a failed reconnect, never to "Not connected".
  const reconnectPending = linkLost && (state === "connecting" || sessionPending === "connect");
  if (linkLost) {
    // Stays until the next Send or until the dialog closes; when the link is back the runtime
    // empties it (DES 2.5). It outranks "Not connected" because the write was transmitted.
    view =
      state === "disconnected" && reason?.phase === "connectFailed"
        ? { ...LINK_LOST_VIEW, text: `Reconnect failed: ${reasonText(reason, connection)}` }
        : LINK_LOST_VIEW;
  } else if (!linkUp) view = NOT_CONNECTED_VIEW;
  else if (status === "sending") view = SENDING_VIEW;
  else if (ipcError) {
    view = { tone: "error", icon: "circle-x", text: `Could not send the write: ${ipcError}` };
  } else if (result) {
    view = describeWriteResult(result, { request, base: requestBase, timeoutMs });
  }

  // Back in L*: the result and the button are gone, and Send takes the focus (DES-001 2.5).
  const hadLinkLost = useRef(false);
  useEffect(() => {
    if (hadLinkLost.current && !linkLost && linkUp && open) sendRef.current?.focus();
    hadLinkLost.current = linkLost;
  }, [linkLost, linkUp, open]);

  // A failed reconnect leaves the focus on [Reconnect], also after it was re-enabled.
  const wasReconnecting = useRef(false);
  useEffect(() => {
    if (wasReconnecting.current && !reconnectPending && linkLost) reconnectRef.current?.focus();
    wasReconnecting.current = reconnectPending;
  }, [reconnectPending, linkLost]);

  const canReconnect = actionsFor(state).connect && sessionPending === null;
  const reconnect = () => {
    if (canReconnect) void runtime.controller.connect();
  };

  const sendDisabled = !linkUp || status === "sending";
  const send = () => {
    if (!sendDisabled) void write.getState().send();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) write.getState().close();
      }}
      title="Write"
      widthClass="w-[480px]"
      initialFocus="[data-autofocus]"
    >
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div>
          <Label htmlFor={id("function")}>Function</Label>
          <div className="mt-1">
            <Select
              id={id("function")}
              data-autofocus=""
              value={draft.function}
              onChange={(e) => update({ function: e.target.value })}
            >
              {WRITE_FUNCTIONS.map((f) => (
                <option key={f} value={String(f)}>
                  {WRITE_FUNCTION_LABELS[f]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-[6rem_1fr] gap-3">
          <div>
            <Label htmlFor={id("slaveId")}>Slave ID</Label>
            <div className="mt-1">
              <Input
                id={id("slaveId")}
                mono
                inputMode="numeric"
                value={draft.slaveId}
                aria-invalid={shownErrors.slaveId ? true : undefined}
                aria-describedby={describedBy(id("slaveId"), {
                  error: shownErrors.slaveId,
                  warning: warnings.slaveId,
                })}
                onChange={(e) => update({ slaveId: e.target.value })}
                onBlur={touch("slaveId")}
              />
            </div>
          </div>
          <div>
            <Label htmlFor={id("address")}>Start address</Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                id={id("address")}
                mono
                inputMode="numeric"
                value={draft.address}
                aria-invalid={shownErrors.address ? true : undefined}
                aria-describedby={describedBy(id("address"), { error: shownErrors.address })}
                onChange={(e) => update({ address: e.target.value })}
                onBlur={touch("address")}
              />
              {protocol !== null ? (
                <span className="whitespace-nowrap text-xs text-text-muted">
                  (protocol address {protocol})
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {shownErrors.slaveId ? (
          <FieldMessage kind="error" id={id("slaveId-error")}>
            {shownErrors.slaveId}
          </FieldMessage>
        ) : null}
        {shownErrors.address ? (
          <FieldMessage kind="error" id={id("address-error")}>
            {shownErrors.address}
          </FieldMessage>
        ) : null}
        {warnings.slaveId ? (
          <FieldMessage kind="warning" id={id("slaveId-warning")}>
            {warnings.slaveId}
          </FieldMessage>
        ) : null}

        {fn === 6 || fn === 16 ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold">Value format</span>
            <SegmentedControl
              aria-label="Value format"
              value={draft.valueFormat}
              onChange={(valueFormat) => update({ valueFormat })}
              options={VALUE_FORMATS.map((f) => ({ value: f, label: VALUE_FORMAT_LABELS[f] }))}
            />
          </div>
        ) : null}

        {fn === 5 ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold">Value</span>
            <SegmentedControl
              aria-label="Coil value"
              value={draft.coil ? "on" : "off"}
              onChange={(v) => update({ coil: v === "on" })}
              options={[
                { value: "on", label: "ON" },
                { value: "off", label: "OFF" },
              ]}
            />
          </div>
        ) : null}

        {fn === 6 ? (
          <div>
            <Label htmlFor={id("value")}>Value</Label>
            <div className="mt-1">
              <Input
                id={id("value")}
                mono
                value={draft.valueText}
                aria-invalid={shownErrors.valueText ? true : undefined}
                aria-describedby={describedBy(id("value"), { error: shownErrors.valueText })}
                onChange={(e) => update({ valueText: e.target.value })}
                onBlur={touch("valueText")}
              />
            </div>
            {shownErrors.valueText ? (
              <FieldMessage kind="error" id={id("value-error")} className="mt-1">
                {shownErrors.valueText}
              </FieldMessage>
            ) : null}
          </div>
        ) : null}

        {listFunction ? (
          <div>
            <Label htmlFor={id("values")}>Values ({items.length})</Label>
            <div className="mt-1">
              <Textarea
                id={id("values")}
                mono
                rows={4}
                value={draft.valuesText}
                aria-invalid={shownErrors.valuesText ? true : undefined}
                aria-describedby={describedBy(id("values"), {
                  error: shownErrors.valuesText,
                  helper: true,
                })}
                onChange={(e) => update({ valuesText: e.target.value })}
                onBlur={touch("valuesText")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
            </div>
            <p id={id("values-helper")} className="mt-1 text-xs text-text-muted">
              {fn === 15
                ? "Enter 0 or 1. Separate values with spaces, commas, tabs or new lines."
                : "Separate values with spaces, commas, tabs or new lines."}
            </p>
            {lastAddress !== null ? (
              <p className="text-xs text-text-muted">
                Writes addresses {startNumber}-{lastAddress}.
              </p>
            ) : null}
            {shownErrors.valuesText ? (
              <FieldMessage kind="error" id={id("values-error")} className="mt-1">
                {shownErrors.valuesText}
              </FieldMessage>
            ) : null}
          </div>
        ) : null}

        <div
          aria-live="polite"
          data-testid="write-result"
          className="flex min-h-10 items-center justify-between gap-2"
        >
          {view ? (
            <p
              className={cn(
                "inline-flex min-w-0 items-center gap-2 rounded-lg px-3 py-1 text-sm",
                TONE_STYLES[view.tone],
              )}
            >
              <Icon name={view.icon} tone={view.tone === "error" ? "error" : "default"} />
              <span>{view.text}</span>
            </p>
          ) : null}
          {linkLost ? (
            <Button
              ref={reconnectRef}
              type="button"
              size="sm"
              variant="outline"
              // aria-disabled, not disabled: a disabled button would drop the focus it has.
              aria-disabled={reconnectPending || !canReconnect}
              title="Reconnect (same as the banner)"
              className="shrink-0 aria-disabled:opacity-50"
              onClick={reconnect}
            >
              {reconnectPending ? <Icon name="loader" /> : null}
              Reconnect
            </Button>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => write.getState().close()}>
            Close
          </Button>
          <Button ref={sendRef} type="submit" disabled={sendDisabled}>
            Send
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
