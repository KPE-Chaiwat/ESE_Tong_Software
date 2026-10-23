type Stoppable = { stopPropagation(): void };
const stop = (e: Stoppable) => e.stopPropagation();

/**
 * Stops a pointer event for the React ancestors of the dialog (the sub-window frame behind it)
 * WITHOUT stopping the native event. A synthetic `stopPropagation()` also stops the native event on
 * its way to `document`, and the Radix dismissable layer of the dialog listens there: it resets its
 * "the pointer went down inside" flag in that listener. With the native event stopped the flag stayed
 * set, and the next click on the overlay was taken for a click inside and ignored (REPORT-030 D2).
 * React checks `isPropagationStopped()` between the handlers of one dispatch, so marking only the
 * synthetic event isolates the React tree and leaves the native event alone.
 */
const stopReactOnly = (e: object) => {
  Object.assign(e, { isPropagationStopped: () => true });
};

/**
 * The dialog sits in a portal, but React still bubbles its events to the sub-window frame behind
 * it. Pointer and context-menu events are stopped here. Keys are stopped too, except Tab: the
 * focus trap of the dialog (Radix FocusScope, an ancestor of this element) wraps the focus in its
 * own keydown handler and must see it (REV-007 m-1). The frame's capture handlers ignore events
 * that did not start inside the frame, so the keys that reach them are not the dialog's.
 *
 * `pointerdown` is isolated for React only (see `stopReactOnly`); the other events can stop the
 * native event too because the dismissable layer does not depend on them for mouse input.
 */
export const KEEP_INSIDE = {
  onKeyDown: (e: { key: string; stopPropagation(): void }) => {
    if (e.key !== "Tab") e.stopPropagation();
  },
  onPointerDown: stopReactOnly,
  onClick: stop,
  onContextMenu: stop,
  onDoubleClick: stop,
};
