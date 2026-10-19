import { describe, expect, it } from 'vitest';
import { readProjectCardPage, readPublicProfile } from './wire';

/**
 * The one reader for `GET /v1/users/{slug}` and its lists — #323.
 *
 * WHAT THESE COVER:
 *
 *   - **nothing is invented for a field that is absent.** A biography that has not been
 *     written is `null`, not an empty string, so a tab omits the row rather than printing a
 *     box saying the creator has not written one. On a page whose subject is whether to send
 *     somebody money, an invented blank is worse than a missing row.
 *   - **an absent `joinedAt` stays absent.** This is the case the cast this module replaced
 *     could not survive: `new Date(null)` is January 1970, and a profile that printed it would
 *     be stating a fact about a stranger that nobody sent.
 *   - **money is never a number.** An amount arrives as a string and stays one, whatever a
 *     card does with it afterwards.
 *   - **a row with nothing to link to is dropped**, because it would render as an unlabelled
 *     hole in a list of somebody's work.
 *   - **a link that is not `https://` never reaches an anchor**, whatever the body said.
 */

describe('reading a profile', () => {
  const body = {
    slug: 'ayan',
    name: 'Ayan Q',
    avatarUrl: 'https://cdn.test/a.jpg',
    bio: 'Photographer in Baku.',
    joinedAt: '2024-02-01T00:00:00Z',
    websiteUrl: 'https://ayan.test',
    location: { slug: 'baku', name: 'Baku' },
    socialLinks: [{ platform: 'INSTAGRAM', url: 'https://instagram.com/ayan' }],
  };

  it('keeps the eight fields the endpoint publishes', () => {
    expect(readPublicProfile(body)).toEqual(body);
  });

  /** An explicit null is "they have not written one", never "it has not arrived yet". */
  it('reads an unwritten biography and an unset avatar as null', () => {
    const profile = readPublicProfile({ ...body, bio: null, avatarUrl: null });

    expect(profile?.bio).toBeNull();
    expect(profile?.avatarUrl).toBeNull();
  });

  /**
   * The defect the cast allowed. A body without the field used to reach `new Date(undefined)`
   * and an explicit null used to reach `new Date(null)`, which is 1 January 1970 — printed on
   * somebody's profile as the month they joined.
   */
  it('answers null for a joining instant the body did not carry', () => {
    const { joinedAt: _dropped, ...withoutJoinedAt } = body;

    expect(readPublicProfile(withoutJoinedAt)?.joinedAt).toBeNull();
    expect(readPublicProfile({ ...body, joinedAt: null })?.joinedAt).toBeNull();
  });

  it('refuses a body with no handle or no name, so the caller falls back to the byline', () => {
    expect(readPublicProfile({ name: 'Ayan Q' })).toBeNull();
    expect(readPublicProfile({ slug: 'ayan' })).toBeNull();
    expect(readPublicProfile(null)).toBeNull();
    expect(readPublicProfile(['ayan'])).toBeNull();
  });

  it('answers an empty list of links rather than a null a component would map over', () => {
    expect(readPublicProfile({ ...body, socialLinks: undefined })?.socialLinks).toEqual([]);
    expect(readPublicProfile({ ...body, socialLinks: 'no' })?.socialLinks).toEqual([]);
  });

  /**
   * The service refuses everything that is not `https://` on the way in. This refuses it again
   * on the way out, because being wrong about that exactly once means a `javascript:` address
   * rendered as an anchor on a page a stranger wrote.
   */
  it('drops a link that is not https, and keeps the ones beside it', () => {
    const profile = readPublicProfile({
      ...body,
      socialLinks: [
        { platform: 'X', url: 'javascript:alert(1)' },
        { platform: 'INSTAGRAM', url: 'https://instagram.com/ayan' },
      ],
    });

    expect(profile?.socialLinks).toEqual([
      { platform: 'INSTAGRAM', url: 'https://instagram.com/ayan' },
    ]);
  });

  it('refuses half a location, which has either nothing to print or nowhere to go', () => {
    expect(readPublicProfile({ ...body, location: { slug: 'baku' } })?.location).toBeNull();
    expect(readPublicProfile({ ...body, location: { name: 'Baku' } })?.location).toBeNull();
  });
});

describe('reading a page of campaign cards', () => {
  const card = {
    id: 'p1',
    title: 'A folding bicycle',
    slug: 'a-folding-bicycle',
    creatorSlug: 'ayan',
    blurb: 'It folds.',
    state: 'SUCCESSFUL',
    goal: { amount: '10000.00', currency: 'AZN' },
    pledged: { amount: '12500.00', currency: 'AZN' },
    backersCount: 214,
    deadline: '2026-01-01T00:00:00Z',
    launchedAt: '2025-12-01T00:00:00Z',
    coverImage: { url: 'https://cdn.test/p1.jpg', width: 1600, height: 900 },
  };

  it('keeps money as the string it arrived as', () => {
    const page = readProjectCardPage({ projects: [card], nextCursor: null });

    expect(page.items[0]?.goal).toEqual({ amount: '10000.00', currency: 'AZN' });
    expect(typeof page.items[0]?.pledged?.amount).toBe('string');
  });

  it('drops a row with nothing to link to and keeps the ones beside it', () => {
    const page = readProjectCardPage({
      projects: [{ id: 'p2', title: 'No slug', creatorSlug: 'ayan', state: 'LIVE' }, card],
    });

    expect(page.items.map((project) => project.id)).toEqual(['p1']);
  });

  it('refuses a cover with no dimensions, because the box could not be reserved', () => {
    const page = readProjectCardPage({
      projects: [{ ...card, coverImage: { url: 'https://cdn.test/p1.jpg' } }],
    });

    expect(page.items[0]?.coverImage).toBeNull();
  });

  it('reads the campaign video, and none when any field a preview needs is missing', () => {
    const video = { url: 'https://cdn.test/p1.mp4', posterUrl: 'https://cdn.test/p1-poster.jpg', width: 1280, height: 720 };

    expect(readProjectCardPage({ projects: [{ ...card, video }] }).items[0]?.video).toEqual(video);
    expect(readProjectCardPage({ projects: [card] }).items[0]?.video).toBeNull();
    expect(
      readProjectCardPage({ projects: [{ ...card, video: { ...video, posterUrl: undefined } }] }).items[0]?.video,
    ).toBeNull();
  });

  it('answers an empty page for a body that is not one', () => {
    expect(readProjectCardPage('nope').items).toEqual([]);
    expect(readProjectCardPage('nope').nextCursor).toBeNull();
  });
});
