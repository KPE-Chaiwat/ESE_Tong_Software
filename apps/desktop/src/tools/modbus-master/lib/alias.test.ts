import {
  ALIAS_CONTROL,
  ALIAS_SPACE,
  ALIAS_TOO_LONG,
  aliasError,
  aliasMap,
  aliasSchema,
  entriesFromMap,
  MAX_ALIAS_LENGTH,
  mergeAliases,
  parseAliasPaste,
  parseAliasPasteAt,
  pasteToastText,
  splitClipboardLines,
} from "./alias";

describe("aliasError (DES-002 section 4)", () => {
  it.each([
    ["x".repeat(33), ALIAS_TOO_LONG],
    [" a", ALIAS_SPACE],
    ["a ", ALIAS_SPACE],
    ["a\tb", ALIAS_CONTROL],
    ["a\nb", ALIAS_CONTROL],
    ["a\u0007", ALIAS_CONTROL],
  ])("%j gives %j", (text, message) => {
    expect(aliasError(text)).toBe(message);
  });

  it("32 characters are valid, 33 are not", () => {
    expect(aliasError("x".repeat(MAX_ALIAS_LENGTH))).toBeNull();
    expect(aliasError("x".repeat(MAX_ALIAS_LENGTH + 1))).toBe(
      "Alias must be at most 32 characters.",
    );
  });

  it("empty and spaces-only are valid (they remove the alias)", () => {
    expect(aliasError("")).toBeNull();
    expect(aliasError("   ")).toBeNull();
  });

  it("duplicates are not an error (aliases are not unique)", () => {
    expect(aliasError("PT-201")).toBeNull();
  });

  it("the first failing rule wins", () => {
    expect(aliasError(` ${"x".repeat(40)}`)).toBe(ALIAS_TOO_LONG);
  });
});

describe("aliasSchema", () => {
  it("maps spaces-only to the empty alias", () => {
    expect(aliasSchema().parse("   ")).toBe("");
    expect(aliasSchema().parse("Tank top")).toBe("Tank top");
  });
  it("reports the message of the first failing rule", () => {
    const result = aliasSchema().safeParse("a\tb");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe(ALIAS_CONTROL);
  });
});

describe("splitClipboardLines", () => {
  it("splits on \\r\\n and \\n and drops one trailing empty line", () => {
    expect(splitClipboardLines("A\r\nB\nC\n")).toEqual(["A", "B", "C"]);
    expect(splitClipboardLines("A\n\n")).toEqual(["A", ""]);
    expect(splitClipboardLines("")).toEqual([]);
  });
});

