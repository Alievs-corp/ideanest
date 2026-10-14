import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizedFetch, publicFetch } from '../api/client';
import {
  listBackedProjects,
  listCreatedProjects,
  profileHref,
  readProfileVisibility,
  setProfileVisibility,
} from './api';

/**
 * §4.2's profile client — issue #274.
 *
 * WHAT THESE COVER, and why each is worth a test rather than a comment:
 *
 *   - **P-07's read is the owner's own profile** (#270), not the public endpoint's status code.
 *     A value the contract does not describe is `null` rather than a guess, because a switch
 *     shown in a position nobody chose is one press away from writing over somebody's choice.
 *   - the paginated lists rename `projects` to `items`, which is the one line reconciling the
 *     service's naming with `useCursorList`'s.
 */

vi.mock('../api/client', () => ({
  publicFetch: vi.fn(),
  authorizedFetch: vi.fn(),
}));

const publicMock = vi.mocked(publicFetch);
const authorizedMock = vi.mocked(authorizedFetch);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the profile lists', () => {
  const CARD = {
    id: 'p1',
    title: 'A thing',
    slug: 'a-thing',
    creatorSlug: 'aysel',
    state: 'LIVE',
  };

  it('reads the service’s `projects` array as the paginator’s `items`', async () => {
    publicMock.mockResolvedValue(json({ projects: [CARD], nextCursor: 'abc' }));

    const page = await listCreatedProjects('aysel');

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe('abc');
  });

  /**
   * #323. Page one is narrowed on the server and page two is narrowed here, by the same
   * reader — which is the point of having one. A row with no slug has no address, and a list
   * that rendered it after a "show more" would put an unlabelled hole under rows that had been
   * filtered.
   */
  it('drops a row the first page would have dropped too', async () => {
    publicMock.mockResolvedValue(
      json({ projects: [{ id: 'p2', title: 'No slug' }, CARD], nextCursor: null }),
    );

    const page = await listCreatedProjects('aysel');

    expect(page.items.map((item) => item.id)).toEqual(['p1']);
  });

  it('reads a missing array as an empty page rather than throwing', async () => {
    // `default-property-inclusion: non_null` means an empty list may arrive as no key at all,
    // and a profile with no campaigns is the common case rather than an error.
    publicMock.mockResolvedValue(json({}));

    const page = await listBackedProjects('aysel');

    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('passes the opaque cursor back unread', async () => {
    publicMock.mockResolvedValue(json({ projects: [], nextCursor: null }));

    await listCreatedProjects('aysel', 'eyJpZCI6MX0=');

    const [path] = publicMock.mock.calls[0] ?? [];
    expect(path).toContain('cursor=eyJpZCI6MX0%3D');
  });

  it('asks the backed list of the right person, escaping the slug', async () => {
    publicMock.mockResolvedValue(json({ projects: [], nextCursor: null }));

    await listBackedProjects('a person/../admin');

    const [path] = publicMock.mock.calls[0] ?? [];
    expect(path).toContain('/v1/users/a%20person%2F..%2Fadmin/backed');
  });

  it('does not swallow a refusal', async () => {
    publicMock.mockResolvedValue(json({ title: 'Not found' }, 404));

    await expect(listCreatedProjects('nobody')).rejects.toBeDefined();
  });
});

describe('reading the visibility', () => {
  it('reads the owner’s own profile, with the bearer, and never the public endpoint', async () => {
    authorizedMock.mockResolvedValue(json({ slug: 'aysel', profileVisibility: 'PRIVATE' }));

    await expect(readProfileVisibility()).resolves.toBe('PRIVATE');

    const [path] = authorizedMock.mock.calls[0] ?? [];
    expect(path).toBe('/v1/me/profile');
    expect(publicMock).not.toHaveBeenCalled();
  });

  it('reads a public profile as public', async () => {
    authorizedMock.mockResolvedValue(json({ slug: 'aysel', profileVisibility: 'PUBLIC' }));

    await expect(readProfileVisibility()).resolves.toBe('PUBLIC');
  });

  it('answers null for a value the contract does not describe, rather than guessing', async () => {
    authorizedMock.mockResolvedValue(json({ slug: 'aysel' }));

    await expect(readProfileVisibility()).resolves.toBeNull();
  });

  it('throws on a refusal, so the panel can say the setting could not be read', async () => {
    authorizedMock.mockResolvedValue(json({ title: 'Service unavailable' }, 503));

    await expect(readProfileVisibility()).rejects.toBeDefined();
  });
});

describe('setting the visibility', () => {
  it('PATCHes the caller’s own account, with no identifier in the path', async () => {
    authorizedMock.mockResolvedValue(new Response(null, { status: 204 }));

    await setProfileVisibility('PRIVATE');

    const [path, init] = authorizedMock.mock.calls[0] ?? [];
    expect(path).toBe('/v1/me/profile-visibility');
    expect(init?.method).toBe('PATCH');
    expect(init?.body).toBe(JSON.stringify({ visibility: 'PRIVATE' }));
  });

  it('throws on a refusal rather than reporting a change that did not happen', async () => {
    authorizedMock.mockResolvedValue(json({ title: 'Forbidden' }, 403));

    await expect(setProfileVisibility('PUBLIC')).rejects.toBeDefined();
  });
});

describe('profileHref', () => {
  it('escapes a slug rather than pasting it into a path', () => {
    expect(profileHref('a/b')).toBe('/u/a%2Fb');
  });
});
