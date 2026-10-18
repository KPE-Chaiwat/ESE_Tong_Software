import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import { routes } from "@/app/routes";
import {
  createFakeModbusMasterIpc,
  type FakeModbusMasterIpc,
  pollConfigInput,
} from "@/shared/ipc/modbus-master.fake";
import { createFakeWindowIpc } from "@/shared/ipc/window";
import NativePollPage, { parsePollId } from "./NativePollPage";
import { resetNativeRuntimeForTests } from "./runtime/native-window-runtime";

// The page makes its own IPC runtime: the test hands it a fake it can seed and look at.
const holder = vi.hoisted(() => ({ created: 0 }));
let fake: FakeModbusMasterIpc | null = null;
vi.mock("@/shared/ipc/runtime", () => ({
  createIpcRuntime: () => {
    holder.created += 1;
    fake ??= createFakeModbusMasterIpc({ mode: "manual" });
    return { modbus: fake, window: createFakeWindowIpc() };
  },
}));

beforeEach(() => {
  fake = null;
  holder.created = 0;
});

afterEach(() => {
  resetNativeRuntimeForTests();
});

describe("parsePollId", () => {
  it("takes digits only", () => {
    expect(parsePollId("7")).toBe(7);
    expect(parsePollId("0")).toBe(0);
    expect(parsePollId("42")).toBe(42);
    for (const bad of [null, "", "-1", "1.5", "abc", "1e3", " 3", "3 ", "99999999999999999999"]) {
      expect(parsePollId(bad)).toBeNull();
    }
  });
});

function renderAt(url: string) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  return render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

describe("route /tools/modbus-master/poll (DES-002 2.6)", () => {
  it("the route exists next to the tool's own", () => {
    const paths = routes.map((r) => r.path);
    expect(paths).toContain("/tools/modbus-master");
    expect(paths).toContain("/tools/modbus-master/poll");
  });

  it("without a poll id it says what is missing and does not touch the backend", async () => {
    renderAt("/tools/modbus-master/poll");
    expect(await screen.findByText(/This window needs a poll/)).toBeVisible();
    expect(holder.created).toBe(0);
  });

  it("a malformed poll id is the same", async () => {
    renderAt("/tools/modbus-master/poll?pollId=abc");
    expect(await screen.findByText(/This window needs a poll/)).toBeVisible();
  });

  it("an unknown poll id says it could not open it", async () => {
    renderAt("/tools/modbus-master/poll?pollId=9");
    expect(await screen.findByTestId("native-detached")).toHaveTextContent(
      "Could not open this poll:",
    );
  });

  it("opens the poll of the query in a native view, once even under StrictMode", async () => {
    fake = createFakeModbusMasterIpc({ mode: "manual" });
    const id = await fake.addPoll(pollConfigInput({ name: "Pump 2" }), "native");
    renderAt(`/tools/modbus-master/poll?pollId=${id}`);
    expect(await screen.findByRole("heading", { name: "Pump 2" })).toBeVisible();
    await waitFor(() => expect(fake?.callsOf("attachPollView")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.callsOf("attachPollView")).toHaveLength(1);
    // One runtime for the window, whatever StrictMode renders.
    expect(holder.created).toBe(1);
    expect(document.title).toBe("Pump 2 - Untitled - Offline");
  });

  it("the page can be rendered directly with a query", async () => {
    const router = createMemoryRouter([{ path: "/p", element: <NativePollPage /> }], {
      initialEntries: ["/p?pollId=x"],
    });
    render(<RouterProvider router={router} />);
    expect(await screen.findByText(/This window needs a poll/)).toBeVisible();
  });
});
