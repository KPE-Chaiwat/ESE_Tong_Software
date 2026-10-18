import {
  duplicateName,
  MAX_POLL_NAME_LENGTH,
  nextPollName,
  POLL_NAME_CONTROL,
  POLL_NAME_REQUIRED,
  POLL_NAME_SPACE,
  POLL_NAME_TOO_LONG,
  pollNameError,
  pollNameSchema,
  pollNameTaken,
} from "./poll-names";

describe("pollNameError (DES-002 section 4, first failing rule only)", () => {
  it.each([
    ["", POLL_NAME_REQUIRED],
    ["   ", POLL_NAME_REQUIRED],
    ["x".repeat(49), POLL_NAME_TOO_LONG],
    [" a", POLL_NAME_SPACE],
    ["a ", POLL_NAME_SPACE],
    ["a\u0007b", POLL_NAME_CONTROL],
    ["a\tb", POLL_NAME_CONTROL],
  ])("%j gives %j", (name, message) => {
    expect(pollNameError(name, [])).toBe(message);
  });

  it("48 characters are fine, 49 are not", () => {
    expect(pollNameError("x".repeat(MAX_POLL_NAME_LENGTH))).toBeNull();
    expect(pollNameError("x".repeat(MAX_POLL_NAME_LENGTH + 1))).toBe(POLL_NAME_TOO_LONG);
  });

  it("counts characters, not UTF-16 units", () => {
    expect(pollNameError("😀".repeat(48))).toBeNull();
    expect(pollNameError("😀".repeat(49))).toBe(POLL_NAME_TOO_LONG);
  });

  it("is unique per connection, case-insensitive (CHK2-B4)", () => {
    expect(pollNameError("tank", ["Tank", "Pump"])).toBe(
      'A poll named "tank" already exists on this connection.',
    );
    expect(pollNameError("tank", ["Tank"])).toBe(pollNameTaken("tank"));
    expect(pollNameError("Tank 2", ["Tank"])).toBeNull();
  });

  it("reports the earlier rule when several fail", () => {
    expect(pollNameError(` ${"x".repeat(60)}`, ["x"])).toBe(POLL_NAME_TOO_LONG);
    expect(pollNameError(" tank", ["tank"])).toBe(POLL_NAME_SPACE);
  });
});

describe("pollNameSchema", () => {
  it("accepts a valid name and reports one message for a bad one", () => {
    const schema = pollNameSchema(["Tank"]);
    expect(schema.safeParse("Pump").success).toBe(true);
    const bad = schema.safeParse("tank");
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues).toHaveLength(1);
      expect(bad.error.issues[0]?.message).toBe(pollNameTaken("tank"));
    }
  });
});

describe("nextPollName", () => {
  it("starts at Poll 1", () => {
    expect(nextPollName([])).toBe("Poll 1");
  });
  it("fills the lowest free number (CHK2-B2)", () => {
    expect(nextPollName(["Poll 1", "Poll 3"])).toBe("Poll 2");
    expect(nextPollName(["Poll 1", "Poll 2"])).toBe("Poll 3");
  });
  it("compares case-insensitively and ignores other names", () => {
    expect(nextPollName(["poll 1", "Tank"])).toBe("Poll 2");
  });
});

describe("duplicateName", () => {
  it("adds ' copy'", () => {
    expect(duplicateName("Tank", ["Tank"])).toBe("Tank copy");
  });
  it("counts up when the copy exists (CHK2-B5)", () => {
    expect(duplicateName("Tank", ["Tank", "Tank copy"])).toBe("Tank copy 2");
    expect(duplicateName("Tank", ["Tank", "Tank copy", "tank copy 2"])).toBe("Tank copy 3");
  });
  it("keeps the result within 48 characters", () => {
    const long = "x".repeat(48);
    const copy = duplicateName(long, [long]);
    expect(copy.length).toBeLessThanOrEqual(48);
    expect(copy.endsWith(" copy")).toBe(true);
    const copy2 = duplicateName(long, [long, copy]);
    expect(copy2.length).toBeLessThanOrEqual(48);
    expect(copy2.endsWith(" copy 2")).toBe(true);
    expect(pollNameError(copy2, [long, copy])).toBeNull();
  });
});
