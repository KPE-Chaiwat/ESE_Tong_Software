import { cleanup, render } from "@testing-library/react";
import { App } from "./App";

afterEach(cleanup);

describe("the app shell (every window, the launcher included)", () => {
  it("installs the lone Alt guard for the life of the window (REPORT-006 D2)", () => {
    const { unmount } = render(<App />);
    expect(
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", cancelable: true })),
    ).toBe(false);
    expect(window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", cancelable: true }))).toBe(
      false,
    );
    // Alt+F4 is never touched.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", cancelable: true }));
    expect(
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "F4", altKey: true, cancelable: true }),
      ),
    ).toBe(true);
    unmount();
    expect(
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", cancelable: true })),
    ).toBe(true);
  });
});
