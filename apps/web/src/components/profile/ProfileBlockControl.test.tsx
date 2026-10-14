import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { blockBySlug, isBlocked, unblockBySlug } from '../../lib/community/blocks';
import { blockControlCopyFrom } from '../../lib/i18n/block-copy';
import type { Session } from '../../lib/session/session';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { useSession, type SessionState } from '../session/SessionProvider';
import { ProfileBlockControl } from './ProfileBlockControl';

/** Built from `messages/en.json` with the builder the route calls. */
const COPY = blockControlCopyFrom(translatorFor('blocking'));

/**
 * §4.9's C-08 on a public profile — issue #324.
 *
 * WHAT THESE COVER:
 *
 *   - **a visitor and the owner are offered nothing**, and nothing is read on their behalf.
 *   - **blocking is asked in place**, with the sentence that says what a block does, and only
 *     the second press blocks — by slug, because a profile carries no account id.
 *   - once blocked the control says so and offers Unblock, and each change is said in a live
 *     region; staff are refused in the catalogue's words.
 */

vi.mock('../session/SessionProvider', () => ({ useSession: vi.fn() }));
vi.mock('../../lib/community/blocks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/community/blocks')>()),
  isBlocked: vi.fn(),
  blockBySlug: vi.fn(),
  unblockBySlug: vi.fn(),
}));

const sessionMock = vi.mocked(useSession);
const isBlockedMock = vi.mocked(isBlocked);
const blockMock = vi.mocked(blockBySlug);
const unblockMock = vi.mocked(unblockBySlug);

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

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockReturnValue(sessionAs('reader'));
  isBlockedMock.mockResolvedValue(false);
  blockMock.mockResolvedValue(true);
  unblockMock.mockResolvedValue(false);
});

afterEach(cleanup);

describe('ProfileBlockControl', () => {
  it('offers a visitor nothing and reads nothing', () => {
    sessionMock.mockReturnValue(sessionAs(null));
    const { container } = render(<ProfileBlockControl slug="aysel" copy={COPY} />);

    expect(container).toBeEmptyDOMElement();
    expect(isBlockedMock).not.toHaveBeenCalled();
  });

  it('offers the owner nothing', () => {
    sessionMock.mockReturnValue(sessionAs('aysel'));
    const { container } = render(<ProfileBlockControl slug="aysel" copy={COPY} />);

    expect(container).toBeEmptyDOMElement();
    expect(isBlockedMock).not.toHaveBeenCalled();
  });

  it('asks first, says what a block does, and blocks by slug on the second press', async () => {
    const user = userEvent.setup();
    const { container } = render(<ProfileBlockControl slug="aysel" copy={COPY} />);

    await user.click(await screen.findByRole('button', { name: COPY.trigger }));
    expect(blockMock).not.toHaveBeenCalled();
    expect(screen.getByText(COPY.warning)).toBeInTheDocument();
    await expectNoViolations(container);

    await user.click(screen.getByRole('button', { name: COPY.confirm }));

    await waitFor(() => expect(blockMock).toHaveBeenCalledWith('aysel'));
    expect(await screen.findByText(COPY.blockedState)).toBeInTheDocument();
    expect(screen.getByText(COPY.blocked)).toHaveAttribute('aria-live', 'polite');
  });

  it('starts from the service’s answer, and unblocks where it was blocked', async () => {
    isBlockedMock.mockResolvedValue(true);
    const user = userEvent.setup();
    render(<ProfileBlockControl slug="aysel" copy={COPY} />);

    await user.click(await screen.findByRole('button', { name: COPY.unblock }));

    await waitFor(() => expect(unblockMock).toHaveBeenCalledWith('aysel'));
    expect(await screen.findByRole('button', { name: COPY.trigger })).toBeInTheDocument();
    expect(screen.getByText(COPY.unblocked)).toBeInTheDocument();
  });

  it('says a member of staff cannot be blocked, in the catalogue’s words', async () => {
    blockMock.mockRejectedValue(new ApiError(422, { code: 'CANNOT_BLOCK_STAFF' }));
    const user = userEvent.setup();
    render(<ProfileBlockControl slug="aysel" copy={COPY} />);

    await user.click(await screen.findByRole('button', { name: COPY.trigger }));
    await user.click(screen.getByRole('button', { name: COPY.confirm }));

    expect(await screen.findByText(COPY.failures.staff)).toBeInTheDocument();
    expect(screen.queryByText(COPY.blockedState)).not.toBeInTheDocument();
  });
});
