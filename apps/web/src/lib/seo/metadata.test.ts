import { describe, expect, it } from 'vitest';
/*
 * NEXT'S OWN TITLE RESOLVER, not a second implementation of it.
 *
 * "The template is applied" is a claim about what the installed framework does
 * with what this module returns, and the only way to test that without asserting
 * a reimplementation of it is to call the resolver Next itself calls. It is an
 * internal path, so it is imported in exactly one place — here — and if a Next
 * upgrade moves it, this test fails loudly rather than quietly testing nothing.
 */
import { resolveTitle } from 'next/dist/lib/metadata/resolvers/resolve-title';
import type { ProjectState } from '../projects/api';
import {
  DESCRIPTION_MAX_LENGTH,
  PROJECT_STATES,
  SITE_NAME,
  SITE_OG_LOCALE,
  canonicalUrl,
  isPubliclyVisible,
  metadataBase,
  privatePageMetadata,
  projectPageMetadata,
  projectSocialDescription,
  publicPageMetadata,
  rootMetadata,
  siteOrigin,
  truncateAtWord,
} from './metadata';
import { SITE_URL_VARIABLE, siteUrl } from './sitemap/config';

const ORIGIN = 'https://ideanest.az';
const env = { IDEANEST_SITE_URL: ORIGIN };

/* -------------------------------------------------------------------------
 * The origin every absolute URL is built from
 * ---------------------------------------------------------------------- */

describe('siteOrigin', () => {
  it('falls back to the development origin when nothing is configured', () => {
    expect(siteOrigin({}).toString()).toBe('http://localhost:3000/');
  });

  it('reads the configured origin', () => {
    expect(siteOrigin(env).toString()).toBe('https://ideanest.az/');
  });

  it('keeps a configured base path, because the sitemap keeps it too', () => {
    /*
     * Not a preference. `siteUrl()` — which `robots.txt` and every sitemap URL
     * are built from — preserves the path, so stripping it here would make the
     * canonical for a page name a different URL than the sitemap entry for the
     * same page. A crawler resolves that by trusting the canonical and dropping
     * the sitemap entry.
     */
    expect(siteOrigin({ IDEANEST_SITE_URL: 'https://ideanest.az/az/?a=1' }).toString()).toBe(
      'https://ideanest.az/az/',
    );
  });

  it('reads the same variable the sitemap does, so the two cannot disagree', () => {
    expect(SITE_URL_VARIABLE).toBe('IDEANEST_SITE_URL');
    expect(siteOrigin({ [SITE_URL_VARIABLE]: ORIGIN }).toString()).toBe(`${siteUrl(env)}/`);
  });

  it('refuses a malformed origin rather than shipping wrong canonicals', () => {
    expect(() => siteOrigin({ IDEANEST_SITE_URL: 'ideanest.az' })).toThrow(/IDEANEST_SITE_URL/);
  });

  it('is what metadataBase resolves relative URLs against', () => {
    expect(metadataBase(env).toString()).toBe('https://ideanest.az/');
  });
});

/* -------------------------------------------------------------------------
 * Canonical URLs
 * ---------------------------------------------------------------------- */

describe('canonicalUrl', () => {
  it('is absolute', () => {
    expect(canonicalUrl('/discover', env)).toBe('https://ideanest.az/discover');
  });

  it('drops a query string, so no filter combination is its own canonical', () => {
    expect(canonicalUrl('/discover?q=ceramics&category=games&sort=ending_soon', env)).toBe(
      'https://ideanest.az/discover',
    );
  });

  it('drops tracking parameters', () => {
    expect(
      canonicalUrl('/discover?utm_source=newsletter&utm_medium=email&fbclid=abc&gclid=def', env),
    ).toBe('https://ideanest.az/discover');
  });

  it('drops pagination parameters', () => {
    /*
     * The feed's cursor is deliberately absent from the URL
     * (`lib/discovery/filters.ts`), so a `?cursor=` or `?page=` in one came from
     * a crawler's invention or somebody else's scroll. Either way it names the
     * same document.
     */
    expect(canonicalUrl('/discover?cursor=eyJhIjoxfQ&page=7&limit=48', env)).toBe(
      'https://ideanest.az/discover',
    );
  });

  it('drops a fragment', () => {
    expect(canonicalUrl('/discover#results', env)).toBe('https://ideanest.az/discover');
  });

  it('normalises a trailing slash away', () => {
    expect(canonicalUrl('/discover/', env)).toBe('https://ideanest.az/discover');
  });

  it('keeps the root as the root', () => {
    expect(canonicalUrl('/', env)).toBe('https://ideanest.az/');
  });

  it('accepts a path with no leading slash', () => {
    expect(canonicalUrl('discover', env)).toBe('https://ideanest.az/discover');
  });

  it('does not fold the case of an identifier', () => {
    // Project identifiers are opaque; lower-casing a path would canonicalise a
    // live campaign to an address that 404s.
    expect(canonicalUrl('/projects/AbC123/prelaunch', env)).toBe(
      'https://ideanest.az/projects/AbC123/prelaunch',
    );
  });

  it('cannot be talked into another origin by a path that looks absolute', () => {
    expect(canonicalUrl('//evil.example/discover', env)).toBe('https://ideanest.az/discover');
    expect(canonicalUrl('https://evil.example/discover', env)).toBe(
      'https://ideanest.az/discover',
    );
  });
});

