import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CURRENCY,
  approximate,
  formatApproximate,
  formatMoney,
  isSupportedCurrency,
  parseAmount,
  rateFor,
  toMoney,
  toWireAmount,
  type ExchangeRate,
} from './index';

/**
 * Money arithmetic is not optional to test (CLAUDE.md §3): it fails silently
 * and expensively. These cover the two ways it fails — a value that was never
 * a valid amount getting through, and a valid amount losing precision on the
 * way to the API.
 */

function amount(input: string, options: { allowZero?: boolean } = {}): Decimal {
  const parsed = parseAmount(input, options);
  if (!parsed.ok) throw new Error(`Expected ${input} to parse, got ${parsed.reason}.`);
  return parsed.value;
}

describe('parseAmount', () => {
  it('reads a plain figure, with or without a scale', () => {
    expect(amount('5000').toFixed(2)).toBe('5000.00');
    expect(amount('5000.5').toFixed(2)).toBe('5000.50');
    expect(amount('5000.50').toFixed(2)).toBe('5000.50');
  });

  it('ignores the spaces somebody types while grouping a large figure', () => {
    expect(amount('120 000.00').toFixed(2)).toBe('120000.00');
    // The narrow no-break space Intl.NumberFormat itself emits.
    expect(amount('120 000').toFixed(2)).toBe('120000.00');
  });

  /*
   * The interface ships in Azerbaijani and English, where "1,50" is one and a
   * half in one language and a malformed thousand in the other. Guessing would
   * occasionally read a goal as a hundredth of what was meant.
   */
  it('refuses a comma rather than guessing what it separates', () => {
    expect(parseAmount('5,000')).toEqual({ ok: false, reason: 'comma' });
    expect(parseAmount('1,50')).toEqual({ ok: false, reason: 'comma' });
  });

  // Everything parseFloat and Number would have accepted, quietly.
  it.each([
    ['1e5', 'not-a-number'],
    ['0x10', 'not-a-number'],
    ['12abc', 'not-a-number'],
    ['-500', 'not-a-number'],
    ['Infinity', 'not-a-number'],
    ['5.005', 'too-many-decimals'],
    ['', 'empty'],
    ['   ', 'empty'],
    ['0', 'not-positive'],
    ['0.00', 'not-positive'],
  ])('refuses %s', (input, reason) => {
    expect(parseAmount(input)).toEqual({ ok: false, reason });
  });

  it('refuses more integer digits than numeric(14,2) can hold', () => {
    expect(amount('999999999999.99').toFixed(2)).toBe('999999999999.99');
    expect(parseAmount('1000000000000')).toEqual({ ok: false, reason: 'too-large' });
    // Leading zeros are padding, not magnitude.
    expect(amount('000000000000500').toFixed(2)).toBe('500.00');
  });
});

