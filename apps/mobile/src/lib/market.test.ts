/*
 * The phone's region, per launch below. `var` for the reason `locale.test.ts` gives: the
 * factory runs when `./market` is imported, above this line.
 */
// eslint-disable-next-line no-var
var mockRegion: string | null | undefined;
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'az', languageTag: 'az', regionCode: mockRegion ?? null }],
}));

/** A cold start: a fresh module over whatever this phone has stored. */
function launch(region: string | null, stored?: string): string {
  let market = '';
  mockRegion = region;
  jest.isolateModules(() => {
    const { deviceStore } = require('./storage') as typeof import('./storage');
    deviceStore.remove('market');
    if (stored !== undefined) deviceStore.set('market', stored);
    market = (require('./market') as typeof import('./market')).currentMarket();
  });
  mockRegion = undefined;
  return market;
}

describe('the market on this phone (#533)', () => {
  it('starts from the phone’s region, and from Azerbaijan when it has none', () => {
    expect(launch('GE')).toBe('GE');
    expect(launch(null)).toBe('AZ');
  });

  it('lets a stored choice outrank the region, every country included', () => {
    expect(launch('GE', 'TR')).toBe('TR');
    expect(launch('GE', 'ALL')).toBe('ALL');
    expect(launch('GE', 'nowhere')).toBe('GE');
  });

  it('remembers a choice and tells every list', () => {
    jest.isolateModules(() => {
      const market = require('./market') as typeof import('./market');
      const { deviceStore } = require('./storage') as typeof import('./storage');
      market.setMarket('DE');
      expect(market.currentMarket()).toBe('DE');
      expect(deviceStore.getString('market')).toBe('DE');
      expect(market.marketQuery('DE')).toEqual({ market: 'DE' });
      expect(market.marketQuery('ALL')).toEqual({});
    });
  });
});
