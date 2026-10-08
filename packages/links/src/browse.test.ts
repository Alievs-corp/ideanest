import { describe, expect, it } from 'vitest';
import { destinationFor } from './destination';

/**
 * The browse pages' deep links — issue #154. A category, a subcategory or a collection shared
 * from the web opens the same page in the app: under the web's path, with or without a locale,
 * from a universal link or the custom scheme, each slug decoded exactly once.
 */

const HOST = 'ideanest.az';

describe('destinationFor, the browse pages (#154)', () => {
  it('opens both indexes', () => {
    expect(destinationFor('https://ideanest.az/categories', HOST)).toEqual({ pathname: '/categories' });
    expect(destinationFor('https://ideanest.az/az/collections/', HOST)).toEqual({
      pathname: '/collections',
    });
    expect(destinationFor('ideanest://categories', HOST)).toEqual({ pathname: '/categories' });
  });

  it('opens a category, a subcategory and a collection with their slugs as params', () => {
    expect(destinationFor('https://ideanest.az/en/categories/games', HOST)).toEqual({
      pathname: '/categories/[category]',
      params: { category: 'games' },
    });
    expect(destinationFor('https://ideanest.az/categories/games/tabletop/', HOST)).toEqual({
      pathname: '/categories/[category]/[subcategory]',
      params: { category: 'games', subcategory: 'tabletop' },
    });
    expect(destinationFor('ideanest://collections/spring-picks', HOST)).toEqual({
      pathname: '/collections/[slug]',
      params: { slug: 'spring-picks' },
    });
  });

  it('decodes each segment exactly once', () => {
    expect(destinationFor('https://ideanest.az/categories/s%C9%99n%C9%99t/el%20i%C5%9Fi', HOST)).toEqual({
      pathname: '/categories/[category]/[subcategory]',
      params: { category: 'sənət', subcategory: 'el işi' },
    });
    // `%2541` is `%41` after one decode, and must stay that — a second decode would make it `A`.
    expect(destinationFor('https://ideanest.az/collections/a%2541', HOST)).toEqual({
      pathname: '/collections/[slug]',
      params: { slug: 'a%41' },
    });
  });

  it('refuses a segment that decodes to a slash, or does not decode at all', () => {
    expect(destinationFor('https://ideanest.az/categories/a%2Fb', HOST)).toBeNull();
    expect(destinationFor('https://ideanest.az/collections/%zz', HOST)).toBeNull();
  });

  it('claims nothing deeper than a subcategory or a collection', () => {
    expect(destinationFor('https://ideanest.az/categories/a/b/c', HOST)).toBeNull();
    expect(destinationFor('https://ideanest.az/collections/spring/extra', HOST)).toBeNull();
  });

  it('still refuses a foreign host, and plain http', () => {
    expect(destinationFor('https://evil-ideanest.az/categories/games', HOST)).toBeNull();
    expect(destinationFor('http://ideanest.az/collections/spring', HOST)).toBeNull();
  });
});
