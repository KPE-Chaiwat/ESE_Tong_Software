import { useEffect } from "react";

/**
 * A lone Alt tap must not reach the host window as an unhandled accelerator (REPORT-006 D2, DES-002
 * 3.1, D-002-25). On Windows, pressing and releasing Alt with no other key in between puts the
 * window into the OS menu mode (WM_SYSKEYUP -> SC_KEYMENU), which freezes the keyboard input of the
 * page until the next Alt or Esc. A page that calls `preventDefault` on the key event tells the
 * host the key was handled, so the menu mode never starts.
 *
 * - keyup of `Alt` / `AltGraph`: `preventDefault` when no other key went down since that Alt went
 *   down (a lone tap), also after an Alt-drag with the mouse (pointer input is not a key) and also
 *   in a text field. A window blur between the two forgets the press (the keyup is not ours).
 * - keydown of `Alt` / `AltGraph`: `preventDefault`, except while a text field has the focus (the OS
 *   builds characters from Alt codes and AltGr there; the keyup rule still protects it). jsdom
 *   cannot tell whether this keydown rule is needed to stop WebView2's menu mode: only the keyup
 *   rule is known to matter, the keydown rule is kept as a second line of defence.
 * - Alt together with another key (Alt+Arrow, Alt+F4, Alt+Space, Alt codes) is never touched: the
 *   other key is not prevented here and the Alt keyup after a combination is not prevented either.
 * - Nothing is stopped from propagating: the drag gestures read the Alt keys (Alt turns snapping off).
 */

const isAlt = (key: string) => key === "Alt" || key === "AltGraph";

export interface LoneAltTracker {
  /** Every keydown (auto repeat included). */
  keyDown(e: { key: string }): void;
  /** True (call `preventDefault`) only for the Alt keyup that ends a press with no other key in between. */
  keyUp(e: { key: string }): boolean;
  /** The window lost the focus: the press in progress is forgotten. */
  blur(): void;
}

export function createLoneAltTracker(): LoneAltTracker {
  /** True from an Alt keydown until any other key goes down. */
  let lone = false;
  return {
    keyDown(e) {
      lone = isAlt(e.key);
    },
    keyUp(e) {
      if (!isAlt(e.key)) return false;
      const result = lone;
      lone = false;
      return result;
    },
    blur() {
      lone = false;
    },
  };
}

export interface AltGuardEvent {
  type: string;
  key: string;
  target: EventTarget | null;
  preventDefault(): void;
}

export interface AltGuard {
  /** Feed every keydown and keyup of the window, in order. Returns true when it prevented it. */
  handle(e: AltGuardEvent): boolean;
  blur(): void;
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true
  );
}

export function createAltGuard(): AltGuard {
  const tracker = createLoneAltTracker();
  return {
    handle(e) {
      if (e.type === "keydown") {
        tracker.keyDown(e);
        if (!isAlt(e.key) || isTextEntry(e.target)) return false;
        e.preventDefault();
        return true;
      }
      if (e.type === "keyup" && tracker.keyUp(e)) {
        e.preventDefault();
        return true;
      }
      return false;
    },
    blur: () => tracker.blur(),
  };
}

/** One installation per window object, shared by every caller (the app shell and the window components). */
const installed = new WeakMap<Window, { count: number; dispose(): void }>();

/** Installs the guard on a window (capture phase). Returns the function that removes this caller's share. */
export function installAltGuard(win: Window = window): () => void {
  const existing = installed.get(win);
  if (existing) {
    existing.count += 1;
  } else {
    const guard = createAltGuard();
    const onKey = (e: KeyboardEvent) => {
      guard.handle(e);
    };
    const onBlur = () => guard.blur();
    win.addEventListener("keydown", onKey, true);
    win.addEventListener("keyup", onKey, true);
    win.addEventListener("blur", onBlur);
    installed.set(win, {
      count: 1,
      dispose() {
        win.removeEventListener("keydown", onKey, true);
        win.removeEventListener("keyup", onKey, true);
        win.removeEventListener("blur", onBlur);
      },
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const entry = installed.get(win);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count <= 0) {
      entry.dispose();
      installed.delete(win);
    }
  };
}

/** Installs the guard for the lifetime of the component: the app shell (every window) and the poll windows. */
export function useAltGuard(): void {
  useEffect(() => installAltGuard(), []);
}
