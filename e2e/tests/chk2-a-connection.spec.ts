// CHK-002 section A: connection window states, with polls in the workspace.
import { expect, test, STANDARD_8 } from "../support/mm-fixtures";

const EMPTY_TEXT =
  "No polls yet. Press New poll (Ctrl+Shift+N) to read registers from this connection.";

test.describe("A connection window states", () => {
  test("CHK2-A1 a new connection window: idle pill, empty list and workspace, title, collapsed traffic bar", async ({
    mm,
    page,
  }) => {
    await mm.open();
    await mm.expectPill("Not connected", "plug");
    await expect(mm.summaryChip, "no summary chip while idle").toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Polls · 0 of 16" })).toBeVisible();
    await expect(mm.sidebar.getByText(EMPTY_TEXT)).toBeVisible();
    await expect(mm.workspaceEmpty).toHaveText(EMPTY_TEXT);
    await expect(mm.workspace.getByRole("button", { name: "New poll" })).toBeVisible();
    await expect(page).toHaveTitle("Modbus Master - Untitled - Not connected");
    await expect.poll(async () => (await mm.windowTitles()).at(-1)).toBe(
      "Modbus Master - Untitled - Not connected",
    );
    await expect(mm.trafficBar).toBeVisible();
    await expect(mm.traffic).toHaveCount(0);
    await expect(mm.trafficBar).toContainText("Requests 0 · Responses 0 · Errors 0 · Timeouts 0 · link load 0%");
  });

  test("CHK2-A2 polls added while idle are Offline / No connection, then Polling after Connect with auto start", async ({
    mm,
  }) => {
    await mm.open();
    const [a, b] = await mm.addPolls([{ name: "Poll 1" }, { name: "Poll 2" }]);
    for (const id of [a, b] as number[]) {
      await expect(mm.row(id)).toContainText("Offline");
      const line = mm.statusLine(id);
      await expect(line).toContainText("Offline");
      await expect(line).toContainText("No connection");
      await expect(line).toHaveAttribute("data-tone", "neutral");
    }
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.expectPill("Connected · 127.0.0.1:5020");
    // Until the first reply a running poll reads "Waiting…" (DES-002 2.3.2); virtual time delivers it.
    for (const id of [a, b] as number[]) await expect(mm.row(id)).toContainText("Waiting");
    await mm.advance(300);
    for (const id of [a, b] as number[]) {
      await expect(mm.row(id)).toContainText("Polling");
      await expect(mm.statusLine(id)).toContainText("Polling");
    }
  });

  test("CHK2-A2 with 'Start polling when connected' off both polls come up Paused", async ({ mm }) => {
    await mm.open();
    const [a, b] = await mm.addPolls([{ name: "Poll 1" }, { name: "Poll 2" }]);
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: false });
    await mm.expectPill("Connected · 127.0.0.1:5020");
    for (const id of [a, b] as number[]) {
      await expect(mm.row(id)).toContainText("Paused");
      await expect(mm.statusLine(id)).toContainText("Paused");
    }
  });

  test("CHK2-A3 on Connect the CONNECTION section collapses to a summary with [Edit]; fields are read-only", async ({
    mm,
    page,
  }) => {
    await mm.open();
    await mm.addPolls([{ name: "Poll 1" }]);
    await mm.useVirtual();
    await mm.pressConnect({ timeoutMs: 1000 });
    await expect(mm.pill).toContainText("Connected");
    await expect(mm.connectionSection).toContainText("TCP 127.0.0.1:5020 · timeout 1000 ms");
    await expect(mm.connectionSection.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    await expect(mm.hostField).toBeHidden();
    await mm.connectionSection.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(mm.hostField).toBeVisible();
    await expect(mm.hostField).toHaveAttribute("readonly", "");
    await expect(mm.portField).toHaveAttribute("readonly", "");
    await expect(mm.timeoutField).toHaveAttribute("readonly", "");
    await expect(page.getByText("Disconnect to change connection settings.")).toBeVisible();
  });

  test("CHK2-A3 after a refused connect the section is expanded again", async ({ mm }) => {
    await mm.open();
    await mm.useVirtual();
    await mm.script((f) =>
      f.scriptConnectFailure({ kind: "refused", phase: "connectFailed", message: "refused" }),
    );
    // The user collapsed the section; a refused connect brings it back so the target can be fixed.
    await mm.hostField.fill("127.0.0.1");
    await mm.portField.fill("5020");
    await mm.timeoutField.fill("3000");
    await mm.connectionSection.getByRole("button", { name: "Collapse connection settings" }).click();
    await expect(mm.hostField).toBeHidden();
    await mm.toolbarButton("Connect").click();
    await mm.expectConnection("disconnected");
    await expect(mm.banner).toContainText("Connection refused by 127.0.0.1:5020.");
    await expect(mm.hostField).toBeVisible();
    await expect(mm.timeoutField).toHaveValue("3000");
  });

  test("CHK2-A4 Connecting: banner with [Cancel], every status line says Connecting…, Cancel returns to idle", async ({
    mm,
  }) => {
    await mm.open();
    const [a, b] = await mm.addPolls([{ name: "Poll 1" }, { name: "Poll 2" }]);
    await mm.pressConnect();
    await mm.script((f) => f.emitConnectionState("connecting"));
    await mm.expectPill("Connecting…", "loader");
    await expect(mm.banner).toContainText("Connecting to 127.0.0.1:5020…");
    await expect(mm.bannerButton("Cancel")).toBeVisible();
    for (const id of [a, b] as number[]) {
      await expect(mm.statusLine(id)).toContainText("Connecting…");
      await expect(mm.statusLine(id)).toHaveAttribute("data-tone", "neutral");
    }
    await mm.bannerButton("Cancel").click();
    await mm.expectCalls("cancelConnect", 1);
    await mm.script((f) => f.emitConnectionState("idle"));
    await mm.expectPill("Not connected", "plug");
    await expect(mm.banner).toHaveCount(0);
    for (const id of [a, b] as number[]) await expect(mm.row(id)).toContainText("Offline");
  });

  test("CHK2-A5 link lost with P2 popped out: banner, 'No connection: link lost' lines, P2 window banner, Reconnect resumes", async ({
    mm,
  }) => {
    await mm.open();
    const polls = [{ name: "Poll 1" }, { name: "Poll 2" }, { name: "Poll 3" }];
    const [p1, p2, p3] = await mm.addPolls(polls);
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await expect(mm.pill).toContainText("Connected");
    await mm.advance(500);
    // P2 into its own window (the fake only moves the host; the window is another page below).
    await mm.titleButton(p2 as number, /^Open in its own window/).click();
    await expect(mm.sub(p2 as number)).toHaveCount(0);
    await expect(mm.row(p2 as number)).toContainText("own window");

    const announced0 = (await mm.announcements()).length;
    await mm.script((f) =>
      f.dropLink({ kind: "closedByPeer", phase: "linkLost", message: "closed" }),
    );
    await mm.expectPill("Disconnected", "unplug");
    await expect(mm.banner).toContainText("The device at 127.0.0.1:5020 closed the connection.");
    // Revision 8 (O-8): the loss is announced exactly once, assertively; the per-poll Offline changes are not.
    await expect(mm.liveAssertive).toContainText("Disconnected.");
    await expect(mm.liveAssertive).toContainText("closed the connection");
    await mm.advance(1000);
    const made = (await mm.announcements()).slice(announced0);
    expect(made.filter((a) => a.assertive), "one assertive announcement").toHaveLength(1);
    expect(made.filter((a) => a.assertive)[0]?.text).toMatch(/^Disconnected\. .*closed the connection\./);
    expect(
      made.filter((a) => !a.assertive && /Offline|No connection/.test(a.text)),
      "per-poll Offline is not announced",
    ).toEqual([]);
    await expect(mm.bannerButton("Reconnect")).toBeVisible();
    await expect(mm.bannerButton("Dismiss")).toBeVisible();
    for (const id of [p1, p3] as number[]) {
      const line = mm.statusLine(id);
      await expect(line).toContainText("No connection: link lost");
      await expect(line).toHaveAttribute("data-tone", "error");
      await expect(line).toContainText("Offline");
      await expect(mm.row(id)).toContainText("Offline");
    }

    // The P2 window (seeded copy of the same backend state) shows the connection banner.
    const w2 = await mm.openNative({ polls, index: 1 });
    await expect(w2.name).toHaveText("Poll 2");
    await w2.script((f) => f.dropLink({ kind: "closedByPeer", phase: "linkLost", message: "closed" }));
    await expect(w2.banner).toContainText("The device at 127.0.0.1:5020 closed the connection.");
    await expect(w2.banner.getByRole("button", { name: "Reconnect", exact: true })).toBeVisible();
    await expect(w2.banner.getByRole("button", { name: "Connection window", exact: true })).toBeVisible();
    await expect(w2.banner.getByRole("button", { name: "Disconnect" })).toHaveCount(0);

    // Reconnect in W1: every poll with the Resume intent polls again.
    await mm.page.bringToFront();
    await mm.bannerButton("Reconnect").click();
    await mm.expectConnection("connected");
    await mm.advance(300);
    for (const id of [p1, p3] as number[]) await expect(mm.statusLine(id)).toContainText("Polling");
    await expect(mm.row(p2 as number)).toContainText("Polling");
  });

  test("CHK2-A6 Dismiss: idle, polls Offline, stale values are cleared", async ({ mm }) => {
    await mm.open();
    const [p1] = await mm.addPolls([{ name: "Poll 1" }]);
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.advance(300);
    await expect(mm.grid(p1 as number)).toHaveAttribute("data-status", "live");
    await mm.script((f) => f.dropLink());
    await mm.expectConnection("disconnected");
    // Stale values stay while disconnected.
    await expect(mm.grid(p1 as number)).toHaveAttribute("data-status", "stale");
    await mm.bannerButton("Dismiss").click();
    await mm.expectConnection("idle");
    await mm.expectPill("Not connected", "plug");
    await expect(mm.row(p1 as number)).toContainText("Offline");
    await expect(mm.statusLine(p1 as number)).toContainText("No connection");
    await expect(mm.grid(p1 as number), "values are cleared").toHaveCount(0);
    await expect(mm.sub(p1 as number)).toContainText("Not connected. Connect from the toolbar (Ctrl+L).");
  });

  test("CHK2-A (Standard 8 polls) connect shows eight live sub-windows", async ({ mm }) => {
    await mm.open();
    const ids = await mm.addPolls(STANDARD_8);
    await mm.useVirtual();
    await mm.pressConnect({ autoStart: true });
    await mm.expectPill("Connected · 127.0.0.1:5020");
    await mm.advance(1500);
    for (const id of ids) await expect(mm.row(id)).toContainText("Polling");
    await expect(mm.summaryChip).toContainText("8 live");
  });
});
