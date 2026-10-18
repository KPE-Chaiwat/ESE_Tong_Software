import { render } from "@testing-library/react";
import { useRef } from "react";
import { useTruncationTitle } from "./use-truncation-title";

function sized(el: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
}

function Probe({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useTruncationTitle(ref, text);
  return (
    <span ref={ref} data-testid="probe">
      {text}
    </span>
  );
}

/** Renders with the given measurements in place before the first layout effect runs. */
function mount(text: string, scrollWidth: number, clientWidth: number) {
  const proto = HTMLElement.prototype;
  const sw = Object.getOwnPropertyDescriptor(proto, "scrollWidth");
  const cw = Object.getOwnPropertyDescriptor(proto, "clientWidth");
  Object.defineProperty(proto, "scrollWidth", { configurable: true, get: () => scrollWidth });
  Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => clientWidth });
  const view = render(<Probe text={text} />);
  const restore = () => {
    if (sw) Object.defineProperty(proto, "scrollWidth", sw);
    else Reflect.deleteProperty(proto, "scrollWidth");
    if (cw) Object.defineProperty(proto, "clientWidth", cw);
    else Reflect.deleteProperty(proto, "clientWidth");
  };
  return { view, restore };
}

describe("useTruncationTitle", () => {
  it("sets the title to the full text when the text is cut (200 > 100)", () => {
    const { view, restore } = mount("Last OK 09:50:57.569 · Round trip 0 ms", 200, 100);
    expect(view.getByTestId("probe")).toHaveAttribute(
      "title",
      "Last OK 09:50:57.569 · Round trip 0 ms",
    );
    restore();
  });

  it("has no title when the text fits (100, 100)", () => {
    const { view, restore } = mount("short", 100, 100);
    expect(view.getByTestId("probe")).not.toHaveAttribute("title");
    restore();
  });

  it("follows a change of the text", () => {
    const { view, restore } = mount("first", 200, 100);
    expect(view.getByTestId("probe")).toHaveAttribute("title", "first");
    view.rerender(<Probe text="second" />);
    expect(view.getByTestId("probe")).toHaveAttribute("title", "second");
    restore();
  });

  it("removes the title when the new text fits", () => {
    const { view, restore } = mount("long text", 200, 100);
    expect(view.getByTestId("probe")).toHaveAttribute("title");
    const el = view.getByTestId("probe");
    sized(el, 50, 100);
    view.rerender(<Probe text="short" />);
    expect(el).not.toHaveAttribute("title");
    restore();
  });
});
