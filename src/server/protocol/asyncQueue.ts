/** Minimal FIFO async queue — TS equivalent of Python's asyncio.Queue used
 * by the RHP session's inbox (one producer: the reader loop, one consumer:
 * WpsClient's recv() calls). */
export class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: Array<(v: T) => void> = [];

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
    } else {
      this.items.push(item);
    }
  }

  async pop(): Promise<T> {
    const item = this.items.shift();
    if (item !== undefined) return item;
    return new Promise<T>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}
