// Pure rules of the profile flow (DES-001 S3-S5 and 3.5, DES-002 6): what marks a profile modified,
// the texts of the confirms and the migration notice. No React, no IPC.
import type { ConnectionConfig, PollConfig } from "@/shared/ipc/modbus-master.types";
import { transportSummary } from "./connection.logic";

export const MIGRATION_NOTICE =
  'This profile was saved by an earlier version. Its poll is now "Poll 1". Saving stores it in the new format, which earlier versions cannot open.';
export const FIX_FIELDS_TOAST = "Fix the highlighted fields before saving.";
export const UNREADABLE_PROFILE = "Cannot be opened (newer or damaged file)";

export interface ProfileContent {
  connection: ConnectionConfig;
  autoStartPoll: boolean;
  polls: readonly PollConfig[];
}

/**
 * The saved content of a window as a string. Polls are keyed by their id and sorted by it, so the
 * list order does not matter. Left out on purpose (DES-002 6.1): `active` (Pause and Resume), the
 * hosts and rectangles, the order, the workspace settings, the traffic filter.
 */
export function contentSignature(c: ProfileContent): string {
  return JSON.stringify({
    connection: c.connection,
    autoStartPoll: c.autoStartPoll,
    polls: [...c.polls]
      .sort((a, b) => a.pollId - b.pollId)
      .map((p) => ({
        id: p.pollId,
        name: p.name,
        definition: p.definition,
        display: p.display,
        scale: p.scale,
        scaleOverrides: p.scaleOverrides,
        valueColumns: p.valueColumns,
        aliases: p.aliases,
      })),
  });
}

/** True when two lists hold the same config objects, so the signature need not be computed again. */
export function sameConfigs(a: readonly PollConfig[], b: readonly PollConfig[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

export const SAVE_CHANGES_TITLE = "Save changes?";

export interface SaveChangesInput {
  /** The profile name, null for an unnamed setup. */
  profileName: string | null;
  /** Polls in their own windows: they close with W1, or with the setup that is replaced by a load. */
  nativeWindowCount: number;
  /** Polls with unapplied setup edits in any host, in list order. */
  unappliedPollNames: readonly string[];
  /** What happens next: the window closes, or another profile is loaded (REPORT-006 O7). */
  reason: "close" | "load";
}

/** "Save changes?" body (DES-002 2.11, 6.3): the question plus the sentences that apply. */
export function saveChangesBody(input: SaveChangesInput): string {
  const when = input.reason === "close" ? "closing" : "loading";
  const parts = [
    input.profileName === null
      ? `Save this setup as a profile before ${when}?`
      : `Save changes to "${input.profileName}" before ${when}?`,
  ];
  if (input.nativeWindowCount > 0) {
    parts.push(
      `This also closes ${input.nativeWindowCount === 1 ? "1 poll window" : `${input.nativeWindowCount} poll windows`}.`,
    );
  }
  if (input.unappliedPollNames.length > 0) {
    parts.push(`Unapplied edits in: ${input.unappliedPollNames.join(", ")}.`);
  }
  return parts.join(" ");
}

export const DISCONNECT_AND_LOAD_TITLE = "Disconnect and load?";

export function disconnectAndLoadBody(
  profile: string,
  connection: ConnectionConfig | null,
): string {
  const target = connection ? transportSummary(connection) : "the device";
  return `Loading "${profile}" will disconnect from ${target}.`;
}

export const REPLACE_TITLE = "Replace profile?";
export const replaceBody = (name: string) =>
  `A profile named "${name}" already exists. Replace it?`;
export const DELETE_PROFILE_TITLE = "Delete profile?";
export const deleteProfileBody = (name: string) => `Delete "${name}"? This cannot be undone.`;

export const couldNotSaveToast = (message: string) => `Could not save profile: ${message}`;
export const couldNotOpenToast = (message: string) => `Could not open profile: ${message}`;
