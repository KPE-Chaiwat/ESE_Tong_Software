import { createConnectionDraftStore, defaultTcpConnection } from "./connection-draft.store";

describe("connectionDraftStore", () => {
  it("starts with the DES-001 TCP defaults", () => {
    expect(createConnectionDraftStore().getState().connection).toEqual({
      mode: "tcp",
      host: "",
      port: 502,
      timeoutMs: 1000,
    });
    expect(defaultTcpConnection()).toEqual({ mode: "tcp", host: "", port: 502, timeoutMs: 1000 });
  });

  it("holds the typed connection and resets", () => {
    const s = createConnectionDraftStore();
    s.getState().setConnection({ mode: "tcp", host: "plc", port: 1502, timeoutMs: 500 });
    expect(s.getState().connection).toMatchObject({ host: "plc" });
    s.getState().reset();
    expect(s.getState().connection).toEqual(defaultTcpConnection());
  });
});
