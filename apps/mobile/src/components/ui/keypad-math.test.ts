import {
  EMPTY_KEYPAD,
  chooseOperator,
  commitResult,
  entryValue,
  groupFigure,
  plainOf,
  pressKey,
  resultOf,
  typeInto,
  type KeypadKey,
  type KeypadState,
} from './keypad-math';

/**
 * The keypad's arithmetic (#280): strings in, Decimals between, one half-even rounding to the minor
 * units at the result, and never a JS number on the way.
 */

function typed(keys: readonly KeypadKey[], from: KeypadState = EMPTY_KEYPAD): KeypadState {
  return keys.reduce((state, key) => pressKey(state, key), from);
}

function digits(text: string): KeypadKey[] {
  return Array.from(text).map((char) => (char === '.' ? 'point' : (char as KeypadKey)));
}

function calculate(left: string, operator: Parameters<typeof chooseOperator>[1], right: string) {
  const withLeft = typed(digits(left));
  const withOperator = chooseOperator(withLeft, operator);
  return resultOf(typed(digits(right), withOperator));
}

function valueOf(result: ReturnType<typeof resultOf>): string | null {
  return result.kind === 'ok' || result.kind === 'over-limit' ? result.value.toFixed(2) : null;
}

describe('typing an amount', () => {
  it('replaces a leading zero instead of following it', () => {
    expect(typeInto('0', '5')).toBe('5');
    expect(typeInto('0', '0')).toBe('0');
    expect(typed(digits('0007')).entry).toBe('7');
    expect(typed(digits('0.05')).entry).toBe('0.05');
  });

  it('starts a bare point as 0. and takes only one point', () => {
    expect(typed(['point']).entry).toBe('0.');
    expect(typed(digits('1.2.3')).entry).toBe('1.23');
  });

  it('stops at the currency minor units after the point', () => {
    expect(typed(digits('12.345')).entry).toBe('12.34');
    expect(typeInto('9.99', '9')).toBe('9.99');
    expect(typeInto('5', 'point', 0)).toBe('5');
  });

  it('stops at the twelve digits a numeric(14,2) amount has before the point', () => {
    expect(typed(digits('9999999999999')).entry).toBe('999999999999');
    expect(typed(digits('999999999999.99')).entry).toBe('999999999999.99');
  });

  it('backspaces a character, then the operator once the operand is empty', () => {
    const pending = typed(['1', '2'], chooseOperator(typed(['4']), 'add'));
    expect(pressKey(pending, 'backspace').operand).toBe('1');
    const bare = pressKey(pressKey(pending, 'backspace'), 'backspace');
    expect(bare).toEqual({ entry: '4', operator: 'add', operand: '' });
    expect(pressKey(bare, 'backspace')).toEqual({ entry: '4', operator: null, operand: '' });
    expect(pressKey(EMPTY_KEYPAD, 'backspace')).toEqual(EMPTY_KEYPAD);
  });

  it('hands on the amount without a dangling point', () => {
    expect(entryValue('45.')).toBe('45');
    expect(entryValue('45.5')).toBe('45.5');
    expect(entryValue('')).toBe('');
  });

  it('groups the whole part in threes and keeps the fraction exactly as typed', () => {
    expect(groupFigure('1234567.5')).toBe('1,234,567.5');
    expect(groupFigure('12.')).toBe('12.');
    expect(groupFigure('999')).toBe('999');
  });
});

