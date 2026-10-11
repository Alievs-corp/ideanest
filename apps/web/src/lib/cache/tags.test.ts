import { describe, expect, it } from 'vitest';
import {
  COLLECTIONS,
  DISCOVERY,
  LEGAL,
  TAXONOMY,
  campaignAddress,
  collection,
  isCacheTag,
  profile,
  project,
  isCacheTag as recognises,
} from './tags';

/**
 * The cache tag vocabulary — issue #127.
 *
 * WHAT THESE COVER:
 *
 *   - **everything this module composes, it also recognises.** The two halves are read by
 *     different sides — the reads compose, the endpoint recognises — and a builder that
 *     produced a tag the guard rejected would be a page that silently never refreshes.
 *   - **the two shapes that would evict the whole cache are refused.** An empty identifier
 *     and a wildcard are what a caller with a bug produces, and the guard is the only thing
 *     between them and every cached render on the platform.
 *   - **a campaign address is two slugs and exactly two.** Neither is unique alone.
 */

describe('composing a tag', () => {
  it('recognises every tag it can build', () => {
    const built = [
      DISCOVERY,
      TAXONOMY,
      COLLECTIONS,
      LEGAL,
      project('0193f2a1-0000-7000-8000-000000000000'),
      campaignAddress('ayan', 'a-folding-bicycle'),
      collection('spring-2027'),
      profile('ayan'),
    ];

    for (const tag of built) {
      expect(recognises(tag), tag).toBe(true);
    }
  });

  it('keeps the two slugs of a campaign address apart', () => {
    expect(campaignAddress('ayan', 'studio')).toBe('campaign:ayan/studio');
    expect(isCacheTag('campaign:ayan')).toBe(false);
    expect(isCacheTag('campaign:ayan/studio/extra')).toBe(false);
    expect(isCacheTag('campaign:/studio')).toBe(false);
  });
});

describe('recognising a tag', () => {
  it('refuses the shapes that would evict everything', () => {
    for (const tag of ['', '*', ':', 'project:', 'project:*', ':everything']) {
      expect(isCacheTag(tag), JSON.stringify(tag)).toBe(false);
    }
  });

  it('refuses a kind it has never heard of', () => {
    expect(isCacheTag('pledge:7b1c')).toBe(false);
    expect(isCacheTag('everything')).toBe(false);
  });

  it('refuses an identifier that is a payload rather than a slug', () => {
    expect(isCacheTag(`project:${'a'.repeat(200)}`)).toBe(false);
    expect(isCacheTag('project:Ayan')).toBe(false);
    expect(isCacheTag('profile:ayan quliyeva')).toBe(false);
  });
});
