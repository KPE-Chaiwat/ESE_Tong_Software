// Driver for the Modbus TCP slave simulator (`esefact-sim-slave`, docs/SETUP.md section 4).
// Loopback only. Free ports (--listen/--control 127.0.0.1:0), parsed from the READY line.
import { type ChildProcess, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

export const REPO = path.resolve(import.meta.dirname, "..", "..");
export const SIM_EXE = path.join(REPO, "target", "debug", "esefact-sim-slave.exe");

export interface LogEntry {
  raw: string;
  iso: string;
  epoch: number;
  conn: number | null;
  dir: "RX" | "TX" | "NO-REPLY" | "CTRL" | "OTHER";
  len: number | null;
  bytes: string | null;
  note: string | null;
}

/** `2026-.. 1760617696789 conn=1 RX 12 | 00 01 ..` or `... NO-REPLY # fault drop` or `... CTRL ...`. */
export function parseLog(line: string): LogEntry | null {
  const m = /^(\S+Z) (\d{10,}) (.*)$/.exec(line);
  if (!m) return null;
  const rest = m[3] ?? "";
  const base = { raw: line, iso: m[1] ?? "", epoch: Number(m[2]), conn: null, len: null, bytes: null, note: null };
  const conn = /^conn=(\d+) (.*)$/.exec(rest);
  const body = conn ? (conn[2] ?? "") : rest;
  const connId = conn ? Number(conn[1]) : null;
  const frame = /^(RX|TX) (\d+) \| ([0-9A-F ]*?)(?: # (.*))?$/.exec(body);
  if (frame) {
    return {
      ...base,
      conn: connId,
      dir: frame[1] as "RX" | "TX",
      len: Number(frame[2]),
      bytes: (frame[3] ?? "").trim(),
      note: frame[4] ?? null,
    };
  }
  if (body.startsWith("NO-REPLY")) return { ...base, conn: connId, dir: "NO-REPLY", note: body };
  if (body.startsWith("CTRL")) return { ...base, conn: connId, dir: "CTRL", note: body };
  return { ...base, conn: connId, dir: "OTHER", note: body };
}

export class Sim {
  readonly lines: string[] = [];
  modbusPort = 0;
  controlPort = 0;
  private proc!: ChildProcess;
  private buffer = "";

  static async start(extraArgs: string[] = []): Promise<Sim> {
    const sim = new Sim();
    await sim.launch(extraArgs);
    return sim;
  }

  get pid(): number | undefined {
    return this.proc.pid;
  }

  private launch(extraArgs: string[]): Promise<void> {
    const args = ["--listen", "127.0.0.1:0", "--control", "127.0.0.1:0", "--no-stdin", ...extraArgs];
    this.proc = spawn(SIM_EXE, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`sim: no READY line. Output so far:\n${this.lines.join("\n")}`)), 15_000);
      const onData = (chunk: Buffer) => {
        this.buffer += chunk.toString("utf8");
        let nl = this.buffer.indexOf("\n");
        while (nl >= 0) {
          const line = this.buffer.slice(0, nl).replace(/\r$/, "");
          this.buffer = this.buffer.slice(nl + 1);
          this.lines.push(line);
          const ready = /READY modbus=127\.0\.0\.1:(\d+) control=127\.0\.0\.1:(\d+)/.exec(line);
          if (ready) {
            this.modbusPort = Number(ready[1]);
            this.controlPort = Number(ready[2]);
            clearTimeout(timer);
            resolve();
          }
          nl = this.buffer.indexOf("\n");
        }
      };
      this.proc.stdout?.on("data", onData);
      this.proc.stderr?.on("data", onData);
      this.proc.once("error", reject);
      this.proc.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`sim exited early with code ${code}:\n${this.lines.join("\n")}`));
      });
    });
  }

  /** One control command; resolves with the answer line (`ok ...` / `error ...`). */
  ctl(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port: this.controlPort });
      let answer = "";
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`control command timed out: ${command}`));
      }, 5000);
      socket.on("connect", () => socket.write(`${command}\n`));
      socket.on("data", (d) => {
        answer += d.toString("utf8");
        if (answer.includes("\n")) {
          clearTimeout(timer);
          socket.end();
          resolve(answer.trim());
        }
      });
      socket.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  async ctlOk(command: string): Promise<string> {
    const answer = await this.ctl(command);
    if (!answer.startsWith("ok")) throw new Error(`control "${command}" -> ${answer}`);
    return answer;
  }

  /** Values read back with `get`: `ok 1 2 3` -> [1, 2, 3]. */
  async get(table: "coils" | "discrete" | "holding" | "input", addr: number, count = 1): Promise<number[]> {
    const answer = await this.ctlOk(`get ${table} ${addr} ${count}`);
    return answer.split(/\s+/).slice(1).map(Number);
  }

  /** Parsed RX/TX frames (not control, not notes) in order. */
  frames(): LogEntry[] {
    return this.entries().filter((e) => e.dir === "RX" || e.dir === "TX");
  }

  entries(): LogEntry[] {
    return this.lines.map(parseLog).filter((e): e is LogEntry => e !== null);
  }

  /** Index to pass to `framesSince` so a test can look only at what happens next. */
  mark(): number {
    return this.lines.length;
  }

  framesSince(mark: number): LogEntry[] {
    return this.lines.slice(mark).map(parseLog).filter((e): e is LogEntry => e !== null && (e.dir === "RX" || e.dir === "TX"));
  }

  async stop(): Promise<void> {
    if (!this.proc || this.proc.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const kill = setTimeout(() => {
        this.proc.kill();
      }, 3000);
      this.proc.once("exit", () => {
        clearTimeout(kill);
        resolve();
      });
      this.ctl("quit").catch(() => this.proc.kill());
    });
  }
}
