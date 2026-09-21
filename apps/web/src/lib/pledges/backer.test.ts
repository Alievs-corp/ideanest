import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizedFetch } from '../api/client';
import { findMyPledge, listMyPledges, pledgeStateLabel } from './backer';
import { pledgeListCopyFrom } from '../i18n/pledges-copy';
import { translatorFor } from '../../test-copy';

/**
 * The backer's own pledge list — §4.5 PL-09 and PL-10, issue #287.
 *
 * WHAT THESE COVER:
 *
 *   - **`findMyPledge` is bounded.** It exists because `PledgeResponse` carries a `projectId`
 *     and no campaign, and it walks a paginated list to find one row. An unbounded walk is a
 *     page that makes forty requests for a heading; a walk that stopped after one page would
 *     lose every pledge older than twenty-four. The bound is behaviour, so it is tested.
 *   - **not finding it is not a failure.** The pledge page still renders, edits and withdraws
 *     without a campaign name, and a `null` that were an exception would take the screen down.
 *   - the list is read with the session, because every row is somebody's own money.
 */

vi.mock('../api/client', () => ({ authorizedFetch: vi.fn() }));

const authorizedMock = vi.mocked(authorizedFetch);

function summary(pledgeId: string) {
  return {
    pledgeId,
    state: 'CONFIRMED',
    amounts: {
      base: { amount: '45.00', currency: 'AZN' },
      addons: { amount: '0.00', currency: 'AZN' },
      bonus: { amount: '0.00', currency: 'AZN' },
      shipping: { amount: '0.00', currency: 'AZN' },
      tax: { amount: '0.00', currency: 'AZN' },
      total: { amount: '45.00', currency: 'AZN' },
    },
    rewardTierId: 'tier-1',
    rewardTitle: 'Enamel mug',
    isAnonymous: false,
    latePledge: false,
    confirmedAt: '2026-01-01T00:00:00Z',
    canceledAt: null,
    project: {
      id: 'proj-1',
      title: 'A folding bicycle',
      slug: 'folding-bicycle',
      creatorSlug: 'aysel',
      state: 'LIVE',
      deadline: '2026-06-01T00:00:00Z',
      coverImage: null,
    },
  };
}

/**
 * A fresh `Response` per call.
 *
 * `mockResolvedValue` hands back the SAME object every time and a `Response` body may be read
 * once — so a test that expects three requests would fail on the second with "body already
 * read", which says nothing about the code under test. The factory is what makes a repeated
 * answer a repeated answer rather than a repeated object.
 */
function page(
  pledgeIds: readonly string[],
  nextCursor: string | null,
): () => Promise<Response> {
  return async () =>
    new Response(JSON.stringify({ pledges: pledgeIds.map(summary), nextCursor }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listMyPledges', () => {
  it('asks for the caller’s own pledges with the session', async () => {
    authorizedMock.mockImplementation(page([], null));

    const answer = await listMyPledges();

    const [path] = authorizedMock.mock.calls[0] ?? [];
    expect(path).toContain('/v1/me/pledges?');
    expect(answer.items).toEqual([]);
    expect(answer.nextCursor).toBeNull();
  });

  it('passes the opaque cursor back unread', async () => {
    authorizedMock.mockImplementation(page([], null));

    await listMyPledges('eyJ4IjoxfQ==');

    const [path] = authorizedMock.mock.calls[0] ?? [];
    expect(path).toContain('cursor=eyJ4IjoxfQ%3D%3D');
  });

  it('does not swallow a refusal — a 401 here is a session that ended', async () => {
    authorizedMock.mockResolvedValue(new Response(null, { status: 401 }));

    await expect(listMyPledges()).rejects.toBeDefined();
  });
});

describe('findMyPledge', () => {
  it('stops at the first page when the pledge is on it', async () => {
    authorizedMock.mockImplementation(page(['a', 'b'], 'next'));

    const found = await findMyPledge('b');

    expect(found?.pledgeId).toBe('b');
    expect(authorizedMock).toHaveBeenCalledTimes(1);
  });

  it('follows the cursor until it finds one', async () => {
    authorizedMock
      .mockImplementationOnce(page(['a'], 'c1'))
      .mockImplementationOnce(page(['b'], 'c2'))
      .mockImplementationOnce(page(['wanted'], null));

    const found = await findMyPledge('wanted');

    expect(found?.project.title).toBe('A folding bicycle');
    expect(authorizedMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after three pages rather than walking a very long list', async () => {
    // Always another page, and the pledge is never on it. The bound is what stops this from
    // being a screen that makes one request per twenty-four pledges somebody has ever made.
    authorizedMock.mockImplementation(page(['a'], 'always-more'));

    const found = await findMyPledge('nowhere');

    expect(found).toBeNull();
    expect(authorizedMock).toHaveBeenCalledTimes(3);
  });

  it('answers null on the last page rather than asking again', async () => {
    authorizedMock.mockImplementation(page(['a'], null));

    expect(await findMyPledge('b')).toBeNull();
    expect(authorizedMock).toHaveBeenCalledTimes(1);
  });
});

/*
 * The twelve words, built from `messages/en.json` with the builder the route calls — #81.
 *
 * Retyping them here would give a test that passes whatever the catalogue says, and would
 * still be green with the message file empty. `src/test-copy.ts` carries the argument.
 */
const STATES = pledgeListCopyFrom(translatorFor('account.pledges')).states;

describe('pledgeStateLabel', () => {
  it('says who cancelled, because the schema’s spelling is not a sentence', () => {
    expect(pledgeStateLabel('CANCELED_BY_PROJECT', STATES)).toBe('Cancelled by the creator');
    expect(pledgeStateLabel('CANCELED_BY_BACKER', STATES)).toBe('Cancelled by you');
  });

  it('renders a state this build has never heard of as itself', () => {
    expect(pledgeStateLabel('SOMETHING_NEW', STATES)).toBe('SOMETHING_NEW');
  });
});
