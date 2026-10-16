import { useId } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Button } from "@/shared/ui/button";
import { Checkbox, Input, Label, Select } from "@/shared/ui/input";
import { toProtocolAddress } from "../../lib/address";
import { QUANTITY_LIMITS, READ_FUNCTION_LABELS, READ_FUNCTIONS } from "../../lib/functions";
import { wholeNumber } from "../../validation/schemas";
import { useConfig, useController, useSession } from "../context";
import { describedBy, Field } from "./field";
import type { SetupFormValues } from "./use-setup-form";

/** DES-001 S1 "Poll": slave, function, start address, quantity, scan rate, auto start and Apply. */
export function PollSection() {
  const uid = useId();
  const controller = useController();
  const form = useFormContext<SetupFormValues>();
  const {
    register,
    formState: { errors },
  } = form;
  const values = useWatch({ control: form.control });
  const base = useConfig((s) => s.display.addressBase);
  const state = useSession((s) => s.state);
  const readOnly = state === "connecting";

  const id = (name: string) => `${uid}-${name}`;
  const error = (name: keyof SetupFormValues) => errors[name]?.message as string | undefined;

  const fc = Number(values.function ?? "3");
  const maxQuantity = QUANTITY_LIMITS[(fc >= 1 && fc <= 4 ? fc : 3) as 1 | 2 | 3 | 4];
  const start = wholeNumber(values.startAddress ?? "");
  const protocolAddress = start === null ? null : toProtocolAddress(start, base);

  return (
    <section aria-labelledby={id("heading")} className="flex flex-col gap-2">
      <h3 id={id("heading")} className="text-base font-semibold">
        Poll
      </h3>
      <form
        className="flex flex-col gap-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void controller.applyPoll();
        }}
      >
        <Field id={id("slaveId")} label="Slave ID" error={error("slaveId")}>
          <Input
            id={id("slaveId")}
            mono
            inputMode="numeric"
            readOnly={readOnly}
            aria-invalid={error("slaveId") ? true : undefined}
            aria-describedby={describedBy(id("slaveId"), { error: error("slaveId") })}
            {...register("slaveId")}
          />
        </Field>

        <Field id={id("function")} label="Function" error={error("function")}>
          <Select id={id("function")} disabled={readOnly} {...register("function")}>
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
          error={error("startAddress")}
          helper={protocolAddress === null ? undefined : `Protocol address ${protocolAddress}`}
        >
          <Input
            id={id("startAddress")}
            mono
            inputMode="numeric"
            readOnly={readOnly}
            aria-invalid={error("startAddress") ? true : undefined}
            aria-describedby={describedBy(id("startAddress"), {
              error: error("startAddress"),
              helper: protocolAddress,
            })}
            {...register("startAddress")}
          />
        </Field>

        <Field
          id={id("quantity")}
          label="Quantity"
          error={error("quantity")}
          helper={`1-${maxQuantity}`}
        >
          <Input
            id={id("quantity")}
            mono
            inputMode="numeric"
            readOnly={readOnly}
            aria-invalid={error("quantity") ? true : undefined}
            aria-describedby={describedBy(id("quantity"), {
              error: error("quantity"),
              helper: true,
            })}
            {...register("quantity")}
          />
        </Field>

        <Field id={id("scanRateMs")} label="Scan rate (ms)" error={error("scanRateMs")}>
          <Input
            id={id("scanRateMs")}
            mono
            inputMode="numeric"
            readOnly={readOnly}
            aria-invalid={error("scanRateMs") ? true : undefined}
            aria-describedby={describedBy(id("scanRateMs"), { error: error("scanRateMs") })}
            {...register("scanRateMs")}
          />
        </Field>

        <div className="flex items-center gap-2">
          <Checkbox id={id("autoStart")} disabled={readOnly} {...register("autoStart")} />
          <Label htmlFor={id("autoStart")} className="text-sm font-normal">
            Start polling when connected
          </Label>
        </div>

        <div>
          <Button type="submit" size="sm" variant="outline" disabled={readOnly}>
            Apply
          </Button>
        </div>
      </form>
    </section>
  );
}
