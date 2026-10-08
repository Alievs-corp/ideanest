import { RETURN_GRACE_MS, claimReturnRoute } from './auth-session-links';
import { NOT_FOUND, incomingLink, listenForLinks, shareUrlFor, type LinkSource } from './links';

/*
 * The parser and the claimed-route table are `@ideanest/links`, tested there over every row in
 * every URL form. What is tested here is what the application does with the parser's answer.
 */

const HOST = 'ideanest.az';
const ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const TOKEN = 'q9Xb2Zk7-Lm_04Rt5sVwYz1aBcDeFgHiJkLmNoPqRsT';

describe('incomingLink', () => {
  it('opens the screen the parser names', () => {
    expect(incomingLink('https://ideanest.az/az/projects/a/b', HOST)).toEqual({
      kind: 'route',
      destination: { pathname: '/projects/a/b' },
    });
  });

  it('opens a link of ours that the app cannot show in the in-app browser', () => {
    for (const url of [
      'https://ideanest.az/az/projects/x/prelaunch/opengraph-image',
      'https://ideanest.az/categories/a/b/c',
      'https://IDEANEST.az/u/a/b',
    ]) {
      expect(incomingLink(url, HOST)).toEqual({ kind: 'browser', url: new URL(url).href });
    }
  });

  it('refuses a foreign host, plain http and a non-URL silently', () => {
    for (const url of [
      'https://evil-ideanest.az/projects/a/b',
      'https://evil-ideanest.az/opengraph-image',
      'http://ideanest.az/projects/a/b',
      'http://ideanest.az/opengraph-image',
      'javascript:alert(1)',
      'not a url',
      '',
    ]) {
      expect(incomingLink(url, HOST)).toEqual({ kind: 'ignore' });
    }
  });

  it('sends the custom scheme with an unknown path to the not-found screen', () => {
    expect(incomingLink('ideanest://nowhere/at/all', HOST)).toEqual({ kind: 'route', destination: NOT_FOUND });
    expect(incomingLink('ideanest://dev/kit', HOST)).toEqual({ kind: 'route', destination: NOT_FOUND });
  });

  it('lands the legacy /projects/<uuid> on not-found, as the web does', () => {
    expect(incomingLink(`https://ideanest.az/projects/${ID}`, HOST)).toEqual({
      kind: 'route',
      destination: NOT_FOUND,
    });
  });

  it.each(['verify-email', 'reset-password/confirm', 'confirm-email-change'])(
    'hands the token of /%s to its screen, from the email’s bare link and the redirected one',
    (page) => {
      for (const url of [
        `https://ideanest.az/${page}?token=${TOKEN}`,
        `https://ideanest.az/az/${page}?token=${TOKEN}`,
      ]) {
        expect(incomingLink(url, HOST)).toEqual({
          kind: 'route',
          destination: { pathname: `/${page}`, params: { token: TOKEN } },
        });
      }
    },
  );
});

