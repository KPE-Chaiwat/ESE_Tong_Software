// Scale settings in the profile (DES-003 5, FE-003 task 09, CHK3-G1, G2): they travel with each poll
// through Open and Save, and a profile without them opens as None with Raw columns.
import { screen, waitFor, within } from "@testing-library/react";
import type { PollId, ScaleOverride, ScaleSettings } from "@/shared/ipc/modbus-master.types";
import { pollProfile, profileV2 } from "../components/dialogs/profile-fixtures";
import { type Harness, renderWindow } from "../components/test-utils";
import { presetDefaults } from "../lib/scale-presets";

let h: Harness;
afterEach(() => h?.rt.dispose());

const modified = () => h.rt.stores.profile.getState().modified;

const clamped: ScaleSettings = {
  ...presetDefaults("current4to20"),
  xMin: 4000,
  xMax: 20000,
  outOfRange: "clamp",
  decimals: 3,
  unit: "mA",
};
const overrides: ScaleOverride[] = [
  { start: 0, end: 3, scale: { ...presetDefaults("divide"), unit: "°C" } },
  {
    start: 8,
    end: 9,
    scale: { ...presetDefaults("divide"), divisor: 100, decimals: 2, unit: "bar", rawSigned: true },
  },
];

async function open(profile: ReturnType<typeof profileV2>) {
  h = await renderWindow({
    prepare: ({ ipc }) => {
      ipc.seedProfiles([profile]);
    },
  });
  await h.act(() => h.rt.profileFlow.load(profile.name));
  expect(modified()).toBe(false);
  return h.ipc.pollIds();
}

const attached = async (id: PollId) => {
  const view = h.rt.views.get(id);
  await waitFor(() => expect(view.stores.poll.getState().config).not.toBeNull());
  return view;
};

describe("round trip (CHK3-G1)", () => {
  it("a poll with a scale, two overrides and value columns Scaled is saved and opened exactly", async () => {
    const original = profileV2("Scaled", [
      pollProfile("Tank", { scale: clamped, scaleOverrides: overrides, valueColumns: "scaled" }),
      pollProfile("Plain"),
    ]);
    const [tank, plain] = await open(original);
    const view = await attached(tank as PollId);
    expect(view.stores.scale.getState()).toMatchObject({
      scale: clamped,
      overrides,
      valueColumns: "scaled",
    });
    expect(h.ipc.pollSummary(tank as PollId).config).toMatchObject({
      scale: clamped,
      scaleOverrides: overrides,
      valueColumns: "scaled",
    });
    await h.act(() => h.rt.profileFlow.save());
    const saved = await h.ipc.profilesGet("Scaled");
    // deep equal, down to the numbers: apply, then export (the placements are the workspace's own)
    const withoutView = (profile: typeof saved) => profile.polls.map(({ view: _view, ...p }) => p);
    expect(withoutView(saved)).toEqual(withoutView(original));
    expect(saved.polls[0]?.scaleOverrides).toHaveLength(2);
    // the other poll is not touched
    expect(h.ipc.pollSummary(plain as PollId).config).toMatchObject({
      scale: null,
      scaleOverrides: [],
      valueColumns: "raw",
    });
    // the numbers in the file are JSON numbers
    const json = JSON.parse(JSON.stringify(saved));
    expect(typeof json.polls[0].scale.xMin).toBe("number");
    expect(typeof json.polls[0].scaleOverrides[1].scale.divisor).toBe("number");
  });

  it("the scale editor and the table show the loaded settings", async () => {
    const original = profileV2("Scaled", [
      pollProfile("Tank", { scale: clamped, scaleOverrides: overrides, valueColumns: "both" }),
    ]);
    const [tank] = await open(original);
    const view = await attached(tank as PollId);
    h.rt.stores.workspace.getState().activate(tank as number);
    view.stores.ui.getState().setSetupOpen(true);
    await h.connect();
    const frame = document.querySelector(`[data-subwindow="${tank}"]`) as HTMLElement;
    await waitFor(() =>
      expect(within(frame).getByTestId("applied-scale")).toHaveTextContent(
        "Applied: 4-20 mA (raw 4000-20000)",
      ),
    );
    const region = within(frame).getByRole("region", { name: "Scale" });
    expect(within(region).getByLabelText("Preset")).toHaveValue("current4to20");
    expect(within(region).getByRole("radio", { name: "Clamp" })).toBeChecked();
    expect(within(frame).getByRole("region", { name: "Overrides (2)" })).toBeInTheDocument();
    expect(within(frame).getAllByTestId("override-row")[1]).toHaveTextContent(
      "Divide by 100, 2 dp, bar, signed",
    );
    expect(within(frame).getByRole("columnheader", { name: "Scaled value" })).toBeInTheDocument();
  });

  it("changing the scale after loading marks the profile modified; Save makes it clean again", async () => {
    const [tank] = await open(
      profileV2("Scaled", [pollProfile("Tank", { scale: clamped, valueColumns: "both" })]),
    );
    const view = await attached(tank as PollId);
    await h.act(() => view.stores.scale.getState().applyScale({ ...clamped, decimals: 1 }));
    expect(modified()).toBe(true);
    await h.act(() => h.rt.profileFlow.save());
    await waitFor(() => expect(modified()).toBe(false));
    // value columns are a display setting and count too
    await h.act(() => view.stores.scale.getState().setValueColumns("raw"));
    expect(modified()).toBe(true);
    // ...and going back to what was saved is clean again
    await h.act(() => view.stores.scale.getState().setValueColumns("both"));
    expect(modified()).toBe(false);
  });
});

