// Pure layout helpers of the traffic table: column widths (DES-001 5.3).

/** Minimum widths in px. Keys are `<table>.<column>`. */
export const COLUMN_MIN_WIDTHS: Readonly<Record<string, number>> = {
  "traffic.seq": 48,
  "traffic.time": 104,
  "traffic.dir": 56,
  "traffic.len": 40,
  "traffic.poll": 80,
  "traffic.bytes": 160,
  "traffic.info": 120,
};

export const FALLBACK_MIN_COLUMN_WIDTH = 24;

export function clampColumnWidth(id: string, px: number): number {
  return Math.max(COLUMN_MIN_WIDTHS[id] ?? FALLBACK_MIN_COLUMN_WIDTH, px);
}
