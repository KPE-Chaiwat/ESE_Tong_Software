import { useEffect } from "react";
import { type FieldErrors, type Resolver, type UseFormReturn, useForm } from "react-hook-form";
import { connectionToForm } from "../../validation/forms";
import { type ConnectionFormValues, connectionSchema, validate } from "../../validation/schemas";
import { useRuntime } from "../context";

export const CONNECTION_FIELDS = {
  tcp: ["host", "port", "timeoutMs"],
  rtu: ["serialPort", "baud", "dataBits", "parity", "stopBits", "timeoutMs"],
} as const;

type FieldName = keyof ConnectionFormValues;

/** "1 field needs attention" / "{n} fields need attention", or null when there is nothing to show. */
export function attentionText(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 field needs attention" : `${count} fields need attention`;
}

export const connectionResolver: Resolver<ConnectionFormValues> = async (values) => {
  const result = validate(connectionSchema, values);
  if (result.ok) return { values, errors: {} };
  const errors: FieldErrors<ConnectionFormValues> = {};
  for (const [name, message] of Object.entries(result.errors)) {
    (errors as Record<string, unknown>)[name] = { type: "validate", message };
  }
  return { values: {}, errors };
};

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The react-hook-form instance of the CONNECTION section:
 * - form -> draft store: every valid draft is pushed into it;
 * - draft store -> form: a connection that came from Rust (a reload, a profile) fills the fields;
 * - registers itself as the runtime's form gateway, so Connect validates through the form, shows
 *   the messages and focuses the first invalid field.
 */
export function useConnectionForm(): UseFormReturn<ConnectionFormValues> {
  const runtime = useRuntime();
  const { draft, section } = runtime.stores;

  const form = useForm<ConnectionFormValues>({
    mode: "onTouched",
    reValidateMode: "onChange",
    resolver: connectionResolver,
    defaultValues: connectionToForm(draft.getState().connection),
  });

  // form -> store
  useEffect(() => {
    const sync = () => {
      const result = validate(connectionSchema, form.getValues());
      if (result.ok && !sameJson(result.value, draft.getState().connection)) {
        draft.getState().setConnection(result.value);
      }
    };
    sync();
    const subscription = form.watch(sync);
    return () => subscription.unsubscribe();
  }, [form, draft]);

  // store -> form
  useEffect(() => {
    return draft.subscribe((state, prev) => {
      if (state.connection === prev.connection) return;
      const values = form.getValues();
      const current = validate(connectionSchema, values);
      if (!current.ok || !sameJson(current.value, state.connection)) {
        form.reset({ ...values, ...connectionToForm(state.connection, values) });
      }
    });
  }, [form, draft]);

  // The runtime validates through the form.
  useEffect(() => {
    runtime.form.current = {
      async validate() {
        const mode = form.getValues("mode");
        const names = [...CONNECTION_FIELDS[mode]] as FieldName[];
        if (!(await form.trigger(names, { shouldFocus: true }))) return null;
        const result = validate(connectionSchema, form.getValues());
        return result.ok ? result.value : null;
      },
      adopt(config) {
        form.reset(connectionToForm(config, form.getValues()));
        draft.getState().setConnection(config);
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
          parity: "parity",
        };
        const name = names[field];
        if (!name) return false;
        section.getState().expand();
        form.setError(name, { type: "server", message }, { shouldFocus: true });
        return true;
      },
    };
    return () => runtime.form.restore();
  }, [form, runtime.form, draft, section]);

  return form;
}
