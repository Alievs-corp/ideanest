import { describe, expect, it } from 'vitest';
import { carriesIdentifyingData, looksIdentifying, stringsIn } from './redaction';
import { CONNECTION_CLASSES, DEVICE_CLASSES, NAVIGATION_TYPES } from './attribution';
import { FIELD_METRICS } from './metrics';
import { ROUTE_PATTERNS, UNRECOGNISED_ROUTE } from './route-pattern';

describe('looksIdentifying', () => {
  it.each([
    ['an email address', 'aygun@example.az'],
    ['an email inside something else', '/discover?q=aygun@example.az'],
    ['an international phone number', '+994 50 123 45 67'],
    ['a local phone number', '0501234567'],
    ['a JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'],
    ['a bearer credential', 'Bearer abcdefghijklmnop'],
    ['an enrolment URI', 'otpauth://totp/IdeyaNest'],
    ['an IBAN', 'AZ21NABZ00000000137010001944'],
    ['a card number', '4111111111111111'],
    ['a card number with spaces', '4111 1111 1111 1111'],
    ['free text', 'vintage watches'],
    ['a query string', '/discover?category=games'],
    ['a fragment', '/discover#results'],
    ['a percent-encoded escape', '/discover%3Fq%3Dx'],
  ])('refuses %s', (_description, value) => {
    expect(looksIdentifying(value)).toBe(true);
  });

  /*
   * The rules must not refuse the payload's own vocabulary, or the endpoint
   * refuses every beacon and the failure looks like a network problem.
   */
  it('accepts every value the payload is allowed to carry', () => {
    const values = [
      ...ROUTE_PATTERNS,
      UNRECOGNISED_ROUTE,
      ...FIELD_METRICS,
      ...CONNECTION_CLASSES,
      ...DEVICE_CLASSES,
      ...NAVIGATION_TYPES,
      'v',
      'requestId',
      'traceId',
      'spanId',
      'sessionId',
      'route',
      'connection',
      'device',
      'samples',
      'name',
      'value',
      'navigationType',
    ];
    for (const value of values) {
      expect(looksIdentifying(value), value).toBe(false);
    }
  });

  /*
   * A sixteen-digit span identifier is a legitimate span identifier, and about
   * one in eighteen hundred of them is one. `payload.ts` therefore exempts the
   * four correlation identifiers from these rules rather than rejecting one
   * beacon in a hundred thousand for looking like a Visa; this documents that
   * the rules on their own really would.
   */
  it('would refuse a span identifier that happened to be a Luhn-valid card', () => {
    expect(looksIdentifying('4111111111111111')).toBe(true);
  });

  it('does not mistake a timestamp for a card number', () => {
    expect(looksIdentifying(String(Date.now()))).toBe(false);
    expect(looksIdentifying('1755500000000')).toBe(false);
  });

  it('does not carry state between calls', () => {
    // `CARD_CANDIDATE` is a global regular expression; a forgotten `lastIndex`
    // would make the second call of a pair scan from where the first stopped.
    expect(looksIdentifying('4111111111111111')).toBe(true);
    expect(looksIdentifying('4111111111111111')).toBe(true);
  });
});

describe('carriesIdentifyingData', () => {
  it('walks nested objects and arrays', () => {
    expect(carriesIdentifyingData({ a: { b: ['ok', 'also-ok'] } })).toBe(false);
    expect(carriesIdentifyingData({ a: { b: ['ok', 'aygun@example.az'] } })).toBe(true);
    expect(carriesIdentifyingData({ samples: [{ name: 'LCP', value: 1822 }] })).toBe(false);
  });

  /*
   * The field name is evidence too: a key called `Aygun Mammadova` is as much a
   * leak as a value that is one.
   */
  it('inspects keys as well as values', () => {
    expect(carriesIdentifyingData({ 'aygun@example.az': 1 })).toBe(true);
  });

  it('ignores numbers, booleans and nulls', () => {
    expect(carriesIdentifyingData({ value: 4111111111111111, ok: true, none: null })).toBe(false);
  });
});

describe('stringsIn', () => {
  it('finds every string reachable from a value', () => {
    expect(stringsIn({ a: 'one', b: [{ c: 'two' }], d: 3 }).sort()).toEqual(
      ['a', 'b', 'c', 'd', 'one', 'two'].sort(),
    );
  });
});
