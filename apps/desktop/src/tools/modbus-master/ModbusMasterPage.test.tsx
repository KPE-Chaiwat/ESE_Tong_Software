import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { vi } from "vitest";
import ModbusMasterPage from "./ModbusMasterPage";
import { resetWindowRuntimeForTests } from "./runtime/window-runtime";

afterEach(() => {
  resetWindowRuntimeForTests();
  vi.unstubAllEnvs();
  delete window.__ESEFACT_FAKE_IPC__;
});

describe("ModbusMasterPage", () => {
  it("renders the window against the simulating fake when VITE_FAKE_IPC=1", async () => {
    vi.stubEnv("VITE_FAKE_IPC", "1");
    render(
      <StrictMode>
        <ModbusMasterPage />
      </StrictMode>,
    );
    expect(screen.getByRole("toolbar", { name: "Toolbar" })).toBeInTheDocument();
    await waitFor(() => expect(window.__ESEFACT_FAKE_IPC__).toBeDefined());
    await waitFor(() =>
      expect(window.__ESEFACT_FAKE_IPC__?.callsOf("openSession")).toHaveLength(1),
    );
    // StrictMode runs effects twice: the session is still opened once.
    await new Promise((r) => setTimeout(r, 20));
    expect(window.__ESEFACT_FAKE_IPC__?.callsOf("openSession")).toHaveLength(1);
    expect(document.title).toBe("Modbus Master - Untitled - Not connected");
    expect(screen.queryByText(/Could not start the Modbus session/)).not.toBeInTheDocument();
  });

  it("shows a clear banner when the backend is not reachable", async () => {
    vi.stubEnv("VITE_FAKE_IPC", "");
    render(<ModbusMasterPage />);
    expect(await screen.findByText(/Could not start the Modbus session:/)).toBeVisible();
    // The window is still usable for editing the setup.
    expect(screen.getByLabelText("Host")).toBeEnabled();
  });
});
