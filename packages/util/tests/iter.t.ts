import { pushable } from "it-pushable";
import { collect } from "streaming-iterables";
import { expect, test, vi } from "vitest";

import { delay, evict, flatMapOnce, safeIter } from "..";

test("safeIter ignore", async () => {
  const it = pushable<number>({ objectMode: true });
  const collector = collect(safeIter(it));

  it.push(1);
  it.push(2);
  await delay(10);
  it.end(new Error("X"));
  it.push(3);

  const a = await collector;
  expect(a).toEqual([1, 2]);
});

test("safeIter catch", async () => {
  const it = pushable<number>({ objectMode: true });
  const onError = vi.fn<[unknown], undefined>();
  const collector = collect(safeIter(it, onError));

  it.push(1);
  it.push(2);
  await delay(10);
  it.end(new Error("X"));
  it.push(3);

  const a = await collector;
  expect(a).toEqual([1, 2]);
  expect(onError).toHaveBeenCalledTimes(1);
});

test("flatMapOnce", async () => {
  const it = pushable<number>({ objectMode: true });
  it.push(1);
  it.push(2);
  it.push(3);
  it.push(4);
  it.end();

  const a = await collect(flatMapOnce((n): Array<number | number[]> => {
    if (n % 2 === 0) {
      return [n];
    }
    return [[n]];
  }, it));
  expect(a).toEqual([[1], 2, [3], 4]);
});

test("evict", () => {
  const m = new Map<number, number>();
  m.set(10, 20);
  m.set(14, 28);
  m.set(18, 36);
  m.set(11, 22);
  m.set(15, 30);
  m.set(19, 38);
  evict(2, m);
  expect(m).toEqual(new Map([[15, 30], [19, 38]]));
});
