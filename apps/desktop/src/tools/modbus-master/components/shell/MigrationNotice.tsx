import { StateBanner } from "@/shared/ui/state-banner";
import { MIGRATION_NOTICE } from "../../store/profile.logic";
import { useProfileInfo, useRuntime } from "../context";

/**
 * The neutral notice of a profile that was saved by an earlier version (DES-002 6.2): its poll is
 * now "Poll 1", and saving stores the new format. It is not an error and does not mark the profile
 * modified; [Dismiss] hides it, and so does the next save or load.
 */
export function MigrationNotice() {
  const runtime = useRuntime();
  const migrated = useProfileInfo((s) => s.migrated);
  if (!migrated) return null;
  return (
    <StateBanner
      variant="neutral"
      icon="info"
      actions={[
        {
          id: "dismiss-notice",
          label: "Dismiss",
          onClick: () => runtime.profileFlow.dismissMigrationNotice(),
        },
      ]}
    >
      {MIGRATION_NOTICE}
    </StateBanner>
  );
}
