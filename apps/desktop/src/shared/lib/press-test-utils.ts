import type { UserEvent } from "@testing-library/user-event";

/**
 * A mouse click on `button` where the layout shifts while the button is pressed: if the press made
 * the page change (`shifted()` is true after the press, for example a blur that showed a field
 * message), the pointer is released over `landing()` instead of over the button, as in a real
 * browser where the button moved away from under the pointer. A click needs the press and the
 * release on the same element, so the click is then lost (user-event dispatches it on the common
 * ancestor), exactly like the real app did before the fix.
 */
export async function clickWithLayoutShift(
  user: UserEvent,
  button: HTMLElement,
  shifted: () => boolean,
  landing: () => HTMLElement,
): Promise<void> {
  await user.pointer({ keys: "[MouseLeft>]", target: button });
  const target = shifted() ? landing() : button;
  await user.pointer({ target });
  await user.pointer({ keys: "[/MouseLeft]", target });
}
