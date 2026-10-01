import { describe, expect, it } from 'vitest';
import {
  categoryPath,
  findCategory,
  findSubcategory,
  subcategoryPath,
  taxonomyFrom,
  type Category,
} from './taxonomy';

/**
 * The taxonomy both clients read (#154): the slug a landing page resolves, the parent a
 * subcategory is looked up under, and the address a link opens.
 */

const TREE: readonly Category[] = [
  {
    id: 'c1',
    slug: 'games',
    name: 'Games',
    subcategories: [{ id: 's1', slug: 'tabletop', name: 'Tabletop' }],
  },
  {
    id: 'c2',
    slug: 'crafts',
    name: 'Crafts',
    subcategories: [{ id: 's2', slug: 'prints', name: 'Prints' }],
  },
];

describe('taxonomyFrom', () => {
  it('fills a missing name with the slug, and absent lists with empty ones', () => {
    expect(taxonomyFrom([{ id: 'c', slug: 'film', subcategories: [{ slug: 'shorts' }] }, {}])).toEqual([
      { id: 'c', slug: 'film', name: 'film', subcategories: [{ id: '', slug: 'shorts', name: 'shorts' }] },
      { id: '', slug: '', name: '', subcategories: [] },
    ]);
  });
});

describe('the browse paths', () => {
  it('encodes each slug once', () => {
    expect(categoryPath('games')).toBe('/categories/games');
    expect(subcategoryPath('games', 'a/b')).toBe('/categories/games/a%2Fb');
  });
});

describe('findCategory and findSubcategory', () => {
  it('match without regard to case, as the service does', () => {
    expect(findCategory(TREE, 'GAMES')?.name).toBe('Games');
    expect(findCategory(TREE, 'gmaes')).toBeNull();
  });

  it('look a subcategory up inside its own parent only', () => {
    const games = findCategory(TREE, 'games')!;
    expect(findSubcategory(games, 'Tabletop')?.name).toBe('Tabletop');
    // `prints` exists, under Crafts — so under Games it names nothing.
    expect(findSubcategory(games, 'prints')).toBeNull();
  });
});
