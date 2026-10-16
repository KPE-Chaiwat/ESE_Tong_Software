import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom has no layout engine. Virtualized lists render nothing without a viewport size, so any
// element marked `data-virtual-viewport` reports 800 x 600 (and the real size when it is not marked).
const viewport = { width: 800, height: 600 };
const originalRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  if (this.hasAttribute("data-virtual-viewport")) {
    return {
      ...viewport,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: viewport.width,
      bottom: viewport.height,
      toJSON() {},
    } as DOMRect;
  }
  return originalRect.call(this);
};

for (const [prop, value] of [
  ["offsetHeight", viewport.height],
  ["offsetWidth", viewport.width],
] as const) {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get() {
      return (this as HTMLElement).hasAttribute("data-virtual-viewport")
        ? value
        : (original?.get?.call(this) ?? 0);
    },
  });
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
