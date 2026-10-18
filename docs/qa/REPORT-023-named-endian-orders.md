# REPORT-023 — Named byte order choices

2026-10-18. The owner pointed out that the combined-value Interpretation form lacked the visible Big-endian/Little-endian choices shown in the Modbus Poll reference. The form now has one **Byte order** select with four named choices and an exact width-specific byte pattern. It maps to the existing persisted `swapBytes` and `reverseWords` flags; decoding, wire requests and profile schema are unchanged.

| UI choice | 32-bit pattern | 64-bit pattern | `swapBytes` | `reverseWords` |
|---|---|---|---|---|
| Big-endian | ABCD | ABCDEFGH | false | false |
| Little-endian | DCBA | HGFEDCBA | true | true |
| Big-endian byte swap | BADC | BADCFEHG | true | false |
| Little-endian byte swap | CDAB | GHEFCDAB | false | true |

The names follow the four format families in the [Modbus Poll display-format documentation](https://modbustools.com/poll_display_formats.html); the patterns explicitly define this app's byte order.

## Verification

- `InterpretationSection.test.tsx` checks all four names and 32-bit mappings, draft/apply behavior in workspace and native components, and the applied summary; focused interpretation/decoder suite 45/45 passed.
- Browser Playwright targeted CHK6-A2: both 32-bit and 64-bit tests printed `ok`, covering all four selected orders, exact displayed values/clipboard and unchanged raw words. The Playwright runner hung after the two passing test lines and was interrupted; the command did not exit 0. No product defect was observed in those assertions, and port 1420 was free after cleanup.
- Full `pnpm check` passed (version, 91 bindings, desktop/E2E TypeScript, Biome, Rust fmt/clippy/tests, frontend 154 files / 3,542 tests). `pnpm build:web`, `cargo build --workspace`, post-build bindings check and `git diff --check` passed. Normal debug executable SHA256 `95415c2def2959a7b2c19c5a0bd4acb00261d8d1bab3a63c62b521c72e6762c1`. Disk remained above 3 GB. No commit or release package.

Real-window visual repetition of the named select remains open under the broader CHK-006 sign-off.
