// The schema 1-5 -> 6 migration of a profile, as the backend does it on load (BE-009,
// `platform::mm_profile::migrate_v5`), so the browser fake can show an old profile the way the app
// does. A poll-wide format becomes one override from the poll's Start; the default becomes none.
import type { FormatOverride, Profile, ValueFormat } from "./modbus-master.types";

interface LegacyDisplay {
  format?: string;
  addressBase: 0 | 1;
  showAlias: boolean;
  copyAlias: boolean;
  swapBytes?: boolean;
  reverseWords?: boolean;
}
interface LegacyPoll extends Omit<Profile["polls"][number], "display" | "formatOverrides"> {
  display: LegacyDisplay;
  formatOverrides?: FormatOverride[];
}
export type LegacyProfile = Omit<Profile, "schemaVersion" | "polls"> & {
  schemaVersion: number;
  polls: LegacyPoll[];
};

const WIDTH: Record<string, number> = {
  unsigned: 1,
  signed: 1,
  hex: 1,
  binary: 1,
  signed32: 2,
  unsigned32: 2,
  float32: 2,
  signed64: 4,
  unsigned64: 4,
  float64: 4,
};

/** The override that stands for a poll-wide format, or none (DES-009 / BE-009 migration rule). */
export function legacyFormatOverrides(
  format: string,
  swapBytes: boolean,
  reverseWords: boolean,
  start: number,
  quantity: number,
): FormatOverride[] {
  const width = WIDTH[format] ?? 1;
  const flags =
    width === 1 ? { swapBytes: false, reverseWords: false } : { swapBytes, reverseWords };
  if (format === "unsigned" && !flags.swapBytes && !flags.reverseWords) return [];
  let length = Math.ceil(quantity / width) * width;
  if (start + length - 1 > 65535) length = Math.floor((65535 - start + 1) / width) * width;
  if (length <= 0) return [];
  return [{ start, end: start + length - 1, format: format as ValueFormat, ...flags }];
}

/**
 * Migrates the polls of a schema 1-5 profile to schema 6; a schema 6 profile is returned as it is.
 * `migratedFrom` stays as the caller gave it: a test that wants the migration notice sets it (the
 * backend sets it to the schema of the file it read).
 */
export function migrateLegacyProfile(profile: Profile | LegacyProfile): Profile {
  if (profile.schemaVersion >= 6) return profile as Profile;
  const legacy = profile as LegacyProfile;
  return {
    ...legacy,
    schemaVersion: 6,
    polls: legacy.polls.map((p) => {
      const { format, swapBytes, reverseWords, ...display } = p.display;
      return {
        ...p,
        display,
        formatOverrides: legacyFormatOverrides(
          format ?? "unsigned",
          swapBytes ?? false,
          reverseWords ?? false,
          p.definition.startAddress,
          p.definition.quantity,
        ),
      };
    }),
  } as Profile;
}
