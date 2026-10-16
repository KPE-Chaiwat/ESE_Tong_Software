import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { modbusMasterManifest } from "@/tools/modbus-master/manifest";
import { LauncherPage } from "./LauncherPage";

describe("LauncherPage", () => {
  it("renders a card for the Modbus Master manifest", () => {
    render(<LauncherPage manifests={[modbusMasterManifest]} onOpen={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Modbus Master" })).toBeInTheDocument();
    expect(screen.getByText(modbusMasterManifest.description)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open/i })).toBeEnabled();
  });

  it("REV-002 M5: Open starts a tool window and the launcher does not navigate", async () => {
    const onOpen = vi.fn().mockResolvedValue(undefined);
    const before = window.location.href;
    render(<LauncherPage manifests={[modbusMasterManifest]} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /open/i }));
    expect(onOpen).toHaveBeenCalledWith(modbusMasterManifest);
    expect(window.location.href).toBe(before);
    // The launcher is still there for the next tool.
    expect(screen.getByRole("heading", { name: "ESEfact" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows why a window could not be opened and allows a retry", async () => {
    const onOpen = vi
      .fn()
      .mockRejectedValueOnce(new Error("Unknown tool."))
      .mockResolvedValueOnce(undefined);
    render(<LauncherPage manifests={[modbusMasterManifest]} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /open/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not open Modbus Master: Unknown tool.",
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /open/i })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: /open/i }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("disables the button while the window is being opened", async () => {
    let finish: () => void = () => {};
    const onOpen = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<LauncherPage manifests={[modbusMasterManifest]} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /open/i }));
    expect(screen.getByRole("button", { name: /open/i })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: /open/i })).toBeEnabled());
  });
});
