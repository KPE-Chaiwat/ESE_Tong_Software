import type { ConnectionConfig, PollConfig } from "@/shared/ipc/modbus-master.types";
import {
  contentSignature,
  disconnectAndLoadBody,
  MIGRATION_NOTICE,
  sameConfigs,
  saveChangesBody,
} from "./profile.logic";

const TCP: ConnectionConfig = { mode: "tcp", host: "h", port: 502, timeoutMs: 1000 };

function config(id: number, patch: Partial<PollConfig> = {}): PollConfig {
  return {
    pollId: id,
    name: `Poll ${id}`,
    definition: { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
    active: true,
    display: { format: "unsigned", addressBase: 0, showAlias: true, copyAlias: false },
    scale: null,
    scaleOverrides: [],
    valueColumns: "raw",
    aliases: [],
    ...patch,
  };
}

const sig = (polls: PollConfig[], autoStartPoll = true, connection = TCP) =>
  contentSignature({ connection, autoStartPoll, polls });

describe("contentSignature (DES-002 6.1: what marks a profile modified)", () => {
  const base = sig([config(1), config(2)]);

  it("ignores the list order", () => {
    expect(sig([config(2), config(1)])).toBe(base);
  });

  it("ignores Pause and Resume (`active`)", () => {
    expect(sig([config(1, { active: false }), config(2)])).toBe(base);
  });

  it.each([
    ["a rename", config(1, { name: "Tank" })],
    [
      "an applied definition",
      config(1, {
        definition: { slaveId: 2, function: 3, startAddress: 0, quantity: 10, scanRateMs: 100 },
      }),
    ],
    [
      "the display format",
      config(1, {
        display: { format: "hex", addressBase: 0, showAlias: true, copyAlias: false },
      }),
    ],
    [
      "the address base",
      config(1, {
        display: { format: "unsigned", addressBase: 1, showAlias: true, copyAlias: false },
      }),
    ],
    [
      "the Alias column",
      config(1, {
        display: { format: "unsigned", addressBase: 0, showAlias: false, copyAlias: false },
      }),
    ],
    [
      "Include alias in copy",
      config(1, {
        display: { format: "unsigned", addressBase: 0, showAlias: true, copyAlias: true },
      }),
    ],
    ["an alias", config(1, { aliases: [{ address: 0, alias: "PT-201" }] })],
    ["the value columns", config(1, { valueColumns: "both" })],
    [
      "a scale",
      config(1, {
        scale: {
          preset: "linear",
          rawMin: 0,
          rawMax: 100,
          engMin: 0,
          engMax: 10,
          decimals: 1,
          unit: "",
        } as never,
      }),
    ],
    ["an override", config(1, { scaleOverrides: [{ start: 0, end: 1, scale: null } as never] })],
  ])("is changed by %s", (_name, changed) => {
    expect(sig([changed, config(2)])).not.toBe(base);
  });

  it("is changed by adding or deleting a poll", () => {
    expect(sig([config(1), config(2), config(3)])).not.toBe(base);
    expect(sig([config(1)])).not.toBe(base);
  });

  it("is changed by the connection and by Start polling when connected", () => {
    expect(sig([config(1), config(2)], false)).not.toBe(base);
    expect(sig([config(1), config(2)], true, { ...TCP, host: "other" })).not.toBe(base);
  });
});

describe("texts", () => {
  it("the migration notice is the DES-002 6.2 text", () => {
    expect(MIGRATION_NOTICE).toBe(
      'This profile was saved by an earlier version. Its poll is now "Poll 1". Saving stores it in the new format, which earlier versions cannot open.',
    );
  });

  it("the Save changes? body names the profile or asks for a profile, for closing and for loading", () => {
    const base = { nativeWindowCount: 0, unappliedPollNames: [] as string[] };
    expect(saveChangesBody({ ...base, profileName: "Boiler-PLC", reason: "close" })).toBe(
      'Save changes to "Boiler-PLC" before closing?',
    );
    expect(saveChangesBody({ ...base, profileName: null, reason: "close" })).toBe(
      "Save this setup as a profile before closing?",
    );
    // FE-002 31c vectors (REPORT-006 O7)
    expect(
      saveChangesBody({
        profileName: null,
        nativeWindowCount: 1,
        unappliedPollNames: ["Poll 2"],
        reason: "load",
      }),
    ).toBe(
      "Save this setup as a profile before loading? This also closes 1 poll window. Unapplied edits in: Poll 2.",
    );
    expect(saveChangesBody({ ...base, profileName: "Plant", reason: "load" })).toBe(
      'Save changes to "Plant" before loading?',
    );
    expect(
      saveChangesBody({
        profileName: null,
        nativeWindowCount: 2,
        unappliedPollNames: ["Poll 3"],
        reason: "close",
      }),
    ).toBe(
      "Save this setup as a profile before closing? This also closes 2 poll windows. Unapplied edits in: Poll 3.",
    );
  });

  it("the Disconnect and load? body names the running connection", () => {
    expect(disconnectAndLoadBody("Boiler", TCP)).toBe(
      'Loading "Boiler" will disconnect from TCP h:502.',
    );
  });
});

describe("sameConfigs", () => {
  it("compares by reference", () => {
    const a = config(1);
    expect(sameConfigs([a], [a])).toBe(true);
    expect(sameConfigs([a], [config(1)])).toBe(false);
    expect(sameConfigs([a], [])).toBe(false);
  });
});