/** A stand-in for `expo-linking`: a launch URL, and a way to deliver later ones. */
function fakeLinking(initial: string | null) {
  const listeners: ((event: { url: string }) => void)[] = [];
  const removed = jest.fn();
  const source: LinkSource = {
    getInitialURL: () => Promise.resolve(initial),
    addEventListener: (_type, listener) => {
      listeners.push(listener);
      return { remove: removed };
    },
  };
  return { source, removed, deliver: (url: string) => listeners.forEach((listener) => listener({ url })) };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('listenForLinks', () => {
  const returns = [
    [`https://ideanest.az/az/pledges/${ID}?payment=returned`, { pathname: `/pledges/${ID}`, params: { payment: 'returned' } }],
    [`https://ideanest.az/en/pledges/${ID}?payment=failed`, { pathname: `/pledges/${ID}`, params: { payment: 'failed' } }],
    ['https://ideanest.az/ru/settings/payout?card=returned', { pathname: '/settings/payout', params: { card: 'returned' } }],
    ['https://ideanest.az/tr/settings/payout?card=failed', { pathname: '/settings/payout', params: { card: 'failed' } }],
  ] as const;

  it.each(returns)('opens %s from a cold start', async (url, destination) => {
    const { source } = fakeLinking(url);
    const handlers = { navigate: jest.fn(), openBrowser: jest.fn() };
    listenForLinks(source, HOST, handlers);
    await flush();
    expect(handlers.navigate).toHaveBeenCalledTimes(1);
    expect(handlers.navigate).toHaveBeenCalledWith(destination);
    expect(handlers.openBrowser).not.toHaveBeenCalled();
  });

  it.each(returns)('opens %s when the app is already running', async (url, destination) => {
    const { source, deliver } = fakeLinking(null);
    const handlers = { navigate: jest.fn(), openBrowser: jest.fn() };
    listenForLinks(source, HOST, handlers);
    await flush();
    expect(handlers.navigate).not.toHaveBeenCalled();
    deliver(url);
    expect(handlers.navigate).toHaveBeenCalledWith(destination);
  });

  it('hands a refused link of ours to the browser handler, and ignores a foreign one', async () => {
    const { source, deliver } = fakeLinking('https://ideanest.az/az/discover/opengraph-image');
    const handlers = { navigate: jest.fn(), openBrowser: jest.fn() };
    listenForLinks(source, HOST, handlers);
    await flush();
    expect(handlers.openBrowser).toHaveBeenCalledWith('https://ideanest.az/az/discover/opengraph-image');
    deliver('https://evil.example/projects/a/b');
    expect(handlers.navigate).not.toHaveBeenCalled();
    expect(handlers.openBrowser).toHaveBeenCalledTimes(1);
  });

  describe('while a payment or payout-card session is returning', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it.each([
      [`https://ideanest.az/az/pledges/${ID}?payment=returned&via=app`, `/pledges/${ID}`],
      [`ideanest://pledges/${ID}?payment=returned`, `/pledges/${ID}`],
      [`https://ideanest.az/pledges/${ID.toUpperCase()}?payment=failed`, `/pledges/${ID}`],
      ['https://ideanest.az/ru/settings/payout?card=returned&via=app', '/settings/payout'],
      ['ideanest://settings/payout?card=failed', '/settings/payout'],
    ])('leaves %s to the session, then routes it again once the claim lapses', async (url, route) => {
      const { source, deliver } = fakeLinking(null);
      const handlers = { navigate: jest.fn(), openBrowser: jest.fn() };
      listenForLinks(source, HOST, handlers);
      await flush();
      jest.useFakeTimers();

      const release = claimReturnRoute(route);
      deliver(url);
      expect(handlers.navigate).not.toHaveBeenCalled();

      // Android can wake the app before the link that woke it arrives: the claim outlasts the session.
      release();
      jest.advanceTimersByTime(RETURN_GRACE_MS - 1);
      deliver(url);
      expect(handlers.navigate).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      deliver(url);
      expect(handlers.navigate).toHaveBeenCalledTimes(1);
      expect(handlers.openBrowser).not.toHaveBeenCalled();
    });

    it('still opens every other link, another pledge included', async () => {
      const { source, deliver } = fakeLinking(null);
      const handlers = { navigate: jest.fn(), openBrowser: jest.fn() };
      listenForLinks(source, HOST, handlers);
      await flush();
      const other = '0e5d4c3b-2a19-4f08-9e7d-6c5b4a392817';

      const release = claimReturnRoute(`/pledges/${ID}`);
      deliver(`https://ideanest.az/pledges/${other}`);
      deliver('https://ideanest.az/az/settings/payout');
      deliver('https://ideanest.az/pledges');
      release();

      expect(handlers.navigate.mock.calls.map(([destination]) => destination.pathname)).toEqual([
        `/pledges/${other}`,
        '/settings/payout',
        '/pledges',
      ]);
    });
  });

  it('stops listening when unsubscribed, including for a launch URL still being read', async () => {
    const { source, deliver, removed } = fakeLinking('https://ideanest.az/az/discover');
    const handlers = { navigate: jest.fn(), openBrowser: jest.fn() };
    const stop = listenForLinks(source, HOST, handlers);
    stop();
    await flush();
    deliver('https://ideanest.az/search');
    expect(handlers.navigate).not.toHaveBeenCalled();
    expect(removed).toHaveBeenCalledTimes(1);
  });
});

describe('Expo Router’s own link handling', () => {
  it('is off, so a link moves the application only through the root’s listener', () => {
    // Deliberately not `redirectSystemPath` rewriting (#165): that hook runs before the app lock
    // exists, so a link routed there would open behind nothing. `_layout.tsx` routes instead.
    const { redirectSystemPath } = require('../app/+native-intent') as {
      redirectSystemPath: (event: { path: string; initial: boolean }) => string | null;
    };
    for (const path of [
      'https://ideanest.az/az/discover?utm_source=x',
      `https://ideanest.az/az/verify-email?token=${TOKEN}`,
      'ideanest://dev/kit',
      'https://evil.example/projects/a/b',
    ]) {
      expect(redirectSystemPath({ path, initial: true })).toBeNull();
      expect(redirectSystemPath({ path, initial: false })).toBeNull();
    }
  });
});

describe('shareUrlFor', () => {
  it('shares the https URL rather than the custom scheme', () => {
    // A recipient without the application installed has to be able to open it.
    expect(shareUrlFor('https://ideanest.az', 'aysel', 'solar-lamp')).toBe(
      'https://ideanest.az/projects/aysel/solar-lamp',
    );
  });

  it('encodes a slug that needs it', () => {
    expect(shareUrlFor('https://ideanest.az', 'ayşe', 'lâmba')).toBe(
      'https://ideanest.az/projects/ay%C5%9Fe/l%C3%A2mba',
    );
  });
});