describe("parseAliasPaste", () => {
  it("the design example: lines beyond the range are dropped and counted", () => {
    const result = parseAliasPaste("A\nB\n\nC\tx\n", 8, 9);
    expect(result.entries).toEqual([
      { address: 8, alias: "A" },
      { address: 9, alias: "B" },
    ]);
    expect(result.beyond).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it("uses the text before the first tab", () => {
    const result = parseAliasPaste("PT-201\t12.5\tmA", 0, 5);
    expect(result.entries).toEqual([{ address: 0, alias: "PT-201" }]);
  });

  it("an empty line in range clears that alias", () => {
    const result = parseAliasPaste("A\n\nC", 0, 5);
    expect(result.entries).toEqual([
      { address: 0, alias: "A" },
      { address: 1, alias: "" },
      { address: 2, alias: "C" },
    ]);
  });

  it("invalid lines are skipped but keep their row", () => {
    const result = parseAliasPaste(`A\n${"x".repeat(40)}\nC\nbad\u0007`, 0, 10);
    expect(result.entries).toEqual([
      { address: 0, alias: "A" },
      { address: 2, alias: "C" },
    ]);
    expect(result.skipped).toBe(2);
  });

  it("handles \\r\\n line ends", () => {
    expect(parseAliasPaste("A\r\nB\r\n", 3, 9).entries).toEqual([
      { address: 3, alias: "A" },
      { address: 4, alias: "B" },
    ]);
  });

  it("counts invalid lines beyond the range as beyond, not skipped", () => {
    const result = parseAliasPaste("A\nB\nbad\u0007", 0, 1);
    expect(result.beyond).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("empty text gives nothing", () => {
    expect(parseAliasPaste("", 0, 9)).toEqual({ entries: [], skipped: 0, beyond: 0 });
  });
});

describe("alias list helpers", () => {
  it("entriesFromMap sorts by address and drops empty aliases", () => {
    const map = new Map([
      [5, "B"],
      [1, "A"],
      [3, ""],
    ]);
    expect(entriesFromMap(map)).toEqual([
      { address: 1, alias: "A" },
      { address: 5, alias: "B" },
    ]);
  });

  it("aliasMap and entriesFromMap round trip", () => {
    const entries = [
      { address: 0, alias: "A" },
      { address: 7, alias: "B" },
    ];
    expect(entriesFromMap(aliasMap(entries))).toEqual(entries);
  });

  describe("mergeAliases", () => {
    const existing = [
      { address: 1, alias: "A" },
      { address: 4, alias: "D" },
    ];

    it("adds, changes and removes, keeping the list sorted", () => {
      const out = mergeAliases(existing, [
        { address: 2, alias: "B" },
        { address: 4, alias: "" },
        { address: 1, alias: "A2" },
      ]);
      expect(out.entries).toEqual([
        { address: 1, alias: "A2" },
        { address: 2, alias: "B" },
      ]);
      expect(out.capped).toBe(false);
      expect(out.applied).toBe(3);
    });

    it("does not count an edit that changes nothing", () => {
      expect(mergeAliases(existing, [{ address: 1, alias: "A" }]).applied).toBe(0);
      expect(mergeAliases(existing, [{ address: 9, alias: "" }]).applied).toBe(0);
    });

    it("stops new aliases at the limit but still allows changes and removals", () => {
      const full = Array.from({ length: 3 }, (_, i) => ({ address: i, alias: `a${i}` }));
      const out = mergeAliases(
        full,
        [
          { address: 10, alias: "new" },
          { address: 0, alias: "changed" },
          { address: 1, alias: "" },
          { address: 11, alias: "new2" },
        ],
        3,
      );
      // address 1 was removed first? No: edits are in order. 10 is refused (3 of 3), 0 changes,
      // 1 is removed (2 of 3), so 11 fits.
      expect(out.entries.map((e) => e.address)).toEqual([0, 2, 11]);
      expect(out.dropped).toBe(1);
      expect(out.capped).toBe(true);
    });
  });
});

describe("pasteToastText", () => {
  it("plain", () => {
    expect(pasteToastText(2, 0, 0, false)).toBe("Pasted 2 aliases.");
  });
  it("with skipped and beyond", () => {
    expect(pasteToastText(3, 1, 2, false)).toBe(
      "Pasted 3 aliases. Skipped 1 invalid lines. 2 lines were beyond the poll range.",
    );
    expect(pasteToastText(2, 0, 2, false)).toBe(
      "Pasted 2 aliases. 2 lines were beyond the poll range.",
    );
  });
  it("at the cap", () => {
    expect(pasteToastText(5, 0, 0, true)).toBe(
      "Pasted 5 aliases. The poll has reached 2000 aliases.",
    );
  });
});

describe("parseAliasPasteAt (one line per row, DES-009 8.5)", () => {
  it("puts line i on the i-th address and counts the lines past the last one", () => {
    const result = parseAliasPasteAt("A\nB\nC\nD", [1, 2, 4]);
    expect(result.entries).toEqual([
      { address: 1, alias: "A" },
      { address: 2, alias: "B" },
      { address: 4, alias: "C" },
    ]);
    expect(result.beyond).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("an invalid line is skipped but still takes its row; an empty line clears", () => {
    const result = parseAliasPasteAt(`A\n${"x".repeat(40)}\n\nD`, [10, 12, 14, 16]);
    expect(result.entries).toEqual([
      { address: 10, alias: "A" },
      { address: 14, alias: "" },
      { address: 16, alias: "D" },
    ]);
    expect(result.skipped).toBe(1);
  });

  it("parseAliasPaste is the same with consecutive addresses", () => {
    expect(parseAliasPaste("A\nB", 5, 6)).toEqual(parseAliasPasteAt("A\nB", [5, 6]));
    expect(parseAliasPaste("A\nB\nC", 5, 6).beyond).toBe(1);
  });
});
