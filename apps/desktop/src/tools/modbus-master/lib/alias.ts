// Aliases (DES-002 2.3.5 and section 4): validation, paste parsing and the helpers that keep an
// alias list sorted by protocol address. Pure.
import { z } from "zod";
import type { AliasEntry } from "@/shared/ipc/modbus-master.types";

export const MAX_ALIAS_LENGTH = 32;
export const MAX_ALIASES = 2000;

export const ALIAS_TOO_LONG = "Alias must be at most 32 characters.";
export const ALIAS_SPACE = "Alias cannot start or end with a space.";
export const ALIAS_CONTROL = "Alias cannot contain control characters.";
export const ALIAS_LIMIT = "A poll can have at most 2000 aliases.";

/**
 * The first failing rule of DES-002 section 4, or null. Empty or spaces-only text is valid: it
 * removes the alias.
 */
export function aliasError(text: string): string | null {
  if (text.trim() === "") return null;
  if (Array.from(text).length > MAX_ALIAS_LENGTH) return ALIAS_TOO_LONG;
  if (/^\s|\s$/.test(text)) return ALIAS_SPACE;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rule rejects.
  if (/[\u0000-\u001f\u007f-\u009f]/.test(text)) return ALIAS_CONTROL;
  return null;
}

/** zod schema of one alias. The output is the text to store, "" meaning "no alias". */
export function aliasSchema() {
  return z
    .string()
    .superRefine((text, ctx) => {
      const message = aliasError(text);
      if (message) ctx.addIssue({ code: "custom", message, path: ["alias"] });
    })
    .transform((text) => (text.trim() === "" ? "" : text));
}

export interface AliasPaste {
  /** `alias: ""` clears that address. */
  entries: AliasEntry[];
  /** Lines in range that were invalid and left alone. */
  skipped: number;
  /** Lines past the end of the poll range (valid or not). */
  beyond: number;
}

/** Splits clipboard text into lines (`\r\n` or `\n`); a trailing empty line is ignored. */
export function splitClipboardLines(text: string): string[] {
  const lines = text.split(/\r\n|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Turns clipboard text into alias entries for consecutive addresses from `startAddress`
 * (protocol addresses). Each line uses its text up to the first tab. Empty lines clear the alias.
 * Lines beyond `endAddress` are dropped and counted; invalid lines are skipped and counted, but
 * still take their address, so every line stays aligned with its row.
 */
export function parseAliasPaste(
  text: string,
  startAddress: number,
  endAddress: number,
): AliasPaste {
  const entries: AliasEntry[] = [];
  let skipped = 0;
  let beyond = 0;
  for (const [i, line] of splitClipboardLines(text).entries()) {
    const address = startAddress + i;
    if (address > endAddress) {
      beyond += 1;
      continue;
    }
    const alias = line.split("\t")[0] ?? "";
    if (aliasError(alias) !== null) {
      skipped += 1;
      continue;
    }
    entries.push({ address, alias: alias.trim() === "" ? "" : alias });
  }
  return { entries, skipped, beyond };
}

export function aliasMap(entries: readonly AliasEntry[]): Map<number, string> {
  return new Map(entries.map((e) => [e.address, e.alias]));
}

/** Sorted by address, one entry per address, no empty aliases. */
export function entriesFromMap(map: ReadonlyMap<number, string>): AliasEntry[] {
  return [...map.entries()]
    .filter(([, alias]) => alias !== "")
    .sort(([a], [b]) => a - b)
    .map(([address, alias]) => ({ address, alias }));
}

export interface AliasMerge {
  entries: AliasEntry[];
  /** True when the 2000 limit stopped at least one new alias. */
  capped: boolean;
  /** How many new aliases the limit stopped. */
  dropped: number;
  /** How many of the edits changed something. */
  applied: number;
}

/**
 * Applies edits (an empty alias removes) to a list. New aliases beyond `limit` are not added;
 * removals and changes of existing addresses always apply.
 */
export function mergeAliases(
  existing: readonly AliasEntry[],
  edits: readonly AliasEntry[],
  limit = MAX_ALIASES,
): AliasMerge {
  const map = aliasMap(existing);
  let dropped = 0;
  let applied = 0;
  for (const edit of edits) {
    if (edit.alias === "") {
      if (map.delete(edit.address)) applied += 1;
      continue;
    }
    if (!map.has(edit.address) && map.size >= limit) {
      dropped += 1;
      continue;
    }
    if (map.get(edit.address) !== edit.alias) applied += 1;
    map.set(edit.address, edit.alias);
  }
  return { entries: entriesFromMap(map), capped: dropped > 0, dropped, applied };
}

/** The toast after a paste (DES-002 2.3.5 and section 4). */
export function pasteToastText(
  applied: number,
  skipped: number,
  beyond: number,
  capped: boolean,
): string {
  const head = `Pasted ${applied} aliases.`;
  if (capped) return `${head} The poll has reached 2000 aliases.`;
  let text = head;
  if (skipped > 0) text += ` Skipped ${skipped} invalid lines.`;
  if (beyond > 0) text += ` ${beyond} lines were beyond the poll range.`;
  return text;
}
