import type { MouseEvent } from "react";

/**
 * Spread on an action button that sits below fields which validate on blur (Apply, Save, Cancel,
 * Send): pressing the mouse on it does not move the focus, so the field keeps the focus, nothing
 * blurs and no message appears and pushes the button away from under the pointer before the click
 * completes (a mouse click needs the press and the release on the same element). The click itself
 * still fires, the button validates everything on submit, and the keyboard is not affected (Tab
 * still moves the focus to the button).
 */
export const KEEP_FOCUS_ON_PRESS = {
  onMouseDown: (e: MouseEvent<HTMLElement>) => {
    if (e.button === 0) e.preventDefault();
  },
} as const;
