import { destinationFor } from './links';

const HOST = 'ideanest.az';

describe('account links (#159)', () => {
  it('opens the Me tab from /account, with or without a locale', () => {
    expect(destinationFor('https://ideanest.az/account', HOST)).toEqual({ pathname: '/me' });
    expect(destinationFor('https://ideanest.az/tr/account/', HOST)).toEqual({ pathname: '/me' });
    expect(destinationFor('ideanest://account', HOST)).toEqual({ pathname: '/me' });
  });

  it('opens the Me hub’s Saved screen from /account/saved', () => {
    expect(destinationFor('https://ideanest.az/account/saved', HOST)).toEqual({ pathname: '/saved' });
    expect(destinationFor('https://ideanest.az/ru/account/saved/', HOST)).toEqual({ pathname: '/saved' });
  });

  it.each(['campaigns', 'deliveries', 'following', 'surveys'])('opens /account/%s', (section) => {
    expect(destinationFor(`https://ideanest.az/account/${section}`, HOST)).toEqual({
      pathname: `/account/${section}`,
    });
    expect(destinationFor(`https://ideanest.az/en/account/${section}?utm_source=mail`, HOST)).toEqual({
      pathname: `/account/${section}`,
    });
    expect(destinationFor(`ideanest://account/${section}`, HOST)).toEqual({
      pathname: `/account/${section}`,
    });
  });

  it('maps /az/account/surveys to /account/surveys', () => {
    expect(destinationFor('https://ideanest.az/az/account/surveys', HOST)).toEqual({
      pathname: '/account/surveys',
    });
  });

  it('refuses a section neither platform has, and anything deeper', () => {
    expect(destinationFor('https://ideanest.az/account/x', HOST)).toBeNull();
    expect(destinationFor('https://ideanest.az/account/billing', HOST)).toBeNull();
    expect(destinationFor('https://ideanest.az/account/surveys/extra', HOST)).toBeNull();
    expect(destinationFor('https://ideanest.az/accounts', HOST)).toBeNull();
    expect(destinationFor('https://evil.example/account/surveys', HOST)).toBeNull();
  });
});

describe('profile links (#156)', () => {
  it('opens a profile by its slug, with or without a locale', () => {
    expect(destinationFor('https://ideanest.az/u/aysel', HOST)).toEqual({
      pathname: '/u/[slug]',
      params: { slug: 'aysel' },
    });
    expect(destinationFor('https://ideanest.az/az/u/aysel/', HOST)).toEqual({
      pathname: '/u/[slug]',
      params: { slug: 'aysel' },
    });
    expect(destinationFor('ideanest://u/aysel', HOST)).toEqual({
      pathname: '/u/[slug]',
      params: { slug: 'aysel' },
    });
  });

  it('decodes the slug once', () => {
    expect(destinationFor('https://ideanest.az/u/ay%20sel', HOST)).toEqual({
      pathname: '/u/[slug]',
      params: { slug: 'ay sel' },
    });
    // %2541 is `%41` after one decode, and stays that way.
    expect(destinationFor('https://ideanest.az/u/%2541', HOST)).toEqual({
      pathname: '/u/[slug]',
      params: { slug: '%41' },
    });
  });

  it('refuses an empty slug, a deeper path, an encoded slash and a malformed escape', () => {
    expect(destinationFor('https://ideanest.az/u/', HOST)).toBeNull();
    expect(destinationFor('https://ideanest.az/u', HOST)).toBeNull();
    expect(destinationFor('https://ideanest.az/u/a/b', HOST)).toBeNull();
    expect(destinationFor('https://ideanest.az/u/a%2Fb', HOST)).toBeNull();
    expect(destinationFor('https://ideanest.az/u/%zz', HOST)).toBeNull();
  });
});
