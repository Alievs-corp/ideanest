import { describe, expect, it, vi } from 'vitest';
import { apiOrigin, fetchPublicProjectPreview, readPublicProjectPreview } from './metadata-source';

const env = { IDEANEST_API_ORIGIN: 'http://api.internal:8080' };

const PUBLIC_BODY = {
  id: '0193f2a1',
  slug: 'quba-kilims',
  state: 'SCHEDULED',
  title: 'Quba kilims',
  blurb: 'Handwoven rugs, dyed with plants.',
  coverImage: { url: 'https://cdn.example/quba.jpg', width: 1600, height: 900 },
  followerCount: 42,
};

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/* -------------------------------------------------------------------------
 * Narrowing the response
 * ---------------------------------------------------------------------- */

describe('readPublicProjectPreview', () => {
  it('reads a public campaign', () => {
    expect(readPublicProjectPreview(PUBLIC_BODY)).toEqual({
      id: '0193f2a1',
      slug: 'quba-kilims',
      state: 'SCHEDULED',
      title: 'Quba kilims',
      blurb: 'Handwoven rugs, dyed with plants.',
      coverImage: { url: 'https://cdn.example/quba.jpg', width: 1600, height: 900 },
    });
  });

  it('keeps only the fields metadata is allowed to print', () => {
    const preview = readPublicProjectPreview({
      ...PUBLIC_BODY,
      story: { blocks: [] },
      risks: 'An internal note.',
      moderationNote: 'Rejected once.',
    });

    // A field a future deployment adds must not arrive in a social card by
    // accident, so the reader copies rather than spreads.
    expect(preview === null ? [] : Object.keys(preview).sort()).toEqual([
      'blurb',
      'coverImage',
      'id',
      'slug',
      'state',
      'title',
    ]);
  });

  it.each(['DRAFT', 'PRELAUNCH', 'SUBMITTED', 'CHANGES_REQUESTED', 'REJECTED', 'SUSPENDED', 'CANCELED'])(
    'refuses a campaign in %s',
    (state) => {
      expect(readPublicProjectPreview({ ...PUBLIC_BODY, state })).toBeNull();
    },
  );

  it('refuses a state it has never heard of', () => {
    expect(readPublicProjectPreview({ ...PUBLIC_BODY, state: 'ARCHIVED' })).toBeNull();
    expect(readPublicProjectPreview({ ...PUBLIC_BODY, state: 42 })).toBeNull();
  });

  it.each([null, undefined, 42, 'a string', [], [PUBLIC_BODY]])(
    'refuses a body that is not an object: %s',
    (body) => {
      expect(readPublicProjectPreview(body)).toBeNull();
    },
  );

  it('refuses a campaign with no usable title', () => {
    expect(readPublicProjectPreview({ ...PUBLIC_BODY, title: '' })).toBeNull();
    expect(readPublicProjectPreview({ ...PUBLIC_BODY, title: '   ' })).toBeNull();
    expect(readPublicProjectPreview({ ...PUBLIC_BODY, title: undefined })).toBeNull();
    expect(readPublicProjectPreview({ ...PUBLIC_BODY, title: 7 })).toBeNull();
  });

  it('treats an absent, null, or blank summary as no summary', () => {
    // The service serialises with `non_null`, so a campaign with no summary has
    // no `blurb` key at all rather than a null one. Both mean the same thing.
    for (const blurb of [undefined, null, '', '  ']) {
      expect(readPublicProjectPreview({ ...PUBLIC_BODY, blurb })?.blurb).toBeNull();
    }
  });

  it('drops a cover image it could not use', () => {
    for (const coverImage of [
      undefined,
      null,
      {},
      { url: 'https://cdn.example/a.jpg' },
      { url: '', width: 1600, height: 900 },
      { url: 'https://cdn.example/a.jpg', width: 0, height: 900 },
      { url: 'https://cdn.example/a.jpg', width: -1, height: 900 },
      { url: 'https://cdn.example/a.jpg', width: '1600', height: 900 },
    ]) {
      expect(readPublicProjectPreview({ ...PUBLIC_BODY, coverImage })?.coverImage).toBeNull();
    }
  });
});

/* -------------------------------------------------------------------------
 * Fetching it
 * ---------------------------------------------------------------------- */

describe('apiOrigin', () => {
  it('defaults to the service on localhost, exactly as next.config.mjs does', () => {
    expect(apiOrigin({})).toBe('http://localhost:8080');
  });

  it('reads the configured origin and drops any trailing slash', () => {
    expect(apiOrigin({ IDEANEST_API_ORIGIN: 'http://api.internal:8080/' })).toBe(
      'http://api.internal:8080',
    );
  });
});

describe('fetchPublicProjectPreview', () => {
  it('asks the service for the public projection', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respond(PUBLIC_BODY));

    const preview = await fetchPublicProjectPreview('0193f2a1', { fetchImpl, env });

    expect(preview?.title).toBe('Quba kilims');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'http://api.internal:8080/v1/projects/0193f2a1/prelaunch',
    );
  });

  it('escapes an identifier into the path', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respond(PUBLIC_BODY));

    await fetchPublicProjectPreview('../../v1/admin', { fetchImpl, env });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'http://api.internal:8080/v1/projects/..%2F..%2Fv1%2Fadmin/prelaunch',
    );
  });

  it('sends no credentials, because a crawler holds none', async () => {
    /*
     * This is the whole reason metadata reads through its own function rather
     * than through `lib/api/client.ts`: what a link preview and a search result
     * may show is exactly what an anonymous request answers. Sending the
     * visitor's token here would let a creator's private draft appear in a
     * public card the moment the creator shared the link.
     */
    const fetchImpl = vi.fn<typeof fetch>(async () => respond(PUBLIC_BODY));

    await fetchPublicProjectPreview('0193f2a1', { fetchImpl, env });

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.has('authorization')).toBe(false);
    expect(init?.credentials).toBe('omit');
  });

  it('is null when the campaign is not there', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('', { status: 404 }));
    expect(await fetchPublicProjectPreview('nope', { fetchImpl, env })).toBeNull();
  });

  it('is null when the service is broken, rather than taking the page down with it', async () => {
    /*
     * A `generateMetadata` that throws fails the whole route. A campaign page
     * that renders without a social card is a worse page; a campaign page that
     * 500s because a meta tag could not be written is a lost backer.
     */
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await fetchPublicProjectPreview('0193f2a1', { fetchImpl, env })).toBeNull();
  });

  it('is null when the body is not the JSON it claims to be', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('<html>oops</html>', { status: 200 }));
    expect(await fetchPublicProjectPreview('0193f2a1', { fetchImpl, env })).toBeNull();
  });

  it('is null for a campaign the anonymous projection should never have carried', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respond({ ...PUBLIC_BODY, state: 'DRAFT' }));
    expect(await fetchPublicProjectPreview('0193f2a1', { fetchImpl, env })).toBeNull();
  });
});
