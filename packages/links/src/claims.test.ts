import { describe, expect, it } from 'vitest';
import {
  CLAIMED_ROUTES,
  EXCLUDED_PATHS,
  LOCALES,
  androidIntentData,
  appleComponents,
  claimedPatterns,
  coversAdmin,
  intentDrift,
  isClaimedPath,
  matchesPattern,
  stripLocale,
} from './claims';
import { NOT_FOUND, destinationFor, hrefOf, type Destination } from './destination';

const HOST = 'ideanest.az';
const ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const TOKEN = 'q9Xb2Zk7-Lm_04Rt5sVwYz1aBcDeFgHiJkLmNoPqRsT';

/**
 * At least one link per row of the claim, written as the web writes it (no locale), with the
 * screen it must open. Every one is tried bare, under each locale and through the custom scheme,
 * with a `utm_source` added that must never survive.
 */
const SAMPLES: Readonly<Record<string, readonly (readonly [string, Destination])[]>> = {
  home: [['/', { pathname: '/' }]],
  discover: [
    ['/discover', { pathname: '/discover', params: {} }],
    ['/discover?category=games&sort=ending_soon', { pathname: '/discover', params: { category: 'games', sort: 'ending_soon' } }],
  ],
  search: [['/search?q=lamp', { pathname: '/search', params: { q: 'lamp' } }]],
  categories: [
    ['/categories', { pathname: '/categories' }],
    ['/categories/games', { pathname: '/categories/[category]', params: { category: 'games' } }],
    [
      '/categories/games/board',
      { pathname: '/categories/[category]/[subcategory]', params: { category: 'games', subcategory: 'board' } },
    ],
  ],
  collections: [
    ['/collections', { pathname: '/collections' }],
    ['/collections/staff-picks', { pathname: '/collections/[slug]', params: { slug: 'staff-picks' } }],
  ],
  'campaign-new': [['/projects/new', { pathname: '/campaigns/new' }]],
  'campaign-prelaunch': [[`/projects/${ID}/prelaunch`, { pathname: `/campaigns/${ID}/prelaunch` }]],
  'campaign-checkout': [
    [`/projects/${ID}/back?reward=t1`, { pathname: `/campaigns/${ID}/back`, params: { reward: 't1' } }],
  ],
  'campaign-editor': [
    [`/projects/${ID}/edit`, { pathname: `/campaigns/${ID}/edit/basics` }],
    [`/projects/${ID}/edit/rewards`, { pathname: `/campaigns/${ID}/edit/rewards` }],
  ],
  'campaign-dashboard': [
    [`/projects/${ID}/dashboard`, { pathname: `/campaigns/${ID}/dashboard` }],
    [`/projects/${ID}/dashboard/backers`, { pathname: `/campaigns/${ID}/dashboard/backers` }],
  ],
  campaign: [
    ['/projects/aysel/solar-lamp', { pathname: '/projects/aysel/solar-lamp' }],
    ['/projects/aysel/solar-lamp?tab=comments&thread=c1', {
      pathname: '/projects/aysel/solar-lamp',
      params: { tab: 'comments', thread: 'c1' },
    }],
  ],
  'campaign-legacy-id': [[`/projects/${ID}`, NOT_FOUND]],
  pledges: [
    ['/pledges', { pathname: '/pledges' }],
    [`/pledges/${ID}?payment=returned`, { pathname: `/pledges/${ID}`, params: { payment: 'returned' } }],
    [`/pledges/${ID}?payment=failed`, { pathname: `/pledges/${ID}`, params: { payment: 'failed' } }],
    [`/pledges/${ID}/address`, { pathname: `/pledges/${ID}/address` }],
  ],
  profile: [['/u/aysel', { pathname: '/u/[slug]', params: { slug: 'aysel' } }]],
  notifications: [['/notifications', { pathname: '/notifications' }]],
  account: [
    ['/account', { pathname: '/me' }],
    ['/account/saved', { pathname: '/saved' }],
    ['/account/deliveries', { pathname: '/account/deliveries' }],
  ],
  settings: [
    ['/settings', { pathname: '/settings' }],
    ['/settings/sessions', { pathname: '/settings/sessions' }],
    ['/settings/payout?card=returned', { pathname: '/settings/payout', params: { card: 'returned' } }],
    ['/settings/payout?card=failed', { pathname: '/settings/payout', params: { card: 'failed' } }],
  ],
  'sign-in': [
    ['/sign-in', { pathname: '/sign-in' }],
    ['/sign-in?next=%2Faz%2Fsettings%2Fsessions', { pathname: '/sign-in', params: { returnTo: '/settings/sessions' } }],
  ],
  register: [['/register', { pathname: '/register' }]],
  'reset-password': [['/reset-password', { pathname: '/reset-password' }]],
  'verify-email': [[`/verify-email?token=${TOKEN}`, { pathname: '/verify-email', params: { token: TOKEN } }]],
  'reset-password-confirm': [
    [`/reset-password/confirm?token=${TOKEN}`, { pathname: '/reset-password/confirm', params: { token: TOKEN } }],
  ],
  'confirm-email-change': [
    [`/confirm-email-change?token=${TOKEN}`, { pathname: '/confirm-email-change', params: { token: TOKEN } }],
  ],
  about: [['/about', { pathname: '/about' }]],
  'how-it-works': [['/how-it-works', { pathname: '/how-it-works' }]],
  pricing: [
    ['/pricing', { pathname: '/pricing' }],
    [`/pricing?from=submit&project=${ID}`, { pathname: '/pricing', params: { from: 'submit', project: ID } }],
  ],
  'trust-safety': [['/trust-safety', { pathname: '/trust-safety' }]],
  legal: [
    ['/legal', { pathname: '/legal' }],
    ['/legal/terms-of-use', { pathname: '/legal/terms-of-use' }],
    ['/legal/terms-of-use/v/2', { pathname: '/legal/terms-of-use/v/2' }],
  ],
  maintenance: [['/maintenance', { pathname: '/maintenance' }]],
};

