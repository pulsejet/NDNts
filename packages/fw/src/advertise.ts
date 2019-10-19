import { Name } from "@ndn/name";

import { Face, FaceImpl } from "./face";
import { FibEntry } from "./fib";

export abstract class Advertise {
  protected readonly face: FaceImpl;

  constructor(face: Face) {
    this.face = face as FaceImpl;
  }

  /** Announce a prefix to the remote peer. */
  public advertise(fibEntry: FibEntry): void {
    if (fibEntry.advertisedTo.has(this.face)) {
      return;
    }
    fibEntry.advertisedTo.set(this.face, null);
    this.doAdvertise(fibEntry.name)
    // tslint:disable-next-line:no-console
    .catch(console.warn);
    // TODO error handling and periodical retry
  }

  /** Withdraw a prefix announcement. */
  public withdraw(fibEntry: FibEntry): void {
    this.doWithdraw(fibEntry.name)
    // tslint:disable-next-line:no-console
    .catch(console.warn)
    .finally(() => fibEntry.advertisedTo.delete(this.face));
  }

  protected abstract doAdvertise(name: Name): Promise<void>;
  protected abstract doWithdraw(name: Name): Promise<void>;
}