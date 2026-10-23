// Copying rows with 32/64-bit groups and per-row formats (DES-009 8.3).
import { describe, expect, it } from "vitest";
import {
  type CopyGroup,
  type CopyOptions,
  type CopyRow,
  copyHeader,
  copyRegistersText,
  copyRowsText,
} from "./copy";

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const join = (...fields: string[]) => fields.join(TAB);

const options = (patch: Partial<CopyOptions> = {}): CopyOptions => ({
  format: "unsigned",
  base: 0,
  columns: "both",
  bits: false,
  includeAlias: false,
  header: false,
  ...patch,
});
const group = (
  address: number,
  value: CopyGroup["value"],
  patch: Partial<CopyGroup> = {},
  alias?: string,
): CopyRow => ({
  address,
  raw: undefined,
  alias,
  scaled: "",
  group: {
    format: "float32",
    value,
    registers: [
      { address, raw: 0x3f80, alias },
      { address: address + 1, raw: 0, alias: alias === undefined ? undefined : `${alias} low` },
    ],
    ...patch,
  },
});
const hex: CopyRow = { address: 1, raw: 0x00a1, alias: "Flags", scaled: "", format: "hex" };
const flow = group(2, { kind: "float", value: 1 }, {}, "Flow");
const mixed: CopyRow[] = [hex, flow];

describe("copyRowsText with group rows", () => {
  it("a mixed selection has the header Raw (Mixed) and each row in its own format", () => {
    expect(copyRowsText(mixed, options({ columns: "raw", header: true }))).toBe(
      [join("Address (0-based)", "Raw (Mixed)"), join("1", "0x00A1"), join("2", "1")].join(LF),
    );
  });

  it("a same-format 16-bit selection keeps Raw (Hex)", () => {
    const rows: CopyRow[] = [
      { address: 0, raw: 1, alias: undefined, scaled: "", format: "hex" },
      { address: 1, raw: 2, alias: undefined, scaled: "", format: "hex" },
    ];
    expect(copyHeader(options({ columns: "raw" }), rows)).toBe(
      join("Address (0-based)", "Raw (Hex)"),
    );
  });

  it("the option's format names the header of rows that have none of their own", () => {
    expect(copyHeader(options({ columns: "raw", format: "signed" }), [])).toBe(
      join("Address (0-based)", "Raw (Signed)"),
    );
  });

  it("a group-only selection says Interpreted with the format; different formats are Mixed", () => {
    expect(copyHeader(options({ columns: "raw" }), [flow])).toBe(
      join("Address (0-based)", "Interpreted (Float 32-bit)"),
    );
    const other = group(4, { kind: "integer", value: 3n }, { format: "signed32" });
    expect(copyHeader(options({ columns: "raw" }), [flow, other])).toBe(
      join("Address (0-based)", "Raw (Mixed)"),
    );
  });

  it("Both gives an empty scaled field for a group row; the header lists Scaled", () => {
    const rows: CopyRow[] = [
      { address: 0, raw: 5, alias: undefined, scaled: "0.5", format: "unsigned" },
      flow,
    ];
    expect(copyRowsText(rows, options({ header: true }))).toBe(
      [
        join("Address (0-based)", "Raw (Mixed)", "Scaled"),
        join("0", "5", "0.5"),
        join("2", "1", ""),
      ].join(LF),
    );
  });

  it("an incomplete group copies Incomplete and a missing one nothing", () => {
    const columns = options({ columns: "raw" });
    expect(
      copyRowsText([group(4, { kind: "incomplete", required: 2, available: 1 })], columns),
    ).toBe(join("4", "Incomplete"));
    expect(copyRowsText([group(4, { kind: "missing" })], columns)).toBe(join("4", ""));
  });

  it("64-bit integers copy exactly", () => {
    const columns = options({ columns: "raw" });
    const big = (value: bigint) =>
      group(0, { kind: "integer", value }, { format: "unsigned64", registers: [] });
    expect(copyRowsText([big(18446744073709551615n), big(9007199254740993n)], columns)).toBe(
      [join("0", "18446744073709551615"), join("0", "9007199254740993")].join(LF),
    );
  });

  it("uses the alias of the group's first register and the display base", () => {
    expect(copyRowsText([flow], options({ columns: "raw", includeAlias: true, base: 1 }))).toBe(
      join("Flow", "3", "1"),
    );
  });

  it("a row's own format wins over the option's", () => {
    expect(
      copyRowsText(
        [
          { address: 0, raw: 255, alias: undefined, scaled: "", format: "binary" },
          { address: 1, raw: 65535, alias: undefined, scaled: "" },
        ],
        options({ columns: "raw", format: "signed" }),
      ),
    ).toBe([join("0", "0000 0000 1111 1111"), join("1", "-1")].join(LF));
  });
});

describe("copyRegistersText (Copy raw registers)", () => {
  it("expands a group into one line per register with each register's alias", () => {
    expect(copyRegistersText(mixed, { base: 0, includeAlias: true, header: false })).toBe(
      [join("Flags", "1", "161"), join("Flow", "2", "16256"), join("Flow low", "3", "0")].join(LF),
    );
  });

  it("has the header Raw (Unsigned) and the display base", () => {
    expect(copyRegistersText(mixed, { base: 1, includeAlias: false, header: true })).toBe(
      [
        join("Address (1-based)", "Raw (Unsigned)"),
        join("2", "161"),
        join("3", "16256"),
        join("4", "0"),
      ].join(LF),
    );
    expect(copyRegistersText([hex], { base: 0, includeAlias: true, header: true })).toBe(
      [join("Alias", "Address (0-based)", "Raw (Unsigned)"), join("Flags", "1", "161")].join(LF),
    );
  });

  it("an unread register copies an empty value and the value wraps to u16", () => {
    const one = (raw: number | undefined): CopyRow => ({
      address: 0,
      raw,
      alias: undefined,
      scaled: "",
    });
    const opts = { base: 0 as const, includeAlias: false, header: false };
    expect(copyRegistersText([one(undefined)], opts)).toBe(join("0", ""));
    expect(copyRegistersText([one(-2)], opts)).toBe(join("0", "65534"));
  });
});
