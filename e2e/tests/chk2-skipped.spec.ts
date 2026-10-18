// CHK-002 items that UI mode cannot drive. Each is skipped with the reason, so the id shows up in
// the run (27 skipped = these plus the legacy list in legacy-obsolete.spec.ts).
import { test } from "@playwright/test";

const SKIPPED: Array<[string, string]> = [
  ["CHK2-D1 [SIM][WIRE] one outstanding transaction, bytes match the simulator log (60 s)", "needs the real backend scheduler and the simulator log (integration mode)"],
  ["CHK2-D2 [SIM][WIRE] every poll gets at least 80% of its scan rate in 60 s", "needs the real backend scheduler (the fake's scheduler is a model, not the product)"],
  ["CHK2-D5 [SIM] writes from a sub-window and a native window within 50 ms are served FIFO", "the two windows are separate JS contexts with separate fakes in UI mode; the shared queue is Rust"],
  ["CHK2-D7 [RTU][WIRE] silence of at least max(t3.5, 5 ms) before every request", "needs a serial device and a logic analyzer or sniffer"],
  ["CHK2-D8 [SIM][WIRE] reorder, pop out, dock and drag do not disturb the scheduler over 60 s", "needs the real backend; UI side: CHK2-F3 shows that these actions send no other command"],
  ["CHK2-F4 [MON2] pop out, move to monitor 2, dock, pop out again reopens on monitor 2", "needs a second monitor and real window placement (the restore rule is Rust)"],
  ["CHK2-F12 [SIM] W1 minimized: native poll windows stay visible, update, and have taskbar entries", "needs real windows"],
  ["CHK2-I16 [WIN] pop out by drag out of the workspace (ghost card, 'Release to open in its own window')", "task 26 (pop out by drag, risk R1) is not in this build; needs WebView2 pointer events outside the window. Mark 'n/a (R1)' until the spike result"],
  ["CHK2-I17 [WIN][P2] dock by drag of a native window over the workspace", "phase 2 (task 27), Windows only, needs WM_EXITSIZEMOVE; 'n/a (phase 2)'"],
  ["CHK2-N4 (file on disk) the schema 1 file is unchanged before Save and has schemaVersion 2 after", "the file system is Rust's; UI side (no profilesSave before Save, new fields in the saved object) is in CHK2-N3"],
  ["CHK2-N5 (rules) schema 3, 17 polls, 2001 aliases, duplicate alias address, minimizedOrder out of range are 'Cannot be opened'", "validation of the file is Rust's (`profiles_*`); the row text and the disabled Open are in CHK2-N5 (UI side)"],
  ["CHK2-Q4 [SIM][WIN] Q1-Q3 on WebView2", "integration mode in the real app; the browser smoke is in perf.spec.ts"],
  ["CHK2-Q5 [SIM] 10 minutes of 8 polls with 5 pop out/dock cycles, memory flat, no leaked view channels", "soak run; needs the real backend for the channel counter. The fake's attached-view count is checked in CHK2-F3 only"],
  ["CHK2-R3 (screen reader) every announcement is read once by NVDA", "manual; the live region text and the once-only rule are in CHK2-R3"],
  ["CHK2-R4 grayscale screenshot review by a person", "manual; the icon-plus-text assertions and a grayscale screenshot attachment are in CHK2-R4"],
  ["CHK2-E14 (WebView2 reload) reloading W1 re-attaches every sub-window with values restored", "values restored after a WebView2 reload need the real backend (the fake with ?fakePersist keeps polls, rectangles, layout and preferences, not values, counters or the link). The rectangles, states, z-order and not-Modified parts are in CHK2-E14 (UI side, reload)"],
  ["CHK2-H1..H5 [WIN][MON2] real window rectangles on the monitors", "needs real windows and monitors; the arrange math, menu and commands are checked UI-side in CHK2-H1..H5"],
  ["CHK2-C (wire) exception 02 and timeout frames in the traffic panel from a real slave", "needs the simulator (integration mode)"],
];

test.describe("CHK-002 items not drivable in UI mode", () => {
  for (const [title, reason] of SKIPPED) {
    test.skip(`${title} -- ${reason}`, () => {});
  }
});
