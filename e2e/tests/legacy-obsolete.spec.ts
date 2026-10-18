// Old CHK-001 UI tests (single-poll window) that are NOT carried over to the multi-poll window in
// this round. Each entry is skipped with the reason; the report (REPORT-003) has the full table.
//   obsolete   = the behavior or the DOM no longer exists (legacy window removed, DES-002 replaces it)
//   not ported = still valid in principle (DES-002 keeps the rule), not rewritten this round
// The tests that were rewritten or carried over are in chk2-*.spec.ts and chk1-carryover*.spec.ts.
import { test } from "@playwright/test";

const OBSOLETE: Array<[string, string]> = [
  ["CHK-STATE idle/connecting/connected/polling/paused/timeout/exception/badResponse/disconnected (states-matrix.spec.ts, 9 tests)", "obsolete: one flat session state is gone; DES-002 has ConnectionState and PollState. Replaced by CHK2-A/C and CHK2-R4."],
  ["CHK-R2 every one of the 9 session states is told apart by icon plus label", "obsolete: same reason. Replaced by CHK2-R4 (poll, connection, host marker)."],
  ["CHK-A2 all fields editable, toolbar Connect with tooltip", "not ported: partly covered by CHK2-A1/A3; the sidebar form has no tooltip on the toolbar button check."],
  ["CHK-B4 reduced motion: the loader icon does not spin", "not ported: still valid (DES-001 7); no CHK-002 item; needs prefers-reduced-motion emulation."],
  ["CHK-C3 invalid poll quantity 126: Ctrl+P and Start polling send nothing", "obsolete: there is no Start polling button and no single poll; poll field validation is CHK2-P1."],
  ["CHK-D13 status bar shows target, last OK and round trip", "obsolete: the W1 status bar is '{transport} · {n} polls'; the 'Last OK' bar moved to the native window (CHK2-F11)."],
  ["CHK-E4 write FC06 while paused, row reads 7 after Resume", "not ported: needs the simulated device values; Write itself is CHK2-D4."],
  ["CHK-F4 timeout without any data: dashes and Waiting for first response", "not ported: still valid per poll; see CHK2-C3 for the timeout line."],
  ["CHK-F5 Pause during timeout: paused, banner gone", "not ported: there is no per-poll banner any more (status line); Pause is CHK2-B7."],
  ["CHK-F6 timeout 50 ms shows within 50 ms", "obsolete: timing of the single-poll banner."],
  ["CHK-G2 exception RX row: Info text with icon, Errors counts per cycle", "not ported: traffic row Info text; CHK2-K7 checks the counters."],
  ["CHK-G3 exception before any data: 'No data' text", "not ported: the data card texts are an open design question (Q-FE2-01)."],
  ["CHK-G4/G5/G6 recovery by Apply, unknown exception 0x0C, exception then timeout counter restart", "not ported: per-poll counting is the fake's; unknown exception text is covered by CHK-F/G/H (banner text) unknown exception."],
  ["CHK-H1 .. H8 corrupted frames (unit id, CRC, short frame, malformed, function)", "not ported: wire level; the kind texts are covered by CHK-F/G/H (banner text) for every kind."],
  ["CHK-K1 every data card empty text appears verbatim in its state", "not ported: texts for paused/connected polls changed (Q-FE2-01 open); the offline text is in CHK2-A6."],
  ["CHK-L1 Start polling: dashes and Waiting for first response", "not ported: see CHK2-A2 (Waiting chip) and CHK2-B9."],
  ["CHK-L3 slow port list: Loading ports… and the select is disabled; CHK-L (DES 2.4) failing port list", "not ported: still valid in the CONNECTION section (RTU)."],
  ["CHK-L4 slow write: Writing… and Send disabled", "not ported: Writing… is asserted in CHK2-D4."],
  ["CHK-Q1 Ctrl+L / Ctrl+P / Ctrl+E / Ctrl+O/S shortcut semantics of the single window", "not ported: the shortcut maps per host are CHK2-B7/B8, CHK2-F, CHK2-I; Ctrl+L semantics in W1 are not in CHK-002."],
  ["CHK-Q2 with a modal open Ctrl+L and Ctrl+P do nothing", "not ported: modal blocking is asserted in CHK2-G1 and CHK-P1 (carry-over)."],
  ["CHK-Q3 Ctrl+C on rows copies tab-separated lines; Q4 column resize; Q5 splitter keys; Q6 hide setup/traffic; Q9 traffic list selection", "not ported: still valid in the grid and traffic panel; no CHK-002 item."],
  ["CHK-R1 tab order and focus rings; focus return of dialogs; R3 no text on solid red, orange only warnings; grid aria", "not ported except CHK2-R1/R5 and CHK-R5/R6 (carry-over)."],
  ["CHK-O2/O3/O4/O9/O10 profile Modified, restore on open, Disconnect and load, deleted elsewhere, unreadable row", "replaced by CHK2-N1, N2, N5, N6 (schema 2); O9 (profile deleted in another window) not ported."],
  ["CHK-P4 window close question (Cancel / Don't save / Save)", "replaced by CHK2-G5 and CHK-J28 (carry-over)."],
  ["rev4 CHK-N7 worked example, CHK-I1/I11 timeout texts, CHK-J29, CHK-N8 clipboard error toast", "J29 and counters semantics are CHK2-D (binary list) and CHK2-K7; the worked example (15 requests) needs the simulator; N8 not ported."],
  ["skipped-needs-integration.spec.ts (D10, D11, M12, byte parts of M8/M15, P2, P3, P5, S2, O8, R4 NVDA)", "obsolete here: integration mode with a real window, the simulator and NVDA."],
  ["perf.spec.ts CHK-S1/S3 (single poll, 125 registers)", "replaced by CHK2-Q1..Q3 (8 sub-windows)."],
];

test.describe("legacy CHK-001 UI tests not carried over", () => {
  for (const [title, reason] of OBSOLETE) {
    test.skip(`${title} -- ${reason}`, () => {});
  }
});
