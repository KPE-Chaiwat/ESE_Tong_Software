/**
 * Fixed-capacity buffer that drops the oldest items first. Index 0 is the oldest item.
 * Mutable on purpose: the traffic store appends thousands of frames and bumps a version counter,
 * so selectors never copy the buffer.
 */
export class RingBuffer<T> {
  readonly capacity: number;
  #items: (T | undefined)[];
  #start = 0;
  #size = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("RingBuffer capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.#items = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.#size;
  }

  push(item: T): void {
    if (this.#size < this.capacity) {
      this.#items[(this.#start + this.#size) % this.capacity] = item;
      this.#size += 1;
    } else {
      this.#items[this.#start] = item;
      this.#start = (this.#start + 1) % this.capacity;
    }
  }

  pushMany(items: readonly T[]): void {
    for (const item of items) this.push(item);
  }

  /** Item at `index` counted from the oldest, or undefined when out of range. */
  get(index: number): T | undefined {
    if (index < 0 || index >= this.#size) return undefined;
    return this.#items[(this.#start + index) % this.capacity];
  }

  first(): T | undefined {
    return this.get(0);
  }

  last(): T | undefined {
    return this.get(this.#size - 1);
  }

  clear(): void {
    this.#items = new Array<T | undefined>(this.capacity);
    this.#start = 0;
    this.#size = 0;
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.#size; i += 1) {
      out.push(this.get(i) as T);
    }
    return out;
  }
}
