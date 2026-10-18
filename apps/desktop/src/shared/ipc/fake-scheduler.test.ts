import { RequestScheduler, type SchedulablePoll } from "./fake-scheduler";

interface Entry {
  kind: "poll" | "write";
  id: number;
  start: number;
  end: number;
}

function harness(options: { rtt?: number; polls: SchedulablePoll[] }) {
  const rtt = options.rtt ?? 8;
  const scheduler = new RequestScheduler<number>(0);
  const log: Entry[] = [];
  const writes: number[] = [];
  const running = [...options.polls];
  const deps = {
    running: () => running,
    takeWrite: () => writes.shift(),
    serveWrite: (w: number, start: number) => {
      log.push({ kind: "write", id: w, start, end: start + rtt });
      return rtt;
    },
    servePoll: (id: number, start: number) => {
      log.push({ kind: "poll", id, start, end: start + rtt });
      return rtt;
    },
  };
  return {
    scheduler,
    log,
    writes,
    running,
    advanceTo: (t: number) => scheduler.advanceTo(t, deps),
    count: (id: number) => log.filter((e) => e.kind === "poll" && e.id === id).length,
  };
}

const polls = (n: number, scanRateMs: number): SchedulablePoll[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, scanRateMs }));

describe("RequestScheduler (DES-002 section 7)", () => {
  it("never has two requests in flight", () => {
    const h = harness({ polls: polls(8, 100) });
    h.advanceTo(10_000);
    expect(h.log.length).toBeGreaterThan(100);
    for (let i = 1; i < h.log.length; i += 1) {
      expect((h.log[i] as Entry).start).toBeGreaterThanOrEqual((h.log[i - 1] as Entry).end);
    }
  });

  it("serves a poll once per scan period when the link is free", () => {
    const h = harness({ polls: polls(1, 100) });
    h.advanceTo(1000);
    // starts at 0, 100, ..., 900 (a request that starts at 1000 is not served before 1000)
    expect(h.log.map((e) => e.start)).toEqual([
      0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000,
    ]);
  });

  it("a queued write goes before any poll request, after the one in flight", () => {
    const h = harness({ polls: polls(3, 100) });
    h.advanceTo(0); // serves poll 1 at 0 (ends at 8)
    h.writes.push(99);
    h.advanceTo(100);
    const kinds = h.log.map((e) => `${e.kind}${e.id}`);
    expect(kinds.slice(0, 3)).toEqual(["poll1", "write99", "poll2"]);
    expect(h.log[1]?.start).toBe(8);
  });

  it("writes keep their FIFO order", () => {
    const h = harness({ polls: polls(1, 1000) });
    h.advanceTo(0);
    h.writes.push(1, 2, 3);
    h.advanceTo(100);
    expect(h.log.filter((e) => e.kind === "write").map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("serves the earliest deadline first and breaks ties by the least recently served", () => {
    const h = harness({ polls: polls(3, 100) });
    h.advanceTo(30);
    // All three were due at 0: they are served in list order (never served = 0, then the id order).
    expect(h.log.map((e) => e.id)).toEqual([1, 2, 3]);
    h.advanceTo(130);
    // Their deadlines are 100, 108, 116: still the same order.
    expect(h.log.slice(3).map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("does not catch up after a slow request: the next deadline is never in the past", () => {
    const scheduler = new RequestScheduler<number>(0);
    const log: Entry[] = [];
    scheduler.advanceTo(1000, {
      running: () => [{ id: 1, scanRateMs: 100 }],
      takeWrite: () => undefined,
      serveWrite: () => 1,
      // each request takes 350 ms, much longer than the scan rate
      servePoll: (id, start) => {
        log.push({ kind: "poll", id, start, end: start + 350 });
        return 350;
      },
    });
    expect(log.map((e) => e.start)).toEqual([0, 350, 700]);
  });

  it("does not starve a poll when the link is saturated (16 polls at 20 ms)", () => {
    const h = harness({ polls: polls(16, 20) });
    h.advanceTo(20_000);
    const counts = Array.from({ length: 16 }, (_, i) => h.count(i + 1));
    expect(Math.min(...counts)).toBeGreaterThan(0);
    // round robin: nobody gets more than one request more than anybody else
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    // every running poll is served within one pass over the others (at most 15 other requests)
    const sequence = h.log.map((e) => e.id);
    for (let id = 1; id <= 16; id += 1) {
      let last = -1;
      for (const [i, who] of sequence.entries()) {
        if (who !== id) continue;
        if (last >= 0) expect(i - last).toBeLessThanOrEqual(16);
        last = i;
      }
    }
  });

  it("a slow poll rate does not delay the others", () => {
    const h = harness({
      polls: [
        { id: 1, scanRateMs: 1000 },
        { id: 2, scanRateMs: 100 },
      ],
    });
    h.advanceTo(2000);
    expect(h.count(1)).toBe(3); // 0, 1000, 2000
    expect(h.count(2)).toBe(20); // 8, 108, ... 1908
  });

  it("idles until the next deadline instead of busy looping", () => {
    const h = harness({ polls: polls(1, 5000) });
    h.advanceTo(100);
    expect(h.log).toHaveLength(1);
    h.advanceTo(4999);
    expect(h.log).toHaveLength(1);
    h.advanceTo(5000);
    expect(h.log).toHaveLength(2);
    expect(h.scheduler.now).toBe(5000);
  });

  it("a paused poll is not served and is due at once when it runs again", () => {
    const h = harness({ polls: polls(2, 100) });
    const second = h.running.pop();
    h.advanceTo(500);
    expect(h.count(2)).toBe(0);
    if (second) h.running.push(second);
    h.advanceTo(600);
    expect(h.log.filter((e) => e.id === 2)[0]?.start).toBeGreaterThanOrEqual(500);
  });

  it("rearm makes a poll due at once", () => {
    const h = harness({ polls: polls(1, 5000) });
    h.advanceTo(100);
    h.scheduler.rearm(1);
    h.advanceTo(200);
    expect(h.count(1)).toBe(2);
  });

  it("reset forgets every deadline", () => {
    const h = harness({ polls: polls(1, 5000) });
    h.advanceTo(100);
    h.scheduler.reset();
    h.advanceTo(200);
    expect(h.count(1)).toBe(2);
  });

  it("a request that is still running at the target finishes in the next advance", () => {
    const h = harness({ polls: polls(2, 100), rtt: 8 });
    h.advanceTo(4);
    expect(h.log).toHaveLength(1);
    expect(h.scheduler.linkFreeAt).toBe(8);
    h.advanceTo(8);
    expect(h.log).toHaveLength(2);
    expect(h.log[1]?.start).toBe(8);
  });
});
