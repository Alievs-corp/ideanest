import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  IBAN_DEFECTS,
  IBAN_LENGTHS,
  caretAfterFormatting,
  checkAzerbaijaniIban,
  checkIban,
  formatIban,
  ibanDefectOf,
  normaliseIban,
  reformatIban,
  type IbanDefect,
} from './iban';

/**
 * `Iban.java`'s `IbanTests`, case for case, plus the two things only a client does: grouping
 * what is typed, and keeping the caret where it was.
 *
 *   - **the client and the service agree.** The last block reads `Iban.java` itself, so a country
 *     added to one table and not the other, or a defect the screens have no sentence for, fails
 *     here rather than as a creator told "invalid" for a number the service would take.
 */

/** The SWIFT registry's own Azerbaijani example. */
const AZERBAIJANI = 'AZ21NABZ00000000137010001944';

function defectOf(typed: string): IbanDefect {
  const checked = checkAzerbaijaniIban(typed);
  if (checked.ok) throw new Error(`Accepted: ${typed}`);
  return checked.defect;
}

describe('checkAzerbaijaniIban', () => {
  it('accepts a valid Azerbaijani IBAN as its electronic form', () => {
    expect(checkAzerbaijaniIban(AZERBAIJANI)).toEqual({ ok: true, value: AZERBAIJANI });
  });

  it('normalises spaces and lower case away, so one account is one value', () => {
    expect(checkAzerbaijaniIban('az21 nabz 0000 0000 1370 1000 1944')).toEqual({ ok: true, value: AZERBAIJANI });
    expect(checkAzerbaijaniIban('  AZ21\tNABZ 0000000013701000 1944 ')).toEqual({ ok: true, value: AZERBAIJANI });
    expect(checkAzerbaijaniIban('AZ21 NABZ00000000137010001944')).toEqual({ ok: true, value: AZERBAIJANI });
  });

  it('refuses one mistyped character and two swapped ones as the check digits', () => {
    expect(defectOf('AZ21NABZ00000000137010001945')).toBe('CHECKSUM');
    expect(defectOf('AZ21NABZ00000000137010009144')).toBe('CHECKSUM');
  });

  it.each(['AZ21NABZ0000000013701000194', 'AZ21NABZ000000001370100019440', 'AZ21', 'AZ', ''])(
    'refuses %j as the wrong length',
    (typed) => {
      expect(defectOf(typed)).toBe('LENGTH');
    },
  );

  it('refuses digits where the bank code goes as the wrong format', () => {
    expect(defectOf('AZ2112340000000013701000194X')).toBe('FORMAT');
    expect(defectOf('A121NABZ00000000137010001944')).toBe('FORMAT');
  });

  it('refuses anything but letters and digits', () => {
    expect(defectOf('AZ21-NABZ-0000-0000-1370-1000-1944')).toBe('CHARACTERS');
    expect(defectOf('AZ21NABZ0000000013701000194!')).toBe('CHARACTERS');
    expect(defectOf('AZ21NABZ0000000013701000194Ə')).toBe('CHARACTERS');
  });

  it('refuses an unknown country as a country rather than a length', () => {
    expect(defectOf('ZZ21NABZ00000000137010001944')).toBe('COUNTRY');
  });

  it('refuses a valid foreign IBAN as one a creator is not paid to, and a mistyped one as mistyped', () => {
    expect(checkIban('GB82 WEST 1234 5698 7654 32')).toEqual({ ok: true, value: 'GB82WEST12345698765432' });
    expect(checkIban('DE89370400440532013000')).toEqual({ ok: true, value: 'DE89370400440532013000' });
    expect(defectOf('GB82WEST12345698765432')).toBe('COUNTRY_NOT_ACCEPTED');
    expect(defectOf('GB82WEST12345698765433')).toBe('CHECKSUM');
  });

  it('treats a missing value as empty', () => {
    expect(checkAzerbaijaniIban(undefined)).toEqual({ ok: false, defect: 'LENGTH' });
    expect(normaliseIban(null)).toBe('');
  });
});

