import { describe, expect, it } from 'vitest';
import { ALL_MARKETS, COUNTRY_CODES, isMarket, marketParameter, resolveMarket } from './country';

describe('resolveMarket', () => {
  it('prefers the reader’s choice, then where they are, then Azerbaijan', () => {
    expect(resolveMarket('ge', 'DE')).toBe('GE');
    expect(resolveMarket(ALL_MARKETS, 'DE')).toBe(ALL_MARKETS);
    expect(resolveMarket(null, 'de')).toBe('DE');
    expect(resolveMarket(undefined, undefined)).toBe('AZ');
  });

  it('reads Cloudflare’s unknown and Tor answers, and anything malformed, as nowhere', () => {
    for (const detected of ['XX', 'T1', '', 'AZE', 'ALL']) {
      expect(resolveMarket(null, detected)).toBe('AZ');
    }
    expect(resolveMarket('nowhere', 'TR')).toBe('TR');
  });
});

describe('the vocabulary', () => {
  it('accepts every country and every-country, and nothing else', () => {
    expect(COUNTRY_CODES.every(isMarket)).toBe(true);
    expect(isMarket(ALL_MARKETS)).toBe(true);
    expect(isMarket('XX')).toBe(false);
    expect(isMarket('az')).toBe(false);
  });

  it('sends no parameter for every country', () => {
    expect(marketParameter(ALL_MARKETS)).toBeNull();
    expect(marketParameter('AZ')).toBe('AZ');
  });
});
