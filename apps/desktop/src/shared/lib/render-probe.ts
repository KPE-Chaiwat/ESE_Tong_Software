// A dev-only render counter (REPORT-003 section 5, item 6): how many times a component committed,
// per key, so a performance test can ask "did the other poll views re-render during this drag?"
// instead of guessing from DOM mutations.
//
// In a dev build (`pnpm dev:web`, with or without VITE_FAKE_IPC) it is on and installed as
// `window.__ESEFACT_RENDERS__`. In a production build it is off: `record` does nothing and nothing
// is installed on `window`.
//
// QA reads it with, for example:
//   const before = await page.evaluate(() => window.__ESEFACT_RENDERS__?.get("poll-view:3") ?? 0);
//   ... drag ...
//   const after = await page.evaluate(() => window.__ESEFACT_RENDERS__?.get("poll-view:3") ?? 0);
// `all()` returns every key, `reset()` clears the counts. The key of a poll view is `poll-view:{pollId}`.

export interface RenderProbe {
  readonly enabled: boolean;
  /** Counts one commit of `key`. */
  record(key: string): void;
  get(key: string): number;
  all(): Record<string, number>;
  reset(): void;
}

export function createRenderProbe(enabled: boolean): RenderProbe {
  const counts = new Map<string, number>();
  return {
    enabled,
    record(key) {
      if (!enabled) return;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    },
    get: (key) => counts.get(key) ?? 0,
    all: () => Object.fromEntries(counts),
    reset: () => counts.clear(),
  };
}

declare global {
  interface Window {
    /** Dev builds only (see `render-probe.ts`). */
    __ESEFACT_RENDERS__?: RenderProbe;
  }
}

/** The app's probe: on in dev builds only. */
export const renderProbe: RenderProbe = createRenderProbe(import.meta.env.DEV);

if (renderProbe.enabled && typeof window !== "undefined") window.__ESEFACT_RENDERS__ = renderProbe;
