// The request scheduler of the fake backend: DES-002 section 7 in virtual time.
//
// 1. One request in flight per link, always (requests never overlap).
// 2. Writes first: when the link is free, a queued write goes before any poll request.
// 3. Polls by earliest deadline: `nextDue = lastStart + scanRateMs`; the poll with the earliest
//    `nextDue` that is not in the future is served; ties go to the poll served least recently.
// 4. No catch-up bursts: after a poll is served, `nextDue = max(lastStart + scanRateMs, end)`.
// 5. No starvation: an overdue poll keeps its old `nextDue`.
// The list order and the host of a poll never matter.
//
// No events, no timers: the caller supplies what to do for a request and how long it takes.

export interface SchedulablePoll {
  id: number;
  scanRateMs: number;
}

export interface SchedulerDeps<W> {
  /** The polls that are running right now (state polling, timeout, exception or badResponse). */
  running(): SchedulablePoll[];
  /** Removes and returns the oldest queued write, if any. */
  takeWrite(): W | undefined;
  /** The link starts a write at `start`. Returns how long the link is busy (ms, at least 1). */
  serveWrite(write: W, start: number): number;
  /** The link starts a poll request at `start`. Returns how long the link is busy. */
  servePoll(pollId: number, start: number): number;
}

interface DueEntry {
  nextDue: number;
  /** Serve counter value when the poll was last served; 0 = never. */
  lastServed: number;
}

export class RequestScheduler<W> {
  /** The scheduler's own clock (ms). */
  now: number;
  /** The link is busy until this time. */
  linkFreeAt: number;
  #due = new Map<number, DueEntry>();
  #served = 0;

  constructor(start: number) {
    this.now = start;
    this.linkFreeAt = start;
  }

  /** The poll is due again right away (after Apply or Resume). */
  rearm(pollId: number): void {
    this.#due.delete(pollId);
  }

  /** Forgets every deadline (link down). */
  reset(): void {
    this.#due.clear();
  }

  /** Runs the link until `target` (ms). Requests that start before `target` are served fully. */
  advanceTo(target: number, deps: SchedulerDeps<W>): void {
    for (;;) {
      const t = Math.max(this.now, this.linkFreeAt);
      if (t > target) break;

      const write = deps.takeWrite();
      if (write !== undefined) {
        const duration = Math.max(1, deps.serveWrite(write, t));
        this.linkFreeAt = t + duration;
        this.now = t;
        continue;
      }

      const running = deps.running();
      const runningIds = new Set(running.map((p) => p.id));
      for (const id of this.#due.keys()) if (!runningIds.has(id)) this.#due.delete(id);
      const candidates = running.map((p) => {
        let entry = this.#due.get(p.id);
        if (!entry) {
          entry = { nextDue: t, lastServed: 0 };
          this.#due.set(p.id, entry);
        }
        return { poll: p, entry };
      });

      const ready = candidates.filter((c) => c.entry.nextDue <= t);
      if (ready.length > 0) {
        let pick = ready[0] as (typeof ready)[number];
        for (const c of ready) {
          if (
            c.entry.nextDue < pick.entry.nextDue ||
            (c.entry.nextDue === pick.entry.nextDue && c.entry.lastServed < pick.entry.lastServed)
          ) {
            pick = c;
          }
        }
        const duration = Math.max(1, deps.servePoll(pick.poll.id, t));
        const end = t + duration;
        this.#served += 1;
        pick.entry.lastServed = this.#served;
        pick.entry.nextDue = Math.max(t + pick.poll.scanRateMs, end);
        this.linkFreeAt = end;
        this.now = t;
        continue;
      }

      const nextDue = Math.min(...candidates.map((c) => c.entry.nextDue));
      if (candidates.length === 0 || nextDue > target) break;
      this.now = nextDue;
    }
    this.now = Math.max(this.now, target);
  }
}
