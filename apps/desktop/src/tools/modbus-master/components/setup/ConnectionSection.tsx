import { RefreshCw } from "lucide-react";
import { useEffect, useId } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Button } from "@/shared/ui/button";
import { FieldMessage } from "@/shared/ui/field-message";
import { Input } from "@/shared/ui/input";
import { SegmentedControl } from "@/shared/ui/segmented";
import { isLinkUp } from "../../store/session.logic";
import {
  BAUD_RATES,
  connectionWarnings,
  DATA_BITS,
  PARITIES,
  STOP_BITS,
} from "../../validation/schemas";
import { useController, useRuntime, useSerialPorts, useSession } from "../context";
import { ControlledSelect, type SelectOption } from "./ControlledSelect";
import { describedBy, Field } from "./field";
import type { SetupFormValues } from "./use-setup-form";

const PARITY_LABELS = { none: "None", even: "Even", odd: "Odd" } as const;

const notSupported = (value: string) => `${value} (not supported)`;

export const CONNECTION_READONLY_HINT = "Disconnect to change connection settings.";

/** DES-001 S1 "Connection": TCP host and port, or the RTU serial settings, plus the timeout. */
export function ConnectionSection() {
  const uid = useId();
  const controller = useController();
  const runtime = useRuntime();
  const form = useFormContext<SetupFormValues>();
  const {
    register,
    setValue,
    formState: { errors },
  } = form;
  const values = useWatch({ control: form.control });
  const mode = values.mode ?? "tcp";
  const state = useSession((s) => s.state);
  const readOnly = state === "connecting" || isLinkUp(state);

  const portsStatus = useSerialPorts((s) => s.status);
  const ports = useSerialPorts((s) => s.ports);
  const portsError = useSerialPorts((s) => s.error);

  // The port list is read the first time RTU is chosen.
  useEffect(() => {
    if (mode === "rtu" && runtime.stores.serialPorts.getState().status === "idle") {
      void runtime.stores.serialPorts.getState().refresh();
    }
  }, [mode, runtime]);

  const warnings = connectionWarnings({
    mode,
    dataBits: values.dataBits ?? "8",
    parity: values.parity ?? "even",
    stopBits: values.stopBits ?? "1",
  });

  const field = (name: keyof SetupFormValues) => {
    const id = `${uid}-${name}`;
    const error = errors[name]?.message as string | undefined;
    return { id, error };
  };

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

  return (
    <section aria-labelledby={`${uid}-heading`} className="flex flex-col gap-2">
      <h3 id={`${uid}-heading`} className="text-base font-semibold">
        Connection
      </h3>
      <form
        className="flex flex-col gap-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void controller.connect();
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
                  <RefreshCw aria-hidden="true" className={portsLoading ? "animate-spin" : ""} />
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
              <div className="flex items-center gap-2">
                <FieldMessage kind="error" id={`${uid}-ports-error`}>
                  Could not list serial ports: {portsError}
                </FieldMessage>
              </div>
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

        {readOnly ? <p className="text-xs text-text-muted">{CONNECTION_READONLY_HINT}</p> : null}
        {/* Enter in a field submits the form; the visible Connect button lives in the toolbar. */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </section>
  );
}
