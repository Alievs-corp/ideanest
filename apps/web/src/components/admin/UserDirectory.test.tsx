import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import type { AdminUser, AdminUserPage } from '../../lib/admin/api';
import { banUser, listUsers, reinstateUser } from '../../lib/admin/api';
import { UserDirectory } from './UserDirectory';
import { ConsoleMembershipProvider } from './ConsoleMembership';
import { translatorFor } from '../../test-copy';
import { consoleChromeCopyFrom } from '../../lib/i18n/admin/common-copy';
import { userDirectoryCopyFrom } from '../../lib/i18n/admin/people-copy';

/*
 * The copy is built from `messages/en.json` with the same builders the routes call, rather
 * than typed out here. `src/test-copy.ts` explains why at length: a suite that retyped the
 * sentences would still be green with the catalogue empty, which is precisely the defect
 * `catalogue.test.ts` exists to catch.
 */
const COPY = userDirectoryCopyFrom(
  translatorFor('admin'),
  consoleChromeCopyFrom(translatorFor('admin'), translatorFor('common')),
);

vi.mock('../../lib/admin/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/admin/api')>();
  return {
    ...actual,
    listUsers: vi.fn(),
    banUser: vi.fn(),
    reinstateUser: vi.fn(),
  };
});

const listUsersMock = vi.mocked(listUsers);
const banUserMock = vi.mocked(banUser);
const reinstateUserMock = vi.mocked(reinstateUser);

const AYAN: AdminUser = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  email: 'ayan@example.com',
  name: 'Ayan Mammadova',
  slug: 'ayan-mammadova',
  emailVerified: true,
  emailVerifiedAt: '2026-01-04T10:00:00Z',
  suspended: false,
  suspendedAt: null,
  suspendedBy: null,
  suspensionReason: null,
  deletionScheduledAt: null,
  createdAt: '2026-01-02T09:00:00Z',
};

const STOPPED: AdminUser = {
  id: 'b1b2c3d4-0000-4000-8000-000000000002',
  email: 'rasim@example.com',
  name: 'Rasim Aliyev',
  slug: 'rasim-aliyev',
  emailVerified: false,
  emailVerifiedAt: null,
  suspended: true,
  suspendedAt: '2026-02-01T12:00:00Z',
  suspendedBy: 'c1b2c3d4-0000-4000-8000-000000000003',
  suspensionReason: 'Counterfeit goods.',
  deletionScheduledAt: null,
  createdAt: '2026-01-03T09:00:00Z',
};

function page(users: AdminUser[], nextCursor?: string): AdminUserPage {
  return { users, nextCursor: nextCursor ?? null };
}

beforeEach(() => {
  vi.clearAllMocks();
  listUsersMock.mockResolvedValue(page([AYAN, STOPPED]));
});

/**
 * Appearance is reviewed in Storybook. These cover BEHAVIOUR and ACCESSIBILITY —
 * the wiring that breaks silently and still ships.
 *
 * The suspension is privileged, audited, and it signs somebody out of every
 * device they own, so the tests that matter most are about the ones that did NOT
 * go through: a refusal, a missing reason, and a screen that does not pretend the
 * ban landed before the service said so.
 */
