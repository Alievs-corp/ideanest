import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionSummary } from '../../lib/sessions/api';
import { ApiError } from '../../lib/api/problem';
import { listSessions, revokeSession } from '../../lib/sessions/api';
import { signOut } from '../../lib/api/access-token';
import { SessionsPanel } from './SessionsPanel';
import { sessionsPanelCopyFrom } from '../../lib/i18n/settings-copy';
import { translatorFor } from '../../test-copy';

/*
 * The words, built from `messages/en.json` with the builder the route calls — #80.
 *
 * Retyping the sentences here would give a test that passes whatever the catalogue says, and
 * would still be green with the message file empty. `src/test-copy.ts` carries the argument.
 */
const COPY = sessionsPanelCopyFrom(translatorFor('settings.panels'), translatorFor('auth'));

vi.mock('../../lib/sessions/api', () => ({
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
}));

vi.mock('../../lib/api/access-token', () => ({
  signOut: vi.fn(),
}));

const listSessionsMock = vi.mocked(listSessions);
const revokeSessionMock = vi.mocked(revokeSession);
const signOutMock = vi.mocked(signOut);

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';

function session(overrides: Partial<SessionSummary> & Pick<SessionSummary, 'id'>): SessionSummary {
  return {
    createdAt: '2026-08-10T09:00:00.000Z',
    lastSeenAt: '2026-08-15T09:00:00.000Z',
    expiresAt: '2026-09-09T09:00:00.000Z',
    current: false,
    ...overrides,
  };
}

const HERE = session({
  id: 'here',
  userAgent: CHROME_MAC,
  ipAddress: '203.0.113.7',
  current: true,
});
const PHONE = session({ id: 'phone', userAgent: SAFARI_IPHONE, ipAddress: '198.51.100.4' });
const LAPTOP = session({ id: 'laptop', deviceLabel: 'Work laptop', userAgent: EDGE_WINDOWS });

/** The list, once the loading placeholders have been replaced. */
function rows(): HTMLElement[] {
  return screen.getAllByRole('listitem');
}

beforeEach(() => {
  vi.clearAllMocks();
  revokeSessionMock.mockResolvedValue('revoked');
  signOutMock.mockResolvedValue(undefined);
});

/**
 * Appearance is reviewed in Storybook. These cover BEHAVIOUR and
 * ACCESSIBILITY — the wiring that breaks silently and still ships.
 */
