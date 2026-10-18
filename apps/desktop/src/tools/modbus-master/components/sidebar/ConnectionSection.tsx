import { RefreshCw } from "lucide-react";
import { useEffect, useId } from "react";
import { FormProvider, useWatch } from "react-hook-form";
import { Button } from "@/shared/ui/button";
import { FieldMessage } from "@/shared/ui/field-message";
import { Icon } from "@/shared/ui/icon";
import { Checkbox, Input, Label } from "@/shared/ui/input";
import { SegmentedControl } from "@/shared/ui/segmented";
import { connectionSummaryLine } from "../../store/connection.logic";
import {
  BAUD_RATES,
  connectionWarnings,
  DATA_BITS,
  PARITIES,
  STOP_BITS,
} from "../../validation/schemas";
import { useActions, useConnection, useRuntime, useSection, useSerialPorts } from "../context";
import { ControlledSelect, type SelectOption } from "../form/ControlledSelect";
import { describedBy, Field } from "../form/field";
import { attentionText, CONNECTION_FIELDS, useConnectionForm } from "./use-connection-form";

const PARITY_LABELS = { none: "None", even: "Even", odd: "Odd" } as const;
const notSupported = (value: string) => `${value} (not supported)`;

export const CONNECTION_READONLY_HINT = "Disconnect to change connection settings.";

/**
 * The sidebar CONNECTION section (DES-002 2.2.2): the DES-001 3.1 form, collapsible. Collapsed it is
 * one summary line with [Edit]; connecting and connected make the fields read-only. The form stays
 * mounted while collapsed so a draft is never lost.
 */
