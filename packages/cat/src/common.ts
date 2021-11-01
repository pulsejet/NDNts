import { closeUplinks, getSigner, openUplinks } from "@ndn/cli-common";
import { Segment as Segment1, Version as Version1 } from "@ndn/naming-convention1";
import { Segment2, Segment3, Version2, Version3 } from "@ndn/naming-convention2";
import { NamingConvention, Signer } from "@ndn/packet";

export interface CommonArgs {
  convention: number;
}

export let versionConvention: NamingConvention<number>;
export let segmentNumConvention: NamingConvention<number>;
export let signer: Signer;

export async function applyCommonArgs(args: CommonArgs) {
  await openUplinks();
  signer = await getSigner();

  switch (args.convention) {
    case 1:
      [versionConvention, segmentNumConvention] = [Version1, Segment1];
      break;
    case 2:
      [versionConvention, segmentNumConvention] = [Version2, Segment2];
      break;
    case 3:
      [versionConvention, segmentNumConvention] = [Version3, Segment3];
      break;
  }
}

export function cleanupCommon() {
  closeUplinks();
}

export function checkVersionArg(keywords: readonly string[]): (args: { ver: string }) => boolean {
  return ({ ver }) => {
    if (keywords.includes(ver)) {
      return true;
    }
    const n = Number.parseInt(ver, 10);
    if (Number.isSafeInteger(n) && n >= 0) {
      return true;
    }
    throw new Error(`--ver must be '${keywords.join("' or '")}' or a non-negative integer`);
  };
}
