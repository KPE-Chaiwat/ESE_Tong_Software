import { createProfileInfoStore } from "./profile-info.store";

describe("profileInfoStore", () => {
  it("is untitled, not modified, without baseline or notice", () => {
    expect(createProfileInfoStore().getState()).toMatchObject({
      name: null,
      modified: false,
      baseline: null,
      migrated: false,
    });
  });

  it("holds the name and the modified flag", () => {
    const s = createProfileInfoStore();
    s.getState().setName("Boiler-PLC");
    s.getState().setModified(true);
    expect(s.getState()).toMatchObject({ name: "Boiler-PLC", modified: true });
  });

  it("the first evaluated content becomes the baseline", () => {
    const s = createProfileInfoStore();
    s.getState().evaluate("a");
    expect(s.getState()).toMatchObject({ baseline: "a", modified: false });
  });

  it("is modified when the content differs from the baseline and clean again when it returns", () => {
    const s = createProfileInfoStore();
    s.getState().setBaseline("a");
    s.getState().evaluate("b");
    expect(s.getState().modified).toBe(true);
    s.getState().evaluate("a");
    expect(s.getState().modified).toBe(false);
  });

  it("setBaseline (a load or a save) clears the modified flag", () => {
    const s = createProfileInfoStore();
    s.getState().setBaseline("a");
    s.getState().evaluate("b");
    s.getState().setBaseline("b");
    expect(s.getState()).toMatchObject({ baseline: "b", modified: false });
  });

  it("the migration notice is set and dismissed", () => {
    const s = createProfileInfoStore();
    s.getState().setMigrated(true);
    expect(s.getState().migrated).toBe(true);
    s.getState().setMigrated(false);
    expect(s.getState().migrated).toBe(false);
  });
});
