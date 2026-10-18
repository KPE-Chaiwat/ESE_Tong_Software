// Profile files for the integration specs: written into the app's temp data dir (ESEFACT_DATA_DIR) and opened
// through File > Open profile. Shapes: schema 2 as in docs/design/DES-002 6.1, schema 1 as in the platform tests.
import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import type { Desktop } from "./desktop";
import type { RealMm } from "./real-mm";

export function profilesDir(desktop: Desktop): string {
  const dir = path.join(desktop.dataDir, "profiles", "modbus-master");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeProfile(desktop: Desktop, name: string, body: unknown): string {
  const file = path.join(profilesDir(desktop), `${name}.json`);
  fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  return file;
}

export function readProfile(desktop: Desktop, name: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(profilesDir(desktop), `${name}.json`), "utf8"));
}

export interface PollProfileSpec {
  name: string;
  slave?: number;
  fc?: number;
  start?: number;
  qty?: number;
  scan?: number;
  active?: boolean;
  host?: "workspace" | "native";
  open?: boolean;
  workspace?: { x: number; y: number; width: number; height: number; z: number; state?: string; restore?: unknown } | null;
  native?: { x: number; y: number; width: number; height: number; maximized?: boolean; monitor: string } | null;
  display?: Record<string, unknown>;
  scale?: unknown;
  scaleOverrides?: unknown[];
  valueColumns?: string;
  aliases?: Array<{ address: number; alias: string }>;
}

export function pollProfile(p: PollProfileSpec): Record<string, unknown> {
  return {
    name: p.name,
    definition: { slaveId: p.slave ?? 1, function: p.fc ?? 3, startAddress: p.start ?? 0, quantity: p.qty ?? 10, scanRateMs: p.scan ?? 1000 },
    active: p.active ?? true,
    display: { format: "unsigned", addressBase: 0, showAlias: true, copyAlias: false, ...(p.display ?? {}) },
    scale: p.scale ?? null,
    scaleOverrides: p.scaleOverrides ?? [],
    valueColumns: p.valueColumns ?? "raw",
    aliases: p.aliases ?? [],
    view: {
      host: p.host ?? "workspace",
      open: p.open ?? true,
      workspace: p.workspace === undefined ? null : p.workspace && { state: "normal", restore: null, ...p.workspace },
      native: p.native ?? null,
    },
  };
}

export function profileV2(name: string, polls: PollProfileSpec[], over: Record<string, unknown> = {}, workspace: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    name,
    connection: { mode: "tcp", host: "127.0.0.1", port: 502, timeoutMs: 1000 },
    autoStartPoll: true,
    connectionWindow: null,
    workspace: {
      tileMode: false,
      compact: false,
      sidebarWidth: 280,
      sidebarCollapsed: false,
      trafficExpanded: false,
      trafficHeight: null,
      minimizedOrder: [],
      ...workspace,
    },
    polls: polls.map(pollProfile),
    ...over,
  };
}

/** File > Open profile…, then double-click the named row. */
export async function openProfile(mm: RealMm, name: string): Promise<void> {
  await mm.openMenu("File");
  await mm.menuItem("Open profile…").click();
  await mm.openDialog.getByRole("row", { name: new RegExp(name) }).dblclick();
  await expect(mm.openDialog).toHaveCount(0);
}

/** File > Save as…, name, Save. */
export async function saveProfileAs(mm: RealMm, name: string): Promise<void> {
  await mm.openMenu("File");
  await mm.menuItem("Save as…").click();
  await mm.saveAsDialog.getByLabel("Name").fill(name);
  await mm.saveAsDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(mm.profileLabel).toContainText(name);
}