describe('SessionsPanel', () => {
  it('announces that it is loading rather than showing a blank panel', () => {
    listSessionsMock.mockReturnValue(new Promise<SessionSummary[]>(() => {}));
    render(<SessionsPanel copy={COPY} />);

    // The placeholders themselves are `aria-hidden`; the container carries the
    // message and the busy state, so a screen reader hears the wait rather than
    // a run of unnamed rectangles.
    const label = screen.getByText('Loading your devices');
    expect(label.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
  });

  it('lists one row per device, named so a person can recognise it', async () => {
    listSessionsMock.mockResolvedValue([HERE, PHONE, LAPTOP]);
    render(<SessionsPanel copy={COPY} />);

    expect(await screen.findByText('Chrome on macOS')).toBeInTheDocument();
    expect(rows()).toHaveLength(3);
    expect(screen.getByText('Safari on iOS')).toBeInTheDocument();
    // The label the client sent wins over anything parsed from the user agent.
    expect(screen.getByText('Work laptop')).toBeInTheDocument();
  });

  // Colour alone must never carry meaning (docs/ui-kit.md §9.2), so the marker
  // has to be readable text on exactly one row.
  it('marks the current device with a word, on that row only', async () => {
    listSessionsMock.mockResolvedValue([HERE, PHONE]);
    render(<SessionsPanel copy={COPY} />);

    await screen.findByText('Chrome on macOS');

    const marks = screen.getAllByText('This device');
    expect(marks).toHaveLength(1);
    expect(rows()[0]!).toContainElement(marks[0]!);
  });

  // Every row's visible label is "Sign out". Without a distinguishing
  // accessible name a screen-reader user hears the same button repeatedly and
  // cannot tell which device they are about to end.
  it('gives each sign-out button an accessible name that says which device', async () => {
    listSessionsMock.mockResolvedValue([HERE, PHONE, LAPTOP]);
    render(<SessionsPanel copy={COPY} />);

    await screen.findByText('Chrome on macOS');

    expect(screen.getByRole('button', { name: 'Sign out of this device' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out Safari on iOS' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out Work laptop' })).toBeInTheDocument();
  });

  it('removes a revoked row and announces it politely', async () => {
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue([HERE, PHONE]);
    render(<SessionsPanel copy={COPY} />);

    await screen.findByText('Chrome on macOS');
    await user.click(screen.getByRole('button', { name: 'Sign out Safari on iOS' }));

    await waitFor(() => expect(screen.queryByText('Safari on iOS')).not.toBeInTheDocument());
    expect(revokeSessionMock).toHaveBeenCalledWith('phone');

    const live = screen.getByText('Signed out Safari on iOS.').closest('[aria-live]');
    expect(live).toHaveAttribute('aria-live', 'polite');
  });

  // The button that started the request has just been removed. Left alone,
  // focus falls to <body> and a keyboard user is dropped at the top of the page.
  it('moves focus somewhere real after the row that had it disappears', async () => {
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue([HERE, PHONE]);
    render(<SessionsPanel copy={COPY} />);

    await screen.findByText('Chrome on macOS');
    await user.click(screen.getByRole('button', { name: 'Sign out Safari on iOS' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Your devices/ })).toHaveFocus(),
    );
  });

  // A 404 means "unknown id" or "not yours" — deliberately indistinguishable.
  // Both readings mean the row is gone, so neither is an error to report.
  it('treats an already-revoked session as success', async () => {
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue([HERE, PHONE]);
    revokeSessionMock.mockResolvedValue('already-gone');
    render(<SessionsPanel copy={COPY} />);

    await screen.findByText('Chrome on macOS');
    await user.click(screen.getByRole('button', { name: 'Sign out Safari on iOS' }));

    await waitFor(() => expect(screen.queryByText('Safari on iOS')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the row and interrupts with an alert when the revoke fails', async () => {
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue([HERE, PHONE]);
    revokeSessionMock.mockRejectedValue(
      new ApiError(500, { detail: 'The device could not be signed out.' }),
    );
    render(<SessionsPanel copy={COPY} />);

    await screen.findByText('Chrome on macOS');
    await user.click(screen.getByRole('button', { name: 'Sign out Safari on iOS' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The device could not be signed out.');
    expect(screen.getByText('Safari on iOS')).toBeInTheDocument();
  });

  /*
   * `DELETE /v1/auth/sessions/{own id}` succeeds but leaves the refresh cookie
   * in the browser, so the session is only half over. Logout is the endpoint
   * that ends it.
   */
  it('signs out through logout, not revoke, when the row is this device', async () => {
    const user = userEvent.setup();
    listSessionsMock.mockResolvedValue([HERE, PHONE]);
    render(<SessionsPanel copy={COPY} />);

    await screen.findByText('Chrome on macOS');
    await user.click(screen.getByRole('button', { name: 'Sign out of this device' }));

    expect(await screen.findByText('You are signed out')).toBeInTheDocument();
    expect(signOutMock).toHaveBeenCalledOnce();
    expect(revokeSessionMock).not.toHaveBeenCalled();
  });

  describe('signing out everywhere else', () => {
    it('is not offered when this is the only device', async () => {
      listSessionsMock.mockResolvedValue([HERE]);
      render(<SessionsPanel copy={COPY} />);

      await screen.findByText('Chrome on macOS');
      expect(
        screen.queryByRole('button', { name: 'Sign out everywhere else' }),
      ).not.toBeInTheDocument();
    });

    it('asks first, and says how many devices it means', async () => {
      const user = userEvent.setup();
      listSessionsMock.mockResolvedValue([HERE, PHONE, LAPTOP]);
      render(<SessionsPanel copy={COPY} />);

      await screen.findByText('Chrome on macOS');
      await user.click(screen.getByRole('button', { name: 'Sign out everywhere else' }));

      const dialog = await screen.findByRole('dialog', { name: 'Sign out everywhere else?' });
      expect(dialog).toHaveTextContent('2 devices will be signed out immediately');
      expect(revokeSessionMock).not.toHaveBeenCalled();
    });

    it('does nothing when the confirmation is cancelled', async () => {
      const user = userEvent.setup();
      listSessionsMock.mockResolvedValue([HERE, PHONE, LAPTOP]);
      render(<SessionsPanel copy={COPY} />);

      await screen.findByText('Chrome on macOS');
      await user.click(screen.getByRole('button', { name: 'Sign out everywhere else' }));

      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(revokeSessionMock).not.toHaveBeenCalled();
      expect(rows()).toHaveLength(3);
    });

    it('revokes every other device and leaves this one signed in', async () => {
      const user = userEvent.setup();
      listSessionsMock.mockResolvedValueOnce([HERE, PHONE, LAPTOP]).mockResolvedValueOnce([HERE]);
      render(<SessionsPanel copy={COPY} />);

      await screen.findByText('Chrome on macOS');
      await user.click(screen.getByRole('button', { name: 'Sign out everywhere else' }));

      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Sign out 2 devices' }));

      await waitFor(() => expect(rows()).toHaveLength(1));
      expect(revokeSessionMock.mock.calls.map(([id]) => id).sort()).toEqual(['laptop', 'phone']);
      expect(screen.getByText('Chrome on macOS')).toBeInTheDocument();
      expect(screen.getByText('Signed out 2 devices.')).toBeInTheDocument();
    });

    // One refusal must not hide the sign-outs that did work.
    it('reports a partial failure without claiming the whole thing worked', async () => {
      const user = userEvent.setup();
      listSessionsMock.mockResolvedValueOnce([HERE, PHONE, LAPTOP]).mockResolvedValueOnce([
        HERE,
        LAPTOP,
      ]);
      revokeSessionMock.mockImplementation(async (id) => {
        if (id === 'laptop') throw new ApiError(500, null);
        return 'revoked';
      });
      render(<SessionsPanel copy={COPY} />);

      await screen.findByText('Chrome on macOS');
      await user.click(screen.getByRole('button', { name: 'Sign out everywhere else' }));

      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Sign out 2 devices' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Signed out 1 device. 1 device could not be signed out');
      expect(screen.getByText('Work laptop')).toBeInTheDocument();
    });
  });

  describe('when the account cannot use the list', () => {
    it('explains a deletion grace period instead of showing a bare failure', async () => {
      listSessionsMock.mockRejectedValue(new ApiError(403, null));
      render(<SessionsPanel copy={COPY} />);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Your account is scheduled for deletion');
    });

    it('says so plainly when the session has ended', async () => {
      listSessionsMock.mockRejectedValue(new ApiError(401, null));
      render(<SessionsPanel copy={COPY} />);

      expect(await screen.findByText('You are signed out')).toBeInTheDocument();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('offers a retry when the request simply failed', async () => {
      const user = userEvent.setup();
      listSessionsMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      render(<SessionsPanel copy={COPY} />);

      const retry = await screen.findByRole('button', { name: 'Try again' });
      listSessionsMock.mockResolvedValueOnce([HERE]);
      await user.click(retry);

      expect(await screen.findByText('Chrome on macOS')).toBeInTheDocument();
    });
  });
});
