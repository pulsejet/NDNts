import { CancelInterest, Forwarder, FwPacket } from "@ndn/fw";
import { Data, FwHint, Interest, NameLike, Verifier } from "@ndn/packet";
import type { AbortSignal } from "abort-controller";
import pushable from "it-pushable";

import { makeRetxGenerator, RetxPolicy } from "./retx";

type ModifyInterestFunc = (interest: Interest) => void;

interface ModifyInterestFields {
  canBePrefix?: boolean;
  mustBeFresh?: boolean;
  fwHint?: FwHint;
  lifetime?: number;
  hopLimit?: number;
}

type ModifyInterest = ModifyInterestFunc | ModifyInterestFields;

function makeModifyInterest(input: ModifyInterest): ModifyInterestFunc {
  if (typeof input === "function") {
    return input;
  }
  const {
    canBePrefix,
    mustBeFresh,
    fwHint,
    lifetime,
    hopLimit,
  } = input;
  return (interest) => {
    if (typeof canBePrefix !== "undefined") {
      interest.canBePrefix = canBePrefix;
    }
    if (typeof mustBeFresh !== "undefined") {
      interest.mustBeFresh = mustBeFresh;
    }
    if (typeof fwHint !== "undefined") {
      interest.fwHint = fwHint;
    }
    if (typeof lifetime !== "undefined") {
      interest.lifetime = lifetime;
    }
    if (typeof hopLimit !== "undefined") {
      interest.hopLimit = hopLimit;
    }
  };
}

export interface Options {
  /** Description for debugging purpose. */
  describe?: string;

  /**
   * Modify Interest according to specified options.
   * Default is no modification.
   */
  modifyInterest?: ModifyInterest;

  /**
   * Retransmission policy.
   * Default is disabling retransmission.
   */
  retx?: RetxPolicy;

  /** AbortSignal that allows canceling the Interest via AbortController. */
  signal?: AbortSignal|globalThis.AbortSignal;

  /**
   * Data verifier.
   * Default is no verification.
   */
  verifier?: Verifier;
}

/**
 * Progress of Data retrieval.
 *
 * This is a Promise that resolves with the retrieved Data, and rejects upon timeout.
 * Calling .cancel() cancels Data retrieval and rejects the Promise.
 */
export type Context = Promise<Data> & {
  readonly interest: Interest;
  readonly nRetx: number;
};

/** Consumer functionality of Endpoint. */
export class EndpointConsumer {
  declare public fw: Forwarder;
  declare public opts: Options;

  /** Consume a single piece of Data. */
  public consume(interestInput: Interest|NameLike, opts: Options = {}): Context {
    const interest = interestInput instanceof Interest ? interestInput : new Interest(interestInput);
    const {
      describe = `consume(${interest.name})`,
      modifyInterest,
      retx,
      signal,
      verifier,
    } = { ...this.opts, ...opts };

    if (modifyInterest) {
      makeModifyInterest(modifyInterest)(interest);
    }

    let nRetx = -1;
    const retxGen = makeRetxGenerator(retx)(interest.lifetime)[Symbol.iterator]();

    const promise = new Promise<Data>((resolve, reject) => {
      const rx = pushable<FwPacket>();

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
        rx.push(FwPacket.create(interest));
        ++nRetx;
      };

      const onabort = () => {
        cancelRetx();
        rx.push(new CancelInterest(interest));
      };
      (signal as AbortSignal|undefined)?.addEventListener("abort", onabort);

      this.fw.addFace({
        rx,
        async tx(iterable) {
          for await (const pkt of iterable) {
            if (pkt.l3 instanceof Data) {
              try {
                await verifier?.verify(pkt.l3);
              } catch (err: unknown) {
                reject(new Error(`Data verify failed: ${err} @${describe}`));
                break;
              }
              resolve(pkt.l3);
              break;
            }
            if (pkt.reject && !timer) {
              reject(new Error(`Interest rejected: ${pkt.reject} @${describe}`));
              break;
            }
          }
          cancelRetx();
          (signal as AbortSignal|undefined)?.removeEventListener("abort", onabort);
          rx.end();
        },
      },
      {
        describe,
        local: true,
      });

      sendInterest();
    });

    return Object.defineProperties(promise, {
      interest: { value: interest },
      nRetx: { get() { return nRetx; } },
    });
  }
}
