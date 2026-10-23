// `PollViewHandoffV1` (DES-002 2.5.4): what travels between a sub-window and a native window when a
// poll is popped out or docked. Rust stores the JSON string opaquely and delivers it once; the
// frontend validates it on arrival and ignores an invalid or missing one without a message.
import { z } from "zod";

const range = z.object({ start: z.number().int(), end: z.number().int() });
const field = z.enum(["name", "slaveId", "function", "startAddress", "quantity", "scanRateMs"]);

export const pollDraftSchema = z.object({
  name: z.string(),
  slaveId: z.string(),
  function: z.string(),
  startAddress: z.string(),
  quantity: z.string(),
  scanRateMs: z.string(),
  dirty: z.array(field),
  errors: z.partialRecord(field, z.string()),
});

/**
 * The scale draft belongs to `scaleDraftStore`. The handoff only guarantees it travels unchanged: `dirty`
 * says whether it holds unapplied edits, `fields` holds the typed texts and their messages.
 */
export const scaleDraftSchema = z.object({
  dirty: z.boolean(),
  fields: z.record(z.string(), z.unknown()),
});

const colorRuleSchema = z
  .object({
    name: z.string(),
    enabled: z.boolean(),
    range: z.object({ start: z.number(), end: z.number() }).nullable(),
    source: z.enum(["displayed", "raw", "scaled"]),
    comparison: z.enum([
      "equals",
      "notEquals",
      "lessThan",
      "lessThanOrEqual",
      "greaterThan",
      "greaterThanOrEqual",
      "always",
      "between",
    ]),
    threshold: z.string(),
    upperThreshold: z.string().nullable(),
    highlight: z.enum(["lime", "neutral", "warning"]),
    colors: z.object({ background: z.string(), foreground: z.string() }).nullable().optional(),
  })
  .transform(({ colors, ...rule }) => (colors === undefined ? rule : { ...rule, colors }));
export const handoffSchema = z.object({
  inspectedGroupAddress: z.number().int().nullable().optional(),
  ruleDraft: z
    .object({
      entries: z.array(
        z.object({
          id: z.string(),
          rule: colorRuleSchema,
          rangeTexts: z.object({ start: z.string(), end: z.string() }).optional(),
        }),
      ),
      selected: z.string().nullable(),
      dirty: z.boolean(),
      errors: z.record(z.string(), z.string()),
      error: z.string().nullable(),
    })
    .nullable()
    .optional(),
  version: z.literal(1),
  setupOpen: z.boolean(),
  /** The user opened the setup in compact mode (a local override). */
  setupOverride: z.boolean(),
  selection: z.array(range),
  anchorAddress: z.number().int().nullable(),
  focusAddress: z.number().int().nullable(),
  /** The first visible address; the new host scrolls so that it is the top row. */
  topAddress: z.number().int().nullable(),
  columnWidths: z.object({
    alias: z.number(),
    address: z.number(),
    /** Added with REQ-009; an older handoff has none and the default width applies. */
    format: z.number().optional(),
    raw: z.number(),
    scaled: z.number(),
  }),
  pollDraft: pollDraftSchema.nullable(),
  scaleDraft: scaleDraftSchema.nullable(),
});

export type PollViewHandoffV1 = z.infer<typeof handoffSchema>;

export function serializeHandoff(handoff: PollViewHandoffV1): string {
  return JSON.stringify(handoff);
}

/** The validated handoff, or null for missing, malformed or invalid input. Never throws. */
export function parseHandoff(json: string | null | undefined): PollViewHandoffV1 | null {
  if (!json) return null;
  try {
    const parsed = handoffSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