/** The same link in each form it reaches the application in. */
function formsOf(webPath: string): string[] {
  const junk = `${webPath.includes('?') ? '&' : '?'}utm_source=newsletter`;
  const [path = '/', query = ''] = `${webPath}${junk}`.split(/(?=\?)/);
  return [
    `https://${HOST}${path}${query}`,
    ...LOCALES.map((locale) => `https://${HOST}/${locale}${path === '/' ? '' : path}${query}`),
    `ideanest://${path.slice(1)}${query}`,
  ];
}

describe('CLAIMED_ROUTES', () => {
  it('has a sample link for every row, and one for every path it claims', () => {
    for (const route of CLAIMED_ROUTES) {
      const samples = SAMPLES[route.id];
      expect(samples, route.id).toBeDefined();
      for (const pattern of route.paths) {
        const covered = (samples ?? []).some(([link]) => matchesPattern(pattern, link.split('?')[0] ?? ''));
        expect(covered, `${route.id} ${pattern}`).toBe(true);
      }
    }
    expect(Object.keys(SAMPLES).sort()).toEqual(CLAIMED_ROUTES.map((route) => route.id).sort());
  });

  describe.each(CLAIMED_ROUTES.map((route) => [route.id, route] as const))('%s', (id, route) => {
    it.each((SAMPLES[id] ?? []).map(([link, destination]) => [link, destination] as const))(
      '%s opens the same screen bare, under every locale and through ideanest://',
      (link, destination) => {
        for (const url of formsOf(link)) {
          expect(destinationFor(url, HOST), url).toEqual(destination);
        }
      },
    );

    it('is claimed by the association in every https form', () => {
      for (const [link] of SAMPLES[id] ?? []) {
        for (const url of formsOf(link).filter((form) => form.startsWith('https:'))) {
          expect(isClaimedPath(new URL(url).pathname), url).toBe(true);
        }
      }
    });

    it('keeps only its own query keys', () => {
      for (const [, destination] of SAMPLES[id] ?? []) {
        const kept = Object.keys(destination.params ?? {}).filter(
          // Path params of a browse route, and sign-in's `returnTo`, which is read from `next`.
          (key) => !destination.pathname.includes(`[${key}]`) && key !== 'returnTo',
        );
        for (const key of kept) expect(route.query, `${id} ${key}`).toContain(key);
      }
    });
  });
});

