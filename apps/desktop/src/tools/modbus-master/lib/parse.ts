import type { ValueFormat } from "@/shared/ipc/modbus-master.types";

export type ParseResult = { ok: true; raw: number } | { ok: false; message: string };

export const VALUE_MESSAGES: Record<"unsigned" | "signed" | "hex" | "binary", string> = {
  unsigned: "Value must be from 0 to 65535.",
  signed: "Value must be from -32768 to 32767.",
  hex: "Enter a hex value from 0x0000 to 0xFFFF.",
  binary: "Enter up to 16 binary digits (0 or 1).",
};

function fail(fmt: ValueFormat): ParseResult {
  return {
    ok: false,
    message:
      fmt in VALUE_MESSAGES
        ? VALUE_MESSAGES[fmt as keyof typeof VALUE_MESSAGES]
        : "Writes require a 16-bit register format.",
  };
}

/**
 * Parses one value typed by the user. `raw` is the unsigned 16-bit pattern, so signed -1 gives 65535.
 * Rules and messages are DES-001 3.3.
 */
export function parseValue(text: string, fmt: ValueFormat): ParseResult {
  const t = text.trim();
  switch (fmt) {
    case "unsigned": {
      if (!/^\d+$/.test(t)) return fail(fmt);
      const n = Number(t);
      return n <= 0xffff ? { ok: true, raw: n } : fail(fmt);
    }
    case "signed": {
      if (!/^-?\d+$/.test(t)) return fail(fmt);
      const n = Number(t);
      return n >= -0x8000 && n <= 0x7fff ? { ok: true, raw: n & 0xffff } : fail(fmt);
    }
    case "hex": {
      const m = /^(?:0x)?([0-9a-f]{1,4})$/i.exec(t);
      return m?.[1] ? { ok: true, raw: Number.parseInt(m[1], 16) } : fail(fmt);
    }
    case "binary": {
      const digits = t.replace(/^0b/i, "").replace(/\s+/g, "");
      return /^[01]{1,16}$/.test(digits)
        ? { ok: true, raw: Number.parseInt(digits, 2) }
        : fail(fmt);
    }
    default:
      return fail(fmt);
  }
}

/** Splits a values box: separators are space, comma, tab and newline; runs count as one. */
export function splitValues(text: string): string[] {
  return text.split(/[\s,]+/).filter((s) => s.length > 0);
}
