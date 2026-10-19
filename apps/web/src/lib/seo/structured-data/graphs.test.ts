import { describe, expect, it } from 'vitest';

import type { PublicProjectPreview } from '../metadata';
import type { JsonLdNode } from './document';
import type { PublicRewardTier } from './product';
import {
  categoryPageGraph,
  discoverPageGraph,
  homePageGraph,
  projectPageGraph,
  sitePageGraph,
} from './graphs';

const env = { IDEANEST_SITE_URL: 'https://ideanest.az' } as const;

/** The English catalogue's words. `trail-copy.test.ts` is what checks they are the real ones. */
const trailCopy = {
  home: 'Home',
  discover: 'Discover',
  categories: 'Categories',
  collections: 'Collections',
} as const;

/** What every builder needs to name a page in its own language — #123. */
const context = { locale: 'en', trailCopy, env } as const;
const now = new Date('2026-08-18T09:00:00Z');
const path = '/projects/ayan/studio';

function types(nodes: readonly JsonLdNode[]): readonly (string | undefined)[] {
  return nodes.map((node) => node['@type'] as string | undefined);
}

function preview(overrides: Partial<PublicProjectPreview> = {}): PublicProjectPreview {
  return {
    id: 'ffa5a1e2-0000-7000-8000-000000000000',
    slug: 'studio',
    state: 'LIVE',
    title: 'A ceramics studio',
    blurb: 'Wheel-thrown tableware from a workshop in Quba.',
    coverImage: null,
    ...overrides,
  };
}

const tier: PublicRewardTier = {
  id: 'reward-1',
  title: 'The boxed set',
  description: null,
  price: { amount: '85.00', currency: 'AZN' },
  remainingQuantity: null,
  imageUrl: null,
};

describe('homePageGraph', () => {
  it('carries the site identity, because the home page is the entry page', () => {
    expect(types(homePageGraph(context))).toEqual(['Organization', 'WebSite']);
  });

  it('claims no trail, because a single-item one says "you got here from here"', () => {
    expect(types(homePageGraph(context))).not.toContain('BreadcrumbList');
  });
});

describe('discoverPageGraph', () => {
  /*
   * The identity nodes MOVED to `/` when #264 built it. Two `Organization` nodes for one
   * organisation across a crawl is what `identity.ts` argues against, and it named this page
   * as a stand-in only while there was no route at the origin.
   */
  it('carries the trail and no longer the site identity', () => {
    expect(types(discoverPageGraph(context))).toEqual(['BreadcrumbList']);
  });
});

describe('sitePageGraph', () => {
  it("is a two-step trail from home to the page, in the page's own words", () => {
    const nodes = sitePageGraph({ ...context, crumb: { name: 'Plans and pricing', path: '/pricing' } });

    expect(types(nodes)).toEqual(['BreadcrumbList']);
    expect(nodes[0]?.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://ideanest.az/en' },
      { '@type': 'ListItem', position: 2, name: 'Plans and pricing', item: 'https://ideanest.az/en/pricing' },
    ]);
  });

  it('claims nothing when the page has no name to give the step', () => {
    expect(sitePageGraph({ ...context, crumb: { name: ' ', path: '/about' } })).toEqual([]);
  });
});

describe('categoryPageGraph', () => {
  it('is a trail through the categories index and nothing else', () => {
    const [breadcrumb] = categoryPageGraph({
      trail: [{ name: 'Games', path: '/categories/games' }],
      ...context,
    });

    expect(breadcrumb?.['@type']).toBe('BreadcrumbList');
    expect(names(breadcrumb)).toEqual(['Home', 'Categories', 'Games']);
  });

  it('carries the parent category on a subcategory page', () => {
    const [breadcrumb] = categoryPageGraph({
      trail: [
        { name: 'Games', path: '/categories/games' },
        { name: 'Tabletop', path: '/categories/games/tabletop' },
      ],
      ...context,
    });

    expect(names(breadcrumb)).toEqual(['Home', 'Categories', 'Games', 'Tabletop']);
  });

  it('is still a trail on the index itself, where there is nothing below Categories', () => {
    const [breadcrumb] = categoryPageGraph({ trail: [], ...context });

    expect(names(breadcrumb)).toEqual(['Home', 'Categories']);
  });
});

/** The `name` of every step of a `BreadcrumbList`, in order. */
function names(node: JsonLdNode | undefined): readonly unknown[] {
  const items = (node?.['itemListElement'] ?? []) as readonly Record<string, unknown>[];
  return items.map((item) => item['name']);
}

describe('projectPageGraph', () => {
  function graph(overrides: Partial<Parameters<typeof projectPageGraph>[0]> = {}) {
    return projectPageGraph({
      preview: preview(),
      path,
      deadline: '2026-09-08T20:59:59Z',
      tiers: [tier],
      faqs: [{ question: 'When does it ship?', answer: 'March 2027.' }],
      now,
      ...context,
      ...overrides,
    });
  }

  it('states the trail, then every tier, then the questions', () => {
    expect(types(graph())).toEqual(['BreadcrumbList', 'Product', 'FAQPage']);
  });

  it('walks home, the feed, and the campaign itself', () => {
    const [breadcrumb] = graph();
    const items = (breadcrumb?.['itemListElement'] ?? []) as readonly { name: string }[];

    expect(items.map((item) => item.name)).toEqual(['Home', 'Discover', 'A ceramics studio']);
  });

  it('anchors every tier to the campaign the page is about', () => {
    const [, product] = graph();
    expect(product?.['@id']).toBe('https://ideanest.az/projects/ayan/studio#reward-reward-1');
  });

  it('says nothing at all about a campaign it could not confirm is public', () => {
    expect(graph({ preview: null })).toEqual([]);
    expect(graph({ preview: preview({ state: 'DRAFT' }) })).toEqual([]);
    expect(graph({ preview: preview({ state: 'SUBMITTED' }) })).toEqual([]);
  });

  it('still walks the trail for a campaign with no tiers and no questions', () => {
    expect(types(graph({ tiers: [], faqs: [] }))).toEqual(['BreadcrumbList']);
  });

  it('makes no offer on a campaign that is public but not taking pledges', () => {
    expect(types(graph({ preview: preview({ state: 'SUCCESSFUL' }) }))).toEqual([
      'BreadcrumbList',
      'FAQPage',
    ]);
  });
});
