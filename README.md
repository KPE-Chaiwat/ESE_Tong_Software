# ESEfact

A Windows desktop launcher that bundles in-house industrial and network tools in one app.

- **Author:** tong_ese
- **Version:** 0.2.0 (pre-1.0, see [CHANGELOG.md](CHANGELOG.md))
- **License:** [MIT](LICENSE)
- **Platform:** Windows 11 first. The code is kept portable for other operating systems later.

## What is in it

| Tool | State |
|---|---|
| **Modbus Master** | Working (v0.2.0). Modbus TCP and RTU master for reading and writing registers. |
| Modbus Slave | Planned, not started. |
| IP Scanner | Planned, not started. |

### Modbus Master

- Connect over **Modbus TCP** or **Modbus RTU** (serial). One connection can run up to **16 polls** at the same time.
- Each poll has its own name, slave id, function (01, 02, 03, 04), start address, quantity and scan rate.
- Polls are shown as sub-windows inside the connection window, or popped out into their own windows and docked back. Tile, cascade and arrange, drag and drop, snapping.
- Live value table: unsigned, signed, hex or binary, 0-based or 1-based addresses, an optional **Alias** label per address.
- **Value scaling** (display only): 4-20 mA, 0-10 V, divide by 10 / 100 / 1000, or a custom linear scale, with decimals and unit.
- **Write** with functions 05, 06, 15 and 16. Writes are sent between poll requests.
- **Communication Traffic** view with the raw TX and RX frame bytes, timestamps and counters.
- Profiles: save and open the whole setup (connection, polls, layout) by name.
- English-only UI.

Known limitations of this version are listed in [CHANGELOG.md](CHANGELOG.md). In short: serial RTU has not been tested on real hardware, and the Windows installer has not been built yet.

## Install and run

There is no ready-made installer yet. Until one is published, run ESEfact from source.

### 1. Requirements (Windows 11)

| Tool | Version |
|---|---|
| Visual Studio Build Tools 2022 | Workload **Desktop development with C++** (MSVC and Windows SDK) |
| WebView2 Runtime | Preinstalled on Windows 11 |
| Rust | 1.92.0 (installed through <https://rustup.rs>; the repo pins the version) |
| Node.js | 22.19 or newer |
| Git | any recent version |
| pnpm | 10.34.6, provided through Corepack (do not install pnpm globally) |

### 2. Get the code and install

```powershell
git clone <repository-url> tong-project
cd tong-project

# pnpm through Corepack (without admin rights use a user folder, see docs/SETUP.md)
corepack enable
pnpm --version        # should print 10.34.6

pnpm install
cargo build --workspace   # first build takes several minutes
```

If `corepack enable` needs administrator rights, follow the "pnpm via Corepack" section of [docs/SETUP.md](docs/SETUP.md).

### 3. Start the app

```powershell
pnpm dev
```

The ESEfact launcher opens. Click **Open** on the Modbus Master card.

### 4. Try it without a device

Modbus Master needs a Modbus TCP slave to talk to. A test simulator is included. Open a second PowerShell window in the repository folder and run:

```powershell
cargo run -p dev-sim-slave --bin esefact-sim-slave --
```

Wait for the line `READY modbus=127.0.0.1:5020`, then in Modbus Master choose **Modbus TCP**, host `127.0.0.1`, port `5020`, and connect. New polls start **paused**: press **Ctrl+P** (or **Resume all**) to start reading. Stop the simulator with Ctrl+C.

### 5. Build the Windows installer (not verified yet)

```powershell
pnpm build
```

This is configured to produce an NSIS installer under `target\release\bundle\nsis\`. It has not been run or tested yet, and it is not code-signed, so Windows SmartScreen may warn when you run it. This section will be updated after the first installer build.

## For developers

```powershell
pnpm check     # version check, bindings, typecheck, lint and all tests
```

- Stack: Tauri v2, React 19 + TypeScript + Vite, Tailwind, Zustand, Rust workspace (tokio). Types are generated from Rust to TypeScript with ts-rs.
- Rules, layout and workflow: [CLAUDE.md](CLAUDE.md) (also summarized for other agents in [AGENTS.md](AGENTS.md)).
- Setup, commands and the simulator: [docs/SETUP.md](docs/SETUP.md).
- Current status and next steps: [docs/STATUS.md](docs/STATUS.md).
- Requirements, designs, QA reports and reviews are in [docs/](docs/).

## Version

The version has one source: `[workspace.package]` in the root `Cargo.toml`. The running app shows it as "ESEfact v0.2.0" in the launcher footer and in the Modbus Master status bar. To change it use `pnpm version:set <x.y.z>`, never edit it by hand.

## License

MIT, Copyright (c) 2026 tong_ese. See [LICENSE](LICENSE).

The project is implemented from public specifications. Fonts bundled with the app (Afacad, JetBrains Mono) have their own open licenses.
