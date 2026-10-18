/** Scroll only this container; scrollIntoView also moves outer frames and the document. */
export function scrollWithin(container: HTMLElement, element: Element) {
  const target = element.getBoundingClientRect();
  const viewport = container.getBoundingClientRect();
  if (target.top < viewport.top) container.scrollTop += target.top - viewport.top;
  else if (target.bottom > viewport.bottom) container.scrollTop += target.bottom - viewport.bottom;
  if (target.left < viewport.left) container.scrollLeft += target.left - viewport.left;
  else if (target.right > viewport.right) container.scrollLeft += target.right - viewport.right;
}
