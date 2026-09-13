import { describe, expect, it } from 'vitest';
import { slugNames, type DiscoveryFacets } from './api';
import { blameFor } from './emptiness';
import { activeFilters, parseFilters } from './filters';
import { filterVocabularyCopyFrom } from '../i18n/feed-copy';
import { translatorFor } from '../../test-copy';
/*
 * The vocabularies the route resolves, built from `messages/en.json` by the same function it
 * calls — issue #324. The group names and the band labels are asserted below, so building them
 * from the catalogue is what makes this fail when a word is edited to something the feed no
 * longer draws.
 */
const VOCABULARY = filterVocabularyCopyFrom(translatorFor('discovery.filters'));

/**
 * "No results" is the least useful sentence an interface can produce: it is
 * indistinguishable from "the platform has nothing", and the reader's only move
 * is to undo choices at random. The panel already holds the answer.
 */

function facets(overrides: Partial<DiscoveryFacets> = {}): DiscoveryFacets {
  return {
    status: [
      { value: 'live', count: 3 },
      { value: 'upcoming', count: 0 },
      { value: 'extended', count: 0 },
      { value: 'successful', count: 1 },
    ],
    categories: [
      { slug: 'games', name: 'Games', count: 2, subcategories: [] },
      { slug: 'art', name: 'Art', count: 0, subcategories: [] },
    ],
    tags: [
      { slug: 'handmade', name: 'Handmade', count: 2 },
      { slug: 'ceramics', name: 'Ceramics', count: 1 },
    ],
    completion: [{ value: 'under_25', count: 1 }],
    goalAmount: [{ value: 'under_1000', count: 1 }],
    amountRaised: [{ value: 'under_1000', count: 1 }],
    ...overrides,
  };
}

/** The chips as the view builds them: names come from the panel, slugs do not. */
const active = (query: string) =>
  activeFilters(parseFilters(new URLSearchParams(query)), VOCABULARY, slugNames(facets()));

describe('blameFor', () => {
  it('names the one filter that counts zero under the others', () => {
    // A facet count excludes its own dimension and applies every other, so a
    // chosen value counting zero is exactly the value that is incompatible with
    // the rest of the choice.
    const blamed = blameFor(active('status=live&category=art'), facets());

    expect(blamed.map((f) => f.label)).toEqual(['Art']);
  });

  it('names several when several are individually impossible', () => {
    const blamed = blameFor(active('status=upcoming&category=art'), facets());

    expect(blamed.map((f) => f.label)).toEqual(['Upcoming', 'Art']);
  });

  it('names all of them when no single one is impossible', () => {
    // Tags are AND'd, so "handmade" and "ceramics" can each have campaigns
    // behind them while nothing carries both. Blaming one would be picking a
    // culprit at random and sending the reader to remove the wrong filter.
    const blamed = blameFor(active('tag=handmade,ceramics'), facets());

    expect(blamed.map((f) => f.label)).toEqual(['Handmade', 'Ceramics']);
  });

  it('treats a tag the panel does not list as counting zero', () => {
    // The tag facet lists only tags with campaigns behind them, because the
    // vocabulary is free and unbounded — so an absent tag genuinely counts zero.
    expect(blameFor(active('tag=nothing-carries-this'), facets()).map((f) => f.label)).toEqual([
      'nothing-carries-this',
    ]);
  });

  it('never blames a custom range on its own', () => {
    // A range has no facet: the bands are a fixed vocabulary and two typed
    // numbers are not. It cannot be counted, so it must not be singled out for
    // an emptiness it may have had nothing to do with.
    expect(blameFor(active('goalMin=1&goalMax=2&category=art'), facets()).map((f) => f.label)).toEqual(
      ['Art'],
    );
  });

  it('blames nothing when nothing is filtered', () => {
    // The other empty feed: the platform has nothing to show, and no amount of
    // removing filters will change that.
    expect(blameFor(active(''), facets())).toEqual([]);
  });

  it('blames every active filter when the panel has not loaded', () => {
    // Without counts there is no evidence, and guessing one would send the
    // reader to remove a filter that was not the problem.
    expect(blameFor(active('status=live&tag=handmade'), null)).toHaveLength(2);
  });
});
