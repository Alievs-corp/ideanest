import { describe, expect, it } from 'vitest';
import { marketFromCookies, withMarket } from './cookie';

describe('marketFromCookies', () => {
  it('reads the choice before what the proxy detected, and Azerbaijan before nothing', () => {
    expect(marketFromCookies('ideanest_country=GE; ideanest_country_detected=DE')).toBe('GE');
    expect(marketFromCookies('ideanest_country=ALL')).toBe('ALL');
    expect(marketFromCookies('other=1; ideanest_country_detected=DE')).toBe('DE');
    expect(marketFromCookies('')).toBe('AZ');
  });

  it('ignores a value that is not shaped like a market', () => {
    expect(marketFromCookies('ideanest_country=nowhere; ideanest_country_detected=TR')).toBe('TR');
    expect(marketFromCookies('ideanest_country_detected=ALL')).toBe('AZ');
  });
});

describe('withMarket', () => {
  it('adds the code, and nothing for every country', () => {
    expect(withMarket(new URLSearchParams('q=lamp'), 'GE').toString()).toBe('q=lamp&market=GE');
    expect(withMarket(new URLSearchParams('q=lamp'), 'ALL').toString()).toBe('q=lamp');
  });
});
