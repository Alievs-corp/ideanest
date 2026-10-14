import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { listBlocked, unblockAccount, type BlockedAccount } from '../../lib/community/blocks';
import { blockedListCopyFrom } from '../../lib/i18n/block-copy';
import { translatorFor } from '../../test-copy';
import { expectNoViolations } from '../../test-axe';
import { BlockedAccountsPanel } from './BlockedAccountsPanel';

/** Built from `messages/en.json` with the builder the route calls. */
const COPY = blockedListCopyFrom(translatorFor('blocking'), translatorFor('common'));

/**
 * §4.9's C-08 — the list in `/settings/privacy`. Issue #324.
 *
 * WHAT THESE COVER:
 *
 *   - **the panel says what a block does** before the list, because somebody reading it is
 *     deciding whether to keep each row.
 *   - **each Unblock button is named after the account it unblocks** (docs/ui-kit.md §9.4).
 *   - **unblocking takes the row away at once, by account id, and puts it back when refused.**
 *   - the empty state says how to block somebody, and the panel has no axe violations.
 */

vi.mock('../../lib/community/blocks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/community/blocks')>()),
  listBlocked: vi.fn(),
  unblockAccount: vi.fn(),
}));

const listMock = vi.mocked(listBlocked);
const unblockMock = vi.mocked(unblockAccount);

function account(id: string, name: string): BlockedAccount {
  return { userId: id, name, slug: `slug-${id}`, avatarUrl: null, blockedAt: '2026-10-01T09:00:00Z' };
}

beforeEach(() => {
  vi.clearAllMocks();
  unblockMock.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('BlockedAccountsPanel', () => {
  it('says what a block does, above the list', async () => {
    listMock.mockResolvedValue({ items: [account('u1', 'Aysel')], nextCursor: null });
    render(<BlockedAccountsPanel copy={COPY} />);

    expect(screen.getByRole('heading', { name: COPY.title })).toBeInTheDocument();
    expect(screen.getByText(COPY.intro)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Aysel' })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/u\/slug-u1$/u),
    );
  });

  it('names every Unblock button after the account it unblocks', async () => {
    listMock.mockResolvedValue({
      items: [account('u1', 'Aysel'), account('u2', 'Kamran')],
      nextCursor: null,
    });
    const { container } = render(<BlockedAccountsPanel copy={COPY} />);

    expect(await screen.findByRole('button', { name: 'Unblock Aysel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unblock Kamran' })).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it('takes the row away at once and unblocks by account id', async () => {
    listMock.mockResolvedValue({ items: [account('u1', 'Aysel')], nextCursor: null });
    const user = userEvent.setup();
    render(<BlockedAccountsPanel copy={COPY} />);

    await user.click(await screen.findByRole('button', { name: 'Unblock Aysel' }));

    await waitFor(() => expect(unblockMock).toHaveBeenCalledWith('u1'));
    expect(screen.queryByText('Aysel')).not.toBeInTheDocument();
  });

  it('puts the row back and says it is still blocked when the service refused', async () => {
    listMock.mockResolvedValue({ items: [account('u1', 'Aysel')], nextCursor: null });
    unblockMock.mockRejectedValue(new ApiError(500));
    const user = userEvent.setup();
    render(<BlockedAccountsPanel copy={COPY} />);

    await user.click(await screen.findByRole('button', { name: 'Unblock Aysel' }));

    expect(await screen.findByText(COPY.unblockFailedTitle)).toBeInTheDocument();
    expect(screen.getByText('Aysel is still blocked. Try again in a moment.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unblock Aysel' })).toBeInTheDocument();
  });

  it('says how to block somebody when nobody is blocked', async () => {
    listMock.mockResolvedValue({ items: [], nextCursor: null });
    render(<BlockedAccountsPanel copy={COPY} />);

    expect(await screen.findByText(COPY.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(COPY.emptyBody)).toBeInTheDocument();
  });
});
