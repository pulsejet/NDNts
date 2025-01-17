import { Certificate, type SigningAlgorithm, SigningAlgorithmListSlim } from "@ndn/keychain";
import { Data, type Name, SigInfo, type Verifier } from "@ndn/packet";
import { Decoder } from "@ndn/tlv";

import type { ChallengeRequest } from "../packet/mod";
import type { ServerChallenge, ServerChallengeContext, ServerChallengeResponse } from "./challenge";

const invalidResponse: ServerChallengeResponse = {
  decrementRetry: true,
  challengeStatus: "invalid-credential",
};

interface State {
  cert: Uint8Array;
  nonce: Uint8Array;
}

/** The "possession" challenge where client must present an existing certificate. */
export class ServerPossessionChallenge implements ServerChallenge<State> {
  public readonly challengeId = "possession";
  public readonly timeLimit = 60000;
  public readonly retryLimit = 1;

  /**
   * Constructor.
   * @param verifier a verifier to accept or reject an existing certificate presented by client.
   *                 This may be a public key of the expected issuer or a trust schema validator.
   * @param assignmentPolicy name assignment policy callback. Default permits all assignments.
   * @param algoList list of recognized algorithms in client certificates.
   */
  constructor(
      private readonly verifier: Verifier,
      private readonly assignmentPolicy?: ServerPossessionChallenge.AssignmentPolicy,
      private readonly algoList = SigningAlgorithmListSlim,
  ) {}

  public process(request: ChallengeRequest, context: ServerChallengeContext<State>): Promise<ServerChallengeResponse> {
    if (!context.challengeState) {
      return this.process0(request, context);
    }
    return this.process1(request, context);
  }

  private async process0(request: ChallengeRequest, context: ServerChallengeContext<State>): Promise<ServerChallengeResponse> {
    const {
      "issued-cert": cert,
    } = request.parameters;
    if (!cert) {
      return invalidResponse;
    }

    const nonce = SigInfo.generateNonce(16);
    context.challengeState = { cert, nonce };
    return {
      challengeStatus: "need-proof",
      parameters: { nonce },
    };
  }

  private async process1(
      request: ChallengeRequest,
      { subjectName, challengeState }: ServerChallengeContext<State>,
  ): Promise<ServerChallengeResponse> {
    const { cert: certWire, nonce } = challengeState!;
    const { proof } = request.parameters;
    if (!proof) {
      return invalidResponse;
    }

    try {
      const cert = Certificate.fromData(Decoder.decode(certWire, Data));
      if (!cert.validity.includes(Date.now())) {
        return invalidResponse;
      }
      await this.verifier.verify(cert.data);
      await this.assignmentPolicy?.(subjectName, cert);

      const [algo, key] = await cert.importPublicKey(this.algoList);
      const llVerify = (algo as SigningAlgorithm<any, true>).makeLLVerify(key);
      await llVerify(nonce, proof);
    } catch {
      return invalidResponse;
    }

    return { success: true };
  }
}

export namespace ServerPossessionChallenge {
  /**
   * Callback to determine whether the owner of `oldCert` is allowed to obtain a certificate
   * of `newSubjectName`. It should throw to disallow assignment.
   */
  export type AssignmentPolicy = (newSubjectName: Name, oldCert: Certificate) => Promise<void>;
}
