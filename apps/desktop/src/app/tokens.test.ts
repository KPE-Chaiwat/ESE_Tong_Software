import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const srcDir = join(import.meta.dirname, "..");
const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "bindings" ? [] : sourceFiles(full);
    return /\.(ts|tsx|css)$/.test(name) ? [full] : [];
  });
}

describe("design tokens (DES-001 6.1)", () => {
  const code = stripComments(css);

  it("defines exactly the six palette hex values and no other hex literal", () => {
    const hexes = [...code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
    expect(new Set(hexes)).toEqual(
      new Set(["#312f2e", "#edeff2", "#d7f26c", "#fa8130", "#22c55e", "#ef4444"]),
    );
    expect(hexes).toHaveLength(6);
  });

  it("maps the palette to the DES token names", () => {
    for (const name of ["dark", "light", "accent", "warning", "success", "error"]) {
      expect(code).toMatch(new RegExp(String.raw`--color-${name}:\s*var\(--ese-${name}\)`));
    }
  });

  it("defines the derived tokens as mixes of base tokens", () => {
    for (const name of [
      "text-muted",
      "border",
      "neutral-tint",
      "error-tint",
      "selected",
      "warning-tint",
      "workspace",
    ]) {
      expect(code).toMatch(new RegExp(String.raw`--ese-${name}:\s*color-mix\(`));
      expect(code).toMatch(new RegExp(String.raw`--color-${name}:\s*var\(--ese-${name}\)`));
    }
  });

  it("defines the single data-font token and no surface token (pending Q-001-11)", () => {
    expect(code).toMatch(/--font-mono:/);
    expect(code).not.toMatch(/--color-surface/);
    expect(code).not.toMatch(/--surface\b/);
  });

  it("keeps hex literals out of every other source file", () => {
    const offenders = sourceFiles(srcDir)
      .filter((f) => !f.endsWith("styles.css"))
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => /#[0-9a-fA-F]{6}\b/.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => relative(srcDir, f));
    expect(offenders).toEqual([]);
  });

  it("uses the orange palette value only through the warning tokens", () => {
    expect(code.match(/--ese-warning/g)?.length).toBeGreaterThan(0);
    const offenders = sourceFiles(srcDir)
      .filter((f) => !f.endsWith("styles.css"))
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => /ese-warning|#fa8130/i.test(readFileSync(f, "utf8")))
      .map((f) => relative(srcDir, f));
    expect(offenders).toEqual([]);
  });

  it("uses orange (warning) classes only in the status primitives and the write result chips", () => {
    // REV-002 n2: the palette check above only sees the raw value. A decorative bg-warning class
    // anywhere else would pass it, so the classes themselves are checked.
    const allowed = [
      "shared/ui/status-pill.tsx",
      "shared/ui/state-banner.tsx",
      "shared/ui/status-strip.tsx",
      // DES-003 1.4: the out-of-range tint of a scaled value.
      "tools/modbus-master/components/poll-view/ScaledCellView.tsx",
      "shared/ui/freshness-chip.tsx",
      "shared/ui/badge.tsx",
      // The minimized pill of a poll in timeout or bad response has the warning border (DES-002 2.2.4).
      "tools/modbus-master/components/workspace/MinimizedBar.tsx",
      // The write result chips (DES-001 2.5) and the scaled preview tint (DES-003 3.5).
      "tools/modbus-master/components/dialogs/WriteDialogView.tsx",
    ];
    const offenders = sourceFiles(srcDir)
      .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f))
      .filter((f) => !allowed.some((a) => f.replaceAll("\\", "/").endsWith(a)))
      .filter((f) => /\b(bg|border|text|ring|fill|stroke)-warning\b/.test(readFileSync(f, "utf8")))
      .map((f) => relative(srcDir, f));
    expect(offenders).toEqual([]);
  });

  it("never pairs text with a solid error or warning-as-text color", () => {
    // DES-001 6.2: no text on a solid error fill; success/warning are never text colors on light.
    const offenders = sourceFiles(srcDir)
      .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f))
      // Icons are the one place where the error color may be used on a light surface.
      .filter((f) => !f.replaceAll("\\", "/").endsWith("shared/ui/icon.tsx"))
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        return (
          /\btext-(error|success|warning)(?![-\w])/.test(text) || /\bbg-error(?![-\w/])/.test(text)
        );
      })
      .map((f) => relative(srcDir, f));
    expect(offenders).toEqual([]);
  });
});
