# ESEfact development setup (Windows 11)

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Visual Studio Build Tools 2022 | any recent | Workload **Desktop development with C++** (MSVC v143 + Windows 10/11 SDK). Required by the Rust MSVC toolchain and Tauri. |
| WebView2 Runtime | any | Preinstalled on Windows 11. Otherwise install the Evergreen runtime from Microsoft. |
| Rust | 1.92.0 (pinned) | Install via <https://rustup.rs> (host `x86_64-pc-windows-msvc`). `rust-toolchain.toml` makes rustup fetch the pinned version, `clippy` and `rustfmt` automatically on first `cargo` call. |
| Node.js | >= 22.19.0 | Includes Corepack. |
| Git | any recent | |
| pnpm | 10.34.6 (pinned) | Provided through Corepack, see below. Do not `npm i -g pnpm`. |

Optional: `cargo install cargo-nextest --locked` (Definition of Done uses nextest; `pnpm test:rust:nextest`).

### pnpm via Corepack

The exact pnpm version is pinned in the root `package.json` (`packageManager`).

```powershell
corepack enable
```

`corepack enable` writes shims into `C:\Program Files\nodejs`, which needs an **administrator** PowerShell. Without admin rights use a user-writable folder instead and put it on PATH:

```powershell
New-Item -ItemType Directory -Force "$HOME\.corepack-bin"
corepack enable --install-directory "$HOME\.corepack-bin"
# current session:
$env:PATH = "$HOME\.corepack-bin;$env:PATH"
# permanent (new terminals): add "$HOME\.corepack-bin" to your user PATH in System Settings
```

Check: `pnpm --version` prints `10.34.6`.

> pnpm 11/12 are not used: pnpm 12's launcher is not compatible with the Corepack shipped with Node 22.19 (`Cannot find module ...\pnpm.cjs`). Bump the pin only after verifying `corepack pnpm --version` works.

## 2. First-time setup

From the repository root:

```powershell
pnpm install                 # JS dependencies (all workspaces)
cargo build --workspace      # first build downloads and compiles Tauri (several minutes)
pnpm bindings                # (re)generate TypeScript bindings from Rust types
```

Optional, only to run Playwright later: `pnpm --filter @esefact/e2e install:browsers`.

## 3. Daily commands (run from the repository root)

