import { pollConfigInput } from "@/shared/ipc/modbus-master.fake";
import type { PollConfig } from "@/shared/ipc/modbus-master.types";
import {
  type DraftContext,
  draftFromConfig,
  draftHasEdits,
  draftTexts,
  patchDraft,
  rebaseDraft,
  reconcileDraft,
  validateDraft,
  validateDraftField,
} from "./poll-draft.logic";

const config = (patch: Partial<PollConfig> = {}): PollConfig => ({
  ...pollConfigInput({
    name: "Tank",
    definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 },
  }),
  pollId: 1,
  active: true,
  ...patch,
});

const ctx: DraftContext = { mode: "tcp", base: 0, others: ["Pump"] };

describe("draftTexts and draftFromConfig", () => {
  it("shows the applied poll as text, the start in the display base", () => {
    expect(draftTexts(config())).toEqual({
      name: "Tank",
      slaveId: "1",
      function: "3",
      startAddress: "0",
      quantity: "10",
      scanRateMs: "1000",
    });
    const oneBased = config({
      display: { addressBase: 1, showAlias: true, copyAlias: false },
    });
    expect(draftTexts(oneBased).startAddress).toBe("1");
  });

  it("a draft from the config has no edits", () => {
    const draft = draftFromConfig(config());
    expect(draft.dirty).toEqual([]);
    expect(draftHasEdits(draft)).toBe(false);
    expect(draftHasEdits(null)).toBe(false);
  });
});

describe("patchDraft", () => {
  it("marks a changed field dirty and keeps the others", () => {
    const draft = patchDraft(null, config(), "quantity", "200");
    expect(draft).toMatchObject({ quantity: "200", name: "Tank", dirty: ["quantity"] });
    expect(draftHasEdits(draft)).toBe(true);
  });

  it("typing the applied value again makes the field clean", () => {
    const draft = patchDraft(
      patchDraft(null, config(), "quantity", "200"),
      config(),
      "quantity",
      "10",
    );
    expect(draft.dirty).toEqual([]);
  });

  it("an edit removes the old message of that field only", () => {
    let draft = patchDraft(null, config(), "quantity", "200");
    draft = { ...draft, errors: { quantity: "bad", scanRateMs: "also bad" } };
    draft = patchDraft(draft, config(), "quantity", "201");
    expect(draft.errors).toEqual({ scanRateMs: "also bad" });
  });

  it("does not change its input", () => {
    const first = patchDraft(null, config(), "quantity", "200");
    const second = patchDraft(first, config(), "slaveId", "5");
    expect(first.dirty).toEqual(["quantity"]);
    expect(second.dirty).toEqual(["quantity", "slaveId"]);
  });
});

describe("reconcileDraft", () => {
  it("returns null without a draft", () => {
    expect(reconcileDraft(null, config())).toBeNull();
  });

  it("a rename from elsewhere keeps the draft: untouched fields follow, edited ones stay", () => {
    const draft = patchDraft(null, config(), "quantity", "200");
    const out = reconcileDraft(draft, config({ name: "Tank 1" }));
    expect(out).toMatchObject({ name: "Tank 1", quantity: "200", dirty: ["quantity"] });
  });

  it("a dirty name stays when it is renamed elsewhere", () => {
    const draft = patchDraft(null, config(), "name", "My name");
    expect(reconcileDraft(draft, config({ name: "Tank 1" }))).toMatchObject({
      name: "My name",
      dirty: ["name"],
    });
  });

  it("keeps the message of a dirty field, including an invalid one", () => {
    const draft = {
      ...patchDraft(null, config(), "quantity", "200"),
      errors: { quantity: "Quantity for FC03 must be from 1 to 125." },
    };
    expect(reconcileDraft(draft, config({ name: "X" }))?.errors).toEqual(draft.errors);
  });

  it("is null when the applied poll caught up with the draft", () => {
    const draft = patchDraft(null, config(), "quantity", "20");
    const applied = config({
      definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 20, scanRateMs: 1000 },
    });
    expect(reconcileDraft(draft, applied)).toBeNull();
  });
});

