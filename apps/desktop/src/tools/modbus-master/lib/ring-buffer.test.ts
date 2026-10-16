import { RingBuffer } from "./ring-buffer";

describe("RingBuffer", () => {
  it("rejects an invalid capacity", () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
    expect(() => new RingBuffer(1.5)).toThrow(RangeError);
  });

  it("starts empty", () => {
    const rb = new RingBuffer<number>(3);
    expect(rb.size).toBe(0);
    expect(rb.first()).toBeUndefined();
    expect(rb.last()).toBeUndefined();
    expect(rb.toArray()).toEqual([]);
  });

  it("keeps items in order below capacity", () => {
    const rb = new RingBuffer<number>(3);
    rb.pushMany([1, 2]);
    expect(rb.toArray()).toEqual([1, 2]);
    expect(rb.get(0)).toBe(1);
    expect(rb.get(2)).toBeUndefined();
    expect(rb.get(-1)).toBeUndefined();
  });

  it("drops the oldest item when full", () => {
    const rb = new RingBuffer<number>(3);
    rb.pushMany([1, 2, 3, 4, 5]);
    expect(rb.size).toBe(3);
    expect(rb.toArray()).toEqual([3, 4, 5]);
    expect(rb.first()).toBe(3);
    expect(rb.last()).toBe(5);
  });

  it("can be cleared and reused", () => {
    const rb = new RingBuffer<number>(2);
    rb.pushMany([1, 2, 3]);
    rb.clear();
    expect(rb.size).toBe(0);
    rb.push(9);
    expect(rb.toArray()).toEqual([9]);
  });
});
