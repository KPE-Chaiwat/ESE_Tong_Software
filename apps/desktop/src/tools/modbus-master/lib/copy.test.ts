import {
  CLIPBOARD_ERROR,
  type CopyOptions,
  type CopyRow,
  copiedToast,
  copyAliasesText,
  copyHeader,
  copyRowsText,
} from "./copy";

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const join = (...fields: string[]) => fields.join(TAB);

const rows: CopyRow[] = [
  { address: 0, raw: 0, alias: "PT-201", scaled: "4.00" },
  { address: 1, raw: 65535, alias: undefined, scaled: "20.00" },
];
const options = (patch: Partial<CopyOptions> = {}): CopyOptions => ({
  format: "unsigned",
  base: 0,
  columns: "both",
  bits: false,
  includeAlias: false,
  header: false,
  ...patch,
});

describe("copyRowsText (DES-003 3.4)", () => {
  it("Raw: address and raw", () => {
    expect(copyRowsText(rows, options({ columns: "raw" }))).toBe(
      [join("0", "0"), join("1", "65535")].join(LF),
    );
  });

  it("Scaled: address and scaled", () => {
    expect(copyRowsText(rows, options({ columns: "scaled" }))).toBe(
      [join("0", "4.00"), join("1", "20.00")].join(LF),
    );
  });

  it("Both: address, raw, scaled", () => {
    expect(copyRowsText(rows, options())).toBe(
      [join("0", "0", "4.00"), join("1", "65535", "20.00")].join(LF),
    );
  });

  it("with the alias on, it is the first field; a row without an alias gives an empty first field", () => {
    expect(copyRowsText(rows, options({ includeAlias: true }))).toBe(
      [join("PT-201", "0", "0", "4.00"), join("", "1", "65535", "20.00")].join(LF),
    );
  });

  it("raw values use the display format", () => {
    expect(copyRowsText(rows, options({ columns: "raw", format: "hex" }))).toBe(
      [join("0", "0x0000"), join("1", "0xFFFF")].join(LF),
    );
    expect(copyRowsText(rows, options({ columns: "raw", format: "signed" }))).toBe(
      [join("0", "0"), join("1", "-1")].join(LF),
    );
    expect(
      copyRowsText(
        [{ address: 0, raw: 1234, alias: undefined, scaled: "" }],
        options({ columns: "raw", format: "binary" }),
      ),
    ).toBe(join("0", "0000 0100 1101 0010"));
  });

  it("bits are 0 or 1 whatever the format", () => {
    expect(
      copyRowsText(
        [{ address: 4, raw: 1, alias: undefined, scaled: "" }],
        options({ columns: "raw", bits: true, format: "hex" }),
      ),
    ).toBe(join("4", "1"));
  });

  it("addresses use the display base", () => {
    expect(copyRowsText(rows, options({ columns: "raw", base: 1 }))).toBe(
      [join("1", "0"), join("2", "65535")].join(LF),
    );
  });

  it("a row without a scale gives an empty scaled field; a row without a value an empty raw field", () => {
    expect(
      copyRowsText([{ address: 0, raw: undefined, alias: undefined, scaled: "" }], options()),
    ).toBe(join("0", "", ""));
  });

  it("no rows give an empty string", () => {
    expect(copyRowsText([], options())).toBe("");
  });

  it("the example of the acceptance test", () => {
    expect(copyRowsText(rows, options({ includeAlias: true }))).toBe(
      `PT-201${TAB}0${TAB}0${TAB}4.00${LF}${TAB}1${TAB}65535${TAB}20.00`,
    );
  });
});

describe("copyHeader and the header option", () => {
  it("Both with the alias: Alias, Address, Raw, Scaled", () => {
    expect(copyHeader(options({ includeAlias: true, format: "hex" }))).toBe(
      join("Alias", "Address (0-based)", "Raw (Hex)", "Scaled"),
    );
  });

  it("only the columns that are present", () => {
    expect(copyHeader(options({ columns: "raw", base: 1 }))).toBe(
      join("Address (1-based)", "Raw (Unsigned)"),
    );
    expect(copyHeader(options({ columns: "scaled" }))).toBe(join("Address (0-based)", "Scaled"));
  });

  it("the example of DES-003 3.4: Hex with the alias", () => {
    const text = copyRowsText(
      [{ address: 0, raw: 0, alias: "PT-201", scaled: "4.00" }],
      options({ includeAlias: true, format: "hex", header: true }),
    );
    expect(text).toBe(
      [
        join("Alias", "Address (0-based)", "Raw (Hex)", "Scaled"),
        join("PT-201", "0", "0x0000", "4.00"),
      ].join(LF),
    );
  });
});

describe("copyAliasesText", () => {
  it("one alias per row, empty lines for rows without one", () => {
    expect(copyAliasesText([{ alias: "A" }, { alias: undefined }, { alias: "C" }])).toBe(
      ["A", "", "C"].join(LF),
    );
    expect(copyAliasesText([])).toBe("");
  });
});

describe("toasts", () => {
  it("copiedToast", () => {
    expect(copiedToast(1)).toBe("Copied 1 row.");
    expect(copiedToast(3)).toBe("Copied 3 rows.");
  });
  it("the clipboard error text", () => {
    expect(CLIPBOARD_ERROR).toBe("Could not copy to the clipboard.");
  });
});