describe("a profile without scale settings (CHK3-G2)", () => {
  it("opens with scale None, no overrides and value columns Raw", async () => {
    const [id] = await open(profileV2("Old", [pollProfile("Poll 1")], { migratedFrom: 1 }));
    const view = await attached(id as PollId);
    expect(view.stores.scale.getState()).toMatchObject({
      scale: null,
      overrides: [],
      valueColumns: "raw",
    });
    view.stores.ui.getState().setSetupOpen(true);
    const frame = document.querySelector(`[data-subwindow="${id}"]`) as HTMLElement;
    await waitFor(() =>
      expect(within(frame).getByTestId("applied-scale")).toHaveTextContent(
        "Applied: Raw (no scale)",
      ),
    );
    expect(
      within(frame).queryByRole("columnheader", { name: "Scaled value" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("scale-not-applied")).not.toBeInTheDocument();
  });
});

describe("value columns Scaled or Both without any scale (REV-007 m-3)", () => {
  it.each(["scaled", "both"] as const)(
    "a profile with %s and no scale opens showing the raw values, and the stored setting stays",
    async (columns) => {
      const original = profileV2("Hand edited", [pollProfile("Tank", { valueColumns: columns })]);
      const [id] = await open(original);
      const view = await attached(id as PollId);
      expect(modified()).toBe(false); // opening does not normalize the stored setting
      h.rt.stores.workspace.getState().activate(id as number);
      await h.connect();
      const frame = document.querySelector(`[data-subwindow="${id}"]`) as HTMLElement;
      await waitFor(() =>
        expect(within(frame).getByRole("columnheader", { name: /^Raw/ })).toBeInTheDocument(),
      );
      expect(
        within(frame).queryByRole("columnheader", { name: "Scaled value" }),
      ).not.toBeInTheDocument();
      // Ctrl+Shift+V changes nothing while the Show control is disabled
      await h.act(() => view.stores.scale.getState().cycleValueColumns());
      expect(
        h.ipc.callsOf("setPollView").filter(([, v]) => "valueColumns" in (v as object)),
      ).toHaveLength(0);
      // the file is not rewritten behind the user's back: saved as it was
      expect(view.stores.scale.getState().valueColumns).toBe(columns);
      await h.act(() => h.rt.profileFlow.save());
      const saved = await h.ipc.profilesGet("Hand edited");
      expect(saved.polls[0]?.valueColumns).toBe(columns);
    },
  );

  it("the first scale added to such a poll shows Both", async () => {
    const [id] = await open(
      profileV2("Hand edited", [pollProfile("Tank", { valueColumns: "scaled" })]),
    );
    const view = await attached(id as PollId);
    h.rt.stores.workspace.getState().activate(id as number);
    await h.connect();
    await h.act(() => view.stores.scale.getState().applyScale(clamped));
    const frame = document.querySelector(`[data-subwindow="${id}"]`) as HTMLElement;
    await waitFor(() => {
      expect(within(frame).getByRole("columnheader", { name: /^Raw/ })).toBeInTheDocument();
      expect(within(frame).getByRole("columnheader", { name: "Scaled value" })).toBeInTheDocument();
    });
    expect(view.stores.scale.getState().valueColumns).toBe("both");
  });
});
