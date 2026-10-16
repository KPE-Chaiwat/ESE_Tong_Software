import { useEffect } from "react";
import { FormProvider } from "react-hook-form";
import { Icon } from "@/shared/ui/icon";
import { attentionText } from "../../store/setup-status.store";
import { useLayout, useSetupStatus } from "../context";
import { ConnectionSection } from "./ConnectionSection";
import { PollSection } from "./PollSection";
import { useSetupForm } from "./use-setup-form";

/**
 * Collapsible setup card (Ctrl+\). It stays mounted when hidden so the drafts are not lost.
 * Width 320px (DES-001 S1).
 */
export function SetupPanel() {
  const form = useSetupForm();
  const open = useLayout((s) => s.setupOpen);
  const attention = useSetupStatus((s) => s.attentionCount);
  const { errors } = form.formState;
  const errorNames = Object.keys(errors);
  const errorCount = errorNames.length;

  // Tell the rest of the window how many fields show an error.
  const setupStatus = useSetupStatus((s) => s.update);
  useEffect(() => {
    setupStatus({ attentionCount: errorCount });
  }, [errorCount, setupStatus]);

  // Showing the panel again moves focus to the first invalid field.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the errors are read only when the panel opens.
  useEffect(() => {
    const first = errorNames[0];
    if (open && first) form.setFocus(first as Parameters<typeof form.setFocus>[0]);
  }, [open]);

  const text = attentionText(attention);

  return (
    <aside
      aria-label="Setup"
      hidden={!open}
      className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto rounded-lg border bg-card p-3"
    >
      {text ? (
        <p className="flex items-center gap-1.5 text-sm font-semibold" data-testid="attention">
          <Icon name="circle-x" tone="error" />
          {text}
        </p>
      ) : null}
      <FormProvider {...form}>
        <ConnectionSection />
        <PollSection />
      </FormProvider>
    </aside>
  );
}
