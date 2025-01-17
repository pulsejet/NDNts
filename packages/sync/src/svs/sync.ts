import { Endpoint, type Producer, type ProducerHandler } from "@ndn/endpoint";
import { Interest, Name, type NameLike, nullSigner, type Signer, type Verifier } from "@ndn/packet";
import { CustomEvent, randomJitter, trackEventListener } from "@ndn/util";
import { TypedEventTarget } from "typescript-event-target";

import { type SyncNode, type SyncProtocol, SyncUpdate } from "../types";
import { SvStateVector } from "./state-vector";

interface DebugEntry {
  action: string;
  own: Record<string, number>;
  recv?: Record<string, number>;
  state: string;
  nextState?: string;
  ourOlder?: number;
  ourNewer?: number;
}

type EventMap = SyncProtocol.EventMap<Name> & {
  debug: CustomEvent<DebugEntry>;
};

/** StateVectorSync participant. */
export class SvSync extends TypedEventTarget<EventMap> implements SyncProtocol<Name> {
  constructor({
    endpoint = new Endpoint(),
    describe,
    syncPrefix,
    syncInterestLifetime = 1000,
    steadyTimer = [30000, 0.1],
    suppressionTimer = [200, 0.5],
    signer = nullSigner,
    verifier,
  }: SvSync.Options) {
    super();
    this.endpoint = endpoint;
    this.describe = describe ?? `SvSync(${syncPrefix})`;
    this.syncPrefix = syncPrefix;
    this.syncInterestLifetime = syncInterestLifetime;
    this.steadyTimer = randomJitter(steadyTimer[1], steadyTimer[0]);
    this.suppressionTimer = randomJitter(suppressionTimer[1], suppressionTimer[0]);
    this.signer = signer;
    this.verifier = verifier;

    this.producer = this.endpoint.produce(this.syncPrefix, this.handleSyncInterest, {
      describe: `${this.describe}[p]`,
      routeCapture: false,
    });
  }

  private readonly maybeHaveEventListener = trackEventListener(this);
  private readonly endpoint: Endpoint;
  public readonly describe: string;
  public readonly syncPrefix: Name;
  private readonly syncInterestLifetime: number;
  private readonly steadyTimer: () => number;
  private readonly suppressionTimer: () => number;
  private readonly signer: Signer;
  private readonly verifier?: Verifier;

  private readonly producer: Producer;

  /** Own state vector. */
  private readonly own = new SvStateVector();

  /**
   * In steady state, undefined.
   * In suppression state, aggregated state vector of incoming sync Interests.
   */
  private aggregated?: SvStateVector;

  /** Sync Interest timer. */
  private timer!: NodeJS.Timeout | number;

  private debug(action: string, entry: Partial<DebugEntry> = {}, recv?: SvStateVector): void {
    if (!this.maybeHaveEventListener.debug) {
      return;
    }
    /* c8 ignore next */
    this.dispatchTypedEvent("debug", new CustomEvent<DebugEntry>("debug", {
      detail: {
        action,
        own: this.own.toJSON(),
        recv: recv?.toJSON(),
        state: this.aggregated ? "suppression" : "steady",
        ...entry,
      },
    }));
  }

  public close(): void {
    clearTimeout(this.timer);
    this.producer.close();
  }

  public get(id: NameLike): SyncNode<Name> {
    return new SvSyncNode(Name.from(id), this.own, this.handlePublish);
  }

  public add(id: NameLike): SyncNode<Name> {
    return this.get(id);
  }

  private readonly handlePublish = () => {
    this.debug("publish");
    this.resetTimer(true);
  };

  private readonly handleSyncInterest: ProducerHandler = async (interest) => {
    await this.verifier?.verify(interest);
    const recv = SvStateVector.fromComponent(interest.name.at(this.syncPrefix.length));

    const ourOlder = this.own.listOlderThan(recv);
    const ourNewer = recv.listOlderThan(this.own);
    this.debug("recv", {
      nextState: (!this.aggregated && ourNewer.length > 0) ? "suppression" : undefined,
      ourOlder: ourOlder.length,
      ourNewer: ourNewer.length,
    }, recv);
    this.own.mergeFrom(recv);

    for (const { id, loSeqNum, hiSeqNum } of ourOlder) {
      this.dispatchTypedEvent("update", new SyncUpdate(this.get(id), loSeqNum, hiSeqNum));
    }

    if (this.aggregated) { // in suppression state
      this.aggregated.mergeFrom(recv);
    } else if (ourNewer.length > 0) { // in steady state, entering suppression state
      this.aggregated = recv;
      this.resetTimer();
    } else { // in steady state
      this.resetTimer();
    }
    return undefined;
  };

  private resetTimer(immediate = false): void {
    clearTimeout(this.timer);
    const delay = immediate ? 0 : this.aggregated ? this.suppressionTimer() : this.steadyTimer();
    this.timer = setTimeout(this.handleTimer, delay);
  }

  private readonly handleTimer = () => {
    if (this.aggregated) { // in suppression state, exiting to steady state
      const ourNewer = this.aggregated.listOlderThan(this.own);
      this.debug("timer", {
        nextState: "steady",
        ourNewer: ourNewer.length,
      });
      if (ourNewer.length > 0) {
        this.sendSyncInterest();
      }
      this.aggregated = undefined;
    } else { // in steady state
      this.debug("timer");
      this.sendSyncInterest();
    }

    this.resetTimer();
  };

  private sendSyncInterest(): void {
    this.debug("send");

    const interest = new Interest();
    interest.name = this.syncPrefix.append(this.own.toComponent());
    interest.canBePrefix = true;
    interest.mustBeFresh = true;
    interest.lifetime = this.syncInterestLifetime;

    void (async () => {
      await this.signer.sign(interest);
      try {
        await this.endpoint.consume(interest, {
          describe: `${this.describe}[c]`,
        });
      } catch {}
    })();
  }
}

export namespace SvSync {
  /**
   * Timer settings.
   * ms: median interval in milliseconds.
   * jitter: ± percentage, in [0.0, 1.0) range.
   */
  export type Timer = [ms: number, jitter: number];

  export interface Options {
    /** Endpoint for communication. */
    endpoint?: Endpoint;

    /** Description for debugging purpose. */
    describe?: string;

    /** Sync group prefix. */
    syncPrefix: Name;

    /**
     * Sync Interest lifetime in milliseconds.
     * @default 1000
     */
    syncInterestLifetime?: number;

    /**
     * Sync Interest timer in steady state.
     * Default is [30000ms, ±10%]
     */
    steadyTimer?: Timer;

    /**
     * Sync Interest timer in suppression state.
     * Default is [200ms, ±50%]
     */
    suppressionTimer?: Timer;

    /**
     * Sync Interest signer.
     * Default is NullSigning.
     */
    signer?: Signer;

    /**
     * Sync Interest verifier.
     * Default is no verification.
     */
    verifier?: Verifier;
  }
}

class SvSyncNode implements SyncNode<Name> {
  constructor(
      public readonly id: Name,
      private readonly own: SvStateVector,
      private readonly handlePublish: () => void,
  ) {}

  public get seqNum(): number {
    return this.own.get(this.id);
  }

  public set seqNum(n: number) {
    if (n <= this.seqNum) {
      return;
    }

    this.own.set(this.id, n);
    this.handlePublish();
  }

  public remove(): void {
    // no effect
  }
}