describe("rebaseDraft", () => {
  it("converts a valid start address to the new base", () => {
    const draft = patchDraft(null, config(), "startAddress", "5");
    expect(rebaseDraft(draft, 0, 1)?.startAddress).toBe("6");
    expect(rebaseDraft(draft, 1, 0)?.startAddress).toBe("4");
  });

  it("leaves text that is not a number alone", () => {
    const draft = patchDraft(null, config(), "startAddress", "abc");
    expect(rebaseDraft(draft, 0, 1)?.startAddress).toBe("abc");
  });

  it("removes the message of the start field and does nothing for the same base or no draft", () => {
    const draft = {
      ...patchDraft(null, config(), "startAddress", "5"),
      errors: { startAddress: "x", quantity: "y" },
    };
    expect(rebaseDraft(draft, 0, 1)?.errors).toEqual({ quantity: "y" });
    expect(rebaseDraft(draft, 0, 0)).toBe(draft);
    expect(rebaseDraft(null, 0, 1)).toBeNull();
  });
});

describe("validateDraft", () => {
  const draft = (patch: Record<string, string>) => ({
    ...draftFromConfig(config()),
    ...patch,
  });

  it("accepts the applied poll", () => {
    expect(validateDraft(draftFromConfig(config()), ctx)).toEqual({
      ok: true,
      name: "Tank",
      definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 },
    });
  });

  it("converts the start address from the display base", () => {
    const result = validateDraft(draft({ startAddress: "1" }), { ...ctx, base: 1 });
    expect(result).toMatchObject({ ok: true, definition: { startAddress: 0 } });
  });

  it.each([
    ["slaveId", "248", "Slave ID must be a whole number from 0 to 247."],
    ["quantity", "126", "Quantity for FC03 must be from 1 to 125."],
    ["scanRateMs", "19", "Scan rate must be a whole number from 20 to 60000 ms."],
    ["startAddress", "70000", "Start address must be a whole number from 0 to 65535."],
    ["name", "", "Enter a poll name."],
    ["name", "pump", 'A poll named "pump" already exists on this connection.'],
    ["name", " a", "Poll name cannot start or end with a space."],
  ] as const)("%s = %j gives %j", (field, text, message) => {
    const result = validateDraft(draft({ [field]: text }), ctx);
    expect(result).toEqual({ ok: false, errors: { [field]: message } });
  });

  it("reports every field that fails, one message each", () => {
    const result = validateDraft(draft({ slaveId: "999", quantity: "0", name: "" }), ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["name", "quantity", "slaveId"]);
    }
  });

  it("slave 0 is not allowed for reads on RTU", () => {
    expect(validateDraft(draft({ slaveId: "0" }), { ...ctx, mode: "rtu" })).toEqual({
      ok: false,
      errors: { slaveId: "Slave ID 0 is broadcast and cannot be used for reads. Use 1 to 247." },
    });
    expect(validateDraft(draft({ slaveId: "0" }), ctx).ok).toBe(true);
  });

  it("a range that ends after the last address is a quantity message", () => {
    const result = validateDraft(draft({ startAddress: "65530", quantity: "10" }), ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.quantity).toContain("maximum quantity from 65530 is 6");
  });
});

describe("validateDraftField", () => {
  it("shows the message of one field and leaves the others", () => {
    const draft = {
      ...patchDraft(patchDraft(null, config(), "quantity", "200"), config(), "scanRateMs", "5"),
      errors: { scanRateMs: "old" },
    };
    const out = validateDraftField(draft, "quantity", ctx);
    expect(out.errors).toEqual({
      scanRateMs: "old",
      quantity: "Quantity for FC03 must be from 1 to 125.",
    });
  });

  it("clears the message of a field that became valid", () => {
    const draft = {
      ...patchDraft(null, config(), "quantity", "20"),
      errors: { quantity: "stale message" },
    };
    expect(validateDraftField(draft, "quantity", ctx).errors).toEqual({});
  });
});