/* -------------------------------------------------------------------------
 * The title template
 * ---------------------------------------------------------------------- */

/** The template the root layout stashes for its children to be composed with. */
function rootTitleTemplate(): string {
  const title = rootMetadata('en', env).title;
  if (title === null || title === undefined || typeof title === 'string' || !('template' in title)) {
    throw new Error('The root layout must export a title template.');
  }
  return title.template ?? '';
}

describe('the title template', () => {
  const page = publicPageMetadata({
    title: 'Discover',
    description: 'Browse and filter every campaign on IdeaNest.',
    path: '/discover',
    locale: 'en',
    env,
  });

  it('composes a page title with the site name', () => {
    expect(resolveTitle(page.title, rootTitleTemplate()).absolute).toBe(`Discover · ${SITE_NAME}`);
  });

  it('leaves the site name alone as the default title', () => {
    expect(resolveTitle(rootMetadata('en', env).title, null).absolute).toBe(SITE_NAME);
  });

  it('does not put the site name in the page title itself, so it is never doubled', () => {
    expect(page.title).toBe('Discover');
    // og:site_name already carries it, and "Discover · IdeaNest — IdeaNest" is
    // what setting it twice looks like in a shared link.
    expect(page.openGraph?.title).toBe('Discover');
    expect(page.twitter?.title).toBe('Discover');
  });
});

/* -------------------------------------------------------------------------
 * A public page
 * ---------------------------------------------------------------------- */

