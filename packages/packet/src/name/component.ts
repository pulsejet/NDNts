import { Decoder, Encoder, fromUtf8, toUtf8 } from "@ndn/tlv";
import bufferCompare from "buffer-compare";

import { TT } from "../an";
import type { NamingConvention } from "./convention";

function checkType(t: number): boolean {
  return Number.isFinite(t) && t >= 0x01 && t <= 0xFFFF;
}

function assertType(t: number): void {
  if (!checkType(t)) {
    throw new Error(`Component TLV-TYPE ${t} out of range`);
  }
}

const CHAR_ENCODE: string[] = [];
for (let ch = 0x00; ch <= 0xFF; ++ch) {
  const s = String.fromCodePoint(ch);
  CHAR_ENCODE.push(/[\w.~-]/i.test(s) ? s : `%${ch.toString(16).padStart(2, "0").toUpperCase()}`);
}
const CODEPOINT_PERCENT = "%".codePointAt(0);
const CODEPOINT_PERIOD = ".".codePointAt(0);

export type ComponentLike = Component | string;

/**
 * Name component.
 * This type is immutable.
 */
export class Component {
  public get length(): number {
    return this.value.length;
  }

  /** TLV-VALUE interpreted as UTF-8 string. */
  public get text(): string {
    return fromUtf8(this.value);
  }

  public static decodeFrom(decoder: Decoder): Component {
    const { tlv } = decoder.read();
    return new Component(tlv);
  }

  /** Parse from URI representation, or return existing Component. */
  public static from(input: ComponentLike): Component {
    if (input instanceof Component) {
      return input;
    }

    let [sType, sValue] = input.split("=", 2) as [string, string?];
    let type = TT.GenericNameComponent;
    let iType: number;
    if (sValue === undefined) {
      [sType, sValue] = ["", sType];
    } else if (checkType(iType = Number.parseInt(sType, 10))) {
      type = iType;
    } else {
      [sType, sValue] = ["", input];
    }
    if (/^\.*$/.test(sValue)) {
      sValue = sValue.slice(3);
    }

    const value = new Uint8Array(sValue.length);
    let length = 0;
    for (let i = 0; i < sValue.length;) {
      let ch = sValue.codePointAt(i)!;
      let hex: string;
      if (ch === CODEPOINT_PERCENT && /^[\da-f]{2}$/i.test(hex = sValue.slice(i + 1, i + 3))) {
        ch = Number.parseInt(hex, 16);
        i += 3;
      } else {
        ++i;
      }
      value[length++] = ch;
    }
    return new Component(type, value.subarray(0, length));
  }

  public readonly tlv: Uint8Array;
  public readonly type: number;
  public readonly value: Uint8Array;

  /**
   * Construct from TLV-TYPE and TLV-VALUE.
   * @param type TLV-TYPE, default is GenericNameComponent.
   * @param value TLV-VALUE; if specified as string, it's encoded as UTF-8 but not interpreted
   *              as URI representation. Use from() to interpret URI.
   */
  constructor(type?: number, value?: Uint8Array | string);

  /** Construct from TLV. */
  constructor(tlv: Uint8Array);

  constructor(arg1: number | Uint8Array = TT.GenericNameComponent, arg2?: Uint8Array | string) {
    if (arg1 instanceof Uint8Array) {
      this.tlv = arg1;
      const decoder = new Decoder(arg1);
      ({ type: this.type, value: this.value } = decoder.read());
      assertType(this.type);
      return;
    }

    this.type = arg1;
    assertType(this.type);
    this.value = typeof arg2 === "string" ? toUtf8(arg2) : (arg2 ?? new Uint8Array());
    this.tlv = Encoder.encode([this.type, this.value], 10 + this.value.length);
  }

  /** Get URI string. */
  public toString(): string {
    let b = `${this.type}=`;
    let hasNonPeriods = false;
    for (const ch of this.value) {
      hasNonPeriods ||= ch !== CODEPOINT_PERIOD;
      b += CHAR_ENCODE[ch];
    }
    if (!hasNonPeriods) {
      b += "...";
    }
    return b;
  }

  public encodeTo(encoder: Encoder) {
    encoder.encode(this.tlv);
  }

  /** Determine if component follows a naming convention. */
  public is(convention: NamingConvention<any>): boolean {
    return convention.match(this);
  }

  /** Convert with naming convention. */
  public as<R>(convention: NamingConvention<any, R>): R {
    if (!this.is(convention)) {
      throw new Error("component does not follow convention");
    }
    return convention.parse(this);
  }

  /** Compare this component with other. */
  public compare(other: ComponentLike): Component.CompareResult {
    return Component.compare(this, other);
  }

  /** Determine if this component equals other. */
  public equals(other: ComponentLike): boolean {
    return this.compare(other) === Component.CompareResult.EQUAL;
  }
}

export namespace Component {
  /** Component compare result. */
  export enum CompareResult {
    /** lhs is less than rhs */
    LT = -2,
    /** lhs and rhs are equal */
    EQUAL = 0,
    /** lhs is greater than rhs */
    GT = 2,
  }

  function toCompareResult(diff: number): CompareResult {
    return diff === 0 ? CompareResult.EQUAL :
      diff < 0 ? CompareResult.LT : CompareResult.GT;
  }

  /** Compare two components. */
  export function compare(lhs: ComponentLike, rhs: ComponentLike): CompareResult {
    const l = Component.from(lhs);
    const r = Component.from(rhs);
    return toCompareResult(l.type - r.type) ||
           toCompareResult(l.length - r.length) ||
           toCompareResult(bufferCompare<Uint8Array>(l.value, r.value));
  }
}
