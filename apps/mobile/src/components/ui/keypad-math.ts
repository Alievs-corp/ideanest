import Decimal from 'decimal.js';
import { MONEY_MAX_INTEGER_DIGITS, MONEY_SCALE } from '@ideanest/money';

/**
 * The arithmetic behind `AmountKeypad` — issue #280, `mobile-design` skill §6.4.
 *
 * <h2>Strings and Decimals, never numbers</h2>
 *
 * What a key adds is a character appended to a string, and what an operator computes is a
 * `Decimal` built from those strings. Nothing here goes through a JS number, so `0.1 + 0.2` is
 * `0.3` and `999,999,999,999.99` keeps its last digit.
 *
 * <p>A result is rounded once, at the end, to the currency's minor units with `ROUND_HALF_EVEN` —
 * §21.2's `MoneyRounding`, the rule `approximate()` in `@ideanest/money` follows too. Every
 * currency the platform collects in has two minor units and the server column is `numeric(14,2)`,
 * so the scale is `MONEY_SCALE` unless a caller says otherwise.
 *
 * <p>A private constructor (`Decimal.clone`), so the precision a division runs at cannot be moved
 * by somebody calling `Decimal.set` elsewhere: 40 significant digits is far past the 14 a money
 * column holds, so the one rounding that matters is the explicit one.
 */
const Exact = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

/** The largest amount a `numeric(14,2)` column holds: the keypad's limit when a caller names none. */
export const MONEY_MAX_AMOUNT = `${'9'.repeat(MONEY_MAX_INTEGER_DIGITS)}.${'9'.repeat(MONEY_SCALE)}`;

export type KeypadOperator = 'add' | 'subtract' | 'multiply' | 'divide';

export const KEYPAD_OPERATORS: readonly KeypadOperator[] = ['add', 'subtract', 'multiply', 'divide'];

/** How each operator is drawn. Symbols, not words: they need no translation. */
export const OPERATOR_SYMBOL: Record<KeypadOperator, string> = {
  add: '+',
  subtract: '−',
  multiply: '×',
  divide: '÷',
};

export type KeypadKey =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'point'
  | 'backspace';

export const KEYPAD_KEYS: readonly KeypadKey[] = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'point',
  '0',
  'backspace',
];

/**
 * What has been typed. `entry` is the amount; with an `operator` chosen, `operand` is the figure
 * after it. Both are strings of digits with at most one point — `''`, `'0.'`, `'143'`, `'2.5'`.
 */
export interface KeypadState {
  readonly entry: string;
  readonly operator: KeypadOperator | null;
  readonly operand: string;
}

export const EMPTY_KEYPAD: KeypadState = { entry: '', operator: null, operand: '' };

/** One typed figure with a key applied: digits, the point, or a backspace. */
export function typeInto(text: string, key: KeypadKey, scale: number = MONEY_SCALE): string {
  if (key === 'backspace') return text.slice(0, -1);
  const point = text.indexOf('.');
  if (key === 'point') {
    if (scale <= 0 || point !== -1) return text;
    return text === '' ? '0.' : `${text}.`;
  }
  if (point !== -1) {
    return text.length - point - 1 >= scale ? text : `${text}${key}`;
  }
  // A leading zero is replaced, never followed: `0` then `5` is `5`, and `00` stays `0`.
  if (text === '0') return key;
  return text.length >= MONEY_MAX_INTEGER_DIGITS ? text : `${text}${key}`;
}

/** A key pressed on the whole keypad: into the operand when an operator is chosen, else the amount. */
export function pressKey(state: KeypadState, key: KeypadKey, scale: number = MONEY_SCALE): KeypadState {
  if (state.operator === null) return { ...state, entry: typeInto(state.entry, key, scale) };
  if (key === 'backspace' && state.operand === '') return { ...state, operator: null };
  return { ...state, operand: typeInto(state.operand, key, scale) };
}

export type KeypadResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'ok'; readonly value: Decimal }
  | { readonly kind: 'divide-by-zero' }
  | { readonly kind: 'below-zero' }
  | { readonly kind: 'over-limit'; readonly value: Decimal };

/** A typed figure as a Decimal: `''` and `'.'`-terminated text read as what is there. */
export function figureOf(text: string): Decimal | null {
  const trimmed = text.endsWith('.') ? text.slice(0, -1) : text;
  return /^\d+(\.\d+)?$/.test(trimmed) ? new Exact(trimmed) : null;
}