describe('the parser’s edge cases (#165)', () => {
  it('matches the id forms first, and a creator/slug pair otherwise', () => {
    expect(destinationFor(`https://${HOST}/az/projects/${ID}/back`, HOST)).toEqual({
      pathname: `/campaigns/${ID}/back`,
    });
    expect(destinationFor(`https://${HOST}/az/projects/alice/back`, HOST)).toEqual({
      pathname: '/projects/alice/back',
    });
  });

  it('refuses the administration console, prefixed or not', () => {
    for (const path of ['/admin', '/az/admin', '/az/admin/users', '/tr/admin/users/1']) {
      expect(destinationFor(`https://${HOST}${path}`, HOST)).toBeNull();
      expect(isClaimedPath(path)).toBe(false);
    }
  });

  it('refuses an OG image, which the in-app browser then shows', () => {
    const path = '/az/projects/x/prelaunch/opengraph-image';
    expect(destinationFor(`https://${HOST}${path}`, HOST)).toBeNull();
    expect(isClaimedPath(path)).toBe(false);
    expect(isClaimedPath('/opengraph-image')).toBe(false);
    expect(isClaimedPath('/en/discover/opengraph-image')).toBe(false);
  });

  it('refuses a foreign host and plain http', () => {
    expect(destinationFor(`https://evil-ideanest.az/az/projects/a/b`, HOST)).toBeNull();
    expect(destinationFor(`http://${HOST}/az/projects/a/b`, HOST)).toBeNull();
    expect(destinationFor(`http://${HOST}/verify-email?token=${TOKEN}`, HOST)).toBeNull();
  });

  it('keeps a slug holding ? or # one segment, in the path and in returnTo', () => {
    const campaign = destinationFor(`https://${HOST}/az/projects/a%3Fb/c%23d?tab=faq`, HOST);
    expect(campaign).toEqual({ pathname: '/projects/a%3Fb/c%23d', params: { tab: 'faq' } });
    expect(hrefOf(campaign as Destination)).toBe('/projects/a%3Fb/c%23d?tab=faq');
    expect(new URL(`https://${HOST}${hrefOf(campaign as Destination)}`).pathname).toBe('/projects/a%3Fb/c%23d');

    const next = encodeURIComponent('/az/projects/a%3Fb/c%23d');
    expect(destinationFor(`https://${HOST}/sign-in?next=${next}`, HOST)).toEqual({
      pathname: '/sign-in',
      params: { returnTo: '/projects/a%3Fb/c%23d' },
    });
  });

  it('decodes a percent-encoded slug exactly once', () => {
    // The campaign path carries the slug encoded again, for the router's one decode: `a%41`, not `A`.
    expect(destinationFor(`https://${HOST}/az/projects/a%2541/b`, HOST)).toEqual({ pathname: '/projects/a%2541/b' });
    expect(destinationFor(`https://${HOST}/u/ay%C5%9Fe`, HOST)).toEqual({ pathname: '/u/[slug]', params: { slug: 'ayşe' } });
  });

  it('drops a token that is empty or too long to be one', () => {
    expect(destinationFor(`https://${HOST}/verify-email?token=%20`, HOST)).toEqual({ pathname: '/verify-email' });
    expect(destinationFor(`https://${HOST}/verify-email?token=${'a'.repeat(200)}`, HOST)).toEqual({
      pathname: '/verify-email',
    });
  });

  it('reads sign-in’s next through the same parser, and never back into the auth screens', () => {
    const signIn = (next: string) =>
      destinationFor(`https://${HOST}/az/sign-in?next=${encodeURIComponent(next)}`, HOST);
    expect(signIn(`/en/projects/${ID}/back?reward=t1`)).toEqual({
      pathname: '/sign-in',
      params: { returnTo: `/campaigns/${ID}/back?reward=t1` },
    });
    expect(signIn('/u/ayşe')).toEqual({ pathname: '/sign-in', params: { returnTo: '/u/ay%C5%9Fe' } });
    for (const refused of ['//evil.test/x', '/\\evil.test', 'https://evil.test', '/az/register', '/sign-in?next=/settings', '/az/admin', `/projects/${ID}`]) {
      expect(signIn(refused), refused).toEqual({ pathname: '/sign-in' });
    }
  });

  it('writes a destination back as one href', () => {
    expect(hrefOf({ pathname: '/categories/[category]', params: { category: 'a b', x: '1' } })).toBe(
      '/categories/a%20b?x=1',
    );
  });

  it('strips exactly one leading locale', () => {
    expect(stripLocale('/az')).toBe('/');
    expect(stripLocale('/az/en/discover')).toBe('/en/discover');
    expect(stripLocale('/azerbaijan')).toBe('/azerbaijan');
  });
});

