import type { MouseEvent } from "react";
import { KEEP_FOCUS_ON_PRESS } from "./keep-focus";

const press = (button: number) => {
  const preventDefault = vi.fn();
  KEEP_FOCUS_ON_PRESS.onMouseDown({ button, preventDefault } as unknown as MouseEvent<HTMLElement>);
  return preventDefault;
};

describe("KEEP_FOCUS_ON_PRESS", () => {
  it("keeps the focus where it is on a primary mouse press", () => {
    expect(press(0)).toHaveBeenCalledOnce();
  });

  it("leaves the other buttons alone", () => {
    expect(press(1)).not.toHaveBeenCalled();
    expect(press(2)).not.toHaveBeenCalled();
  });
});
