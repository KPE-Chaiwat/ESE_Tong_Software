// CHK-001 items that UI mode (browser + scriptable fake) cannot decide. They are listed here as
// skipped tests so the report and the HTML report show each one with its reason. Integration mode
// (real Tauri window via WebView2 + CDP, simulated slave, fault proxy, wire capture) will cover them.
import { test } from "@playwright/test";

const needs = (id: string, title: string, reason: string) =>
  test.skip(`${id} ${title}`, { annotation: { type: "reason", description: reason } }, async () => {});

test.describe("skipped in UI mode", () => {
  needs("CHK-D9", "TX frames are spaced about 1000 ms apart", "backend scan scheduling: needs the real poll loop and a simulator");
  needs("CHK-D10", "TX/RX bytes equal the captured TCP frames", "[WIRE] needs a packet capture of the real transport");
  needs("CHK-D11", "RTU TX 01 03 00 00 00 02 C4 0B equals the sniffer capture", "[RTU][WIRE] needs a serial device/virtual COM pair and a sniffer");
  needs("CHK-M8", "RTU broadcast TX bytes 00 06 00 03 01 F4 78 0C, no RX row, counters (wire part)", "[RTU][WIRE] the UI text and warning are covered; bytes and counters need the wire");
  needs("CHK-M12", "FC16 PDU 10 00 0A 00 03 06 00 0A 00 14 00 1E equals the capture", "[WIRE] the request payload is checked in CHK-M2; the bytes need a capture");
  needs("CHK-M15", "unit 0 TX/echo bytes and transaction ID on the wire (wire part)", "[WIRE] the UI side is covered; the echo and no 'discarded' RX notes need a real TCP server");
  needs("CHK-N7", "counters equal frame counts after a 1-minute mixed-fault run", "[FAULT] needs the backend counters and a fault-injecting proxy");
  needs("CHK-O8", "profiles survive an app restart", "needs the real profile store on disk and an app restart");
  needs("CHK-P1", "second window is offset by 24 px, idle and Untitled", "UI mode checks that Ctrl+N asks the window IPC for a new modbus-master window; the offset and the new window's state need real Tauri windows");
  needs("CHK-P2", "two windows poll two simulators independently", "needs two Tauri windows and two simulated slaves");
  needs("CHK-P3", "stopping simulator 5020 disconnects only window 1", "needs two Tauri windows and a simulator");
  needs("CHK-P4", "closing a polling window closes the socket at the simulator", "UI mode checks the confirm and the close decision; the socket close is Rust and needs a simulator");
  needs("CHK-P5", "window size and position are restored", "window-state plugin, Tauri only");
  needs("CHK-R4", "NVDA announces 'Disconnected. {reason}' once and no value updates", "manual item (screen reader); the live regions are checked in CHK-F2, CHK-I4 and CHK-R");
  needs("CHK-S1", "10 minutes at 125 registers / 100 ms: memory within 10 %", "10-minute soak on the real app; UI mode runs a 12 s smoke in CHK-S1/S3");
  needs("CHK-S2", "two windows polling at the same time stay responsive", "needs two Tauri windows");
});