describe('the wire value', () => {
  it('is always at the scale the column holds', () => {
    expect(toWireAmount(amount('5000'))).toBe('5000.00');
    expect(toWireAmount(amount('5000.5'))).toBe('5000.50');
  });

  it('keeps every digit of a large goal', () => {
    // A double loses this one: 999999999999.99 is not representable exactly.
    expect(toWireAmount(amount('999999999999.99'))).toBe('999999999999.99');
  });

  /*
   * The reason this module exists. 0.1 + 0.2 is 0.30000000000000004 in IEEE
   * 754, and on a funding platform that difference is somebody's pledge.
   */
  it('adds without the floating-point error', () => {
    expect(toWireAmount(amount('0.1').plus(amount('0.2')))).toBe('0.30');
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('builds a Money body with the amount as a string', () => {
    const money = toMoney(amount('5000'), 'AZN');
    expect(money).toEqual({ amount: '5000.00', currency: 'AZN' });
    expect(typeof money.amount).toBe('string');
  });
});

/*
 * A shipping rate is the one amount on the platform that is legitimately zero:
 * "free to Azerbaijan" is an offer creators make deliberately, and the server
 * stores it as `0.00` rather than as an absent rule. Without the option this
 * module would leave the creator no way to say the thing the data model exists
 * to express.
 */
describe('an amount that may be zero', () => {
  it('accepts zero when the caller allows it, and not otherwise', () => {
    expect(parseAmount('0', { allowZero: true }).ok).toBe(true);
    expect(parseAmount('0.00', { allowZero: true }).ok).toBe(true);
    expect(parseAmount('0')).toEqual({ ok: false, reason: 'not-positive' });
  });

  it('is zero at the scale the column holds', () => {
    expect(toWireAmount(amount('0', { allowZero: true }))).toBe('0.00');
  });

  // The option relaxes exactly one rule and no others. A rate of "1e5" or
  // "5,00" is as wrong on a shipping line as it is on a goal.
  it.each([
    ['1e5', 'not-a-number'],
    ['5,00', 'comma'],
    ['0.005', 'too-many-decimals'],
    ['', 'empty'],
  ])('still refuses %s', (input, reason) => {
    expect(parseAmount(input, { allowZero: true })).toEqual({ ok: false, reason });
  });
});

describe('formatting an amount for a reader', () => {
  it('groups the digits and puts the currency after them', () => {
    expect(formatMoney({ amount: '5000.00', currency: 'AZN' })).toBe('5,000.00 AZN');
    expect(formatMoney({ amount: '19.99', currency: 'AZN' })).toBe('19.99 AZN');
    expect(formatMoney({ amount: '999.00', currency: 'AZN' })).toBe('999.00 AZN');
  });

  /*
   * The reason this is not `Intl.NumberFormat`: it takes a `number`, and the
   * whole discipline of this module is that an amount never becomes one. The
   * formatting is done on the digits, so the figure shown is the figure the
   * service sent, to the last qəpik.
   */
  it('formats the largest amount the column can hold, digit for digit', () => {
    expect(formatMoney({ amount: '999999999999.99', currency: 'AZN' })).toBe(
      '999,999,999,999.99 AZN',
    );
  });

  it('shows the scale even when the server did not send one', () => {
    expect(formatMoney({ amount: '12', currency: 'AZN' })).toBe('12.00 AZN');
    expect(formatMoney({ amount: '12.5', currency: 'AZN' })).toBe('12.50 AZN');
  });

  it('has nothing to say about an amount that is not there', () => {
    expect(formatMoney(null)).toBe('');
    expect(formatMoney(undefined)).toBe('');
  });
});

describe('currency', () => {
  it('accepts only what the platform can collect in', () => {
    // Phase 1 is AZN (docs/architecture.md §21.2).
    expect(isSupportedCurrency(DEFAULT_CURRENCY)).toBe(true);
    expect(isSupportedCurrency('USD')).toBe(false);
    expect(isSupportedCurrency('')).toBe(false);
  });
});

/**
 * §21.2's display currency — issue #327.
 *
 * The two assertions this whole feature rests on are the direction and the
 * precision, and both are asserted against figures computed by hand:
 *
 *   * **Direction.** One dollar is worth 1.70 manat, so ₼50.00 is *less* than
 *     fifty dollars. Multiplying instead of dividing gives $85.00, and on a
 *     rate near one nobody notices until somebody pledges in lira.
 *   * **Precision.** 0.0354 manat per lira. A rate rounded to two decimal
 *     places is 0.04, which makes a ₼50 campaign look 13% cheaper than it is.
 *
 * Everything else here is the same rule stated once: an approximation that
 * cannot be computed honestly is absent, never a fallback.
 */
describe('approximate', () => {
  const usd: ExchangeRate = { currency: 'USD', rate: '1.7000000000', publishedFor: '2026-08-27' };
  const lira: ExchangeRate = { currency: 'TRY', rate: '0.0354000000', publishedFor: '2026-08-27' };

  it('divides by the rate, and rounds once at the end', () => {
    // 50 / 1.7 = 29.41176…
    expect(approximate({ amount: '50.00', currency: 'AZN' }, usd)).toEqual({
      amount: '29.41',
      currency: 'USD',
    });
  });

  it('keeps the rate at full precision', () => {
    // 50 / 0.0354 = 1412.4293…, and never the 1250 a two-place rate would give.
    expect(approximate({ amount: '50.00', currency: 'AZN' }, lira)).toEqual({
      amount: '1412.43',
      currency: 'TRY',
    });
  });

  it('rounds half to even, like every other amount on this platform', () => {
    // 0.025 / 1 -> 0.02, not 0.03. §21.2 declares HALF_EVEN once, in
    // MoneyRounding, and a display currency that rounded away from zero would
    // be a second rule nobody wrote down.
    const one: ExchangeRate = { currency: 'USD', rate: '1', publishedFor: '2026-08-27' };
    expect(approximate({ amount: '0.025', currency: 'AZN' }, one)).toBeNull();
    expect(approximate({ amount: '0.05', currency: 'AZN' }, { ...one, rate: '2' })).toEqual({
      amount: '0.02',
      currency: 'USD',
    });
  });

  it('shows nothing rather than a guess when there is no rate', () => {
    expect(approximate({ amount: '50.00', currency: 'AZN' }, null)).toBeNull();
    expect(approximate(null, usd)).toBeNull();
  });

  it('refuses a rate that is not a decimal string', () => {
    // `Decimal`'s own constructor accepts these, which is exactly why it is not
    // the check. A rate of `1e5` would produce a figure nobody quoted.
    for (const rate of ['1e5', '0x10', '', '-1.7', 'nineteen']) {
      expect(approximate({ amount: '50.00', currency: 'AZN' }, { ...usd, rate })).toBeNull();
    }
  });

  it('refuses to make an amount an approximation of itself', () => {
    // "₼50 ≈ ₼50" reads as a conversion that went wrong rather than as one that
    // was not needed.
    expect(
      approximate({ amount: '50.00', currency: 'AZN' }, { ...usd, currency: 'AZN' }),
    ).toBeNull();
  });

  it('refuses an amount that is not a wire amount', () => {
    expect(approximate({ amount: '1,50', currency: 'AZN' }, usd)).toBeNull();
  });
});

describe('formatApproximate', () => {
  it('marks the figure as approximate, in a character rather than a word', () => {
    // The almost-equal sign is the only thing on the screen saying this is not
    // what will be charged, and it needs no translation in §21.1's four
    // languages.
    expect(formatApproximate({ amount: '1412.43', currency: 'TRY' })).toBe('≈ 1,412.43 TRY');
  });

  it('draws nothing when there is nothing to draw', () => {
    expect(formatApproximate(null)).toBe('');
    expect(formatApproximate(undefined)).toBe('');
  });
});

describe('rateFor', () => {
  const rates: ExchangeRate[] = [
    { currency: 'USD', rate: '1.7', publishedFor: '2026-08-27' },
    { currency: 'EUR', rate: '1.9877', publishedFor: '2026-08-27' },
  ];

  it('finds a currency, and answers null for one that is not there', () => {
    expect(rateFor(rates, 'EUR')?.rate).toBe('1.9877');
    // A currency somebody chose last month whose source has since stopped
    // publishing it. Every caller has to handle this, which is why it is null
    // rather than undefined from a `find`.
    expect(rateFor(rates, 'GBP')).toBeNull();
    expect(rateFor(null, 'USD')).toBeNull();
    expect(rateFor(rates, null)).toBeNull();
  });
});

describe('the format entry', () => {
  it('is the same function the whole module exports, so there is one implementation', async () => {
    const whole = await import('./index');
    const only = await import('./format');

    expect(whole.formatMoney).toBe(only.formatMoney);
    expect(whole.MONEY_SCALE).toBe(only.MONEY_SCALE);
    expect(only.formatMoney({ amount: '12500.5', currency: 'AZN' })).toBe('12,500.50 AZN');
  });

  it('imports nothing, which is the whole reason it is a separate entry', async () => {
    // The file's own text, through Vite's `?raw`, so no Node types are needed here.
    const { default: source } = await import('./format.ts?raw');

    // Not a `decimal.js` import, and not an import of the module that has one: the day this file
    // imports either, a screen that only prints an amount is carrying the arithmetic library again.
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
