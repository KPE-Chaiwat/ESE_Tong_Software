import type { ValueFormat } from "@/shared/ipc/modbus-master.types";

export const VALUE_FORMATS: readonly ValueFormat[] = ["unsigned", "signed", "hex", "binary"];

export const VALUE_FORMAT_LABELS: Record<ValueFormat, string> = {
  unsigned: "Unsigned",
  signed: "Signed",
  hex: "Hex",
  binary: "Binary",
};

/** Formats a raw 16-bit register value (DES-001 section 4). */
export function formatValue(raw: number, fmt: ValueFormat): string {
  const u16 = raw & 0xffff;
  switch (fmt) {
    case "unsigned":
      return String(u16);
    case "signed":
      return String(u16 > 0x7fff ? u16 - 0x10000 : u16);
    case "hex":
      return `0x${u16.toString(16).toUpperCase().padStart(4, "0")}`;
    case "binary":
      return u16.toString(2).padStart(16, "0").match(/.{4}/g)?.join(" ") ?? "";
  }
}

/** Coils and discrete inputs are always shown as 0 or 1. */
export function formatBit(v: boolean | number): "0" | "1" {
  return v ? "1" : "0";
}

/** Uppercase two-digit hex groups separated by a single space. */
export function formatHexBytes(bytes: readonly number[]): string {
  return bytes.map((b) => (b & 0xff).toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

/** Four-digit uppercase hex offset used by the traffic detail strip. */
export function formatOffset(offset: number): string {
  return offset.toString(16).toUpperCase().padStart(4, "0");
}

/** Splits bytes into lines of 16 with a 4-digit hex offset: `0000  00 01 ...`. */
export function formatHexDump(bytes: readonly number[]): string[] {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    lines.push(`${formatOffset(offset)}  ${formatHexBytes(bytes.slice(offset, offset + 16))}`);
  }
  return lines;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** Local time as `HH:MM:SS.mmm` (DES-001 section 4). */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}.${pad(d.getMilliseconds(), 3)}`;
}

/** Full local date-time with offset, used as a tooltip: `2026-10-12T14:02:11.532+09:00`. */
export function formatIsoWithOffset(ms: number): string {
  const d = new Date(ms);
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
  return `${date}T${formatTime(ms)}${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`;
}

/** Local `YYYY-MM-DD HH:MM`, used by the profile list. */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)} ${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`;
}
