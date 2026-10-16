import { describe, expect, it } from 'vitest';
import {
  handleProblem,
  nextSortOrder,
  placementChanges,
  type AdminCollection,
} from './curation';

function collection(slug: string, sortOrder: number): AdminCollection {
  return { id: slug, slug, kind: 'themed', copy: { az: { title: slug } }, grantsBadge: false, sortOrder };
}

describe('handleProblem', () => {
  it('accepts the shape V14 checks', () => {
    expect(handleProblem('autumn-picks')).toBeNull();
    expect(handleProblem('q4')).toBeNull();
  });

  it('names what is wrong', () => {
    expect(handleProblem('a')).toBe('length');
    expect(handleProblem('Autumn')).toBe('shape');
    expect(handleProblem('-autumn')).toBe('shape');
    expect(handleProblem('autumn--picks')).toBe('shape');
  });

  it('refuses the three handles the console’s own screens already use', () => {
    expect(handleProblem('badges')).toBe('reserved');
    expect(handleProblem('open-calls')).toBe('reserved');
    expect(handleProblem('placements')).toBe('reserved');
  });
});

describe('nextSortOrder', () => {
  it('puts a new collection after every existing one', () => {
    expect(nextSortOrder([])).toBe(10);
    expect(nextSortOrder([collection('a', 0), collection('b', 40)])).toBe(50);
  });
});

describe('placementChanges', () => {
  it('swaps two numbers when the list is already strictly ordered', () => {
    const list = [collection('a', 10), collection('b', 20), collection('c', 30)];

    expect(placementChanges(list, 1, 1).map((c) => [c.collection.slug, c.sortOrder])).toEqual([
      ['b', 30],
      ['c', 20],
    ]);
  });

  it('renumbers when numbers are shared, because swapping equal numbers changes nothing', () => {
    const list = [collection('a', 0), collection('b', 0), collection('c', 10)];

    expect(placementChanges(list, 0, 1).map((c) => [c.collection.slug, c.sortOrder])).toEqual([
      ['b', 10],
      ['a', 20],
      ['c', 30],
    ]);
  });

  it('sends nothing for a move off either end', () => {
    const list = [collection('a', 10), collection('b', 20)];

    expect(placementChanges(list, 0, -1)).toEqual([]);
    expect(placementChanges(list, 1, 1)).toEqual([]);
  });
});