describe('publicPageMetadata', () => {
  const page = publicPageMetadata({
    title: 'Discover',
    description: 'Browse and filter every campaign on IdeaNest.',
    path: '/discover?utm_source=x',
    locale: 'en',
    env,
  });

  it('carries an absolute canonical with the noise stripped', () => {
    /* The canonical is this page in THIS language since #123, never the un-prefixed path. */
    expect(page.alternates?.canonical).toBe('https://ideanest.az/en/discover');
  });

  it('describes itself completely to Open Graph', () => {
    expect(page.openGraph).toMatchObject({
      type: 'website',
      siteName: SITE_NAME,
      locale: SITE_OG_LOCALE,
      url: 'https://ideanest.az/en/discover',
      title: 'Discover',
      description: 'Browse and filter every campaign on IdeaNest.',
    });
  });

  it('asks for a large summary card on X', () => {
    expect(page.twitter).toMatchObject({
      card: 'summary_large_image',
      title: 'Discover',
      description: 'Browse and filter every campaign on IdeaNest.',
    });
  });

  it('names no image, so the file-convention image applies', () => {
    /*
     * Next merges a file-based `opengraph-image` in only when the segment's own
     * metadata has no `images` OWN PROPERTY (`resolve-metadata.js` checks
     * `hasOwnProperty`). An explicit `images: undefined` is an own property and
     * would therefore suppress the generated card and leave the page with no
     * preview at all — which is why this asserts absence rather than undefined.
     */
    expect(Object.hasOwn(page.openGraph ?? {}, 'images')).toBe(false);
    expect(Object.hasOwn(page.twitter ?? {}, 'images')).toBe(false);
  });

  it('is indexable — it says nothing about robots at all', () => {
    expect(page.robots).toBeUndefined();
  });

  it('carries an explicit image when it is given one', () => {
    const withImage = publicPageMetadata({
      title: 'Kilim',
      description: 'A rug.',
      path: '/projects/1/prelaunch',
      locale: 'en',
      image: { url: 'https://cdn.example/cover.jpg', width: 1600, height: 900, alt: 'The cover' },
      env,
    });

    const image = { url: 'https://cdn.example/cover.jpg', width: 1600, height: 900, alt: 'The cover' };
    expect(withImage.openGraph?.images).toEqual([image]);
    expect(withImage.twitter?.images).toEqual([image]);
  });

  it('truncates a description that is too long for a search result', () => {
    const long = publicPageMetadata({
      title: 'Kilim',
      description: 'word '.repeat(80),
      path: '/x',
      locale: 'en',
      env,
    });

    expect((long.description ?? '').length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
  });
});

/* -------------------------------------------------------------------------
 * A private page
 * ---------------------------------------------------------------------- */

describe('privatePageMetadata', () => {
  const page = privatePageMetadata({ title: 'Back this campaign' });

  it('is neither indexed nor followed', () => {
    expect(page.robots).toEqual({ index: false, follow: false });
  });

  it('offers nothing to unfurl, and refuses what it would otherwise inherit', () => {
    /*
     * `null`, not undefined. Next inherits the root layout's resolved `openGraph`
     * into any page that does not overwrite it, so undefined here would leave a
     * checkout page advertising the site's own social card.
     */
    expect(page.openGraph).toBeNull();
    expect(page.twitter).toBeNull();
  });

  it('claims no canonical, because a page that must not be indexed consolidates nothing', () => {
    expect(page.alternates).toBeUndefined();
  });

  it('still has a title, because that is the browser tab and the window name', () => {
    expect(page.title).toBe('Back this campaign');
  });
});

/* -------------------------------------------------------------------------
 * Descriptions
 * ---------------------------------------------------------------------- */

describe('truncateAtWord', () => {
  it('leaves a short description exactly as it is', () => {
    expect(truncateAtWord('A handmade kilim from Quba.', 160)).toBe('A handmade kilim from Quba.');
  });

  it('collapses the whitespace a creator typed', () => {
    expect(truncateAtWord('Two   lines\nof   copy.', 160)).toBe('Two lines of copy.');
  });

  it('never returns more characters than it was allowed', () => {
    const long = 'Handwoven kilims from the villages around Quba, dyed with plants. '.repeat(6);
    expect(truncateAtWord(long, 160).length).toBeLessThanOrEqual(160);
  });

  it('cuts at a word boundary and says that it cut', () => {
    const text = 'Handwoven kilims from the villages around Quba, dyed with plants and wool.';
    const result = truncateAtWord(text, 40);

    expect(result).toBe('Handwoven kilims from the villages…');
    // The character after the last one kept is a space in the original: no half
    // word was published.
    expect(text.charAt(result.length - 1)).toBe(' ');
  });

  it('does not leave punctuation dangling in front of the ellipsis', () => {
    expect(truncateAtWord('Handwoven kilims from Quba, dyed with plants.', 30)).toBe(
      'Handwoven kilims from Quba…',
    );
  });

  it('cuts a single unbroken word rather than returning nothing', () => {
    expect(truncateAtWord('a'.repeat(200), 10)).toBe(`${'a'.repeat(9)}…`);
  });

  it('is empty for empty copy, rather than a lone ellipsis', () => {
    expect(truncateAtWord('   ', 160)).toBe('');
  });
});

describe('projectSocialDescription', () => {
  it('uses the summary the creator wrote', () => {
    expect(projectSocialDescription({ title: 'Kilim', blurb: 'A handmade rug from Quba.' })).toBe(
      'A handmade rug from Quba.',
    );
  });

  it('truncates that summary at a word boundary', () => {
    const blurb = 'Handwoven kilims from the villages around Quba, dyed with plants. '.repeat(6);
    const description = projectSocialDescription({ title: 'Kilim', blurb });

    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
    expect(description.endsWith('…')).toBe(true);
    expect(description).not.toMatch(/\s…$/);
  });

  it('says something true rather than nothing when there is no summary', () => {
    const description = projectSocialDescription({ title: 'Kilim', blurb: null });

    expect(description).toContain('Kilim');
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
  });

  it('treats a summary of only whitespace as no summary', () => {
    expect(projectSocialDescription({ title: 'Kilim', blurb: '   \n ' })).toContain('Kilim');
  });

  it('does not print an over-long title into the sentence unabridged', () => {
    const description = projectSocialDescription({ title: 'K'.repeat(300), blurb: null });
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
  });
});

/* -------------------------------------------------------------------------
 * Who may be seen — docs/architecture.md §6.1
 * ---------------------------------------------------------------------- */

describe('isPubliclyVisible', () => {
  /** Every state with a surface a visitor holding no session can reach. */
  const PUBLIC: readonly ProjectState[] = [
    'PRELAUNCH',
    'SCHEDULED',
    'LIVE',
    'CLOSING_WINDOW',
    'EXTENDED',
    'SUCCESSFUL',
    'UNSUCCESSFUL',
    'WITHDRAWN',
    'COLLECTING',
    'LATE_PLEDGE',
    'FULFILLING',
    'COMPLETED',
  ];

  const PRIVATE: readonly ProjectState[] = [
    'DRAFT',
    'SUBMITTED',
    'CHANGES_REQUESTED',
    'REJECTED',
    'APPROVED',
    'SUSPENDED',
    'CANCELED',
  ];

  it('covers every state of the machine and nothing else', () => {
    expect([...PUBLIC, ...PRIVATE].sort()).toEqual([...PROJECT_STATES].sort());
    expect(PROJECT_STATES).toHaveLength(19);
  });

  it.each(PUBLIC)('shows %s', (state) => {
    expect(isPubliclyVisible(state)).toBe(true);
  });

  it.each(PRIVATE)('hides %s', (state) => {
    expect(isPubliclyVisible(state)).toBe(false);
  });

  it('hides a state it has never heard of', () => {
    expect(isPubliclyVisible('ARCHIVED')).toBe(false);
    expect(isPubliclyVisible('')).toBe(false);
    // Not a state, and not inherited from Object either.
    expect(isPubliclyVisible('constructor')).toBe(false);
  });
});

/* -------------------------------------------------------------------------
 * A campaign's own page
 * ---------------------------------------------------------------------- */

describe('projectPageMetadata', () => {
  const path = '/projects/0193f2a1/prelaunch';

  it('leaks nothing about a campaign it could not confirm is public', () => {
    const page = projectPageMetadata(null, path, 'en', env);

    expect(page.robots).toEqual({ index: false, follow: false });
    expect(page.openGraph).toBeNull();
    expect(page.twitter).toBeNull();
    expect(page.alternates).toBeUndefined();
    expect(JSON.stringify(page)).not.toContain('0193f2a1');
  });

  it('refuses a campaign whose state is not public, even when handed its row', () => {
    /*
     * Defence in depth. The reader that produces a preview already refuses a
     * non-public state, and so does the endpoint behind it; this is the third
     * lock, and it is the one closest to the tag that would carry the leak.
     */
    const page = projectPageMetadata(
      {
        id: '0193f2a1',
        slug: 'secret-idea',
        state: 'DRAFT',
        title: 'Working title nobody may see',
        blurb: 'An unfinished summary.',
        coverImage: { url: 'https://cdn.example/draft.jpg', width: 1600, height: 900 },
      },
      path,
      'en',
      env,
    );
    const printed = JSON.stringify(page);

    expect(page.robots).toEqual({ index: false, follow: false });
    expect(printed).not.toContain('Working title nobody may see');
    expect(printed).not.toContain('An unfinished summary.');
    expect(printed).not.toContain('draft.jpg');
    expect(printed).not.toContain('secret-idea');
  });

  it('describes a public campaign fully', () => {
    const page = projectPageMetadata(
      {
        id: '0193f2a1',
        slug: 'quba-kilims',
        state: 'PRELAUNCH',
        title: 'Quba kilims',
        blurb: 'Handwoven rugs, dyed with plants.',
        coverImage: null,
      },
      path,
      'en',
      env,
    );

    expect(page.title).toBe('Quba kilims');
    expect(page.description).toBe('Handwoven rugs, dyed with plants.');
    expect(page.alternates?.canonical).toBe(`https://ideanest.az/en${path}`);
    expect(page.openGraph).toMatchObject({
      type: 'website',
      siteName: SITE_NAME,
      locale: SITE_OG_LOCALE,
      url: `https://ideanest.az/en${path}`,
      title: 'Quba kilims',
      description: 'Handwoven rugs, dyed with plants.',
    });
    expect(page.twitter).toMatchObject({
      card: 'summary_large_image',
      title: 'Quba kilims',
      description: 'Handwoven rugs, dyed with plants.',
    });
    expect(page.robots).toBeUndefined();
  });

  it('falls back to the generated card when the campaign has no cover image', () => {
    const page = projectPageMetadata(
      {
        id: '0193f2a1',
        slug: 'quba-kilims',
        state: 'PRELAUNCH',
        title: 'Quba kilims',
        blurb: null,
        coverImage: null,
      },
      path,
      'en',
      env,
    );

    expect(Object.hasOwn(page.openGraph ?? {}, 'images')).toBe(false);
  });

  it('prefers the campaign cover image over the generated card', () => {
    const page = projectPageMetadata(
      {
        id: '0193f2a1',
        slug: 'quba-kilims',
        state: 'LIVE',
        title: 'Quba kilims',
        blurb: 'Handwoven rugs.',
        coverImage: { url: 'https://cdn.example/quba.jpg', width: 1600, height: 900 },
      },
      path,
      'en',
      env,
    );

    expect(page.openGraph?.images).toEqual([
      { url: 'https://cdn.example/quba.jpg', width: 1600, height: 900, alt: 'Quba kilims' },
    ]);
  });

  it('ignores a cover image that is not fetchable over http', () => {
    const page = projectPageMetadata(
      {
        id: '0193f2a1',
        slug: 'quba-kilims',
        state: 'LIVE',
        title: 'Quba kilims',
        blurb: null,
        coverImage: { url: 'javascript:alert(1)', width: 1600, height: 900 },
      },
      path,
      'en',
      env,
    );

    expect(Object.hasOwn(page.openGraph ?? {}, 'images')).toBe(false);
  });
});