describe('arithmetic', () => {
  it('adds in decimals: 0.1 + 0.2 is exactly 0.3', () => {
    const result = calculate('0.1', 'add', '0.2');
    expect(result.kind).toBe('ok');
    expect(result.kind === 'ok' && plainOf(result.value)).toBe('0.3');
  });

  it('multiplies and subtracts without float drift', () => {
    expect(valueOf(calculate('143', 'multiply', '2'))).toBe('286.00');
    expect(valueOf(calculate('1.1', 'multiply', '1.1'))).toBe('1.21');
    expect(valueOf(calculate('0.3', 'subtract', '0.1'))).toBe('0.20');
    expect(valueOf(calculate('999999999999.99', 'subtract', '0.01'))).toBe('999999999999.98');
  });

  it('rounds a product half-even to the minor units, once, at the result', () => {
    // 2.5 × 0.05 = 0.125 → 0.12 (the even neighbour); 3.5 × 0.05 = 0.175 → 0.18.
    expect(valueOf(calculate('2.5', 'multiply', '0.05'))).toBe('0.12');
    expect(valueOf(calculate('3.5', 'multiply', '0.05'))).toBe('0.18');
    expect(valueOf(calculate('0.01', 'multiply', '0.5'))).toBe('0.00');
  });

  it('rounds a quotient half-even to the minor units', () => {
    expect(valueOf(calculate('10', 'divide', '3'))).toBe('3.33');
    expect(valueOf(calculate('20', 'divide', '3'))).toBe('6.67');
    expect(valueOf(calculate('0.25', 'divide', '2'))).toBe('0.12');
    expect(valueOf(calculate('0.35', 'divide', '2'))).toBe('0.18');
    expect(valueOf(calculate('1', 'divide', '8'))).toBe('0.12');
  });

  it('refuses division by zero, also by a zero typed as 0.00', () => {
    expect(calculate('5', 'divide', '0').kind).toBe('divide-by-zero');
    expect(calculate('5', 'divide', '0.00').kind).toBe('divide-by-zero');
  });

  it('refuses a result below zero, and takes exactly zero', () => {
    expect(calculate('10', 'subtract', '20').kind).toBe('below-zero');
    const zero = calculate('10', 'subtract', '10');
    expect(zero.kind === 'ok' && plainOf(zero.value)).toBe('0');
  });

  it('flags a result over the limit, keeping the value to show', () => {
    const state = typed(digits('9'), chooseOperator(typed(digits('999999999999')), 'multiply'));
    const result = resultOf(state, { max: '999999999999.99' });
    expect(result.kind).toBe('over-limit');
    expect(valueOf(result)).toBe('8999999999991.00');
    expect(commitResult(state, { max: '999999999999.99' })).toBe(state);
  });

  it('has nothing to show before both figures are there', () => {
    expect(resultOf(EMPTY_KEYPAD).kind).toBe('none');
    expect(resultOf(chooseOperator(typed(['5']), 'add')).kind).toBe('none');
  });
});

describe('operators and commit', () => {
  it('commits a result as the new amount, in its shortest exact form', () => {
    const state = typed(digits('2'), chooseOperator(typed(digits('143')), 'multiply'));
    expect(commitResult(state)).toEqual({ entry: '286', operator: null, operand: '' });
    const third = typed(['3'], chooseOperator(typed(['1', '0']), 'divide'));
    expect(commitResult(third).entry).toBe('3.33');
  });

  it('ignores an operator with nothing typed, and switches one with no operand yet', () => {
    expect(chooseOperator(EMPTY_KEYPAD, 'add')).toBe(EMPTY_KEYPAD);
    const plus = chooseOperator(typed(['5']), 'add');
    expect(chooseOperator(plus, 'multiply')).toEqual({ entry: '5', operator: 'multiply', operand: '' });
  });

  it('chains: a second operator takes the pending result first', () => {
    const state = typed(['3'], chooseOperator(typed(['2']), 'multiply'));
    expect(chooseOperator(state, 'add')).toEqual({ entry: '6', operator: 'add', operand: '' });
  });

  it('will not chain through a refused result', () => {
    const state = typed(['0'], chooseOperator(typed(['2']), 'divide'));
    expect(chooseOperator(state, 'add')).toBe(state);
  });

  it('lets typing carry on after a committed result', () => {
    const committed = commitResult(typed(digits('0.2'), chooseOperator(typed(digits('0.1')), 'add')));
    expect(typed(['5'], committed).entry).toBe('0.35');
  });
});