| Command | What it does |
|---|---|
| `pnpm dev` | Starts Vite and the Tauri desktop window (hot reload). |
| `pnpm dev:web` | Frontend only in a browser at <http://localhost:1420> (no Tauri IPC). |
| `pnpm build` | Production build and Windows installer (NSIS) under `target\release\bundle\`. Signing is not configured in the repo. |
| `pnpm build:web` | Typecheck + Vite build into `apps/desktop/dist`. |
| `pnpm typecheck` | `tsc --noEmit` for `apps/desktop` and `e2e`. |
| `pnpm lint` | `cargo fmt --check`, `cargo clippy -D warnings`, and Biome. |
| `pnpm lint:rust` / `pnpm lint:web` | Each half of the above. |
| `pnpm test` | Rust (`cargo test --workspace`) then frontend (Vitest). |
| `pnpm test:rust` / `pnpm test:rust:nextest` / `pnpm test:web` | Individual suites. |
| `pnpm bindings` | Regenerates `apps/desktop/src/shared/bindings/` from `crates/shared-types` (ts-rs). Never edit those files by hand. |
| `pnpm bindings:check` | Regenerates into a temp folder and fails if the committed bindings are stale (CI). |
| `pnpm e2e` | Playwright (no tests yet; passes when empty). |
| `pnpm check` | bindings:check + typecheck + lint + test (what CI should run). |
| `pnpm --filter @esefact/desktop lint:fix` | Biome auto-fix and format. |

## 4. Dev tool: Modbus TCP slave simulator (`esefact-sim-slave`)

> **Test tool only.** This is not the future Modbus Slave product. It lives in `crates/dev-sim-slave` (`publish = false`), is not bundled with the app (`pnpm build` only bundles `esefact-desktop`), and no product crate depends on it. QA uses it for integration runs against the real app (WebView2).

### Run it

```powershell
cargo run -p dev-sim-slave --bin esefact-sim-slave --              # 127.0.0.1:5020, control 127.0.0.1:5021
cargo run -p dev-sim-slave --bin esefact-sim-slave -- --listen 127.0.0.1:0 --control 127.0.0.1:0   # free ports
cargo run -p dev-sim-slave --bin esefact-sim-slave -- --help
```

On start it prints `... READY modbus=127.0.0.1:5020 control=127.0.0.1:5021`, which you can parse when ports are 0. Stop it with `quit` (stdin or control port) or Ctrl+C.

| Option | Meaning |
|---|---|
| `--listen <ip:port>` | Modbus TCP address (default `127.0.0.1:5020`; port 0 = any free port) |
| `--control <ip:port>` | Control port, **loopback only** (default `127.0.0.1:5021`); `--no-control` disables it |
| `--no-stdin` | Do not read control commands from stdin |
| `--units <all\|1,2,0>` | Unit ids that are answered (default all, including 0; unit 0 is a normal unit on TCP). Others get no reply |
| `--limit <n>` | Addresses `>= n` answer exception 02 (default 65536 = none) |
| `--preload <file.json>` | Initial values, e.g. `{"holding": {"100": [1, 2, 3], "0x10": 4660}, "coils": {"0": [0, 1]}, "input": {"5": 9}, "discrete": {"1": 1}}` |
| `--set <table>:<addr>=<v>[,<v>...]` | Initial values, repeatable, e.g. `--set holding:0=1234,5678` |

Default data (all unit ids share one map): `holding[n] = n`, `input[n] = 65535 - n`, `coils[n] = 1` when n is odd, `discrete[n] = 1` when n is a multiple of 3. Functions 01-06, 15, 16. Exceptions on their own: 01 unsupported function, 02 address beyond `--limit`/65535, 03 bad quantity / byte count / coil value.

### Control commands

Send one per line on stdin or to the control port (`127.0.0.1:5021`, plain TCP, for example from Node `net.connect`). Each line is answered with `ok ...` or `error ...` (on the control port; on stdin the answer appears in the log). Numbers are decimal or `0x` hex.

| Command | Effect |
|---|---|
| `status` | Listening flag, active fault, units, limit, request count |
| `set <coils\|discrete\|holding\|input> <addr> <v> [v...]` | Write values (bits 0/1) |
| `get <table> <addr> [count]` | Read values: `ok 1 2 3` |
| `fault delay <ms>` | Reply after a delay |
| `fault drop` | No reply (master times out) |
| `fault exception <code>` | Exception reply, e.g. `4` device failure, `0x0A`/`0x0B` gateway (the request is not executed) |
| `fault wrong-unit <id>` | Reply with another unit id |
| `fault wrong-txn` | Reply with transaction id + 1 |
| `fault wrong-function` | Reply with another function code (03 <-> 04, else 03) |
| `fault truncate <bytes>` | Send only the first N bytes of the reply |
| `fault garbage [hex...]` | Send these bytes instead (default `DE AD BE EF`) |
| `fault close` | Send half the reply, then close the socket |
| `... times=N` | Any fault: apply to the next N requests only (default: until `clear`) |
| `clear` | Remove the active fault (one fault is active at a time; a new one replaces it) |
| `units all` / `units <id> [id...]` | Change answered unit ids |
| `limit <n>` | Change the exception-02 limit |
| `refuse on` / `refuse off` | Stop / start accepting new connections (the listening socket is closed, so connects are refused by the OS; established connections keep working, but one that connected a moment before and was not yet accepted is reset) |
| `stop` / `resume` | Device goes away: close all connections and refuse new ones / come back |
| `help`, `quit` | Command list / exit |

Except for `fault exception`, faulted requests are still executed (a write is applied), only the reply is changed.

### Log format (stdout)

```
2026-10-16T12:28:16.789Z 1760617696789 conn=1 RX 12 | 00 01 00 00 00 06 01 03 00 00 00 0A
2026-10-16T12:28:16.790Z 1760617696790 conn=1 TX 29 | 00 01 00 00 00 17 01 03 14 00 00 00 01 ...
2026-10-16T12:28:17.001Z 1760617697001 conn=1 NO-REPLY # fault drop: no reply
```

Columns: UTC time, epoch milliseconds (comparable with `TrafficFrame.at`), connection id, direction, byte count, bytes in the same uppercase hex format as the Traffic panel, `# note` for faults. Control commands are logged as `CTRL <line> -> <answer>`.
## 5. Layout notes

- Crates: `modbus-core` <- `transport` <- `modbus-master` <- `apps/desktop/src-tauri`; `platform` and `shared-types` are independent. See `CLAUDE.md`. `crates/dev-sim-slave` is a dev/test tool (section 4), not a product crate.
- `cargo test` also writes ts-rs bindings; `.cargo/config.toml` sends them to `apps/desktop/src/shared/bindings/`.
- `cargo check`/`clippy` of `src-tauri` do not need a built frontend in the dev profile. A release build does (`pnpm build` runs `build:web` first).
- Fonts (Afacad, JetBrains Mono) are bundled from `@fontsource/*`; the app needs no network at runtime.
- Design tokens live only in `apps/desktop/src/app/styles.css`.
- The Tauri window title is `ESEfact` (`apps/desktop/src-tauri/tauri.conf.json`).
- The app icon is a placeholder; replace with `pnpm --filter @esefact/desktop tauri icon <1024px-png>` when branding is final.

## 6. Troubleshooting

- `link.exe not found` / `linker ... failed`: install the C++ build tools workload, then reopen the terminal.
- `Cannot find module ...pnpm.cjs`: pnpm pin is too new for your Corepack; see the note above.
- `ERR_PNPM_UNSUPPORTED_ENGINE`: Node is older than the dependency requires; upgrade Node (>= 22.19, the newest 22.x is recommended).
- Port 1420 busy: close the other dev server (the port is fixed because Tauri expects it).
