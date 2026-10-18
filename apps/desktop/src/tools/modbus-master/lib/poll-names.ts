// Poll names (DES-002 section 4): the validation rules and the generated names for New poll and
// Duplicate. Pure.
import { z } from "zod";

export const MAX_POLL_NAME_LENGTH = 48;
export const MAX_POLLS = 16;

export const POLL_NAME_REQUIRED = "Enter a poll name.";
export const POLL_NAME_TOO_LONG = "Poll name must be at most 48 characters.";
export const POLL_NAME_SPACE = "Poll name cannot start or end with a space.";
export const POLL_NAME_CONTROL = "Poll name cannot contain control characters.";
export const MAX_POLLS_MESSAGE = "A connection can have at most 16 polls.";

export function pollNameTaken(name: string): string {
  return `A poll named "${name}" already exists on this connection.`;
}

const characterCount = (text: string) => Array.from(text).length;

/**
 * The first failing rule of DES-002 section 4, or null. `existing` are the other polls' names
 * (case-insensitive); leave the poll's own name out when renaming.
 */
export function pollNameError(name: string, existing: readonly string[] = []): string | null {
  if (name.trim() === "") return POLL_NAME_REQUIRED;
  if (characterCount(name) > MAX_POLL_NAME_LENGTH) return POLL_NAME_TOO_LONG;
  if (/^\s|\s$/.test(name)) return POLL_NAME_SPACE;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rule rejects.
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return POLL_NAME_CONTROL;
  const lower = name.toLowerCase();
  if (existing.some((n) => n.toLowerCase() === lower)) return pollNameTaken(name);
  return null;
}

/** zod schema of a poll name; only the first failing rule's message is reported. */
export function pollNameSchema(existing: readonly string[] = []) {
  return z.string().superRefine((name, ctx) => {
    const message = pollNameError(name, existing);
    if (message) ctx.addIssue({ code: "custom", message, path: ["name"] });
  });
}

/** "Poll 1", "Poll 2", ...: the lowest number that is not used yet (case-insensitive). */
export function nextPollName(existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  for (let n = 1; ; n += 1) {
    const candidate = `Poll ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** "Tank copy", then "Tank copy 2", "Tank copy 3", ... The result keeps within 48 characters. */
export function duplicateName(source: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const build = (suffix: string): string => {
    const room = MAX_POLL_NAME_LENGTH - characterCount(suffix);
    const head = Array.from(source).slice(0, Math.max(0, room)).join("").trimEnd();
    return `${head}${suffix}`;
  };
  const first = build(" copy");
  if (!taken.has(first.toLowerCase())) return first;
  for (let n = 2; ; n += 1) {
    const candidate = build(` copy ${n}`);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
