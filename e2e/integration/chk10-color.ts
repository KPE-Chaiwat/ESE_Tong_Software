// Colour parsing for the CHK-010 contrast checks (REPORT-031).

/** Parses a computed CSS colour (rgb, rgba, color(srgb), oklab) into sRGB 0-255; null when unknown. */
export function parseColor(css: string): [number, number, number] | null {
  let m = /^rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(css);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  m = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)/.exec(css);
  if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255];
  m = /^oklab\(([\d.e-]+%?) ([\d.e-]+) ([\d.e-]+)/.exec(css);
  if (m) {
    const L = m[1]?.endsWith("%") ? Number.parseFloat(m[1]) / 100 : Number(m[1]);
    const a = Number(m[2]);
    const b = Number(m[3]);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const lin = [
      4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
    ];
    const g = (c: number) => Math.round(255 * Math.max(0, Math.min(1, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
    return [g(lin[0] as number), g(lin[1] as number), g(lin[2] as number)];
  }
  return null;
}
