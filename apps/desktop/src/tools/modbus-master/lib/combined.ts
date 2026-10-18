export type CombinedFormat =
  | "signed32"
  | "unsigned32"
  | "float32"
  | "signed64"
  | "unsigned64"
  | "float64";
export interface RegisterOrder {
  swapBytes: boolean;
  reverseWords: boolean;
}
export type CombinedValue =
  | { kind: "integer"; value: bigint }
  | { kind: "float"; value: number }
  | { kind: "incomplete"; required: number; available: number }
  | { kind: "missing" };
export interface CombinedRow {
  address: number;
  endAddress: number;
  words: readonly number[];
  value: CombinedValue;
}

export function isCombinedFormat(format: string): format is CombinedFormat {
  return ["signed32", "unsigned32", "float32", "signed64", "unsigned64", "float64"].includes(
    format,
  );
}
export function registerWidth(format: CombinedFormat): 2 | 4 {
  return format.endsWith("64") ? 4 : 2;
}
export function orderedBytes(words: readonly number[], order: RegisterOrder): number[] {
  const source = order.reverseWords ? [...words].reverse() : words;
  return source.flatMap((word) =>
    order.swapBytes ? [word & 255, word >>> 8] : [word >>> 8, word & 255],
  );
}
export function orderLabel(width: number, order: RegisterOrder): string {
  const letters = "ABCDEFGH".slice(0, width * 2);
  const pairs = Array.from({ length: width }, (_, index) =>
    letters.slice(index * 2, index * 2 + 2),
  );
  if (order.reverseWords) pairs.reverse();
  return pairs.map((pair) => (order.swapBytes ? [...pair].reverse().join("") : pair)).join("");
}
export function decodeCombined(
  words: readonly number[],
  format: CombinedFormat,
  order: RegisterOrder,
): CombinedValue {
  const width = registerWidth(format);
  if (words.length !== width)
    return { kind: "incomplete", required: width, available: words.length };
  const bytes = Uint8Array.from(orderedBytes(words, order));
  const view = new DataView(bytes.buffer);
  if (format === "float32" || format === "float64")
    return { kind: "float", value: format === "float32" ? view.getFloat32(0) : view.getFloat64(0) };
  let value = bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
  if (format.startsWith("signed")) value = BigInt.asIntN(width * 16, value);
  return { kind: "integer", value };
}
export function combinedText(value: CombinedValue, missing = "—"): string {
  if (value.kind === "missing") return missing;
  if (value.kind === "incomplete") return "Incomplete";
  if (value.kind === "integer") return value.value.toString();
  return value.value === Number.POSITIVE_INFINITY ? "+Infinity" : String(value.value);
}
/** Derives rows from one complete snapshot only; no remembered words or padding. */
export function combinedRows(
  start: number,
  quantity: number,
  words: readonly number[] | null | undefined,
  format: CombinedFormat,
  order: RegisterOrder,
): CombinedRow[] {
  const width = registerWidth(format);
  const snapshot = words?.length === quantity ? words : null;
  return Array.from({ length: Math.ceil(quantity / width) }, (_, index) => {
    const offset = index * width;
    const count = Math.min(width, quantity - offset);
    const raw = snapshot?.slice(offset, offset + count) ?? [];
    return {
      address: start + offset,
      endAddress: start + offset + count - 1,
      words: raw,
      value: snapshot ? decodeCombined(raw, format, order) : { kind: "missing" },
    };
  });
}
export function rawWordsText(words: readonly number[]): string {
  return words.map((word) => `0x${word.toString(16).toUpperCase().padStart(4, "0")}`).join(" ");
}
