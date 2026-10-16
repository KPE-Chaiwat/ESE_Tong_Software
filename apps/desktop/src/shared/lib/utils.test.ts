import { cn } from "./utils";

describe("cn", () => {
  it("joins class names and skips falsy values", () => {
    expect(cn("a", false, undefined, "b")).toBe("a b");
  });

  it("lets the later Tailwind utility win", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
