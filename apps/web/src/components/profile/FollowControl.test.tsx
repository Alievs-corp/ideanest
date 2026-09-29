import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { followCreator, isFollowing, unfollowCreator } from '../../lib/community/signals';
import { followControlCopyFrom } from '../../lib/i18n/profile-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { Session } from '../../lib/session/session';
import { translatorFor } from '../../test-copy';
import { useSession, type SessionState } from '../session/SessionProvider';
import { FollowControl } from './FollowControl';

/*
 * The words, built from `messages/en.json` with the builder the pages call.
 */
const COPY = followControlCopyFrom(translatorFor('profile'));

/**
 * The Follow / Following toggle — issue #143.
 *
 * WHAT THESE COVER:
 *
 *   - **signed out is a sign-in wall**, returning to the page it was pressed on — never a
 *     button that fails with a 401 after it is pressed.
 *   - **the account the page is about is offered nothing**, and nothing is read on its
 *     behalf: following yourself is a 400 the service refuses.
 *   - **the initial state is `GET /v1/me/following`'s**, and the button cannot be pressed
 *     before that answer lands.
 *   - follow and unfollow each call their endpoint by slug, flip `aria-pressed` and say what
 *     happened in the live region; a refusal puts the state back and says why.
 */

vi.mock('../session/SessionProvider', () => ({ useSession: vi.fn() }));
vi.mock('../../lib/community/signals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/community/signals')>()),
  isFollowing: vi.fn(),
  followCreator: vi.fn(),
  unfollowCreator: vi.fn(),
}));

const sessionMock = vi.mocked(useSession);
const isFollowingMock = vi.mocked(isFollowing);
const followMock = vi.mocked(followCreator);
const unfollowMock = vi.mocked(unfollowCreator);

function sessionAs(slug: string | null): SessionState {
  const session: Session | null =
    slug === null
      ? null
      : { id: `id-${slug}`, email: `${slug}@example.com`, name: slug, slug, emailVerified: true };
  return {
    status: slug === null ? 'signed-out' : 'signed-in',
    session,
    refresh: async () => {},
    signOut: async () => {},
  };
}

function renderControl() {
  return render(
    <FollowControl slug="aysel" name="Aysel Q" returnTo="/u/aysel" copy={COPY} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockReturnValue(sessionAs('reader'));
  isFollowingMock.mockResolvedValue(false);
  followMock.mockResolvedValue(true);
  unfollowMock.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('FollowControl', () => {
  it('sends a signed-out visitor to sign in, and back to this page', () => {
    sessionMock.mockReturnValue(sessionAs(null));
    renderControl();

    const wall = screen.getByRole('link', { name: 'Follow Aysel Q' });
    expect(wall).toHaveAttribute('href', `/en/sign-in?next=${encodeURIComponent('/u/aysel')}`);
    expect(isFollowingMock).not.toHaveBeenCalled();
    expect(followMock).not.toHaveBeenCalled();
  });

  it('offers the owner nothing, and reads nothing on their behalf', () => {
    sessionMock.mockReturnValue(sessionAs('aysel'));
    const { container } = renderControl();

    expect(container).toBeEmptyDOMElement();
    expect(isFollowingMock).not.toHaveBeenCalled();
  });

  it('cannot be pressed until the following list has answered', async () => {
    isFollowingMock.mockReturnValue(new Promise(() => {}));
    renderControl();

    expect(screen.getByRole('button', { name: 'Follow Aysel Q' })).toBeDisabled();
    expect(isFollowingMock).toHaveBeenCalledWith('aysel', expect.any(AbortSignal));
  });

  it('starts as Following when the list says so', async () => {
    isFollowingMock.mockResolvedValue(true);
    renderControl();

    const button = await screen.findByRole('button', { name: 'Follow Aysel Q', pressed: true });
    expect(button).toHaveTextContent(COPY.following);
  });

  it('follows, by slug, and says so', async () => {
    const user = userEvent.setup();
    renderControl();

    const button = await screen.findByRole('button', { name: 'Follow Aysel Q', pressed: false });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    expect(followMock).toHaveBeenCalledWith('aysel');
    expect(await screen.findByRole('button', { pressed: true })).toHaveTextContent(COPY.following);
    expect(screen.getByText(fillPlaceholders(COPY.followed, { name: 'Aysel Q' }))).toBeInTheDocument();
  });

  it('unfollows, by slug, and says so', async () => {
    isFollowingMock.mockResolvedValue(true);
    const user = userEvent.setup();
    renderControl();

    await user.click(await screen.findByRole('button', { name: 'Follow Aysel Q', pressed: true }));

    expect(unfollowMock).toHaveBeenCalledWith('aysel');
    expect(await screen.findByRole('button', { pressed: false })).toHaveTextContent(COPY.follow);
    expect(
      screen.getByText(fillPlaceholders(COPY.unfollowed, { name: 'Aysel Q' })),
    ).toBeInTheDocument();
  });

  it('puts the state back when the service refuses, and says why', async () => {
    followMock.mockRejectedValue(
      new ApiError(429, { type: 'about:blank', title: 'Too many', detail: 'Slow down.' }),
    );
    const user = userEvent.setup();
    renderControl();

    const button = await screen.findByRole('button', { name: 'Follow Aysel Q', pressed: false });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    expect(await screen.findByText('Slow down.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Follow Aysel Q' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('asks a reader whose session lapsed to sign in', async () => {
    followMock.mockRejectedValue(new ApiError(401, null));
    const user = userEvent.setup();
    renderControl();

    const button = await screen.findByRole('button', { name: 'Follow Aysel Q' });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    expect(await screen.findByText(COPY.signIn)).toBeInTheDocument();
  });

  it('offers Follow when the list cannot be read, since following is idempotent', async () => {
    isFollowingMock.mockRejectedValue(new Error('offline'));
    renderControl();

    const button = await screen.findByRole('button', { name: 'Follow Aysel Q', pressed: false });
    await waitFor(() => expect(button).toBeEnabled());
  });
});
