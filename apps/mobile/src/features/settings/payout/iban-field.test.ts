import { checkAzerbaijaniIban } from '@ideanest/account/iban';
import { editIban, type IbanSelection } from './iban-field';

/** The SWIFT registry's Azerbaijani example, as the field shows it. */
const GROUPED = 'AZ21 NABZ 0000 0000 1370 1000 1944';
const IBAN = 'AZ21NABZ00000000137010001944';

function caret(at: number): IbanSelection {
  return { start: at, end: at };
}

/** `text` with the character at `index` gone: what the native input holds after the keystroke. */
function without(text: string, index: number): string {
  return text.slice(0, index) + text.slice(index + 1);
}

describe('editIban', () => {
  it('groups what is typed at the end, with the caret after it', () => {
    expect(editIban('AZ21', caret(4), 'AZ21n')).toEqual({ value: 'AZ21 N', caret: 6, typedCaret: 5 });
    expect(editIban('AZ21 N', caret(6), 'AZ21 NA')).toEqual({ value: 'AZ21 NA', caret: 7, typedCaret: 7 });
  });

  it('deletes at the end of the field as typed, the trailing group losing its space', () => {
    expect(editIban('AZ21 N', caret(6), 'AZ21 ')).toEqual({ value: 'AZ21', caret: 4, typedCaret: 5 });
    expect(editIban('AZ21', caret(4), 'AZ2')).toEqual({ value: 'AZ2', caret: 3, typedCaret: 3 });
  });

  it('takes a backspace over a grouping space as the character before it', () => {
    // The caret was after "NABZ ", at 10; the space at 9 went.
    const edit = editIban(GROUPED, caret(10), without(GROUPED, 9));
    expect(edit.value).toBe('AZ21 NAB0 0000 0001 3701 0001 944');
    // Where the Z was: after "NAB", before the regrouped "0".
    expect(edit.caret).toBe(8);
    expect(edit.typedCaret).toBe(9);
  });

  it('reads the same backspace without a reported selection, or with one reported after the edit', () => {
    const typed = without(GROUPED, 9);
    const expected = { value: 'AZ21 NAB0 0000 0001 3701 0001 944', caret: 8, typedCaret: 9 };
    expect(editIban(GROUPED, null, typed)).toEqual(expected);
    // A platform that reports the caret's new place first: still a backspace, never a forward delete.
    expect(editIban(GROUPED, caret(9), typed)).toEqual(expected);
    // A hint that explains nothing is set aside.
    expect(editIban(GROUPED, caret(30), typed)).toEqual(expected);
  });

  it('takes a deleted selection of only a grouping space as the character before it', () => {
    expect(editIban(GROUPED, { start: 4, end: 5 }, without(GROUPED, 4))).toEqual({
      value: 'AZ2N ABZ0 0000 0001 3701 0001 944',
      caret: 3,
      typedCaret: 4,
    });
  });

  it('regroups after a backspace on a character in the middle, the caret staying put', () => {
    expect(editIban(GROUPED, caret(7), without(GROUPED, 6))).toEqual({
      value: 'AZ21 NBZ0 0000 0001 3701 0001 944',
      caret: 6,
      typedCaret: 6,
    });
  });

  it('keeps the caret at the deleted character inside a run of equal ones, from the reported caret', () => {
    // The second of four zeros, from a caret after it at 12.
    const typed = without(GROUPED, 11);
    expect(editIban(GROUPED, caret(12), typed)).toEqual({
      value: 'AZ21 NABZ 0000 0001 3701 0001 944',
      caret: 11,
      typedCaret: 11,
    });
    // Without it the texts alone cannot tell which zero went, so the caret ends the run.
    expect(editIban(GROUPED, null, typed).caret).toBe(13);
  });

  it('regroups what is typed in the middle, with the caret after the new character', () => {
    expect(editIban('AZ21 NABZ', caret(2), 'AZ921 NABZ')).toEqual({ value: 'AZ92 1NAB Z', caret: 3, typedCaret: 3 });
    expect(editIban('AZ21 0000', caret(6), 'AZ21 00000')).toEqual({ value: 'AZ21 0000 0', caret: 7, typedCaret: 7 });
  });

  it('puts the character a backspace took back where it was', () => {
    const removed = editIban(GROUPED, caret(10), without(GROUPED, 9));
    const typed = removed.value.slice(0, removed.caret) + 'Z' + removed.value.slice(removed.caret);
    expect(editIban(removed.value, caret(removed.caret), typed)).toEqual({ value: GROUPED, caret: 9, typedCaret: 9 });
  });

  it('groups a pasted number, in either case, with the caret at its end', () => {
    expect(editIban('', caret(0), 'az21nabz00000000137010001944')).toEqual({
      value: GROUPED,
      caret: GROUPED.length,
      typedCaret: IBAN.length,
    });
    expect(editIban('', null, 'AZ21 NABZ 0000 0000 1370 1000 1944')).toEqual({
      value: GROUPED,
      caret: GROUPED.length,
      typedCaret: GROUPED.length,
    });
    // The pasted number is what the service takes, once normalised.
    expect(checkAzerbaijaniIban(editIban('', null, IBAN).value)).toEqual({ ok: true, value: IBAN });
  });

  it('does not take a paste of the same characters over everything as a deleted space', () => {
    expect(editIban(GROUPED, { start: 0, end: GROUPED.length }, IBAN)).toEqual({
      value: GROUPED,
      caret: GROUPED.length,
      typedCaret: IBAN.length,
    });
  });

  it('pastes into the middle of a selection, and empties on a deleted selection of everything', () => {
    expect(editIban('AZ21 NABZ', { start: 5, end: 9 }, 'AZ21 XXXX0000')).toEqual({
      value: 'AZ21 XXXX 0000',
      caret: 14,
      typedCaret: 13,
    });
    expect(editIban(GROUPED, { start: 0, end: GROUPED.length }, '')).toEqual({ value: '', caret: 0, typedCaret: 0 });
  });
});
