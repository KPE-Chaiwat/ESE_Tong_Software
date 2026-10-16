import { windowTitle } from "./title";

describe("windowTitle", () => {
  it("shows Untitled and the pill label at start", () => {
    expect(windowTitle(null, false, "Not connected")).toBe(
      "Modbus Master - Untitled - Not connected",
    );
  });

  it("marks modified setups and uses the profile name", () => {
    expect(windowTitle("Boiler-PLC", true, "Polling")).toBe(
      "Modbus Master - Boiler-PLC * - Polling",
    );
    expect(windowTitle("Boiler-PLC", false, "Exception 02")).toBe(
      "Modbus Master - Boiler-PLC - Exception 02",
    );
  });
});
