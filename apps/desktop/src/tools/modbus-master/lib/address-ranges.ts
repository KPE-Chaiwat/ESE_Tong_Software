// Selections as protocol address ranges (DES-002 2.5.4: a selection moves between hosts by address,
// never by row index). Pure helpers over sorted, merged, inclusive ranges.

export interface AddressRange {
  start: number;
  end: number;
}

/** Sorts, drops invalid ranges, and merges ranges that overlap or touch. */
export function normalizeRanges(ranges: readonly AddressRange[]): AddressRange[] {
  const sorted = ranges
    .filter((r) => Number.isInteger(r.start) && Number.isInteger(r.end) && r.start <= r.end)
    .map((r) => ({ start: r.start, end: r.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: AddressRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
    else out.push(r);
  }
  return out;
}

export function rangesContain(ranges: readonly AddressRange[], address: number): boolean {
  for (const r of ranges) {
    if (address < r.start) return false;
    if (address <= r.end) return true;
  }
  return false;
}

/** The inclusive range between two addresses, in either order. */
export function rangeBetween(a: number, b: number): AddressRange {
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/** Adds the address when it is not selected, removes it when it is (Ctrl-click). */
export function toggleAddress(ranges: readonly AddressRange[], address: number): AddressRange[] {
  if (!rangesContain(ranges, address)) {
    return normalizeRanges([...ranges, { start: address, end: address }]);
  }
  const out: AddressRange[] = [];
  for (const r of ranges) {
    if (address < r.start || address > r.end) out.push(r);
    else {
      if (r.start < address) out.push({ start: r.start, end: address - 1 });
      if (address < r.end) out.push({ start: address + 1, end: r.end });
    }
  }
  return out;
}

/** Keeps only what lies inside [start, end]. */
export function clampRanges(
  ranges: readonly AddressRange[],
  start: number,
  end: number,
): AddressRange[] {
  return normalizeRanges(
    ranges.flatMap((r) => {
      const s = Math.max(r.start, start);
      const e = Math.min(r.end, end);
      return s <= e ? [{ start: s, end: e }] : [];
    }),
  );
}

/** Every selected address, ascending. */
export function addressesOf(ranges: readonly AddressRange[]): number[] {
  const out: number[] = [];
  for (const r of ranges) for (let a = r.start; a <= r.end; a += 1) out.push(a);
  return out;
}

export function countAddresses(ranges: readonly AddressRange[]): number {
  return ranges.reduce((n, r) => n + (r.end - r.start + 1), 0);
}

/** "0-1, 5, 9-12" in the display base (DES-003 3.2 "Applies to ..."). */
export function formatRanges(ranges: readonly AddressRange[], base: 0 | 1 = 0): string {
  return ranges
    .map((r) => (r.start === r.end ? `${r.start + base}` : `${r.start + base}-${r.end + base}`))
    .join(", ");
}

export function sameRanges(a: readonly AddressRange[], b: readonly AddressRange[]): boolean {
  return a.length === b.length && a.every((r, i) => r.start === b[i]?.start && r.end === b[i]?.end);
}
