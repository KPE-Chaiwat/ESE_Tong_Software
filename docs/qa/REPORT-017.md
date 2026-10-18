# REPORT-017 — Value rules and combined-format performance

2026-10-18. **1 passed, 0 failed, exit0, 71.616s**, start `2026-10-18T04:41:22.169Z`. Focused real-window evidence for CHK5-D2 and CHK6-D1; no confirmed product defect.

Normal debug Tauri/WebView2 over CDP, real TCP simulator, one worker. Existing executable SHA256 `8f5ec29fa6a360d4be9aee11b04d60b38cd532077ebd94e40fda72e470dd40f0` matches STATUS. No build. Fixture profile loads through the production UI/loader: one FC03 poll, start0, quantity125, scan100ms, sixteen enabled rules, no scale. Unsigned16 data forces evaluation through all sixteen nonmatching thresholds. Combined interpretations retain all sixteen rules; their decoded magnitude can match an earlier rule. All six combined formats (signed/unsigned/float32/64) and all four byte/word orders are applied through the UI.

Command from e2e with corepack PATH and `ESEFACT_BINARY_LABEL=report017-normal`: `pnpm.cmd exec playwright test --project=integration tests-integration/25-report017.spec.ts --workers=1`. Approved execution outside sandbox permits native WebView2/CDP startup. E2E TypeScript and Biome checks pass. Full workspace check is coordinated by the parent; not repeated here.

## Measurements

The PerformanceObserver was calibrated by a separate timer task: **90ms detected**. Calibration and UI edits are excluded from steady captures. Each capture records CDP aggregate TaskDuration, LayoutDuration and RecalcStyleDuration deltas, plus simulator request epoch intervals. These are main-thread/layout/style totals, not React component render durations.

| Capture | Wall time | Requests | Request intervals min / mean / max | Long tasks >50ms | Main-thread / layout / style total |
|---|---:|---:|---|---:|---|
| Unsigned16 + sixteen rules |12.136s|121|98 /100.217 /103ms|0|562.679 /45.549 /12.521ms|
| 24 combined format/order variants |2.034–2.101s each|20–21 each|all means99.95–101.60ms; aggregate minimum93, maximum122ms|0 in every variant|107.280–197.544 /5.531–8.342 /1.892–2.352ms per capture|

All captured requests are FC03/start0/quantity125. No simulator OVERLAP line. One signed32 capture contains a122ms interval (mean101.60ms); other variant means99.95–100.35ms. The test records this scheduling observation without inventing an absolute cadence tolerance or asserting its cause. It does not establish a feature-induced cadence regression. The shared host was requested to avoid heavy concurrent checks; aggregate host CPU was not measured. Captures are short responsiveness checks, not a soak or throughput benchmark.

After Pause reaches Paused, six combined interpretation/order Apply operations and a rule-name edit/Apply generate **zero additional wire requests**. Rule reorder while polling and incoming-match Modified behavior are not asserted by this spec.

## Comparison and limits

REQ-001 real-window baseline REPORT-002 S3:125 registers/100ms,120 ticks, table/traffic scrolling, calibrated observer, zero long tasks >50ms; Pause6–7ms. This round's125-register/100ms sixteen-rule capture has121 requests over12.136s and also zero long tasks >50ms; all24 combined/order captures preserve that zero count and wire quantity. The historic baseline has no task/layout/style totals or request-interval distribution to compare, so no numeric CPU/render-speed regression percentage is claimed. This round does not repeat baseline scrolling or Pause latency.

CHK5-D2 is PARTIAL: real-window steady performance and paused edit/Apply wire isolation pass; browser performance, reorder isolation and incoming matches not marking Modified need other evidence. CHK6-D1 real-window modes/orders, wire quantity, display-edit isolation and steady long-task clauses pass; timing comparison is the historical baseline comparison above. This is no full checklist or release sign-off.

Artifacts: `e2e/test-results/report017-final-results.json`, `e2e/test-results/evidence/report017/performance.json`, simulator.log and app-stdout.log. Exact per-variant measurements are retained in performance.json. Fixture cleanup removes owned app/simulator processes and data directories. Disk guard observed8,538,877,952 free bytes (>3GB) before measurement; no cache/build artifacts were deleted. Standard port1420 belongs to concurrent browser QA and is left alone. No product change, commit or .codex edit.
