import { L3Face, rxFromPacketIterable, Transport } from "@ndn/l3face";
import type { AbortSignal } from "abort-controller";
import EventIterator from "event-iterator";

import { makeWebSocket } from "./ws_node";

/** WebSocket transport. */
export class WsTransport extends Transport {
  public readonly rx: Transport.Rx;
  private readonly highWaterMark: number;
  private readonly lowWaterMark: number;

  constructor(private readonly sock: WebSocket, private readonly opts: WsTransport.Options) {
    super({
      describe: `WebSocket(${sock.url})`,
    });
    sock.binaryType = "arraybuffer";
    this.rx = rxFromPacketIterable(new EventIterator<Uint8Array>(
      ({ push, stop }) => {
        const pushHandler = (evt: MessageEvent) => push(new Uint8Array(evt.data as ArrayBuffer));
        sock.addEventListener("message", pushHandler);
        sock.addEventListener("close", stop);
        return () => {
          sock.removeEventListener("message", pushHandler);
          sock.removeEventListener("close", stop);
        };
      },
    ));

    this.highWaterMark = opts.highWaterMark ?? 1024 * 1024;
    this.lowWaterMark = opts.lowWaterMark ?? 16 * 1024;
  }

  public close() {
    this.sock.close();
  }

  public tx = async (iterable: AsyncIterable<Uint8Array>): Promise<void> => {
    for await (const pkt of iterable) {
      if (this.sock.readyState !== this.sock.OPEN) {
        throw new Error(`unexpected WebSocket.readState ${this.sock.readyState}`);
      }
      this.sock.send(pkt);
      if (this.sock.bufferedAmount > this.highWaterMark) {
        await this.waitForTxBuffer();
      }
    }
    this.close();
  };

  private waitForTxBuffer(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (this.sock.bufferedAmount <= this.lowWaterMark || this.sock.readyState !== this.sock.OPEN) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  }

  public reopen() {
    return WsTransport.connect(this.sock.url, this.opts);
  }
}

export namespace WsTransport {
  export interface Options {
    /** Connect timeout (in milliseconds). */
    connectTimeout?: number;

    /** AbortSignal that allows canceling connection attempt via AbortController. */
    signal?: AbortSignal|globalThis.AbortSignal;

    /** Buffer amount (in bytes) to start TX throttling. */
    highWaterMark?: number;

    /** Buffer amount (in bytes) to stop TX throttling. */
    lowWaterMark?: number;
  }

  /**
   * Create a transport and connect to remote endpoint.
   * @param uri server URI.
   * @param opts other options.
   */
  export function connect(uri: string, opts: WsTransport.Options = {}): Promise<WsTransport> {
    const {
      connectTimeout = 10000,
      signal,
    } = opts;

    return new Promise<WsTransport>((resolve, reject) => {
      const sock = makeWebSocket(uri);

      const fail = (err?: Error) => {
        sock.close();
        reject(err);
      };
      setTimeout(() => fail(new Error("connectTimeout")), connectTimeout);

      const onabort = () => fail(new Error("abort"));
      (signal as AbortSignal|undefined)?.addEventListener("abort", () => onabort);

      const onerror = (evt: Event) => {
        reject(new Error((evt as ErrorEvent).message));
        sock.close();
      };
      sock.addEventListener("error", onerror);

      sock.addEventListener("open", () => {
        sock.removeEventListener("error", onerror);
        (signal as AbortSignal|undefined)?.removeEventListener("abort", onabort);
        resolve(new WsTransport(sock, opts));
      });
    });
  }

  /** Create a transport and add to forwarder. */
  export const createFace = L3Face.makeCreateFace(WsTransport.connect);
}
