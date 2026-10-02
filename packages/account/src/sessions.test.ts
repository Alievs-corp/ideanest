import { describe, expect, it } from 'vitest';
import az from '@ideanest/messages/az.json';
import en from '@ideanest/messages/en.json';
import { browserOf, deviceNameOf, locationOf, platformOf } from './sessions';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

describe('browserOf', () => {
  it('reads the plain cases', () => {
    expect(browserOf(FIREFOX_LINUX)).toBe('Firefox');
    expect(browserOf(CHROME_MAC)).toBe('Chrome');
  });

  // Every Chromium browser still claims to be Chrome, and Chrome still claims
  // to be Safari. Getting these wrong mislabels most of the list.
  it('prefers the specific token over the one every browser inherits', () => {
    expect(browserOf(EDGE_WINDOWS)).toBe('Edge');
    expect(browserOf(CHROME_ANDROID)).toBe('Chrome');
  });

  it('reads Safari only when nothing more specific claims the string', () => {
    expect(browserOf(SAFARI_IPHONE)).toBe('Safari');
  });

  it('answers null rather than guessing', () => {
    expect(browserOf(undefined)).toBeNull();
    expect(browserOf('curl/8.7.1')).toBeNull();
  });
});

describe('platformOf', () => {
  it('reads the plain cases', () => {
    expect(platformOf(CHROME_MAC)).toBe('macOS');
    expect(platformOf(EDGE_WINDOWS)).toBe('Windows');
  });

  // An Android user-agent contains "Linux"; an iOS one contains "like Mac OS X".
  it('prefers the narrower platform over the one it is built on', () => {
    expect(platformOf(CHROME_ANDROID)).toBe('Android');
    expect(platformOf(SAFARI_IPHONE)).toBe('iOS');
    expect(platformOf(FIREFOX_LINUX)).toBe('Linux');
  });

  it('answers null rather than guessing', () => {
    expect(platformOf(undefined)).toBeNull();
  });
});

/*
 * The words, read from the catalogue both clients draw them from. Retyping the sentences here
 * would give a test that passes whatever the catalogue says.
 */
const NAMES = en.settings.panels.sessions.row;

describe('deviceNameOf', () => {
  it('prefers the label the client sent at sign-in', () => {
    expect(deviceNameOf({ deviceLabel: "İsmət's MacBook", userAgent: CHROME_MAC }, NAMES)).toBe(
      "İsmət's MacBook",
    );
  });

  it('ignores a label that is only whitespace', () => {
    expect(deviceNameOf({ deviceLabel: '   ', userAgent: CHROME_MAC }, NAMES)).toBe('Chrome on macOS');
  });

  it('falls back to browser and platform', () => {
    expect(deviceNameOf({ userAgent: SAFARI_IPHONE }, NAMES)).toBe('Safari on iOS');
  });

  it('joins the two in the reader’s own word order', () => {
    expect(deviceNameOf({ userAgent: SAFARI_IPHONE }, az.settings.panels.sessions.row)).not.toBe(
      'Safari on iOS',
    );
  });

  it('uses whichever half it could read', () => {
    expect(deviceNameOf({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }, NAMES)).toBe('Windows');
  });

  // An invented name on a security screen is worse than none: the user then has
  // to decide whether to trust it.
  it('admits when it knows nothing', () => {
    expect(deviceNameOf({}, NAMES)).toBe('Unknown device');
    expect(deviceNameOf({ userAgent: 'something-unparseable' }, NAMES)).toBe('Unknown device');
  });
});

describe('locationOf', () => {
  it('returns the address when there is one', () => {
    expect(locationOf({ ipAddress: '203.0.113.7' })).toBe('203.0.113.7');
  });

  // Stripped at account anonymisation, and absent from the JSON when null.
  it('returns null when the service recorded none', () => {
    expect(locationOf({})).toBeNull();
    expect(locationOf({ ipAddress: '  ' })).toBeNull();
  });
});
