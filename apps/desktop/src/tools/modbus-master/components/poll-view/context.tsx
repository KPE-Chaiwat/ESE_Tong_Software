import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { PollViewRuntime } from "../../runtime/poll-view-runtime";
import type { AliasStore } from "../../store/alias.store";
import type { ConnectionStore } from "../../store/connection.store";
import type { OverrideDialogStore } from "../../store/override-dialog.store";
import type { PollStore } from "../../store/poll.store";
import type { PollDataStore } from "../../store/poll-data.store";
import type { PollScaleStore } from "../../store/poll-scale.store";
import type { PollViewUiStore } from "../../store/poll-view-ui.store";
import type { ScaleDraftStore } from "../../store/scale-draft.store";
import { entryBorderWidth } from "./border-width";
import { DEFAULT_VIEW_WIDTH } from "./poll-view.logic";

const RuntimeContext = createContext<PollViewRuntime | null>(null);

/** Gives the PollView and its parts the runtime of one poll view. */
export function PollViewProvider({
  runtime,
  children,
}: {
  runtime: PollViewRuntime;
  children: ReactNode;
}) {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function usePollViewRuntime(): PollViewRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("PollViewProvider is missing");
  return runtime;
}

// Typed store hooks. Components select the minimum slice so unrelated updates do not re-render them.
export const usePoll = <T,>(sel: (s: PollStore) => T) =>
  useStore(usePollViewRuntime().stores.poll, sel);
export const usePollUi = <T,>(sel: (s: PollViewUiStore) => T) =>
  useStore(usePollViewRuntime().stores.ui, sel);
export const usePollData = <T,>(sel: (s: PollDataStore) => T) =>
  useStore(usePollViewRuntime().stores.data, sel);
export const usePollAlias = <T,>(sel: (s: AliasStore) => T) =>
  useStore(usePollViewRuntime().stores.alias, sel);
export const usePollScale = <T,>(sel: (s: PollScaleStore) => T) =>
  useStore(usePollViewRuntime().stores.scale, sel);
export const useScaleDraft = <T,>(sel: (s: ScaleDraftStore) => T) =>
  useStore(usePollViewRuntime().stores.scaleDraft, sel);
export const useOverrideDialog = <T,>(sel: (s: OverrideDialogStore) => T) =>
  useStore(usePollViewRuntime().stores.overrides, sel);
export const usePollConnection = <T,>(sel: (s: ConnectionStore) => T) =>
  useStore(usePollViewRuntime().stores.connection, sel);

/** Calls `callback` once per animation frame at most (a 16 ms timer where there are no frames). */
function nextFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
}

const identityWidth = (width: number) => width;

/**
 * The width of an element, from a `ResizeObserver` coalesced to one update per animation frame
 * (DES-002 2.3.4 container queries). Before the first measurement it is `DEFAULT_VIEW_WIDTH`.
 *
 * The width is the BORDER box (`getBoundingClientRect` at the start, `borderBoxSize` from the observer;
 * never `contentRect`, REPORT-008 D11): a caller whose decision changes the padding of the element it
 * measures would otherwise feed its own padding back into its input. Callers that measure an element
 * with padding or borders get the width including them.
 *
 * The measured width is EXACT (fractional at a 125% scale, e.g. 464.8): it is never rounded, because
 * a rounded width flips a strict "below the limit" step up to 0.2 px late (REPORT-005 F1).
 * `reduce` maps the exact width to the value the caller needs (default: the exact width). The state
 * is set only when that value changes, so a resize drag that moves the width by sub-pixels
 * re-renders the caller only when its own derived value changes, not once per frame.
 */
export function useElementWidth<T extends HTMLElement>(
  reduce: (exactWidth: number) => number = identityWidth,
): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(() => reduce(DEFAULT_VIEW_WIDTH));
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let latest = el.getBoundingClientRect().width;
    // `setState` bails out when the value is the same, so an unchanged derived value renders nothing.
    if (latest > 0) setWidth(reduceRef.current(latest));
    let cancel: (() => void) | null = null;
    let scheduled = false;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const measured = entryBorderWidth(entry);
      if (measured <= 0) return;
      latest = measured;
      if (scheduled) return;
      scheduled = true;
      cancel = nextFrame(() => {
        scheduled = false;
        if (latest > 0) setWidth(reduceRef.current(latest));
      });
    });
    observer.observe(el, { box: "border-box" });
    return () => {
      observer.disconnect();
      cancel?.();
    };
  }, []);

  return [ref, width];
}

/**
 * The real width of a host's FRAME element (its layout width, borders included: `offsetWidth`), from
 * a `ResizeObserver` coalesced to one update per animation frame. The sub-window frame's border is
 * 2 px active and 1.5 px (floored to 1 px by Chromium) inactive, so the width of the view inside it
 * plus a constant is not the frame width (REPORT-004 CHK2-E12). `null` until the first measurement,
 * or without a frame.
 */
export function useFrameWidth(
  frame: React.RefObject<HTMLElement | null> | undefined,
): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = frame?.current;
    if (!el) return;
    const read = () => {
      const w = el.offsetWidth;
      if (w > 0) setWidth(w);
    };
    read();
    let cancel: (() => void) | null = null;
    let scheduled = false;
    const observer = new ResizeObserver(() => {
      if (scheduled) return;
      scheduled = true;
      cancel = nextFrame(() => {
        scheduled = false;
        read();
      });
    });
    observer.observe(el, { box: "border-box" });
    return () => {
      observer.disconnect();
      cancel?.();
    };
  }, [frame]);

  return width;
}
