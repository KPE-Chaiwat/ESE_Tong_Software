import type { PollHostState } from "../lib/status-line";
import { HOST_ALLOWED, isAllowedHost } from "./poll-list.logic";

const STATES: PollHostState[] = [
  "workspace.normal",
  "workspace.minimized",
  "workspace.maximized",
  "native",
  "closed",
];

describe("HOST_ALLOWED (DES-002 2.5.1)", () => {
  it("the sub-window states move between each other, pop out and close", () => {
    for (const from of STATES.filter((s) => s.startsWith("workspace."))) {
      for (const to of STATES) expect(isAllowedHost(from, to)).toBe(true);
    }
  });

  it("a native poll docks to a normal sub-window or closes, nothing else", () => {
    expect(isAllowedHost("native", "workspace.normal")).toBe(true);
    expect(isAllowedHost("native", "closed")).toBe(true);
    expect(isAllowedHost("native", "workspace.minimized")).toBe(false);
    expect(isAllowedHost("native", "workspace.maximized")).toBe(false);
  });

  it("a closed poll is shown again in the workspace or natively", () => {
    expect(isAllowedHost("closed", "workspace.normal")).toBe(true);
    expect(isAllowedHost("closed", "native")).toBe(true);
    expect(isAllowedHost("closed", "workspace.minimized")).toBe(false);
    expect(isAllowedHost("closed", "workspace.maximized")).toBe(false);
  });

  it("no change is always fine, and every state has an entry", () => {
    for (const s of STATES) expect(isAllowedHost(s, s)).toBe(true);
    expect(Object.keys(HOST_ALLOWED).sort()).toEqual([...STATES].sort());
  });
});
