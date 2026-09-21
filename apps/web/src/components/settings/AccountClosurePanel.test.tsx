import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { DEFAULT_LOCALE } from '../../lib/i18n/locale';
import { cancelDeletion, requestDeletion } from '../../lib/account/closure';
import { fetchSession, type Session } from '../../lib/session/session';
import { formatExactTime } from '../../lib/time';
import { SessionProvider } from '../session/SessionProvider';
import { AccountClosurePanel } from './AccountClosurePanel';
import { accountClosurePanelCopyFrom } from '../../lib/i18n/settings-copy';
import { translatorFor } from '../../test-copy';

/*
 * The words, built from `messages/en.json` with the builder the route calls — #80.
 *
 * Retyping the sentences here would give a test that passes whatever the catalogue says, and
 * would still be green with the message file empty. `src/test-copy.ts` carries the argument.
 */
const COPY = accountClosurePanelCopyFrom(translatorFor('settings.panels'), translatorFor('auth'));

/**
 * §4.1's A-10 — issue #279.
 *
 * WHAT THESE COVER:
 *
 *   - **the delay is a date, not an interval.** `AccountDeletionController` returns
 *     `scheduledFor` because "a confirmation the user cannot check is not a confirmation", and
 *     a screen that wrote "in thirty days" would be making a promise about arithmetic and
 *     would be wrong the day §17.4's window is configured differently.
 *   - the closure cannot be submitted without the acknowledgement, and cancelling asks for
 *     nothing — §17.4's deliberate asymmetry.
 *   - **a pending deletion is legible.** An account inside the grace period can still sign in,
 *     so a panel that showed nothing would show a working account with a closure running
 *     underneath it.
 */

vi.mock('../../lib/account/closure', () => ({
  requestDeletion: vi.fn(),
  cancelDeletion: vi.fn(),
}));
vi.mock('../../lib/session/session', () => ({ fetchSession: vi.fn() }));
vi.mock('../../lib/api/access-token', () => ({ signOut: vi.fn().mockResolvedValue(undefined) }));
vi.mock('next/navigation', async (importOriginal) => ({
  /*
   * Spread first so the real module's other exports survive. `i18n/navigation.ts`
   * builds its wrappers at import time and reads `redirect` and `permanentRedirect`
   * while doing so, and a factory that replaced the module wholesale left those
   * undefined — which failed as a TypeError inside next-intl rather than anywhere
   * near the test that caused it.
   */
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/settings/privacy',
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
}));

const requestMock = vi.mocked(requestDeletion);
const cancelMock = vi.mocked(cancelDeletion);
const sessionMock = vi.mocked(fetchSession);

const ACCOUNT: Session = {
  id: 'u1',
  email: 'aysel@example.com',
  name: 'Aysel',
  slug: 'aysel',
  emailVerified: true,
};

function renderPanel() {
  return render(
    <SessionProvider>
      <AccountClosurePanel copy={COPY} />
    </SessionProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue(ACCOUNT);
  cancelMock.mockResolvedValue('cancelled');
});

afterEach(cleanup);

describe('an account with no closure scheduled', () => {
  it('will not close without the acknowledgement, however complete the form looks', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(await screen.findByLabelText(/Current password/u), 'correct horse');
    expect(screen.getByRole('button', { name: 'Close my account' })).toBeDisabled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('sends the password once the consequence has been acknowledged', async () => {
    requestMock.mockResolvedValue({
      kind: 'scheduled',
      schedule: { requestedAt: '2026-08-23T09:00:00Z', scheduledFor: '2026-09-22T09:00:00Z' },
    });
    const user = userEvent.setup();
    renderPanel();

    await user.type(await screen.findByLabelText(/Current password/u), 'correct horse');
    await user.click(screen.getByLabelText(/I understand/u));
    await user.click(screen.getByRole('button', { name: 'Close my account' }));

    expect(requestMock).toHaveBeenCalledWith('correct horse');
  });

  it('says so plainly when the account is already gone', async () => {
    requestMock.mockResolvedValue({ kind: 'already-gone' });
    const user = userEvent.setup();
    renderPanel();

    await user.type(await screen.findByLabelText(/Current password/u), 'correct horse');
    await user.click(screen.getByLabelText(/I understand/u));
    await user.click(screen.getByRole('button', { name: 'Close my account' }));

    expect(await screen.findByText('This account is no longer there')).toBeInTheDocument();
  });

  it('prints the rate limit rather than leaving the button apparently broken', async () => {
    requestMock.mockRejectedValue(
      new ApiError(429, { detail: 'Too many attempts. Try again in fifteen minutes.' }),
    );
    const user = userEvent.setup();
    renderPanel();

    await user.type(await screen.findByLabelText(/Current password/u), 'correct horse');
    await user.click(screen.getByLabelText(/I understand/u));
    await user.click(screen.getByRole('button', { name: 'Close my account' }));

    expect(
      await screen.findByText('Too many attempts. Try again in fifteen minutes.'),
    ).toBeInTheDocument();
  });
});

describe('an account already scheduled to close', () => {
  beforeEach(() => {
    sessionMock.mockResolvedValue({ ...ACCOUNT, deletionScheduledAt: '2026-09-22T09:00:00Z' });
  });

  it('prints the date rather than the phrase “in thirty days”', async () => {
    renderPanel();

    expect(await screen.findByText('This account is scheduled to close')).toBeInTheDocument();
    // Through the same formatter the panel uses: a literal here would pass in GMT+4 and fail
    // on a runner in UTC, which is a flake rather than a check.
    expect(screen.getByText(formatExactTime('2026-09-22T09:00:00Z', DEFAULT_LOCALE))).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('in thirty days');
  });

  it('offers the way back, and it costs nothing', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Keep my account' }));

    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith());
    // No password, deliberately: requiring one would obstruct the victim of a deletion they
    // did not ask for.
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });
});