export function ConnectionSection() {
  const uid = useId();
  const runtime = useRuntime();
  const actions = useActions();
  const form = useConnectionForm();
  const { register, setValue } = form;
  const errors = form.formState.errors;
  const values = useWatch({ control: form.control });
  const mode = values.mode ?? "tcp";

  const expanded = useSection((s) => s.expanded);
  const focusRequest = useSection((s) => s.focusRequest);
  const state = useConnection((s) => s.state);
  const running = useConnection((s) => s.connection);
  const autoStart = useConnection((s) => s.autoStartPoll);
  const readOnly = state === "connecting" || state === "connected";

  const portsStatus = useSerialPorts((s) => s.status);
  const ports = useSerialPorts((s) => s.ports);
  const portsError = useSerialPorts((s) => s.error);

  // The port list is read the first time RTU is chosen.
  useEffect(() => {
    if (mode === "rtu" && runtime.stores.serialPorts.getState().status === "idle") {
      void runtime.stores.serialPorts.getState().refresh();
    }
  }, [mode, runtime]);

  // [Edit] and "Edit connection settings" expand the section and focus its first field. The effect
  // runs after the render that showed the fields.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new request moves the focus.
  useEffect(() => {
    if (focusRequest === 0) return;
    const names = CONNECTION_FIELDS[form.getValues("mode")];
    // The first field that shows a message, else the first field.
    form.setFocus(
      names.find((n) => form.getFieldState(n).error) ?? (names[0] as (typeof names)[number]),
    );
  }, [focusRequest]);

  const warnings = connectionWarnings({
    mode,
    dataBits: values.dataBits ?? "8",
    parity: values.parity ?? "even",
    stopBits: values.stopBits ?? "1",
  });

  const field = (name: keyof typeof errors) => ({
    id: `${uid}-${String(name)}`,
    error: errors[name]?.message as string | undefined,
  });
  const host = field("host");
  const port = field("port");
  const timeout = field("timeoutMs");
  const serial = field("serialPort");
  const baud = field("baud");
  const dataBits = field("dataBits");
  const parity = field("parity");
  const stopBits = field("stopBits");

  const currentPort = values.serialPort ?? "";
  const portsLoading = portsStatus === "loading";
  const noPorts = portsStatus === "ready" && ports.length === 0;
  // The current value is always an option (ControlledSelect adds it when it is not in the list),
  // so Refresh cannot change what the select shows without changing the form value.
  const serialOptions: SelectOption[] = [
    ...(currentPort === ""
      ? [
          {
            value: "",
            label: portsLoading
              ? "Loading ports…"
              : noPorts
                ? "No serial ports found"
                : "Select a serial port",
          },
        ]
      : []),
    ...(portsLoading
      ? []
      : ports.map((p) => ({
          value: p.name,
          label: p.description ? `${p.name} - ${p.description}` : p.name,
        }))),
  ];

  const attention = attentionText(Object.keys(errors).length);
  const summary = connectionSummaryLine(running ?? runtime.stores.draft.getState().connection);

  return (
    <section
      aria-labelledby={`${uid}-heading`}
      data-slot="connection-section"
      data-expanded={expanded ? "true" : "false"}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center justify-between">
        <h3
          id={`${uid}-heading`}
          className="text-xs font-semibold uppercase tracking-wide text-text-muted"
        >
          Connection
        </h3>
        <button
          type="button"
          aria-label={expanded ? "Collapse connection settings" : "Expand connection settings"}
          aria-expanded={expanded}
          onClick={() => runtime.stores.section.getState().toggle()}
          className="inline-flex size-6 items-center justify-center rounded-md outline-none hover:bg-neutral-tint focus-ring"
        >
          <Icon name={expanded ? "chevron-up" : "chevron-down"} />
        </button>
      </div>

      {expanded ? null : (
        <div className="flex items-center justify-between gap-2" data-testid="connection-summary">
          <span className="min-w-0 truncate font-mono text-xs">{summary}</span>
          <button
            type="button"
            onClick={() => runtime.stores.section.getState().edit()}
            className="shrink-0 rounded-md px-1 text-xs font-semibold underline outline-none focus-ring"
          >
            Edit
          </button>
        </div>
      )}

      {/* The form stays mounted while the section is collapsed, so nothing typed is lost. */}
      <div hidden={!expanded} className="flex flex-col gap-2">
        {attention ? (
          <p className="flex items-center gap-1.5 text-sm font-semibold" data-testid="attention">
            <Icon name="circle-x" tone="error" />
            {attention}
          </p>
        ) : null}
        <FormProvider {...form}>
          <form
            className="flex flex-col gap-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void actions.connect();
            }}
          >
            <div className="flex items-center gap-2">
              <span id={`${uid}-mode`} className="w-14 text-xs font-semibold">
                Mode
              </span>
              <SegmentedControl
                aria-label="Mode"
                value={mode}
                disabled={readOnly}
                onChange={(next) => setValue("mode", next, { shouldDirty: true })}
                options={[
                  { value: "tcp", label: "TCP" },
                  { value: "rtu", label: "RTU" },
                ]}
              />
            </div>

            {mode === "tcp" ? (
              <>
                <Field id={host.id} label="Host" error={host.error}>
                  <Input
                    id={host.id}
                    mono
                    autoComplete="off"
                    spellCheck={false}
                    readOnly={readOnly}
                    aria-invalid={host.error ? true : undefined}
                    aria-describedby={describedBy(host.id, { error: host.error })}
                    {...register("host")}
                  />
                </Field>
                <Field id={port.id} label="Port" error={port.error}>
                  <Input
                    id={port.id}
                    mono
                    inputMode="numeric"
                    readOnly={readOnly}
                    aria-invalid={port.error ? true : undefined}
                    aria-describedby={describedBy(port.id, { error: port.error })}
                    {...register("port")}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field id={serial.id} label="Serial port" error={serial.error}>
                  <div className="flex gap-2">
                    <ControlledSelect
                      name="serialPort"
                      id={serial.id}
                      disabled={readOnly || portsLoading || (noPorts && currentPort === "")}
                      invalid={Boolean(serial.error)}
                      describedBy={describedBy(serial.id, { error: serial.error })}
                      options={serialOptions}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={readOnly || portsLoading}
                      aria-label="Refresh serial ports"
                      onClick={() => void runtime.stores.serialPorts.getState().refresh()}
                    >
                      <RefreshCw
                        aria-hidden="true"
                        className={portsLoading ? "animate-spin" : ""}
                      />
                      Refresh
                    </Button>
                  </div>
                </Field>
                {portsLoading && currentPort !== "" ? (
                  <p className="text-xs text-text-muted">Loading ports…</p>
                ) : null}
                {noPorts ? (
                  <FieldMessage kind="warning" id={`${uid}-no-ports`}>
                    No serial ports found. Connect a device and press Refresh.
                  </FieldMessage>
                ) : null}
                {portsStatus === "error" ? (
                  <FieldMessage kind="error" id={`${uid}-ports-error`}>
                    Could not list serial ports: {portsError}
                  </FieldMessage>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <Field id={baud.id} label="Baud" error={baud.error}>
                    <ControlledSelect
                      name="baud"
                      id={baud.id}
                      disabled={readOnly}
                      invalid={Boolean(baud.error)}
                      describedBy={describedBy(baud.id, { error: baud.error })}
                      options={BAUD_RATES.map((b) => ({ value: String(b), label: String(b) }))}
                      unlistedLabel={notSupported}
                    />
                  </Field>
                  <Field id={dataBits.id} label="Data bits" error={dataBits.error}>
                    <ControlledSelect
                      name="dataBits"
                      id={dataBits.id}
                      disabled={readOnly}
                      invalid={Boolean(dataBits.error)}
                      describedBy={describedBy(dataBits.id, { error: dataBits.error })}
                      options={DATA_BITS.map((b) => ({ value: String(b), label: String(b) }))}
                      unlistedLabel={notSupported}
                    />
                  </Field>
                  <Field id={parity.id} label="Parity" error={parity.error}>
                    <ControlledSelect
                      name="parity"
                      id={parity.id}
                      disabled={readOnly}
                      invalid={Boolean(parity.error)}
                      describedBy={describedBy(parity.id, { error: parity.error })}
                      options={PARITIES.map((p) => ({ value: p, label: PARITY_LABELS[p] }))}
                      unlistedLabel={notSupported}
                    />
                  </Field>
                  <Field id={stopBits.id} label="Stop bits" error={stopBits.error}>
                    <ControlledSelect
                      name="stopBits"
                      id={stopBits.id}
                      disabled={readOnly}
                      invalid={Boolean(stopBits.error)}
                      describedBy={describedBy(stopBits.id, { error: stopBits.error })}
                      options={STOP_BITS.map((b) => ({ value: String(b), label: String(b) }))}
                      unlistedLabel={notSupported}
                    />
                  </Field>
                </div>
                {warnings.dataBits ? (
                  <FieldMessage kind="warning" id={`${uid}-warn-databits`}>
                    {warnings.dataBits}
                  </FieldMessage>
                ) : null}
                {warnings.stopBits ? (
                  <FieldMessage kind="warning" id={`${uid}-warn-stopbits`}>
                    {warnings.stopBits}
                  </FieldMessage>
                ) : null}
              </>
            )}

            <Field id={timeout.id} label="Timeout (ms)" error={timeout.error}>
              <Input
                id={timeout.id}
                mono
                inputMode="numeric"
                readOnly={readOnly}
                aria-invalid={timeout.error ? true : undefined}
                aria-describedby={describedBy(timeout.id, { error: timeout.error })}
                {...register("timeoutMs")}
              />
            </Field>

            <div className="flex items-center gap-2">
              <Checkbox
                id={`${uid}-auto`}
                checked={autoStart}
                onChange={(e) =>
                  void runtime.stores.connection.getState().setAutoStartPoll(e.target.checked)
                }
              />
              <Label htmlFor={`${uid}-auto`} className="font-normal">
                Start polling when connected
              </Label>
            </div>

            {readOnly ? (
              <p className="text-xs text-text-muted">{CONNECTION_READONLY_HINT}</p>
            ) : null}
            {/* Enter in a field submits the form; the visible Connect button lives in the toolbar. */}
            <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
          </form>
        </FormProvider>
      </div>
    </section>
  );
}
