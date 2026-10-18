// WCAG contrast of the token pairs that carry text (DES-001 6.2, DES-002 9, FE-002 task 28). The
// ratios are computed from the six palette values in `styles.css`; the derived tokens are mixes of
// them, composited over the surface they sit on (the light page color).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

type Rgb = [number, number, number];

function palette(name: string): Rgb {
  const m = new RegExp(String.raw`--ese-${name}:\s*#([0-9a-fA-F]{6})`).exec(css);
  if (!m?.[1]) throw new Error(`no palette value ${name}`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `color` at `alpha` (0-1) over `base`. */
function over(color: Rgb, alpha: number, base: Rgb): Rgb {
  return [0, 1, 2].map(
    (i) => (color[i] as number) * alpha + (base[i] as number) * (1 - alpha),
  ) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const dark = palette("dark");
const light = palette("light");
const accent = palette("accent");
const warning = palette("warning");
const error = palette("error");

describe("contrast of the text pairs (WCAG 2.1 AA, 4.5:1)", () => {
  it("dark on the warning fill: the status line and banners on warning (DES-002 9: 5.2:1)", () => {
    expect(contrast(dark, warning)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark, warning)).toBeCloseTo(5.2, 0);
  });

  it("light on dark: the active title bar, the traffic bar and the dark panels (11.6:1)", () => {
    expect(contrast(light, dark)).toBeGreaterThanOrEqual(7);
    expect(contrast(light, dark)).toBeCloseTo(11.6, 0);
  });

  it("dark on the accent: primary buttons and the drop previews (10.7:1)", () => {
    expect(contrast(dark, accent)).toBeGreaterThanOrEqual(7);
    expect(contrast(dark, accent)).toBeCloseTo(10.7, 0);
  });

  it("the accent on dark: the focus ring on a dark title bar and the gauge icon", () => {
    expect(contrast(accent, dark)).toBeGreaterThanOrEqual(4.5);
  });

  it("dark on the tints it sits on: neutral, error, warning, selected and the workspace", () => {
    const tints: Record<string, Rgb> = {
      neutral: over(dark, 0.06, light),
      error: over(error, 0.12, light),
      warning: over(warning, 0.2, light),
      selected: over(accent, 0.35, light),
      workspace: over(dark, 0.18, light),
    };
    for (const [name, color] of Object.entries(tints)) {
      expect(contrast(dark, color), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the muted text (dark at 75%) on the light page and on the workspace", () => {
    const muted = over(dark, 0.75, light);
    expect(contrast(muted, light)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(muted, over(dark, 0.18, light))).toBeGreaterThanOrEqual(3);
  });

  it("the derived tokens in the CSS use the percentages computed here", () => {
    expect(css).toMatch(/--ese-neutral-tint:\s*color-mix\(in srgb, var\(--ese-dark\) 6%/);
    expect(css).toMatch(/--ese-error-tint:\s*color-mix\(in srgb, var\(--ese-error\) 12%/);
    expect(css).toMatch(/--ese-selected:\s*color-mix\(in srgb, var\(--ese-accent\) 35%/);
    expect(css).toMatch(/--ese-warning-tint:\s*color-mix\(in srgb, var\(--ese-warning\) 20%/);
    expect(css).toMatch(
      /--ese-workspace:\s*color-mix\(in srgb, var\(--ese-dark\) 18%, var\(--ese-light\)/,
    );
  });
});

describe("the error and warning colors are never text on a light surface", () => {
  it("red on light fails the text contrast, so it is only used for icons and borders (DES-002 9)", () => {
    // Documented, not asserted as a goal: if the palette ever changes, this says where text is allowed.
    expect(contrast(error, light)).toBeLessThan(4.5);
    expect(contrast(warning, light)).toBeLessThan(4.5);
  });
});
