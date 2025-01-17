import { sha256, timingSafeEqual } from "@ndn/util";

import { SigType } from "../an";
import { KeyLocator } from "../key-locator";
import type { Name } from "../name/mod";
import { SigInfo } from "../sig-info";

/**
 * Low level signing function.
 * It takes a buffer of signed portion, and returns a Promise of signature value.
 */
export type LLSign = (input: Uint8Array) => Promise<Uint8Array>;

export namespace LLSign {
  export const OP = Symbol("LLSign.OP");

  export interface Signable {
    [OP]: (signer: LLSign) => Promise<void>;
  }
}

/**
 * Low level verification function.
 * It takes a buffer of signed portion and the signature value, and returns a Promise
 * that is resolved upon good signature or rejected upon bad signature.
 */
export type LLVerify = (input: Uint8Array, sig: Uint8Array) => Promise<void>;

export namespace LLVerify {
  export const OP = Symbol("LLVerify.OP");

  export interface Verifiable {
    [OP]: (verifier: LLVerify) => Promise<void>;
  }
}

interface PacketWithSignature {
  readonly name: Name;
  sigInfo?: SigInfo;
  sigValue: Uint8Array;
}

/** High level signer, such as a named private key. */
export interface Signer {
  /** Sign a packet. */
  sign: (pkt: Signer.Signable) => Promise<void>;
}

export namespace Signer {
  export interface Signable extends PacketWithSignature, LLSign.Signable {}

  /**
   * Put SigInfo on packet if it does not exist.
   * @param pkt target packet.
   * @param sigType optionally set sigType.
   * @param keyLocator optionally set keyLocator; false to delete KeyLocator.
   */
  export function putSigInfo(pkt: PacketWithSignature, sigType?: number, keyLocator?: KeyLocator.CtorArg | false): SigInfo {
    pkt.sigInfo ??= new SigInfo();
    if (sigType !== undefined) {
      pkt.sigInfo.type = sigType;
    }
    if (keyLocator === false) {
      pkt.sigInfo.keyLocator = undefined;
    } else if (keyLocator !== undefined) {
      pkt.sigInfo.keyLocator = new KeyLocator(keyLocator);
    }
    return pkt.sigInfo;
  }
}

/** High level verifier, such as a named public key. */
export interface Verifier {
  /**
   * Verify a packet.
   * @returns a Promise is resolved upon good signature/policy or rejected upon bad signature/policy.
   */
  verify: (pkt: Verifier.Verifiable) => Promise<void>;
}

export namespace Verifier {
  export interface Verifiable extends Readonly<PacketWithSignature>, LLVerify.Verifiable {}

  /** Throw if packet does not have expected SigType. */
  export function checkSigType(pkt: Readonly<PacketWithSignature>, expectedSigType: number) {
    if (pkt.sigInfo?.type !== expectedSigType) {
      throw new Error(`packet does not have SigType ${expectedSigType}`);
    }
  }

  /** Throw bad signature error if not OK. */
  export function throwOnBadSig(ok: boolean): asserts ok {
    if (!ok) {
      throw new Error("bad signature value");
    }
  }
}

/** Signer and Verifier that do nothing. */
export const noopSigning: Signer & Verifier = {
  sign() {
    return Promise.resolve();
  },
  verify() {
    return Promise.resolve();
  },
};

/** Signer and Verifier for SigType.Sha256 digest. */
export const digestSigning: Signer & Verifier = {
  sign(pkt: Signer.Signable): Promise<void> {
    Signer.putSigInfo(pkt, SigType.Sha256, false);
    return pkt[LLSign.OP]((input) => sha256(input));
  },

  async verify(pkt: Verifier.Verifiable): Promise<void> {
    Verifier.checkSigType(pkt, SigType.Sha256);
    return pkt[LLVerify.OP](async (input, sig) => {
      const h = await sha256(input);
      const ok = timingSafeEqual(sig, h);
      Verifier.throwOnBadSig(ok);
    });
  },
};

/**
 * Signer for SigType.Null, a packet that is not signed.
 * @see https://redmine.named-data.net/projects/ndn-tlv/wiki/NullSignature
 */
export const nullSigner: Signer = {
  sign(pkt: Signer.Signable): Promise<void> {
    Signer.putSigInfo(pkt, SigType.Null, false);
    pkt.sigValue = new Uint8Array();
    return Promise.resolve();
  },
};
