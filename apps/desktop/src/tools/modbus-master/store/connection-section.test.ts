import type { SessionReason } from "@/shared/ipc/modbus-master.types";
import { initialSectionExpanded, sectionAfterTransition } from "./connection-section.logic";
import { createConnectionSectionStore } from "./connection-section.store";

const reason = (kind: SessionReason["kind"]): SessionReason => ({
  kind,
  phase: "connectFailed",
  message: kind,
});

describe("section logic (DES-002 2.2.2)", () => {
  it("is expanded while idle or disconnected, collapsed otherwise", () => {
    expect(initialSectionExpanded("idle")).toBe(true);
    expect(initialSectionExpanded("disconnected")).toBe(true);
    expect(initialSectionExpanded("connecting")).toBe(false);
    expect(initialSectionExpanded("connected")).toBe(false);
  });

  it("collapses on entering connected", () => {
    expect(sectionAfterTransition(true, "connecting", "connected", null)).toBe(false);
  });

  it.each(["portBusy", "portNotFound", "refused"] as const)(
    "re-expands on a %s disconnect",
    (kind) => {
      expect(sectionAfterTransition(false, "connecting", "disconnected", reason(kind))).toBe(true);
    },
  );

  it("keeps the user's choice for other transitions and other reasons", () => {
    expect(
      sectionAfterTransition(false, "connecting", "disconnected", reason("closedByPeer")),
    ).toBe(false);
    expect(sectionAfterTransition(true, "idle", "connecting", null)).toBe(true);
    expect(sectionAfterTransition(false, "connected", "idle", null)).toBe(false);
  });

  it("ignores a repeat of the same state", () => {
    expect(sectionAfterTransition(true, "connected", "connected", null)).toBe(true);
  });
});

describe("connectionSectionStore", () => {
  it("starts expanded and follows the snapshot", () => {
    const s = createConnectionSectionStore();
    expect(s.getState().expanded).toBe(true);
    s.getState().applySnapshot("connected");
    expect(s.getState().expanded).toBe(false);
  });

  it("collapses on connect and re-expands on a refused connect", () => {
    const s = createConnectionSectionStore();
    s.getState().applyTransition("connecting", "connected", null);
    expect(s.getState().expanded).toBe(false);
    s.getState().applyTransition("connecting", "disconnected", reason("refused"));
    expect(s.getState().expanded).toBe(true);
  });

  it("toggle, expand and edit (which also asks the form for the focus)", () => {
    const s = createConnectionSectionStore();
    s.getState().toggle();
    expect(s.getState().expanded).toBe(false);
    s.getState().expand();
    expect(s.getState().expanded).toBe(true);
    s.getState().toggle();
    s.getState().edit();
    expect(s.getState()).toMatchObject({ expanded: true, focusRequest: 1 });
    s.getState().edit();
    expect(s.getState().focusRequest).toBe(2);
  });
});
