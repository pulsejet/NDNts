import { Interest } from "@ndn/packet";
import { Encoder, EvDecoder } from "@ndn/tlv";

import { C } from "./an";
import type { CaProfile } from "./ca-profile";
import * as decode_common from "./decode-common";
import * as parameter_kv from "./parameter-kv";

const EVD = new EvDecoder<ProbeRequest.Fields>("ProbeRequest");
parameter_kv.parseEvDecoder(EVD, 1);

/** PROBE request packet. */
export class ProbeRequest {
  public static fromInterest(
      interest: Interest,
      { profile }: ProbeRequest.Context,
  ): Promise<ProbeRequest> {
    decode_common.checkName(interest, profile, C.PROBE, undefined);
    return decode_common.fromInterest(interest, EVD, (f) => {
      checkKeys(profile, f);
      return new ProbeRequest(interest);
    });
  }

  private constructor(public readonly interest: Interest) {}
}
export interface ProbeRequest extends Readonly<ProbeRequest.Fields> {}

function checkKeys({ probeKeys }: CaProfile, { parameters }: ProbeRequest.Fields): void {
  const keys = new Set(probeKeys);
  for (const key of Object.keys(parameters)) {
    if (!keys.delete(key)) {
      throw new Error(`unknown probe key ${key}`);
    }
  }

  if (keys.size > 0) {
    throw new Error(`missing probe ${keys.size > 1 ? "keys" : "key"} ${Array.from(keys).join(",")}`);
  }
}

export namespace ProbeRequest {
  export interface Context {
    profile: CaProfile;
  }

  export interface Fields {
    parameters: parameter_kv.ParameterKV;
  }

  export interface Options extends Context, Fields {
  }

  export async function build({
    profile,
    parameters,
  }: Options) {
    const payload = Encoder.encode([
      ...parameter_kv.encode(parameters),
    ]);

    const interest = new Interest();
    interest.name = profile.prefix.append(C.CA, C.PROBE);
    interest.mustBeFresh = true;
    interest.appParameters = payload;
    await interest.updateParamsDigest();
    return ProbeRequest.fromInterest(interest, { profile });
  }
}
