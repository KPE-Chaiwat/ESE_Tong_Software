// Pure helpers of the poll list (DES-002 2.2.3, FE-002 task 06). No React, no IPC, no store.
import type {
  Counters,
  PollConfigInput,
  PollDefinition,
  PollId,
  PollSummary,
} from "@/shared/ipc/modbus-master.types";
import { hostStateOf, type PollHostState } from "../lib/status-line";

/** Slave 1, FC03, protocol start 0, quantity 10, scan rate 1000 ms (DES-001 section 1). */
export function defaultPollDefinition(): PollDefinition {
  return { slaveId: 1, function: 3, startAddress: 0, quantity: 10, scanRateMs: 1000 };
}

/**
 * What New poll creates: no scale, no aliases, values raw, alias column on. The run intent
 * `active` is set by Rust: a new poll starts paused unless "Start polling when connected" is on.
 */
export function defaultPollInput(name: string): PollConfigInput {
  return {
    name,
    definition: defaultPollDefinition(),
    display: {
      format: "unsigned",
      addressBase: 0,
      showAlias: true,
      copyAlias: false,
      swapBytes: false,
      reverseWords: false,
    },
    colorRules: [],
    scale: null,
    scaleOverrides: [],
    valueColumns: "raw",
    aliases: [],
  };
}

export function sameCounters(a: Counters, b: Counters): boolean {
  return (
    a.requests === b.requests &&
    a.responses === b.responses &&
    a.errors === b.errors &&
    a.timeouts === b.timeouts
  );
}

/** Structural equality of two summaries, so an unchanged poll keeps its object identity. */
export function sameSummary(a: PollSummary, b: PollSummary): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The poll to select after `removedId` left the list: the next row, else the previous one, else
 * nothing. `previousOrder` is the order before the removal.
 */
export function selectionAfterRemoval(
  previousOrder: readonly PollId[],
  removedId: PollId,
  newOrder: readonly PollId[],
): PollId | null {
  const index = previousOrder.indexOf(removedId);
  if (index === -1) return newOrder[0] ?? null;
  for (let i = index + 1; i < previousOrder.length; i += 1) {
    const candidate = previousOrder[i];
    if (candidate !== undefined && newOrder.includes(candidate)) return candidate;
  }
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = previousOrder[i];
    if (candidate !== undefined && newOrder.includes(candidate)) return candidate;
  }
  return null;
}

/** Names in list order. */
export function namesInOrder(
  order: readonly PollId[],
  polls: Readonly<Record<PollId, PollSummary>>,
): string[] {
  return order.flatMap((id) => {
    const p = polls[id];
    return p ? [p.config.name] : [];
  });
}

/**
 * The host transitions of DES-002 2.5.1 (H1-H17), as in the FE-002 ground rules: the sub-window
 * states move between each other, any of them pops out to native or closes, a native poll docks
 * (to a normal sub-window) or closes, and a closed poll is shown again in the workspace or natively.
 * An unexpected pair is applied anyway (Rust is authoritative) and recorded in `lastUnexpected`.
 */
export const HOST_ALLOWED: Readonly<Record<PollHostState, readonly PollHostState[]>> = {
  "workspace.normal": ["workspace.minimized", "workspace.maximized", "native", "closed"],
  "workspace.minimized": ["workspace.normal", "workspace.maximized", "native", "closed"],
  "workspace.maximized": ["workspace.normal", "workspace.minimized", "native", "closed"],
  native: ["workspace.normal", "closed"],
  closed: ["workspace.normal", "native"],
};

export function isAllowedHost(from: PollHostState, to: PollHostState): boolean {
  return from === to || HOST_ALLOWED[from].includes(to);
}

export interface UnexpectedHostTransition {
  pollId: PollId;
  from: PollHostState;
  to: PollHostState;
}

/** The first transition between two lists of polls that is not in `HOST_ALLOWED`, or null. */
export function findUnexpectedHostTransition(
  before: Readonly<Record<PollId, PollSummary>>,
  after: readonly PollSummary[],
): UnexpectedHostTransition | null {
  for (const next of after) {
    const old = before[next.config.pollId];
    if (!old) continue;
    const from = hostStateOf(old);
    const to = hostStateOf(next);
    if (!isAllowedHost(from, to)) return { pollId: next.config.pollId, from, to };
  }
  return null;
}
