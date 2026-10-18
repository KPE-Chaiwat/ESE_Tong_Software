// CHK-002 section C: independent poll states (one poll fails, the others and the link do not).
import { expect, STANDARD_8, test, type Mm } from "../support/mm-fixtures";

/** Standard 8 polls, P6 answers exception 02, connected and tiled, a few seconds of virtual time. */
async function standard8Connected(mm: Mm, seconds = 3): Promise<number[]> {
  await mm.open({
    polls: STANDARD_8,
    seed: (f, _a, ids) => f.scriptFault(ids[5], { kind: "exception", code: 2 }),
  });
  const ids = await mm.pollIds();
  await mm.useVirtual();
  await mm.pressConnect({ autoStart: true });
  await mm.expectConnection("connected");
  await mm.windowMenu("Tile");
  await mm.advance(seconds * 1000);
  return ids;
}

test.describe("C independent poll states", () => {
  test("CHK2-C1 P6 shows Exception 02 on the error tint with its tooltip; the others poll; the link is fine", async ({
    mm,
  }) => {
    const ids = await standard8Connected(mm);
    const p6 = ids[5] as number;
    const line = mm.statusLine(p6);
    await expect(line).toHaveAttribute("data-state", "exception");
    await expect(line).toHaveAttribute("data-tone", "error");
    await expect(line.locator('[data-slot="status-pill"]')).toContainText("Exception 02");
    await expect(line.getByTestId("status-reason")).toHaveText("Exception 02 (Illegal data address)");
    const tooltip = await line.getByTestId("status-reason").getAttribute("title");
    expect(tooltip).toMatch(/^Exception 02 \(Illegal data address\) from slave 1 for FC03 at 20-144\. /);
    for (const id of ids.filter((i) => i !== p6)) {
      await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
    }
    await expect(mm.pill).toHaveText("Connected · 127.0.0.1:5020");
    await expect(mm.banner).toHaveCount(0);
    await expect(mm.row(p6)).toContainText("Exc 02");
  });

  test("CHK2-C2 summary chip '1 exception · 7 live' with octagon-x, and the window title carries it", async ({
    mm,
    page,
  }) => {
    await standard8Connected(mm);
    await expect(mm.summaryChip).toContainText("1 exception · 7 live");
    await expect(mm.summaryChip.locator('[data-icon="octagon-x"]')).toHaveCount(1);
    // The connection typed into the form is a change of the profile, so DES-002 2.12 adds " *".
    const title = "Modbus Master - Untitled * - Connected (1 exception · 7 live)";
    await expect(page).toHaveTitle(title);
    await expect.poll(async () => (await mm.windowTitles()).at(-1)).toBe(title);
    // Revision 8: after Save as "Plant" the title has no " *" ...
    await mm.openMenu("File");
    await mm.menuItem("Save as…").click();
    await mm.saveAsDialog.getByLabel("Name").fill("Plant");
    await mm.saveAsDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(mm.profileLabel).toContainText("Plant");
    const saved = "Modbus Master - Plant - Connected (1 exception · 7 live)";
    await expect(page).toHaveTitle(saved);
    await expect.poll(async () => (await mm.windowTitles()).at(-1)).toBe(saved);
    // ... and renaming a poll gives " *" again.
    const first = await mm.idOf("Poll 1");
    await mm.row(first).focus();
    await page.keyboard.press("F2");
    const input = mm.row(first).getByRole("textbox", { name: "Poll name" });
    await input.fill("Boiler 1");
    await input.press("Enter");
    const renamed = "Modbus Master - Plant * - Connected (1 exception · 7 live)";
    await expect(page).toHaveTitle(renamed);
    await expect.poll(async () => (await mm.windowTitles()).at(-1)).toBe(renamed);
  });

  test("CHK2-C3 drops for slave 2: P7 turns to the warning fill with Timeout, Err rises, summary follows, then recovers", async ({
    mm,
  }) => {
    const ids = await standard8Connected(mm);
    const p7 = ids[6] as number;
    await mm.script((f) => f.scriptSlaveFault(2, { kind: "timeout" }));
    await mm.advance(4000);
    const line = mm.statusLine(p7);
    await expect(line).toHaveAttribute("data-state", "timeout");
    await expect(line).toHaveAttribute("data-tone", "warning");
    await expect(line.locator('[data-slot="status-pill"]')).toContainText("Timeout");
    await expect(line.getByTestId("status-reason")).toHaveText("No response within 1000 ms");
    const err = async () => Number((await mm.statusText(p7)).match(/Err (\d+)/)?.[1]);
    const before = await err();
    await mm.advance(3000);
    await expect.poll(err).toBeGreaterThan(before);
    await expect(mm.row(p7)).toContainText(/Timeout \d+/);
    await expect(mm.summaryChip).toContainText("1 exception · 1 timeout · 6 live");
    // The drops stop.
    await mm.script((f) => f.scriptSlaveFault(2, null));
    await mm.advance(4000);
    await expect(line).toHaveAttribute("data-state", "polling");
    await expect(line).not.toHaveAttribute("data-tone", "warning");
    await expect(mm.summaryChip).toContainText("1 exception · 7 live");
  });

  test("CHK2-C4 bad responses for P2 only: short frame text on the warning fill; the others are unaffected", async ({
    mm,
  }) => {
    const ids = await standard8Connected(mm);
    const p2 = ids[1] as number;
    await mm.script(
      (f, id) =>
        f.scriptFault(id, {
          kind: "badResponse",
          badKind: "shortFrame",
          detail: { expected: 29, got: 20, message: "" },
        }),
      p2,
    );
    await mm.advance(2000);
    const line = mm.statusLine(p2);
    await expect(line).toHaveAttribute("data-state", "badResponse");
    await expect(line).toHaveAttribute("data-tone", "warning");
    await expect(line.getByTestId("status-reason")).toHaveText("Bad response: short frame (20 of 29 bytes)");
    for (const id of [ids[0], ids[2], ids[3], ids[4], ids[6], ids[7]] as number[]) {
      await expect(mm.statusLine(id)).toHaveAttribute("data-state", "polling");
    }
    await expect(mm.summaryChip).toContainText("1 exception · 1 bad response · 6 live");
  });

  test("CHK2-C5 four polls time out within 1 s: one 'N polls are failing.'; a later single failure is announced once", async ({
    mm,
  }) => {
    await mm.open({ polls: Array.from({ length: 5 }, (_, i) => ({ name: `Poll ${i + 1}` })) });
    const ids = await mm.pollIds();
    await mm.pressConnect({ autoStart: true });
    await mm.script((f) => f.emitConnectionState("connecting"));
    await mm.script((f) => f.emitConnectionState("connected"));
    await mm.script((f, list) => {
      for (const id of list) f.emitPollState(id, "polling");
    }, ids);
    await mm.expectConnection("connected");
    // Hook: the fake window IPC logs every announcement. Count only what comes after this point.
    const baseline = (await mm.announcements()).length;
    const seq0 = await mm.liveSeq("polite");
    await mm.script((f, list) => {
      for (const id of list.slice(0, 4)) f.emitPollState(id, "timeout", { consecutiveFailures: 1 });
    }, ids);
    const live = async () =>
      (await mm.announcements())
        .slice(baseline)
        .filter((a) => !a.assertive)
        .map((a) => a.text);
    await expect.poll(live).toContain("4 polls are failing.");
    // One poll fails later, outside that window: announced alone and once.
    await mm.script((f, id) => f.emitPollState(id, "timeout", { consecutiveFailures: 1 }), ids[4] as number);
    await expect.poll(live).toContain("Poll 5: Timeout.");
    const log = await live();
    expect(log.filter((m) => m === "4 polls are failing.")).toHaveLength(1);
    expect(log.filter((m) => m === "Poll 5: Timeout.")).toHaveLength(1);
    expect(log.filter((m) => /^Poll [1-4]: /.test(m)), "no per-poll message in the burst").toEqual([]);
    // Sub-windows do not announce on their own: a repeat of the same state is silent.
    await mm.script((f, id) => f.emitPollState(id, "timeout", { consecutiveFailures: 2 }), ids[4] as number);
    await mm.script((f, id) => f.emitPollState(id, "polling", {}), ids[4] as number);
    expect((await live()).filter((m) => m === "Poll 5: Timeout.")).toHaveLength(1);
    expect(await live(), "exactly the burst message and the single failure, nothing else").toEqual([
      "4 polls are failing.",
      "Poll 5: Timeout.",
    ]);
    expect(await mm.liveSeq("polite"), "the polite region took new announcements").toBeGreaterThan(seq0);
    await expect(mm.sub(ids[0] as number).locator("[aria-live]")).toHaveCount(0);
  });

  test("CHK2-C6 a kept (closed) P6 still shows 'Exc 02' with the 'closed' marker and is counted", async ({ mm }) => {
    const ids = await standard8Connected(mm);
    const p6 = ids[5] as number;
    await mm.titleButton(p6, /^Close/).click();
    await expect(mm.confirm).toContainText("Close poll window?");
    await mm.confirm.getByRole("button", { name: "Keep poll" }).click();
    await expect(mm.sub(p6)).toHaveCount(0);
    await expect(mm.row(p6)).toContainText("closed");
    await expect(mm.row(p6)).toContainText("Exc 02");
    await mm.advance(1000);
    await expect(mm.summaryChip).toContainText("1 exception · 7 live");
  });

  test("CHK2-C7 status line format: Tx, Err, ID, F, SR; Tx equals the Requests of the poll in the traffic filter", async ({
    mm,
  }) => {
    const ids = await standard8Connected(mm, 2);
    const counters = (id: number) => mm.statusLine(id).getByTestId("status-counters");
    // The complete format is the counters' tooltip at every width (revision 9: the visible text is shortened by the
    // width steps; the 8 tiles are narrow, so their visible text is `Tx n · SR 100 ms`).
    await expect(counters(ids[0] as number)).toHaveAttribute("title", /^Tx \d+ · Err 0 · ID 1 · F 03 · SR 100 ms$/);
    await expect(counters(ids[6] as number)).toHaveAttribute("title", /^Tx \d+ · Err 0 · ID 2 · F 03 · SR 100 ms$/);
    await expect(counters(ids[3] as number)).toHaveAttribute("title", /^Tx \d+ · Err 0 · ID 1 · F 01 · SR 100 ms$/);
    await expect(counters(ids[7] as number)).toHaveAttribute("title", /^Tx \d+ · Err 0 · ID 1 · F 03 · SR 1000 ms$/);
    // The same format, visible: maximize P1 so its status line is wide (step 0 or 1).
    await mm.titleButton(ids[0] as number, "Maximize").click();
    await expect(counters(ids[0] as number)).toHaveText(/^Tx \d+ · Err 0 · ID 1 · F 03 · SR 100 ms$/);
    // Virtual time stands still between `advance` calls, so the numbers can be compared.
    const tx = Number(((await counters(ids[0] as number).innerText()).match(/Tx (\d+)/) ?? [])[1]);
    await mm.page.keyboard.press("Control+j");
    await expect(mm.traffic).toBeVisible();
    await mm.traffic.getByRole("combobox", { name: "Traffic filter" }).selectOption({ label: "Poll 1" });
    await expect(mm.counter("requests")).toHaveText(String(tx));
  });
});
