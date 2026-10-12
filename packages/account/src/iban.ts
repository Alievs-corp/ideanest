/**
 * An International Bank Account Number as a creator types it — the service's
 * `compliance/domain/Iban.java` (#394), mirrored for `apps/web` and `apps/mobile` (#395).
 *
 * <h2>Why the client checks at all</h2>
 *
 * The service is the authority and refuses anything this module would; the check here only
 * says what is wrong while the number is still in the field, in the same words a refusal would
 * be shown in. Both read the same closed set of {@link IbanDefect}s, so a refusal's
 * `meta.defect` and a local check land on one sentence. `iban.test.ts` reads `Iban.java` and
 * fails if the country table or the defect set drifts from it.
 *
 * <h2>Printed in fours, sent in one piece</h2>
 *
 * Banks print an IBAN in groups of four and a creator copies it from a banking app in either
 * case. {@link formatIban} groups what is typed for reading; {@link checkIban} and
 * {@link checkAzerbaijaniIban} hand back the electronic form — upper case, no spaces — which is
 * the only form that goes over the wire.
 */

/** What is wrong with a candidate: `Iban.Defect`, by name. */
export type IbanDefect =
  /** Something other than letters and digits after removing spaces. */
  | 'CHARACTERS'
  /** The first two letters are not a country that issues IBANs. */
  | 'COUNTRY'
  /** Not the length that country's IBANs have. */
  | 'LENGTH'
  /** The right length, but not the structure that country's IBANs have. */
  | 'FORMAT'
  /** The check digits do not agree with the rest: a mistyped or transposed character. */
  | 'CHECKSUM'
  /** A valid IBAN, from a country the platform does not pay creators in. */
  | 'COUNTRY_NOT_ACCEPTED';

export const IBAN_DEFECTS: readonly IbanDefect[] = [
  'CHARACTERS',
  'COUNTRY',
  'LENGTH',
  'FORMAT',
  'CHECKSUM',
  'COUNTRY_NOT_ACCEPTED',
];

export type IbanCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly defect: IbanDefect };

/** Azerbaijan, the only country a creator is paid in. */
export const AZERBAIJAN = 'AZ';

/** `AZ`, two check digits, a four-letter bank code, and twenty letters or digits. */
const AZERBAIJANI = /^AZ[0-9]{2}[A-Z]{4}[A-Z0-9]{20}$/;
const ALPHANUMERIC = /^[A-Z0-9]*$/;
const SHAPE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/;

/** Java's `\s` and the no-break space, exactly: the service strips these and nothing else. */
const WHITESPACE = /[ \t\n\u000B\f\r ]+/g;

/**
 * The length each country's IBANs have, from the SWIFT IBAN registry: `Iban.LENGTHS`, entry for
 * entry. A country missing from here is refused as `COUNTRY`, as the service refuses it.
 */
export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27,
  BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28,
  EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23,
  GL: 18, GR: 27, GT: 28, HN: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26,
  IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21,
  LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28,
  NL: 18, NO: 15, OM: 23, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22,
  RU: 33, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, SO: 23, ST: 25,
  SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
};

/** Spaces removed and letters upper-cased: the electronic form, if the rest is right. */
export function normaliseIban(typed: string | null | undefined): string {
  return (typed ?? '').replace(WHITESPACE, '').toUpperCase();
}

/** Any country's IBAN: the first defect found, in the order `Iban.parse` looks, or the value. */
export function checkIban(typed: string | null | undefined): IbanCheck {
  const candidate = normaliseIban(typed);
  if (!ALPHANUMERIC.test(candidate)) return refused('CHARACTERS');
  if (!SHAPE.test(candidate)) return refused(candidate.length < 5 ? 'LENGTH' : 'FORMAT');
  const length = IBAN_LENGTHS[candidate.slice(0, 2)];
  if (length === undefined) return refused('COUNTRY');
  if (candidate.length !== length) return refused('LENGTH');
  if (candidate.startsWith(AZERBAIJAN) && !AZERBAIJANI.test(candidate)) return refused('FORMAT');
  if (mod97(candidate) !== 1) return refused('CHECKSUM');
  return { ok: true, value: candidate };
}

/**
 * An Azerbaijani IBAN, the only kind a creator is paid to. The other checks first, so a mistyped
 * Azerbaijani number is reported as mistyped rather than as foreign.
 */
export function checkAzerbaijaniIban(typed: string | null | undefined): IbanCheck {
  const checked = checkIban(typed);
  if (checked.ok && !checked.value.startsWith(AZERBAIJAN)) return refused('COUNTRY_NOT_ACCEPTED');
  return checked;
}

/** Reads a refusal's `meta.defect`; anything outside the closed set is null. */
export function ibanDefectOf(value: unknown): IbanDefect | null {
  return typeof value === 'string' && (IBAN_DEFECTS as readonly string[]).includes(value)
    ? (value as IbanDefect)
    : null;
}

/**
 * What is typed, grouped in fours for reading: spaces removed, upper-cased, then one space every
 * four characters. Anything else typed stays, so the field shows what `checkIban` will refuse.
 */
export function formatIban(typed: string): string {
  return normaliseIban(typed).replace(/(.{4})(?=.)/g, '$1 ');
}

/**
 * Where the caret belongs once {@link formatIban} has regrouped the text: after the same number
 * of characters that are not spaces, so typing or deleting in the middle does not throw the
 * caret to the end.
 */
export function caretAfterFormatting(typed: string, caret: number): number {
  const before = normaliseIban(typed.slice(0, caret)).length;
  if (before === 0) return 0;
  // Every full group before the caret is followed by a space, except when the caret ends one.
  return before + Math.floor((before - 1) / 4);
}

export interface IbanEdit {
  readonly value: string;
  readonly caret: number;
}

/**
 * One edit to a grouped field: `typed` is the field's text after the keystroke, `caret` where the
 * browser left the caret. Deleting only one of the spaces the grouping put there changes nothing
 * that matters, and the grouping would put it straight back, so the deletion is applied to the
 * character beside it instead — the one the person meant to remove.
 */
export function reformatIban(
  previous: string,
  typed: string,
  caret: number,
  direction: 'backward' | 'forward' = 'backward',
): IbanEdit {
  let text = typed;
  let at = caret;
  if (typed.length < previous.length && normaliseIban(typed) === normaliseIban(previous)) {
    if (direction === 'forward') {
      text = typed.slice(0, at) + typed.slice(at + 1);
    } else if (at > 0) {
      text = typed.slice(0, at - 1) + typed.slice(at);
      at -= 1;
    }
  }
  return { value: formatIban(text), caret: caretAfterFormatting(text, at) };
}

function refused(defect: IbanDefect): IbanCheck {
  return { ok: false, defect };
}

/**
 * ISO 7064 mod 97-10 over the rearranged number, folded a character at a time so the
 * thirty-odd-digit number is never built — and never touches a float.
 */
function mod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const c of rearranged) {
    const code = c.charCodeAt(0);
    remainder = code <= 57 ? (remainder * 10 + (code - 48)) % 97 : (remainder * 100 + (code - 55)) % 97;
  }
  return remainder;
}