describe('UserDirectory', () => {
  describe('reading the directory', () => {
    it('announces that it is loading rather than showing an empty list', () => {
      listUsersMock.mockReturnValue(new Promise<AdminUserPage>(() => {}));
      render(<UserDirectory copy={COPY} />);

      const label = screen.getByText('Loading accounts');
      expect(label.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
    });

    it('shows each account with the address that is the point of the screen', async () => {
      render(<UserDirectory copy={COPY} />);

      expect(await screen.findByText('ayan@example.com')).toBeInTheDocument();
      expect(screen.getByText('Ayan Mammadova')).toBeInTheDocument();
    });

    it('says what an account standing is in words as well as in colour', async () => {
      render(<UserDirectory copy={COPY} />);
      await screen.findByText('ayan@example.com');

      // docs/ui-kit.md: colour alone must never carry meaning.
      expect(screen.getByText('Email verified')).toBeInTheDocument();
      expect(screen.getByText('Email unverified')).toBeInTheDocument();
      expect(screen.getByText('Suspended')).toBeInTheDocument();
    });

    it('shows why a suspended account was stopped, so a second moderator reads it first', async () => {
      render(<UserDirectory copy={COPY} />);

      expect(await screen.findByText(/Counterfeit goods\./)).toBeInTheDocument();
    });

    it('searches when the form is submitted rather than on every keystroke', async () => {
      const user = userEvent.setup();
      render(<UserDirectory copy={COPY} />);
      await screen.findByText('ayan@example.com');

      await user.type(screen.getByLabelText('Search'), 'ayan');
      // Every read of this list is audited, and the term is frequently an email
      // address: a request per character would be a row in audit_logs per
      // character.
      expect(listUsersMock).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: 'Search' }));
      await waitFor(() =>
        expect(listUsersMock).toHaveBeenCalledWith(expect.objectContaining({ query: 'ayan' })),
      );
    });

    it('asks the service for the stopped accounts when the filter is on', async () => {
      const user = userEvent.setup();
      render(<UserDirectory copy={COPY} />);
      await screen.findByText('ayan@example.com');

      await user.click(screen.getByRole('button', { name: 'Suspended only' }));

      await waitFor(() =>
        expect(listUsersMock).toHaveBeenCalledWith(
          expect.objectContaining({ suspendedOnly: true }),
        ),
      );
    });

    it('says nobody matched rather than showing a blank page', async () => {
      listUsersMock.mockResolvedValue(page([]));
      render(<UserDirectory copy={COPY} />);

      expect(await screen.findByText('No accounts to show')).toBeInTheDocument();
    });

    it('tells a caller who is not staff that this is not theirs to read', async () => {
      listUsersMock.mockRejectedValue(new ApiError(403, { code: 'NOT_A_MODERATOR' }, 'Forbidden'));
      render(<UserDirectory copy={COPY} />);

      expect(await screen.findByText('You do not work here')).toBeInTheDocument();
      expect(screen.queryByLabelText('Search')).not.toBeInTheDocument();
    });

    it('tells a colleague which capability the directory wanted, and not that they are a stranger', async () => {
      listUsersMock.mockRejectedValue(
        new ApiError(
          403,
          { code: 'INSUFFICIENT_STAFF_CAPABILITY', meta: { capability: 'ADMINISTER_ACCOUNTS' } },
          'Forbidden',
        ),
      );
      render(<UserDirectory copy={COPY} />);

      // #400. This screen keeps its own not-staff sentence — it names the directory and what
      // searching it costs — and the other 403 is the console's, because the only part of it
      // that differs is the capability and the service supplies that.
      expect(await screen.findByText('This screen is not yours')).toBeInTheDocument();
      expect(screen.getByText(/ADMINISTER_ACCOUNTS/)).toBeInTheDocument();
      expect(screen.queryByText('You do not work here')).toBeNull();
    });

    it('offers another go when the service could not be reached', async () => {
      const user = userEvent.setup();
      listUsersMock.mockRejectedValueOnce(new Error('offline'));
      render(<UserDirectory copy={COPY} />);

      await screen.findByText('Something went wrong');
      listUsersMock.mockResolvedValue(page([AYAN]));
      await user.click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByText('ayan@example.com')).toBeInTheDocument();
    });
  });

  describe('loading more', () => {
    it('offers no "load more" when the first page is the whole list', async () => {
      render(<UserDirectory copy={COPY} />);
      await screen.findByText('ayan@example.com');

      expect(screen.queryByRole('button', { name: COPY.loadMore })).toBeNull();
    });

    it('appends the next page, asks with the cursor, and says when there is nothing further', async () => {
      const user = userEvent.setup();
      listUsersMock.mockResolvedValueOnce(page([AYAN], AYAN.id));
      listUsersMock.mockResolvedValueOnce(page([STOPPED]));
      render(<UserDirectory copy={COPY} />);
      await screen.findByText('ayan@example.com');

      await user.click(screen.getByRole('button', { name: COPY.loadMore }));

      expect(await screen.findByText('rasim@example.com')).toBeInTheDocument();
      expect(listUsersMock).toHaveBeenLastCalledWith(expect.objectContaining({ after: AYAN.id }));
      expect(screen.getAllByText('ayan@example.com')).toHaveLength(1);
      expect(screen.getByText(COPY.noMore)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: COPY.loadMore })).toBeNull();
    });

    it('never draws an account twice, and says so when the next page held nothing new', async () => {
      const user = userEvent.setup();
      // A full page offers a cursor whether or not anything is behind it.
      listUsersMock.mockResolvedValueOnce(page([AYAN, STOPPED], STOPPED.id));
      listUsersMock.mockResolvedValueOnce(page([AYAN, STOPPED]));
      render(<UserDirectory copy={COPY} />);
      await screen.findByText('ayan@example.com');

      await user.click(screen.getByRole('button', { name: COPY.loadMore }));

      expect(await screen.findByText(COPY.noMore)).toBeInTheDocument();
      expect(screen.getAllByText('ayan@example.com')).toHaveLength(1);
      expect(screen.getAllByText('rasim@example.com')).toHaveLength(1);
    });
  });

  describe('suspending an account', () => {
    it("offers no suspension on the reader's own row, and says it is theirs", async () => {
      const membership = {
        accountId: AYAN.id,
        staff: true,
        bootstrapped: false,
        roles: ['MODERATOR' as const],
        capabilities: ['ADMINISTER_ACCOUNTS' as const],
      };
      render(
        <ConsoleMembershipProvider given={{ status: 'ready', membership }}>
          <UserDirectory copy={COPY} />
        </ConsoleMembershipProvider>,
      );

      // A red "Suspend" sat on the reader's own account, which the service refuses.
      const own = (await screen.findByText('ayan@example.com')).closest('li') as HTMLElement;
      expect(within(own).getByText(COPY.you)).toBeInTheDocument();
      expect(within(own).queryByRole('button', { name: COPY.suspend })).not.toBeInTheDocument();
    });

    it('asks before it does it, and says what the person loses', async () => {
      const user = userEvent.setup();
      render(<UserDirectory copy={COPY} />);
      await screen.findByText('ayan@example.com');

      await user.click(screen.getAllByRole('button', { name: 'Suspend' })[0]!);

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/Suspend Ayan Mammadova\?/)).toBeInTheDocument();
      expect(within(dialog).getByText(/signed out of every device/)).toBeInTheDocument();
      expect(banUserMock).not.toHaveBeenCalled();
    });

    it('refuses to send a suspension with no reason', async () => {
      const user = userEvent.setup();
      render(<UserDirectory copy={COPY} />);
      await screen.findByText('ayan@example.com');

      await user.click(screen.getAllByRole('button', { name: 'Suspend' })[0]!);
      await user.click(await screen.findByRole('button', { name: 'Suspend account' }));

      // The person is told this and an appeal is answered from it, so an empty
      // one is refused here rather than by the service's 400.
      expect(await screen.findByText(/Say why/)).toBeInTheDocument();
      expect(banUserMock).not.toHaveBeenCalled();
    });

    it('sends the reason and shows what the service answered with', async () => {
      const user = userEvent.setup();
      banUserMock.mockResolvedValue({
        ...AYAN,
        suspended: true,
        suspendedAt: '2026-03-01T09:00:00Z',
        suspensionReason: 'Counterfeit product photographs.',
      });
      render(<UserDirectory copy={COPY} />);
      await screen.findByText('ayan@example.com');

      await user.click(screen.getAllByRole('button', { name: 'Suspend' })[0]!);
      await user.type(await screen.findByLabelText(/Reason/), 'Counterfeit product photographs.');
      await user.click(screen.getByRole('button', { name: 'Suspend account' }));

      await waitFor(() =>
        expect(banUserMock).toHaveBeenCalledWith(AYAN.id, 'Counterfeit product photographs.'),
      );
      expect(await screen.findByText(/every session they held has been revoked/)).toBeInTheDocument();
      expect(screen.getByText(/Counterfeit product photographs\./)).toBeInTheDocument();
    });

    it('leaves the account exactly as it was when the service refuses', async () => {
      const user = userEvent.setup();
      banUserMock.mockRejectedValue(
        new ApiError(422, { code: 'ACCOUNT_SUSPENSION_REFUSED' }, 'Refused'),
      );
      render(<UserDirectory copy={COPY} />);
      await screen.findByText('ayan@example.com');

      await user.click(screen.getAllByRole('button', { name: 'Suspend' })[0]!);
      await user.type(await screen.findByLabelText(/Reason/), 'A reason.');
      await user.click(screen.getByRole('button', { name: 'Suspend account' }));

      // The dialog stays open with the reason still in it: nothing changed, and
      // retyping it is the last thing a refused moderator should have to do.
      expect(await screen.findByText(/cannot suspend your own account/)).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByLabelText(/Reason/)).toHaveValue('A reason.');
    });
  });

  describe('reinstating an account', () => {
    it('lets a suspended account back in and says what is not restored', async () => {
      const user = userEvent.setup();
      reinstateUserMock.mockResolvedValue({
        ...STOPPED,
        suspended: false,
        suspendedAt: null,
        suspendedBy: null,
        suspensionReason: null,
      });
      render(<UserDirectory copy={COPY} />);
      await screen.findByText('rasim@example.com');

      await user.click(screen.getByRole('button', { name: 'Reinstate' }));

      await waitFor(() => expect(reinstateUserMock).toHaveBeenCalledWith(STOPPED.id));
      expect(await screen.findByText(/old sessions are not restored/)).toBeInTheDocument();
      expect(screen.queryByText('Counterfeit goods.')).not.toBeInTheDocument();
    });

    it('takes a reinstated account out of the suspended list rather than contradicting the filter', async () => {
      const user = userEvent.setup();
      listUsersMock.mockResolvedValue(page([STOPPED]));
      reinstateUserMock.mockResolvedValue({
        ...STOPPED,
        suspended: false,
        suspendedAt: null,
        suspendedBy: null,
        suspensionReason: null,
      });
      render(<UserDirectory copy={COPY} />);
      await screen.findByText('rasim@example.com');

      await user.click(screen.getByRole('button', { name: 'Suspended only' }));
      await screen.findByText('rasim@example.com');
      await user.click(screen.getByRole('button', { name: 'Reinstate' }));

      await waitFor(() => expect(screen.queryByText('rasim@example.com')).not.toBeInTheDocument());
    });
  });
});
