import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  disposeHarnesses,
  installPollViewEnvironment,
  renderPollView,
  uninstallPollViewEnvironment,
} from "./test-utils";

beforeAll(installPollViewEnvironment);
afterAll(uninstallPollViewEnvironment);
afterEach(disposeHarnesses);
describe.each(["workspace", "native"] as const)("interpretation draft in %s", (host) => {
  it("previews order without applying, applies once, and preserves a rejected draft", async () => {
    const h = await renderPollView({ host, mode: "manual", width: 900 });
    act(() => h.rt.stores.ui.getState().setSetupOpen(true));
    const section = screen.getByRole("region", { name: "Interpretation" });
    await h.user.selectOptions(within(section).getByLabelText("Interpretation"), "unsigned64");
    await h.user.selectOptions(within(section).getByLabelText("Byte order"), "littleByteSwap");
    expect(h.rt.stores.poll.getState().config?.display.format).toBe("unsigned");
    expect(within(section).getByText(/Decode: DE F0 9A BC 56 78 12 34/)).toBeInTheDocument();
    await h.user.click(within(section).getByRole("button", { name: "Apply interpretation" }));
    expect(h.rt.stores.poll.getState().config?.display).toMatchObject({
      format: "unsigned64",
      reverseWords: true,
    });
    expect(
      within(section).getByText("Applied: Unsigned 64-bit · Little-endian byte swap (GHEFCDAB)"),
    ).toBeInTheDocument();
    await h.user.selectOptions(within(section).getByLabelText("Interpretation"), "float64");
    h.ipc.failNext("setPollView", "Rejected view");
    await h.user.click(within(section).getByRole("button", { name: "Apply interpretation" }));
    expect(within(section).getByRole("alert")).toHaveTextContent(
      "Could not apply interpretation. Rejected view",
    );
    expect(h.rt.stores.poll.getState().config?.display.format).toBe("unsigned64");
    expect(within(section).getByLabelText("Interpretation")).toHaveValue("float64");
  });
});
it("offers four named endian orders with exact 32-bit byte sequences", async () => {
  const h = await renderPollView({ host: "workspace", mode: "manual", width: 900 });
  act(() => h.rt.stores.ui.getState().setSetupOpen(true));
  const section = screen.getByRole("region", { name: "Interpretation" });
  await h.user.selectOptions(within(section).getByLabelText("Interpretation"), "unsigned32");
  const select = within(section).getByLabelText("Byte order");
  for (const [id, name, sequence, swapBytes, reverseWords] of [
    ["big", "Big-endian", "ABCD", false, false],
    ["little", "Little-endian", "DCBA", true, true],
    ["bigByteSwap", "Big-endian byte swap", "BADC", true, false],
    ["littleByteSwap", "Little-endian byte swap", "CDAB", false, true],
  ] as const) {
    expect(
      within(section).getByRole("option", { name: `${name} (${sequence})` }),
    ).toBeInTheDocument();
    await h.user.selectOptions(select, id);
    expect(select).toHaveValue(id);
    await h.user.click(within(section).getByRole("button", { name: "Apply interpretation" }));
    expect(h.rt.stores.poll.getState().config?.display).toMatchObject({
      format: "unsigned32",
      swapBytes,
      reverseWords,
    });
    expect(
      within(section).getByText(`Applied: Unsigned 32-bit · ${name} (${sequence})`),
    ).toBeInTheDocument();
  }
});
it.each([
  { host: "workspace", format: "unsigned" },
  { host: "native", format: "unsigned32" },
] as const)("opens Format / endian from the $host $format grid menu", async ({ host, format }) => {
  const h = await renderPollView({
    host,
    mode: "manual",
    width: 900,
    poll: {
      display: {
        format,
        swapBytes: false,
        reverseWords: false,
        addressBase: 0,
        showAlias: true,
        copyAlias: false,
      },
    },
  });
  act(() => {
    h.ipc.emitConnectionState("connected");
    h.ipc.emitPollState(h.pollId, "polling");
    h.ipc.emitPollUpdate(h.pollId, { values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    h.rt.stores.ui.getState().setSetupOpen(false);
  });
  const row = within(screen.getByRole("grid", { name: "Register values" })).getAllByRole("row")[1];
  if (!row) throw new Error("Missing data row");
  fireEvent.contextMenu(row);
  await h.user.click(screen.getByRole("menuitem", { name: "Format / endian…" }));
  const section = screen.getByRole("region", { name: "Interpretation" });
  const select = within(section).getByLabelText("Interpretation");
  await waitFor(() => expect(select).toHaveFocus());
  expect(h.rt.stores.ui.getState().setupOpen).toBe(true);
  expect(h.rt.stores.poll.getState().config?.display.format).toBe(format);
  expect(within(section).getByRole("button", { name: "Apply interpretation" })).toBeVisible();
});
