import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  announceMarket,
  currentMarket,
  marketFromCookies,
  rememberPageMarket,
  subscribeMarket,
  withMarket,
  writeMarketCookie,
} from './cookie';

afterEach(() => {
  rememberPageMarket(null);
  document.cookie = 'ideanest_country=; Path=/; Max-Age=0';
});

describe('marketFromCookies', () => {
  it('reads the choice before the market the page was rendered for, and Azerbaijan before nothing', () => {
    expect(marketFromCookies('ideanest_country=GE', 'DE')).toBe('GE');
    expect(marketFromCookies('ideanest_country=ALL')).toBe('ALL');
    expect(marketFromCookies('other=1', 'DE')).toBe('DE');
    expect(marketFromCookies('')).toBe('AZ');
  });

  it('ignores a choice that is not shaped like a market', () => {
    expect(marketFromCookies('ideanest_country=nowhere', 'TR')).toBe('TR');
    expect(marketFromCookies('ideanest_country=nowhere')).toBe('AZ');
  });

  it('never reads the detected-country cookie a browser may still hold from before #641', () => {
    expect(marketFromCookies('ideanest_country_detected=DE')).toBe('AZ');
  });
});

describe('the market a page was rendered for (#641)', () => {
  it('is what the browser reads when the reader has not chosen', () => {
    expect(currentMarket()).toBe('AZ');
    rememberPageMarket('DE');
    expect(currentMarket()).toBe('DE');

    document.cookie = 'ideanest_country=GE; Path=/';
    expect(currentMarket()).toBe('GE');
  });

  it('ignores a value that is not shaped like a market', () => {
    rememberPageMarket('<script>');
    expect(currentMarket()).toBe('AZ');
  });

  it('tells the controls when it arrives and when the reader chooses', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMarket(listener);

    announceMarket();
    writeMarketCookie('ALL');
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    announceMarket();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('withMarket', () => {
  it('adds the code, and nothing for every country', () => {
    expect(withMarket(new URLSearchParams('q=lamp'), 'GE').toString()).toBe('q=lamp&market=GE');
    expect(withMarket(new URLSearchParams('q=lamp'), 'ALL').toString()).toBe('q=lamp');
  });

  it('reads the page’s market by default, so a second page of a list is the same country', () => {
    rememberPageMarket('DE');
    expect(withMarket(new URLSearchParams('limit=24')).toString()).toBe('limit=24&market=DE');
  });
});
