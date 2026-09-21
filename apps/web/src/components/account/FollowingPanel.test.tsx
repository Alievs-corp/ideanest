import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { listFollowing, unfollowCreator, type FollowedCreator } from '../../lib/community/signals';
import { FollowingPanel } from './FollowingPanel';
import { followingListCopyFrom } from '../../lib/i18n/signals-copy';
import { translatorFor } from '../../test-copy';

/*
 * The words, built from `messages/en.json` with the builder the route calls — #83.
 *
 * Retyping them here would give a test that passes whatever the catalogue says, and would
 * still be green with the message file empty. `src/test-copy.ts` carries the argument.
 */
const COPY = followingListCopyFrom(translatorFor('account.signals'), translatorFor('common'));

/**
 * §4.9's C-10 — the other half of the pair `SavedProjectsPanel.test.tsx` covers. Issue #288,
 * translated under #83.
 *
 * WHAT THESE COVER:
 *
 *   - **each Unfollow button has its own accessible name.** A list of eight buttons all called
 *     "Unfollow" is a list a screen reader cannot tell apart (docs/ui-kit.md §9.4), and the
 *     name comes out of the catalogue with the creator's name filled into it.
 *   - **an optimistic removal reverts.** The row goes at once and comes back with a message
 *     when the service refused, rather than leaving the list disagreeing with the server.
 *   - the empty state offers somewhere to go, and says so in the catalogue's words.
 *   - a row is text rather than a link, which is the decision the component's own note
 *     explains: `/users/{slug}` is #274 and does not exist yet.
 */

vi.mock('../../lib/community/signals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/community/signals')>()),
  listFollowing: vi.fn(),
  unfollowCreator: vi.fn(),
}));

const listMock = vi.mocked(listFollowing);
const unfollowMock = vi.mocked(unfollowCreator);

function creator(id: string, name: string): FollowedCreator {
  return {
    creatorId: id,
    name,
    slug: `slug-${id}`,
    followedAt: '2026-08-20T09:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  unfollowMock.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('FollowingPanel', () => {
  it('announces the wait rather than showing a blank panel', () => {
    listMock.mockReturnValue(new Promise(() => {}));
    render(<FollowingPanel copy={COPY} />);

    const label = screen.getByText(COPY.loading);
    expect(label.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
  });

  it('draws a creator as text, because the profile route does not exist yet', async () => {
    listMock.mockResolvedValue({ items: [creator('c1', 'Aysel')], nextCursor: null });
    render(<FollowingPanel copy={COPY} />);

    expect(await screen.findByText('Aysel')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Aysel' })).not.toBeInTheDocument();
  });

  it('names every Unfollow button after the creator it unfollows', async () => {
    listMock.mockResolvedValue({
      items: [creator('c1', 'Aysel'), creator('c2', 'Kamran')],
      nextCursor: null,
    });
    render(<FollowingPanel copy={COPY} />);

    expect(await screen.findByRole('button', { name: 'Stop following Aysel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop following Kamran' })).toBeInTheDocument();
  });

  it('takes the row away at once', async () => {
    listMock.mockResolvedValue({ items: [creator('c1', 'Aysel')], nextCursor: null });
    const user = userEvent.setup();
    render(<FollowingPanel copy={COPY} />);

    await user.click(await screen.findByRole('button', { name: 'Stop following Aysel' }));

    await waitFor(() => expect(unfollowMock).toHaveBeenCalledWith('slug-c1'));
    expect(screen.queryByText('Aysel')).not.toBeInTheDocument();
  });

  it('puts the row back and says so when the service refused', async () => {
    listMock.mockResolvedValue({ items: [creator('c1', 'Aysel')], nextCursor: null });
    unfollowMock.mockRejectedValue(new ApiError(500));
    const user = userEvent.setup();
    render(<FollowingPanel copy={COPY} />);

    await user.click(await screen.findByRole('button', { name: 'Stop following Aysel' }));

    expect(await screen.findByText(COPY.removalFailedTitle)).toBeInTheDocument();
    expect(screen.getByText('You are still following Aysel. The change did not reach the service — try again in a moment.')).toBeInTheDocument();
  });

  it('appends the next page rather than replacing what is already read', async () => {
    listMock
      .mockResolvedValueOnce({ items: [creator('c1', 'Aysel')], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: [creator('c2', 'Kamran')], nextCursor: null });
    const user = userEvent.setup();
    render(<FollowingPanel copy={COPY} />);

    await user.click(await screen.findByRole('button', { name: COPY.showMore }));

    expect(await screen.findByText('Kamran')).toBeInTheDocument();
    expect(screen.getByText('Aysel')).toBeInTheDocument();
    // The signal is `undefined` on a page load: only the first read is abortable, because
    // only the first is tied to the component's own mount.
    expect(listMock).toHaveBeenLastCalledWith('cursor-2', undefined);
  });

  it('offers somewhere to go when nothing is followed', async () => {
    listMock.mockResolvedValue({ items: [], nextCursor: null });
    render(<FollowingPanel copy={COPY} />);

    expect(await screen.findByText(COPY.emptyTitle)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: new RegExp(COPY.emptyAction, 'u') })).toHaveAttribute(
      'href',
      '/en/discover',
    );
  });

  it('renders nothing at all when there is no session, rather than an error', async () => {
    listMock.mockRejectedValue(new ApiError(401));
    const { container } = render(<FollowingPanel copy={COPY} />);

    // `SessionProvider`'s guard is what acts on a 401; a panel shouting about it would be a
    // second, louder answer to the same fact.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