/**
 * The pending operation's result, rounded half-even to `scale`, or why there is none to take.
 *
 * <p>Rounded once, after the operation: rounding each operand first would make `0.005 × 3` and
 * `0.015` disagree, and the rule is one rounding per amount.
 */
export function resultOf(
  state: KeypadState,
  { scale = MONEY_SCALE, max }: { readonly scale?: number; readonly max?: string | null } = {},
): KeypadResult {
  if (state.operator === null) return { kind: 'none' };
  const left = figureOf(state.entry);
  const right = figureOf(state.operand);
  if (left === null || right === null || state.operand.endsWith('.')) return { kind: 'none' };
  // `0`, `0.` and `0.0` are on their way to `0.5`: a divisor is only zero once it cannot grow.
  if (state.operator === 'divide' && right.isZero() && !operandComplete(state.operand, scale)) {
    return { kind: 'none' };
  }

  let exact: Decimal;
  switch (state.operator) {
    case 'add':
      exact = left.plus(right);
      break;
    case 'subtract':
      exact = left.minus(right);
      break;
    case 'multiply':
      exact = left.times(right);
      break;
    case 'divide':
      if (right.isZero()) return { kind: 'divide-by-zero' };
      exact = left.dividedBy(right);
      break;
  }
  const value = exact.toDecimalPlaces(scale, Decimal.ROUND_HALF_EVEN);
  if (value.isNegative() && !value.isZero()) return { kind: 'below-zero' };
  if (exceeds(value, max)) return { kind: 'over-limit', value };
  return { kind: 'ok', value: value.isZero() ? new Exact(0) : value };
}

/** Whether a typed figure has every digit it can take: its decimals are full. */
function operandComplete(text: string, scale: number): boolean {
  const point = text.indexOf('.');
  return point !== -1 && text.length - point - 1 >= scale;
}

/** Whether an amount is over the caller's limit. No limit, or one that is not an amount, is none. */
export function exceeds(value: Decimal | null, max: string | null | undefined): boolean {
  if (value === null || max == null) return false;
  const limit = figureOf(max);
  return limit !== null && value.greaterThan(limit);
}

/**
 * A value as the keypad types it: plain notation, no trailing zeros — `286`, `0.3`, `357.5`. The
 * shortest string that is exactly the Decimal, so typing can carry on after a result.
 */
export function plainOf(value: Decimal): string {
  return value.toFixed();
}

/** Commits the pending result as the new amount. Anything but a valid result leaves state alone. */
export function commitResult(
  state: KeypadState,
  options: { readonly scale?: number; readonly max?: string | null } = {},
): KeypadState {
  const result = resultOf(state, options);
  if (result.kind !== 'ok') return state;
  return { entry: plainOf(result.value), operator: null, operand: '' };
}

/**
 * Chooses an operator. With nothing typed it does nothing; with a full operation already pending
 * it first takes that result, so `2 × 3 +` reads `6 +` — and refuses when that result is one it
 * would not take (division by zero, below zero, over the limit).
 */
export function chooseOperator(
  state: KeypadState,
  operator: KeypadOperator,
  options: { readonly scale?: number; readonly max?: string | null } = {},
): KeypadState {
  if (figureOf(state.entry) === null) return state;
  if (state.operator !== null && state.operand !== '') {
    const settled = commitResult(state, options);
    if (settled === state) return state;
    return { ...settled, operator };
  }
  return { ...state, operator, operand: '' };
}

/**
 * An amount handed in from outside — a reward's price, `45.00` — as the keypad types it: `45`,
 * `45.5`. Kept verbatim, its full decimals would refuse every digit key. Anything that is not an
 * amount is kept as it is.
 */
export function normaliseEntry(value: string): string {
  const figure = /^\d+(\.\d+)?$/.test(value) ? figureOf(value) : null;
  return figure === null ? value : plainOf(figure);
}

/** The amount as the field's value: `''`, or digits with a point only when a fraction follows. */
export function entryValue(entry: string): string {
  return entry.endsWith('.') ? entry.slice(0, -1) : entry;
}

/**
 * A typed figure grouped in threes as `formatMoney` groups an amount, with the fraction exactly as
 * typed — `1234.5` is `1,234.5` and `12.` keeps its point, so the digit just pressed is the one at
 * the end of what is shown.
 */
export function groupFigure(text: string): string {
  const point = text.indexOf('.');
  const whole = point === -1 ? text : text.slice(0, point);
  const rest = point === -1 ? '' : text.slice(point);
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${rest}`;
}
