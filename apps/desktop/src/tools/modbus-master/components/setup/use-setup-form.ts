import { useEffect, useRef } from "react";
import { type FieldErrors, type Resolver, type UseFormReturn, useForm } from "react-hook-form";
import type { AddressBase } from "@/shared/ipc/modbus-master.types";
import { connectionToForm, pollToForm } from "../../validation/forms";
import {
  type ConnectionFormValues,
  connectionSchema,
  type PollFormValues,
  pollSchema,
  validate,
  wholeNumber,
} from "../../validation/schemas";
import { useRuntime } from "../context";

export type SetupFormValues = ConnectionFormValues & PollFormValues & { autoStart: boolean };

export const CONNECTION_FIELDS = {
  tcp: ["host", "port", "timeoutMs"],
  rtu: ["serialPort", "baud", "dataBits", "parity", "stopBits", "timeoutMs"],
} as const;

export const POLL_FIELDS = [
  "slaveId",
  "function",
  "startAddress",
  "quantity",
  "scanRateMs",
] as const;

type FieldName = keyof SetupFormValues;

/** One resolver for the whole setup form: the connection schema plus the poll schema. */
export function setupResolver(getBase: () => AddressBase): Resolver<SetupFormValues> {
  return async (values) => {
    const connection = validate(connectionSchema, values);
    const poll = validate(pollSchema(values.mode, getBase()), values);
    const messages = {
      ...(connection.ok ? {} : connection.errors),
      ...(poll.ok ? {} : poll.errors),
    };
    const errors: FieldErrors<SetupFormValues> = {};
    for (const [name, message] of Object.entries(messages)) {
      (errors as Record<string, unknown>)[name] = { type: "validate", message };
    }
    return Object.keys(messages).length === 0 ? { values, errors: {} } : { values: {}, errors };
  };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The react-hook-form instance of the setup panel (connection and poll fields).
 * - form -> config store: every valid draft is pushed into the store (dirty tracking, profiles);
 * - config store -> form: a profile load or a base change updates the fields;
 * - registers itself as the controller's `FormGateway` so Connect / Start / Apply validate the drafts.
 */
export function useSetupForm(): UseFormReturn<SetupFormValues> {
  const runtime = useRuntime();
  const { config, setupStatus, layout } = runtime.stores;
  const initial = config.getState();
  const baseRef = useRef<AddressBase>(initial.display.addressBase);

  const form = useForm<SetupFormValues>({
    mode: "onTouched",
    reValidateMode: "onChange",
    resolver: setupResolver(() => baseRef.current),
    defaultValues: {
      ...connectionToForm(initial.connection),
      ...pollToForm(initial.poll, initial.display.addressBase),
      autoStart: initial.autoStartPoll,
    },
  });

  // form -> store
  useEffect(() => {
    const sync = () => {
      const values = form.getValues();
      const cfg = config.getState();
      const conn = validate(connectionSchema, values);
      const poll = validate(pollSchema(values.mode, cfg.display.addressBase), values);
      setupStatus.getState().update({ connectionInvalid: !conn.ok, pollInvalid: !poll.ok });
      if (conn.ok && !sameJson(conn.value, cfg.connection)) cfg.setConnection(conn.value);
      if (poll.ok && !sameJson(poll.value, cfg.poll)) cfg.setPoll(poll.value);
      if (values.autoStart !== cfg.autoStartPoll) cfg.setAutoStart(values.autoStart);
    };
    sync();
    const subscription = form.watch(sync);
    return () => subscription.unsubscribe();
  }, [form, config, setupStatus]);

  // store -> form
  useEffect(() => {
    return config.subscribe((state, prev) => {
      const oldBase = prev.display.addressBase;
      const newBase = state.display.addressBase;
      baseRef.current = newBase;
      if (oldBase !== newBase) {
        // Same protocol address, new display number. Only a valid number can be converted.
        const n = wholeNumber(form.getValues("startAddress"));
        if (n !== null) form.setValue("startAddress", String(n + (newBase - oldBase)));
        const hasError =
          form.getFieldState("startAddress").error || form.getFieldState("quantity").error;
        if (hasError) void form.trigger(["startAddress", "quantity"]);
      }

      const values = form.getValues();
      if (state.connection !== prev.connection) {
        const current = validate(connectionSchema, values);
        if (!current.ok || !sameJson(current.value, state.connection)) {
          form.reset({ ...values, ...connectionToForm(state.connection, values) });
        }
      }
      if (state.poll !== prev.poll || oldBase !== newBase) {
        const current = validate(pollSchema(values.mode, newBase), form.getValues());
        if (!current.ok || !sameJson(current.value, state.poll)) {
          form.reset({ ...form.getValues(), ...pollToForm(state.poll, newBase) });
        }
      }
      if (state.autoStartPoll !== prev.autoStartPoll) {
        form.setValue("autoStart", state.autoStartPoll);
      }
    });
  }, [form, config]);

  // The controller validates through the form.
  useEffect(() => {
    const validateFields = async (names: readonly FieldName[]) =>
      form.trigger([...names] as FieldName[], { shouldFocus: true });
    const pollOf = () => {
      const values = form.getValues();
      const result = validate(
        pollSchema(values.mode, config.getState().display.addressBase),
        values,
      );
      return result.ok ? result.value : null;
    };
    runtime.gateway.current = {
      async validateConnection() {
        const mode = form.getValues("mode");
        if (!(await validateFields(CONNECTION_FIELDS[mode]))) return null;
        const result = validate(connectionSchema, form.getValues());
        return result.ok ? result.value : null;
      },
      async validatePoll() {
        if (!(await validateFields(POLL_FIELDS))) return null;
        return pollOf();
      },
      peekPoll: pollOf,
      async validateAll() {
        const mode = form.getValues("mode");
        // One trigger for both sections, so every message shows and focus goes to the first one.
        if (!(await validateFields([...CONNECTION_FIELDS[mode], ...POLL_FIELDS]))) return null;
        const values = form.getValues();
        const connection = validate(connectionSchema, values);
        const poll = pollOf();
        return connection.ok && poll ? { connection: connection.value, poll } : null;
      },
      async revalidate() {
        // No focus change: a loaded profile with a bad value just shows it (DES-001 3.1).
        await form.trigger();
      },
      showFieldError(field, message) {
        const mode = form.getValues("mode");
        const names: Record<string, FieldName> = {
          host: "host",
          port: mode === "rtu" ? "serialPort" : "port",
          timeoutMs: "timeoutMs",
          baud: "baud",
          dataBits: "dataBits",
          stopBits: "stopBits",
          slaveId: "slaveId",
          function: "function",
          quantity: "quantity",
          scanRateMs: "scanRateMs",
        };
        const name = names[field];
        if (!name) return false;
        if (!layout.getState().setupOpen) layout.getState().toggleSetup();
        form.setError(name, { type: "server", message }, { shouldFocus: true });
        return true;
      },
    };
    return () => runtime.gateway.restore();
  }, [form, runtime.gateway, config, layout]);

  return form;
}
