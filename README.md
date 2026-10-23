# ESEfact

A Windows desktop launcher that bundles in-house industrial and network tools in one app.

- **Author:** tong_ese
- **Version:** 0.3.0 (pre-1.0, see [CHANGELOG.md](CHANGELOG.md))
- **License:** [MIT](LICENSE)
- **Platform:** Windows 11 first. The code is kept portable for other operating systems later.

## What is in it

| Tool | State |
|---|---|
| **Modbus Master** | Working (v0.3.0). Modbus TCP and RTU master for reading and writing registers. |
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

### Modbus Master CLI

`esefact-modbus-master.exe` is a separate command-line program for one read or write at a time. It shares the Modbus protocol code with the desktop app. Run it in PowerShell from the folder containing the executable. It is not installed as a system-wide command on `PATH`.

```powershell
.\esefact-modbus-master.exe --help
.\esefact-modbus-master.exe --version
.\esefact-modbus-master.exe read --tcp 127.0.0.1 --port 502 --unit 1 --function 3 --address 0 --count 10
.\esefact-modbus-master.exe write --tcp 127.0.0.1 --port 502 --unit 1 --function 6 --address 0 --values 42
.\esefact-modbus-master.exe read --rtu COM3 --baud 19200 --unit 1 --function 4 --address 0 --count 2 --json
```

Functions 01-04 read coils or registers; 05, 06, 15 and 16 write them. Addresses are zero-based. TCP defaults to port 502; RTU defaults to 9600 baud, 8 data bits, even parity and 1 stop bit. Use `--timeout-ms`, `--trace` for TX/RX bytes, or `--json` for scripts. Errors go to stderr with a nonzero exit code. This CLI has its own executable; a future Modbus Slave CLI will be separate.

Build the standalone file with `pnpm build:cli` at `target\release\esefact-modbus-master.exe`. `pnpm build` also bundles it with the ESEfact installer.

Known limitations are listed in [CHANGELOG.md](CHANGELOG.md). Serial RTU has not been tested on real hardware.

## Install and run

Download the installer or standalone Modbus Master CLI from the project's GitHub Releases, or build them from source as described below.

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

Wait for the line `READY modbus=127.0.0.1:5020`, then in Modbus Master choose **Modbus TCP**, host `127.0.0.1`, port `5020`, and connect. New polls start reading automatically. Stop the simulator with Ctrl+C.

### 5. Build the Windows installer and CLI

```powershell
pnpm build
```

This produces an NSIS installer under `target\release\bundle\nsis\` and a standalone CLI at `target\release\esefact-modbus-master.exe`. The installer includes the CLI executable. The installer is not code-signed.

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

The version has one source: `[workspace.package]` in the root `Cargo.toml`. The running app shows it as "ESEfact v0.3.0" in the launcher footer and in the Modbus Master status bar. The CLI reports the same version through `--version`. To change it use `pnpm version:set <x.y.z>`, never edit it by hand.

## License

MIT, Copyright (c) 2026 tong_ese. See [LICENSE](LICENSE).

The project is implemented from public specifications. Fonts bundled with the app (Afacad, JetBrains Mono) have their own open licenses.
