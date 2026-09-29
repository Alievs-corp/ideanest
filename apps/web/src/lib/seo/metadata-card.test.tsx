// @vitest-environment node
/*
 * NODE, NOT JSDOM. `next/og` loads Satori and resvg as WebAssembly and streams a
 * real PNG out of them; the browser shim jsdom installs over `fetch` and
 * `ReadableStream` is not what that code is compiled against.
 *
 * These tests do NOT assert what the card looks like. Appearance is reviewed
 * (docs/ui-kit.md, CLAUDE.md §3) and a pixel snapshot of a font-rendered image
 * is a test that fails on somebody else's machine for no reason. What is
 * asserted is the part that silently breaks: that the route renders a PNG at all
 * rather than throwing at build time, that the campaign's own words reach the
 * card, and that nothing reaches it when the campaign is not public.
 */
import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  OG_IMAGE_SIZE,
  OG_PROJECT_ALT,
  OG_SITE_ALT,
  PROJECT_CARD_TITLE_MAX_LENGTH,
  projectSocialCard,
  siteSocialCard,
} from './metadata-card';

/** Every string anywhere in a rendered element tree. */
function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (isValidElement(node)) {
    const props: unknown = node.props;
    if (props !== null && typeof props === 'object' && 'children' in props) {
      return textOf((props as { children?: unknown }).children);
    }
  }
  return '';
}

/** The first eight bytes of every PNG ever written. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function expectPng(response: Response): Promise<void> {
  expect(response.headers.get('content-type')).toBe('image/png');

  const bytes = new Uint8Array(await response.arrayBuffer());
  expect([...bytes.slice(0, 8)]).toEqual(PNG_MAGIC);
  // A PNG header with nothing after it is a card nobody can see.
  expect(bytes.byteLength).toBeGreaterThan(1000);
}

describe('the card itself', () => {
  it('is the size every unfurler expects', () => {
    // 1200x630 is the 1.91:1 both Open Graph and a large X card crop to.
    expect(OG_IMAGE_SIZE).toEqual({ width: 1200, height: 630 });
  });

  it('prints the campaign title and summary', () => {
    const text = textOf(projectSocialCard({ title: 'Quba kilims', blurb: 'Handwoven rugs.' }));

    expect(text).toContain('Quba kilims');
    expect(text).toContain('Handwoven rugs.');
  });

  it('shortens a title that would not fit rather than overflowing the card', () => {
    const text = textOf(projectSocialCard({ title: 'Q'.repeat(400), blurb: null }));

    expect(text).toContain('…');
    expect(text).not.toContain('Q'.repeat(PROJECT_CARD_TITLE_MAX_LENGTH + 1));
  });

  it('says something on a campaign with no summary at all', () => {
    const text = textOf(projectSocialCard({ title: 'Quba kilims', blurb: null }));

    expect(text).toContain('Quba kilims');
    expect(text.trim().length).toBeGreaterThan('Quba kilims'.length);
  });

  it('names the site and no campaign on the site card', () => {
    const text = textOf(siteSocialCard());

    expect(text).toContain('IdeyaNest');
    expect(text).not.toContain('…');
  });

  it('describes both cards for a screen reader', () => {
    // og:image:alt. Both are static strings: a per-campaign alt cannot be
    // exported from a metadata image file, and inventing one would be the one
    // place a non-public title could still escape.
    expect(OG_SITE_ALT.length).toBeGreaterThan(0);
    expect(OG_PROJECT_ALT.length).toBeGreaterThan(0);
  });
});

describe('the site image route', () => {
  it('renders a PNG', async () => {
    const route = await import('../../app/[locale]/opengraph-image');

    expect(route.size).toEqual(OG_IMAGE_SIZE);
    expect(route.contentType).toBe('image/png');
    expect(route.alt).toBe(OG_SITE_ALT);
    await expectPng(route.default());
  }, 30_000);
});

describe('the campaign image route', () => {
  it('renders the campaign onto a PNG', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          id: '0193f2a1',
          slug: 'quba-kilims',
          state: 'PRELAUNCH',
          title: 'Quba kilims',
          blurb: 'Handwoven rugs, dyed with plants.',
          followerCount: 3,
        }),
      ),
    );

    const route = await import('../../app/[locale]/projects/[id]/prelaunch/opengraph-image');
    expect(route.size).toEqual(OG_IMAGE_SIZE);
    expect(route.contentType).toBe('image/png');
    await expectPng(await route.default({ params: Promise.resolve({ id: '0193f2a1' }) }));

    vi.unstubAllGlobals();
  }, 30_000);

  it('still renders a PNG when the campaign is not public, and prints nothing of it', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        id: '0193f2a1',
        slug: 'secret',
        state: 'DRAFT',
        title: 'Working title nobody may see',
        blurb: 'An unfinished summary.',
        followerCount: 0,
      }),
    );
    vi.stubGlobal('fetch', fetchImpl);

    const route = await import('../../app/[locale]/projects/[id]/prelaunch/opengraph-image');
    // It degrades to the site card rather than 500ing the image route.
    await expectPng(await route.default({ params: Promise.resolve({ id: '0193f2a1' }) }));

    vi.unstubAllGlobals();
  }, 30_000);

  it('still renders a PNG when the service cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    const route = await import('../../app/[locale]/projects/[id]/prelaunch/opengraph-image');
    await expectPng(await route.default({ params: Promise.resolve({ id: '0193f2a1' }) }));

    vi.unstubAllGlobals();
  }, 30_000);
});
