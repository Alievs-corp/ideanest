import { describe, expect, it } from 'vitest';
import { ACCENT_NAMES, campaignAccent, categoryLook, hashAccent } from './category-look';

const SEEDED_ORDER = [
  'technology',
  'design',
  'games',
  'art',
  'music',
  'film',
  'publishing',
  'food',
  'fashion',
  'photography',
  'comics',
  'crafts',
  'dance',
  'journalism',
  'theatre',
];

describe('categoryLook', () => {
  it('gives every seeded category its own icon', () => {
    const icons = SEEDED_ORDER.map((slug) => categoryLook(slug).icon);
    expect(new Set(icons).size).toBe(SEEDED_ORDER.length);
    expect(icons).not.toContain('other');
  });

  it.each([2, 4, 5])('never puts one accent beside itself in a %i-column grid', (columns) => {
    const accents = SEEDED_ORDER.map((slug) => categoryLook(slug).accent);
    accents.forEach((accent, index) => {
      const right = index % columns === columns - 1 ? undefined : accents[index + 1];
      const below = accents[index + columns];
      expect(right, `${SEEDED_ORDER[index]} and its right neighbour`).not.toBe(accent);
      expect(below, `${SEEDED_ORDER[index]} and the one below`).not.toBe(accent);
    });
  });

  it('hashes a category it does not know, the same way every time', () => {
    const look = categoryLook('ceramics');
    expect(look.icon).toBe('other');
    expect(ACCENT_NAMES).toContain(look.accent);
    expect(categoryLook('ceramics')).toEqual(look);
  });

  it('does not read inherited keys as categories', () => {
    expect(categoryLook('constructor').icon).toBe('other');
    expect(categoryLook('toString').icon).toBe('other');
  });
});

describe('campaignAccent', () => {
  it('takes the category accent when the card has a category', () => {
    expect(campaignAccent({ id: 'a', categorySlug: 'games' })).toBe('mint');
    expect(campaignAccent({ id: 'b', categorySlug: 'games' })).toBe('mint');
  });

  it('falls back to a hash of the campaign when there is no category', () => {
    expect(campaignAccent({ id: 'abc' })).toBe(hashAccent('abc'));
    expect(campaignAccent({ id: 'abc', categorySlug: null })).toBe(hashAccent('abc'));
    expect(campaignAccent({ slug: 'only-a-slug', categorySlug: '' })).toBe(hashAccent('only-a-slug'));
  });
});
