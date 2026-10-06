import { completionOf, joinedMonth, knownTotal, socialPlatformLabel } from './format';
import { isHttps, readProjectCardPage, readPublicProfile, type ProfileProjectCard } from './wire';

/** The profile's rules (#156): known totals, the decimal percent, platform names, the join month. */

const card = (id: string): ProfileProjectCard => ({
  id,
  title: id,
  slug: id,
  creatorSlug: 'aysel',
  blurb: null,
  state: 'LIVE',
  goal: null,
  pledged: null,
  backersCount: 0,
  coverUrl: null,
});

describe('knownTotal', () => {
  it('counts a first page only when it has no next cursor', () => {
    expect(knownTotal({ items: [card('a'), card('b')], nextCursor: null })).toBe(2);
    expect(knownTotal({ items: [], nextCursor: null })).toBe(0);
  });

  it('has no count for a paged list, or for a list that has not arrived or failed', () => {
    expect(knownTotal({ items: [card('a'), card('b')], nextCursor: 'c2' })).toBeUndefined();
    expect(knownTotal(undefined)).toBeUndefined();
  });
});

describe('completionOf', () => {
  it('divides in decimal: 795.00 of 1000.00 is 80% (79.5 rounded half up)', () => {
    expect(completionOf('1000.00', '795.00')?.toFixed(0)).toBe('80');
    expect(completionOf('3.00', '1.00')?.toFixed(2)).toBe('33.33');
  });

  it('has no figure for a goal of zero or less, or a malformed one', () => {
    expect(completionOf('0.00', '10.00')).toBeNull();
    expect(completionOf('-5', '10.00')).toBeNull();
    expect(completionOf('abc', '10.00')).toBeNull();
    expect(completionOf('100.00', 'x')).toBeNull();
  });
});

describe('socialPlatformLabel', () => {
  it('names the nine platforms and prints an unknown one raw', () => {
    expect(socialPlatformLabel('GITHUB')).toBe('GitHub');
    expect(socialPlatformLabel('X')).toBe('X');
    expect(socialPlatformLabel('MASTODON')).toBe('MASTODON');
    expect(socialPlatformLabel('toString')).toBe('toString');
  });
});

describe('joinedMonth', () => {
  it('is the long month and the year, in the app language', () => {
    expect(joinedMonth('2025-03-14T10:00:00Z', 'en')).toBe('March 2025');
    expect(joinedMonth('2025-03-14T10:00:00Z', 'ru')).toMatch(/2025/);
  });

  it('is nothing for an absent or unparseable instant', () => {
    expect(joinedMonth(null, 'en')).toBeNull();
    expect(joinedMonth('not a date', 'en')).toBeNull();
  });
});

describe('the wire', () => {
  it('reads a profile, and refuses one with no slug or name', () => {
    expect(readPublicProfile({ slug: 'aysel', name: 'Aysel', socialLinks: null })).toMatchObject({
      slug: 'aysel',
      bio: null,
      socialLinks: [],
    });
    expect(readPublicProfile({ name: 'Aysel' })).toBeNull();
    expect(readPublicProfile('nope')).toBeNull();
  });

  it('drops a card that cannot be linked and keeps amounts as strings', () => {
    const page = readProjectCardPage({
      projects: [
        { id: '1', title: 'A', slug: 'a', creatorSlug: 'c', state: 'LIVE', goal: { amount: '10.00', currency: 'AZN' } },
        { id: '2', title: 'B', slug: 'b', state: 'LIVE' },
      ],
      nextCursor: '',
    });
    expect(page.items.map((item) => item.id)).toEqual(['1']);
    expect(page.items[0]?.goal).toEqual({ amount: '10.00', currency: 'AZN' });
    expect(page.nextCursor).toBeNull();
  });

  it('opens https only', () => {
    expect(isHttps('https://example.com/me')).toBe(true);
    expect(isHttps('http://example.com')).toBe(false);
    expect(isHttps('javascript:alert(1)')).toBe(false);
  });
});
