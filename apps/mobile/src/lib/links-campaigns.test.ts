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