describe('ibanDefectOf', () => {
  it('reads a refusal’s meta.defect from the closed set, and nothing else', () => {
    expect(ibanDefectOf('CHECKSUM')).toBe('CHECKSUM');
    expect(ibanDefectOf('COUNTRY_NOT_ACCEPTED')).toBe('COUNTRY_NOT_ACCEPTED');
    expect(ibanDefectOf('checksum')).toBeNull();
    expect(ibanDefectOf(undefined)).toBeNull();
    expect(ibanDefectOf(3)).toBeNull();
  });
});

describe('formatIban', () => {
  it('groups what is typed in fours, upper-cased', () => {
    expect(formatIban('az21nabz00000000137010001944')).toBe('AZ21 NABZ 0000 0000 1370 1000 1944');
    expect(formatIban('AZ21 NABZ 0')).toBe('AZ21 NABZ 0');
    expect(formatIban('AZ21')).toBe('AZ21');
    expect(formatIban('AZ21 ')).toBe('AZ21');
    expect(formatIban('')).toBe('');
  });

  it('keeps a stray character visible, so the refusal points at something on screen', () => {
    expect(formatIban('AZ21-NABZ')).toBe('AZ21 -NAB Z');
  });

  it('is undone by normalising: what is shown and what is sent are one account', () => {
    expect(normaliseIban(formatIban(AZERBAIJANI))).toBe(AZERBAIJANI);
  });
});

describe('caretAfterFormatting', () => {
  it('keeps the caret after the same characters once the groups move', () => {
    // Typed "X" between "AZ21" and " NABZ": the caret was after "AZ21X".
    expect(caretAfterFormatting('AZ21X NABZ', 5)).toBe(6);
    expect(formatIban('AZ21X NABZ')).toBe('AZ21 XNAB Z');
    // At the end of a full group the caret stays before the space that follows it.
    expect(caretAfterFormatting('AZ21NABZ', 4)).toBe(4);
    expect(caretAfterFormatting('AZ21 NABZ', 9)).toBe(9);
    expect(caretAfterFormatting('AZ21NABZ0', 9)).toBe(11);
    expect(caretAfterFormatting('AZ21', 0)).toBe(0);
  });
});

describe('reformatIban', () => {
  it('regroups a keystroke in the middle and keeps the caret after it', () => {
    expect(reformatIban('AZ21 NABZ', 'AZ21X NABZ', 5)).toEqual({ value: 'AZ21 XNAB Z', caret: 6 });
  });

  it('groups a pasted number and puts the caret at its end', () => {
    expect(reformatIban('', 'az21nabz00000000137010001944', 28)).toEqual({
      value: 'AZ21 NABZ 0000 0000 1370 1000 1944',
      caret: 34,
    });
  });

  it('turns backspace over a grouping space into deleting the character before it', () => {
    // Backspace with the caret just after the space in "AZ21 |NABZ" removes the space; it meant "1".
    expect(reformatIban('AZ21 NABZ', 'AZ21NABZ', 4)).toEqual({ value: 'AZ2N ABZ', caret: 3 });
  });

  it('turns forward delete over a grouping space into deleting the character after it', () => {
    expect(reformatIban('AZ21 NABZ', 'AZ21NABZ', 4, 'forward')).toEqual({ value: 'AZ21 ABZ', caret: 4 });
  });
});

describe('the service’s Iban.java', () => {
  const java = readFileSync(
    fileURLToPath(
      new URL('../../../apps/api/src/main/java/az/ideanest/compliance/domain/Iban.java', import.meta.url),
    ),
    'utf8',
  );

  it('has the same country lengths', () => {
    const entries = Object.fromEntries(
      [...java.matchAll(/Map\.entry\("([A-Z]{2})", (\d+)\)/g)].map(([, country, length]) => [country, Number(length)]),
    );
    expect(Object.keys(entries).length).toBeGreaterThan(80);
    expect(IBAN_LENGTHS).toEqual(entries);
  });

  it('has the same defects, so every refusal has a sentence', () => {
    const body = /enum Defect \{([\s\S]*?)\}/.exec(java)?.[1] ?? '';
    const names = [...body.replace(/\/\*\*[\s\S]*?\*\//g, '').matchAll(/\b([A-Z_]+)\b/g)].map(([, name]) => name);
    expect(names).toEqual([...IBAN_DEFECTS]);
  });
});
