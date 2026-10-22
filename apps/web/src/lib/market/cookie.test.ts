import { describe, expect, it } from 'vitest';
import { chosenMarket, marketFromCookies } from './cookie';

describe('marketFromCookies', () => {
  it('reads the choice before what the proxy detected, and Azerbaijan before nothing', () => {
    expect(marketFromCookies('ideanest_country=GE; ideanest_country_detected=DE')).toBe('GE');
    expect(marketFromCookies('ideanest_country=ALL')).toBe('ALL');
    expect(marketFromCookies('other=1; ideanest_country_detected=DE')).toBe('DE');
    expect(marketFromCookies('')).toBe('AZ');
  });

  it('ignores a choice that is not a market', () => {
    expect(marketFromCookies('ideanest_country=nowhere; ideanest_country_detected=TR')).toBe('TR');
    expect(chosenMarket('ideanest_country=nowhere')).toBeNull();
    expect(chosenMarket('ideanest_country=TR')).toBe('TR');
  });
});
