import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const triple = execFileSync("rustc", ["--print", "host-tuple"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (!triple) throw new Error("Rust did not report a host target triple");

execFileSync("cargo", ["build", "--workspace", "--release", "--bin", "esefact-modbus-master"], {
  cwd: root,
  stdio: "inherit",
});

const extension = process.platform === "win32" ? ".exe" : "";
const source = join(root, "target", "release", `esefact-modbus-master${extension}`);
const directory = join(root, "apps", "desktop", "src-tauri", "binaries");
mkdirSync(directory, { recursive: true });
const bundled = join(directory, `esefact-modbus-master-${triple}${extension}`);
copyFileSync(source, bundled);
process.stdout.write(`Standalone CLI: ${source}\nInstaller sidecar: ${bundled}\n`);
