// An app session started by a test itself (for restart tests): own data dir that survives a restart.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Page } from "@playwright/test";
import { Desktop } from "./desktop";
import { openModbusWindow } from "./fixtures";
import type { RealMm } from "./real-mm";

export interface AppSession {
  desktop: Desktop;
  launcher: Page;
  mm: RealMm;
}

export function makeDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "esefact-it-data-"));
}

/** Starts the app on `dataDir` and opens one connection window. */
export async function startApp(dataDir: string, keepWindowState = false): Promise<AppSession> {
  const desktop = await Desktop.start({ dataDir, keepWindowState });
  const launcher = await desktop.launcherPage();
  const mm = await openModbusWindow(desktop, launcher);
  return { desktop, launcher, mm };
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
}
