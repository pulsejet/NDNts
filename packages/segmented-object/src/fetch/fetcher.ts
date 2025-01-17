import type { Endpoint } from "@ndn/endpoint";
import { CancelInterest, Forwarder, type FwFace, FwPacket } from "@ndn/fw";
import { Data, Interest, type Name, type Verifier } from "@ndn/packet";
import { CustomEvent } from "@ndn/util";
import { TypedEventTarget } from "typescript-event-target";

import { defaultSegmentConvention, type SegmentConvention } from "../convention";
import { FetchLogic } from "./logic";

type EventMap = {
  /** Emitted when a Data segment arrives. */
  segment: Fetcher.SegmentDataEvent;
  /** Emitted after all data chunks arrive. */
  end: Event;
  /** Emitted upon error. */
  error: CustomEvent<Error>;
};

/** Fetch Data packets as guided by FetchLogic. */
export class Fetcher extends TypedEventTarget<EventMap> {
  /** Number of segments retrieved so far. */
  public get count() { return this.count_; }
  private count_ = 0;
  private readonly logic: FetchLogic;
  private readonly face: FwFace;
  private readonly modifyInterest: Interest.ModifyFunc;

  constructor(private readonly name: Name, private readonly opts: Fetcher.Options) {
    super();
    this.logic = new FetchLogic(opts);
    this.logic.addEventListener("end", () => {
      this.dispatchTypedEvent("end", new Event("end"));
      this.close();
    });
    this.logic.addEventListener("exceedRetxLimit", ({ detail: segNum }) => {
      this.fail(new Error(`cannot retrieve segment ${segNum}`));
    });

    this.face = (opts.endpoint?.fw ?? Forwarder.getDefault()).addFace({
      rx: this.tx(),
      tx: this.rx,
    }, {
      describe: opts.describe ?? `fetch(${name})`,
    });

    this.modifyInterest = Interest.makeModifyFunc(opts.modifyInterest);

    opts.signal?.addEventListener("abort", this.handleAbort);
  }

  public close() {
    this.opts.signal?.removeEventListener("abort", this.handleAbort);
    this.logic.close();
    this.face.close();
  }

  /**
   * Pause outgoing Interests, for backpressure from Data consumer.
   * Return a function for resuming.
   */
  public pause() {
    return this.logic.pause();
  }

  private tx(): AsyncIterable<FwPacket> {
    const {
      segmentNumConvention = defaultSegmentConvention,
      lifetimeAfterRto = 1000,
    } = this.opts;
    return this.logic.outgoing(
      ({ segNum, rto }) => {
        const interest = new Interest(this.name.append(segmentNumConvention, segNum),
          Interest.Lifetime(rto + lifetimeAfterRto));
        this.modifyInterest(interest);
        return FwPacket.create(interest, segNum);
      },
      ({ interest: { l3, token } }) => new CancelInterest(l3, token),
    );
  }

  private readonly rx = async (iterable: AsyncIterable<FwPacket>) => {
    const {
      acceptContentType = [0],
    } = this.opts;
    for await (const { l3, token, congestionMark = 0 } of iterable) {
      if (l3 instanceof Data && typeof token === "number" && acceptContentType.includes(l3.contentType)) {
        void this.handleData(l3, token, congestionMark);
      }
    }
  };

  private async handleData(data: Data, segNum: number, congestionMark: number) {
    const now = this.logic.now();
    try {
      await this.opts.verifier?.verify(data);
    } catch (err: unknown) {
      this.fail(new Error(`cannot verify segment ${segNum}: ${err}`));
      return;
    }

    this.logic.satisfy(segNum, now, congestionMark !== 0);
    if (data.isFinalBlock) {
      this.logic.setFinalSegNum(segNum);
    } else {
      let segmentConvention: SegmentConvention;
      if (data.finalBlockId?.is((segmentConvention = this.opts.segmentNumConvention ?? defaultSegmentConvention))) {
        this.logic.setFinalSegNum(data.finalBlockId.as(segmentConvention), true);
      }
    }
    ++this.count_;
    this.dispatchTypedEvent("segment", new Fetcher.SegmentDataEvent("segment", segNum, data));
  }

  private fail(err: Error): void {
    setTimeout(() => {
      this.dispatchTypedEvent("error", new CustomEvent("error", { detail: err }));
      this.close();
    }, 0);
  }

  private readonly handleAbort = () => {
    this.fail(new Error("abort"));
  };
}

export namespace Fetcher {
  export interface Options extends FetchLogic.Options {
    /** Use the specified endpoint instead of the default. */
    endpoint?: Endpoint;

    /** FwFace description. */
    describe?: string;

    /**
     * Choose a segment number naming convention.
     * Default is Segment from @ndn/naming-convention2 package.
     */
    segmentNumConvention?: SegmentConvention;

    /**
     * Modify Interest according to specified options.
     * This can also be used to witness Interests without modification.
     */
    modifyInterest?: Interest.Modify;

    /** AbortSignal that allows canceling the Interest via AbortController. */
    signal?: AbortSignal;

    /**
     * InterestLifetime added to RTO.
     * Default is 1000ms.
     * Ignored if `lifetime` is set.
     */
    lifetimeAfterRto?: number;

    /**
     * List of acceptable ContentType values.
     * Default is [0].
     */
    acceptContentType?: readonly number[];

    /** If specified, verify received Data. */
    verifier?: Verifier;
  }

  export interface SegmentData {
    segNum: number;
    data: Data;
  }

  export class SegmentDataEvent extends Event implements SegmentData {
    constructor(type: string, public readonly segNum: number, public readonly data: Data) {
      super(type);
    }
  }
}
