import { describe, expect, it } from 'vitest';
import { formatPrice } from './api';

describe('formatPrice', () => {
  /*
   * The server and the browser have to write the same string, or React throws the server's
   * markup away (#418). Chromium's `az` is root-locale data — `AZN 19` — and Node's full ICU
   * writes `19 ₼`, so the Azerbaijani price must not depend on which of the two answered.
   */
  it('writes an Azerbaijani price the same way in every runtime', () => {
    expect(formatPrice('19.00', 'AZN', 'az')).toBe('19 ₼');
    expect(formatPrice('10000', 'AZN', 'az')).toBe('10.000 ₼');
    expect(formatPrice('19.5', 'AZN', 'az')).toBe('19,50 ₼');
  });

  it('names a currency it has no sign for by its code', () => {
    expect(formatPrice('19', 'USD', 'az')).toBe('19 USD');
  });

  it('formats the other languages through Intl', () => {
    expect(formatPrice('10000', 'AZN', 'en')).toMatch(/^AZN\s10,000$/u);
    expect(formatPrice('10000', 'AZN', 'ru')).toMatch(/^10\s000\sAZN$/u);
  });

  it('shows the raw value when the amount is not a number', () => {
    expect(formatPrice('abc', 'AZN', 'az')).toBe('abc AZN');
  });
});
