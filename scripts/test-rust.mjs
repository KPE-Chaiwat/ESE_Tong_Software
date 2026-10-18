#!/usr/bin/env node
// Keep ts-rs exports from rewriting the checked-in bindings during workspace tests.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exportDir = mkdtempSync(join(tmpdir(), "esefact-rust-tests-"));
const args = process.argv.includes("--nextest")
  ? ["nextest", "run", "--workspace"]
  : ["test", "--workspace"];

try {
  const result = spawnSync("cargo", args, {
    stdio: "inherit",
    env: { ...process.env, TS_RS_EXPORT_DIR: exportDir },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(exportDir, { recursive: true, force: true });
}
