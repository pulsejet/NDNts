import { CancelInterest, Forwarder, FwFace, RejectInterest } from "@ndn/fw";
import { Data, Interest, Verifier } from "@ndn/packet";
import pushable from "it-pushable";
import PCancelable from "p-cancelable";

import { makeRetxGenerator, RetxPolicy } from "./retx";

export interface Options {
  retx?: RetxPolicy;
  verifier?: Verifier;
  describe?: string;
}

/**
 * Progress of Data retrieval.
 *
 * This is a Promise that resolves with the retrieved Data, and rejects upon timeout.
 * Calling .cancel() cancels Data retrieval and rejects the Promise.
 */
export type Context = PCancelable<Data> & {
  readonly interest: Interest;
  readonly nRetx: number;
};

/** Consumer functionality of Endpoint. */
export class EndpointConsumer {
  declare public fw: Forwarder;
  declare public opts: Options;

  /** Consume a single piece of Data. */
  public consume(interest: Interest, opts: Options = {}): Context {
    const {
      retx,
      verifier,
      describe = `consume(${interest.name})`,
    } = { ...this.opts, ...opts };
    let nRetx = -1;
    const retxGen = makeRetxGenerator(retx)(interest.lifetime)[Symbol.iterator]();

    const promise = new PCancelable<Data>((resolve, reject, onCancel) => {
      const rx = pushable<FwFace.Rxable>();
      let timer: NodeJS.Timeout|undefined;
      const cancelRetx = () => {
        if (timer) { clearTimeout(timer); }
        timer = undefined;
      };
      const sendInterest = () => {
        cancelRetx();
        const { value, done } = retxGen.next() as IteratorYieldResult<number>;
        if (!done) {
          timer = setTimeout(sendInterest, value);
        }
        rx.push(interest);
        ++nRetx;
      };

      this.fw.addFace({
        extendedTx: true,
        rx,
        async tx(iterable) {
          for await (const pkt of iterable) {
            if (pkt instanceof Data) {
              try {
                await verifier?.verify(pkt);
              } catch (err) {
                reject(new Error(`Data verify failed: ${err} @${this}`));
                break;
              }
              resolve(pkt);
              break;
            }
            if (!timer) {
              const rej = pkt as RejectInterest;
              reject(new Error(`Interest rejected: ${rej.reason} @${this}`));
              break;
            }
          }
          cancelRetx();
          rx.end();
        },
        toString() { return describe; },
      } as FwFace.Base & FwFace.RxTxExtended,
      {
        local: true,
      });

      sendInterest();
      onCancel(() => {
        cancelRetx();
        rx.push(new CancelInterest(interest));
      });
      onCancel.shouldReject = false;
    });

    return Object.defineProperties(promise, {
      interest: { value: interest },
      nRetx: { get() { return nRetx; } },
    });
  }
}