describe('the association’s components', () => {
  const components = appleComponents();

  it('lists every exclude before the first claim', () => {
    const firstClaim = components.findIndex((component) => component.exclude !== true);
    const lastExclude = components.map((component) => component.exclude === true).lastIndexOf(true);
    expect(firstClaim).toBeGreaterThan(lastExclude);
    for (const path of EXCLUDED_PATHS) {
      expect(components.some((component) => component.exclude === true && component['/'] === path)).toBe(true);
    }
  });

  it('claims every path bare and under each locale', () => {
    const claimed = components.filter((component) => component.exclude !== true).map((component) => component['/']);
    for (const route of CLAIMED_ROUTES) {
      for (const path of route.paths) {
        expect(claimed).toContain(path);
        for (const locale of LOCALES) expect(claimed).toContain(path === '/' ? `/${locale}` : `/${locale}${path}`);
      }
    }
  });

  it('claims nothing under /admin', () => {
    const claimed = claimedPatterns();
    for (const path of ['/admin', '/admin/users', ...LOCALES.map((locale) => `/${locale}/admin/users`)]) {
      expect(claimed.some((pattern) => matchesPattern(pattern, path)), path).toBe(false);
    }
  });
});

describe('the Android intent filter', () => {
  const data = androidIntentData(HOST);

  it('is an allowlist of exact paths and prefixes, none of them a wildcard or the console', () => {
    for (const entry of data) {
      expect(entry.scheme).toBe('https');
      expect(entry.host).toBe(HOST);
      const value = 'path' in entry ? entry.path : entry.pathPrefix;
      expect(value).not.toContain('*');
      if ('pathPrefix' in entry) expect(coversAdmin(entry.pathPrefix), entry.pathPrefix).toBe(false);
    }
  });

  it('claims the site root and each locale root as exact paths', () => {
    const paths = data.flatMap((entry) => ('path' in entry ? [entry.path] : []));
    expect(paths).toEqual(expect.arrayContaining(['/', ...LOCALES.map((locale) => `/${locale}`)]));
  });

  it('claims the bare origin too, whose path Android reads as empty rather than as /', () => {
    // `Uri.parse('https://ideanest.az').getPath()` is "", and a literal `path` matches exactly.
    const exact = data.filter((entry) => 'path' in entry).map((entry) => ('path' in entry ? entry.path : ''));
    expect(exact).toContain('');
    expect(exact.filter((path) => path === '')).toHaveLength(1);
    // Only the bare root: a locale root is never written without its segment.
    expect(data.filter((entry) => 'pathPrefix' in entry && entry.pathPrefix === '')).toEqual([]);
    expect(intentDrift(data, HOST).admin).toEqual([]);
  });

  it('covers every sample link, bare and prefixed', () => {
    for (const samples of Object.values(SAMPLES)) {
      for (const [link] of samples) {
        for (const url of formsOf(link).filter((form) => form.startsWith('https:'))) {
          const path = new URL(url).pathname;
          const covered = data.some((entry) => ('path' in entry ? entry.path === path : path.startsWith(entry.pathPrefix)));
          expect(covered, path).toBe(true);
        }
      }
    }
  });

  it('knows a prefix that would reach the console', () => {
    expect(coversAdmin('/')).toBe(true);
    expect(coversAdmin('/az/')).toBe(true);
    expect(coversAdmin('/ad')).toBe(true);
    expect(coversAdmin('/projects/')).toBe(false);
  });
});

describe('intentDrift', () => {
  const data = androidIntentData(HOST);

  it('finds nothing when the filter is the table', () => {
    expect(intentDrift(data, HOST)).toEqual({ missing: [], extra: [], admin: [] });
  });

  it('names a prefix the filter lost, and one added by hand', () => {
    const lost = data.filter((entry) => !('pathPrefix' in entry && entry.pathPrefix === '/az/settings/'));
    expect(intentDrift(lost, HOST).missing).toEqual(['pathPrefix /az/settings/']);

    const added = [...data, { scheme: 'https', host: HOST, pathPrefix: '/az/' }];
    expect(intentDrift(added, HOST)).toEqual({ missing: [], extra: ['pathPrefix /az/'], admin: ['pathPrefix /az/'] });
  });

  it('treats an entry with no path as claiming everything, the console included', () => {
    expect(intentDrift([...data, { scheme: 'https', host: HOST }], HOST).admin).toEqual(['every path']);
  });

  it('ignores another scheme or host, which are not this table’s', () => {
    expect(intentDrift([...data, { scheme: 'ideanest' }, { scheme: 'https', host: 'other.az', path: '/x' }], HOST)).toEqual(
      { missing: [], extra: [], admin: [] },
    );
  });
});
