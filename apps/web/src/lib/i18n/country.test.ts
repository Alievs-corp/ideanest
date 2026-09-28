import { describe, expect, it } from 'vitest';
import { COUNTRY_LOCALES, localeForCountry } from './country';
import { isLocale } from './locale';

describe('the language a country starts in (#125)', () => {
  it('names the three languages the table exists for', () => {
    expect(localeForCountry('AZ')).toBe('az');
    expect(localeForCountry('TR')).toBe('tr');
    for (const country of ['RU', 'BY', 'KZ', 'KG', 'UZ', 'TJ', 'AM', 'MD', 'TM']) {
      expect(localeForCountry(country)).toBe('ru');
    }
  });

  it('leaves Georgia and Ukraine to the default, deliberately', () => {
    expect(localeForCountry('GE')).toBeNull();
    expect(localeForCountry('UA')).toBeNull();
  });

  it('says nothing for a country it does not list, or one Cloudflare could not place', () => {
    for (const country of ['DE', 'US', 'XX', 'T1', '', null, undefined]) {
      expect(localeForCountry(country)).toBeNull();
    }
  });

  it('reads the code whatever its case or surrounding space', () => {
    expect(localeForCountry('az')).toBe('az');
    expect(localeForCountry(' tr ')).toBe('tr');
  });

  it('cannot be steered onto a property the table inherited', () => {
    for (const value of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(localeForCountry(value)).toBeNull();
    }
  });

  it('only ever answers with a language the platform has', () => {
    for (const locale of Object.values(COUNTRY_LOCALES)) {
      expect(isLocale(locale)).toBe(true);
    }
  });
});
