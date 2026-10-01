import { destinationFor } from './links';

const HOST = 'ideanest.az';
const ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('id-keyed campaign routes', () => {
  it.each([
    [`https://ideanest.az/az/projects/new`, '/campaigns/new'],
    [`https://ideanest.az/projects/${ID}/back`, `/campaigns/${ID}/back`],
    [`https://ideanest.az/ru/projects/${ID}/edit/story`, `/campaigns/${ID}/edit/story`],
    [`https://ideanest.az/projects/${ID}/dashboard`, `/campaigns/${ID}/dashboard`],
    [`https://ideanest.az/projects/${ID}/dashboard/finance`, `/campaigns/${ID}/dashboard/finance`],
    [`ideanest://projects/${ID}/prelaunch`, `/campaigns/${ID}/prelaunch`],
  ])('maps %s', (url, pathname) => {
    expect(destinationFor(url, HOST)).toEqual({ pathname });
  });

  it('opens the campaign page, not the checkout, for a slug that is not a UUID', () => {
    expect(destinationFor('https://ideanest.az/projects/alice/back', HOST)).toEqual({
      pathname: '/projects/alice/back',
    });
  });

  it('strips a locale prefix from a campaign link', () => {
    expect(destinationFor('https://ideanest.az/tr/projects/aysel/solar-lamp', HOST)).toEqual({
      pathname: '/projects/aysel/solar-lamp',
    });
  });
});

describe('the pre-launch page and the checkout, by id (#155)', () => {
  it('opens the pre-launch screen from a locale-prefixed web link', () => {
    // The web serves every page under a locale, so this is the URL people actually share.
    for (const locale of ['az', 'en', 'ru', 'tr']) {
      expect(destinationFor(`https://ideanest.az/${locale}/projects/${ID}/prelaunch`, HOST)).toEqual(
        { pathname: `/campaigns/${ID}/prelaunch` },
      );
    }
    expect(destinationFor(`https://ideanest.az/projects/${ID}/prelaunch/`, HOST)).toEqual({
      pathname: `/campaigns/${ID}/prelaunch`,
    });
  });

  it('drops the query on the pre-launch page, which reads none', () => {
    expect(
      destinationFor(`https://ideanest.az/az/projects/${ID}/prelaunch?utm_source=x`, HOST),
    ).toEqual({ pathname: `/campaigns/${ID}/prelaunch` });
  });

  it('keeps the chosen reward on a checkout link, and nothing else', () => {
    expect(
      destinationFor(`https://ideanest.az/projects/${ID}/back?reward=t1&utm_source=x`, HOST),
    ).toEqual({ pathname: `/campaigns/${ID}/back`, params: { reward: 't1' } });
    expect(destinationFor(`ideanest://projects/${ID}/back?reward=t1`, HOST)).toEqual({
      pathname: `/campaigns/${ID}/back`,
      params: { reward: 't1' },
    });
    // An empty or absurdly long reward is no reward: the checkout opens on its picker.
    expect(destinationFor(`https://ideanest.az/projects/${ID}/back?reward=%20`, HOST)).toEqual({
      pathname: `/campaigns/${ID}/back`,
    });
    expect(
      destinationFor(`https://ideanest.az/projects/${ID}/back?reward=${'x'.repeat(129)}`, HOST),
    ).toEqual({ pathname: `/campaigns/${ID}/back` });
  });

  it('tries the id forms before the creator/slug pattern', () => {
    // `/projects/<uuid>/prelaunch` also fits `/projects/{creatorSlug}/{projectSlug}`; the id form
    // must win, or a pre-launch link would open a campaign page for a creator named by a UUID.
    expect(destinationFor(`https://ideanest.az/projects/${ID}/prelaunch`, HOST)?.pathname).toBe(
      `/campaigns/${ID}/prelaunch`,
    );
    expect(destinationFor(`https://ideanest.az/projects/${ID}/back`, HOST)?.pathname).toBe(
      `/campaigns/${ID}/back`,
    );
  });

  it('opens the campaign slugged "prelaunch" for a first segment that is not an id', () => {
    /*
     * PINNED, and different from the web on purpose. On the web the static `prelaunch` segment
     * wins over `[projectSlug]`, so this URL renders the pre-launch page for a project "id" of
     * `alice` (a 404) and a campaign slugged `prelaunch` is unreachable there (#148). The app's
     * own share sheet builds exactly this URL for that campaign, so the app opens the campaign.
     */
    expect(destinationFor('https://ideanest.az/az/projects/alice/prelaunch', HOST)).toEqual({
      pathname: '/projects/alice/prelaunch',
    });
  });
});

describe('the campaign page keeps its own query (#155)', () => {
  it('keeps the tab and the thread', () => {
    expect(destinationFor('https://ideanest.az/projects/a/b?tab=comments&thread=c1', HOST)).toEqual({
      pathname: '/projects/a/b',
      params: { tab: 'comments', thread: 'c1' },
    });
    expect(destinationFor('ideanest://projects/a/b?tab=updates', HOST)).toEqual({
      pathname: '/projects/a/b',
      params: { tab: 'updates' },
    });
  });

  it('keeps nothing that is not the page’s own', () => {
    expect(destinationFor('https://ideanest.az/en/projects/a/b?utm_source=x&from=20', HOST)).toEqual(
      { pathname: '/projects/a/b' },
    );
  });

  it('reads the tab as the web does: the default and an unknown value are no tab at all', () => {
    for (const tab of ['campaign', 'nonsense', '']) {
      expect(destinationFor(`https://ideanest.az/projects/a/b?tab=${tab}`, HOST)).toEqual({
        pathname: '/projects/a/b',
      });
    }
    expect(destinationFor('https://ideanest.az/projects/a/b?tab=FAQ', HOST)).toEqual({
      pathname: '/projects/a/b',
      params: { tab: 'faq' },
    });
  });

  it('keeps a thread only on the Comments tab, where the web reads it', () => {
    expect(destinationFor('https://ideanest.az/projects/a/b?tab=updates&thread=c1', HOST)).toEqual({
      pathname: '/projects/a/b',
      params: { tab: 'updates' },
    });
    expect(destinationFor('https://ideanest.az/projects/a/b?thread=c1', HOST)).toEqual({
      pathname: '/projects/a/b',
    });
  });

  it('refuses a path deeper than a campaign', () => {
    expect(destinationFor('https://ideanest.az/projects/a/b/c', HOST)).toBeNull();
    expect(destinationFor('https://ideanest.az/projects/a/b/c?tab=comments', HOST)).toBeNull();
  });
});

describe('hostile links', () => {
  it('returns null for a malformed percent escape instead of throwing', () => {
    expect(destinationFor('https://ideanest.az/projects/a%zz/b', HOST)).toBeNull();
  });

  it('refuses an encoded slash in a slug', () => {
    expect(destinationFor('https://ideanest.az/projects/a%2Fb/c', HOST)).toBeNull();
  });

  it('opens the first edit step for a bare /edit', () => {
    expect(destinationFor(`https://ideanest.az/projects/${ID}/edit`, HOST)).toEqual({
      pathname: `/campaigns/${ID}/edit/basics`,
    });
  });
});
