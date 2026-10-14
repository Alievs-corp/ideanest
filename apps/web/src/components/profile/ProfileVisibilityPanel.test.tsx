import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api/problem';
import { readProfileVisibility, setProfileVisibility } from '../../lib/profiles/api';
import { fetchSession, type Session } from '../../lib/session/session';
import { SessionProvider } from '../session/SessionProvider';
import { ProfileVisibilityPanel } from './ProfileVisibilityPanel';
import { profileVisibilityCopyFrom } from '../../lib/i18n/profile-copy';
import { translatorFor } from '../../test-copy';

/*
 * The words, built from `messages/en.json` with the builder the route calls — #82.
 *
 * Retyping the sentences here would give a test that passes whatever the catalogue says, and
 * would still be green with the message file empty. `src/test-copy.ts` carries the argument.
 */
const COPY = profileVisibilityCopyFrom(translatorFor('profile'));

/**
 * §4.2's P-07 — issue #274.
 *
 * WHAT THESE COVER:
 *
 *   - **the switch positions itself from the owner's own profile** (#270), once, and no longer
 *     from what the public endpoint answers a stranger. If that read ever stopped working the
 *     switch would show a position nobody chose, and the first press would write it back —
 *     silently unhiding a profile.
 *   - **it refuses to guess.** When the read cannot answer, the switch is disabled and says so
 *     rather than defaulting to the column's `PUBLIC`. A control that picks a position and then
 *     writes it is a control that overwrites a decision.
 *   - **a refused write puts the switch back**, and says which position is actually in force.
 *     An optimistic control that cannot revert is a lie.
 *   - the state is a word as well as a colour and a thumb position (docs/ui-kit.md §9.2).
 */

vi.mock('../../lib/profiles/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/profiles/api')>(
    '../../lib/profiles/api',
  );
  return {
    ...actual,
    readProfileVisibility: vi.fn(),
    setProfileVisibility: vi.fn(),
  };
});
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

const readMock = vi.mocked(readProfileVisibility);
const setMock = vi.mocked(setProfileVisibility);
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
      <ProfileVisibilityPanel copy={COPY} />
    </SessionProvider>,
  );
}

function theSwitch(): HTMLElement {
  return screen.getByRole('switch', { name: /Show my profile to everybody/u });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue(ACCOUNT);
  setMock.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('a profile that is currently public', () => {
  beforeEach(() => {
    readMock.mockResolvedValue('PUBLIC');
  });

  it('shows the switch on, and says so in a word', async () => {
    renderPanel();

    /* `findByText`, not `waitFor` on the attribute: the word is produced only by a resolved
       read, whereas the attribute has a value from the first paint. */
    expect(await screen.findByText('Public')).toBeInTheDocument();
    expect(theSwitch()).toHaveAttribute('aria-checked', 'true');
  });

  it('offers a way to see what a visitor sees', async () => {
    renderPanel();

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /See your profile/u })).toHaveAttribute('href', '/en/u/aysel'),
    );
  });

  it('hides it on request, and asks the endpoint for PRIVATE', async () => {
    const user = userEvent.setup();
    renderPanel();

    await waitFor(() => expect(theSwitch()).toBeEnabled());
    await user.click(theSwitch());

    expect(setMock).toHaveBeenCalledWith('PRIVATE');
    await waitFor(() => expect(theSwitch()).toHaveAttribute('aria-checked', 'false'));
    expect(await screen.findByText('Hidden')).toBeInTheDocument();
    // The 204 is the whole answer: the position it named is the position in force, so the
    // setting is not read a second time.
    expect(readMock).toHaveBeenCalledTimes(1);
  });
});

describe('a profile that is currently hidden', () => {
  it('shows the switch off, without any prompting from the service', async () => {
    readMock.mockResolvedValue('PRIVATE');
    renderPanel();

    /* `findByText`, not `waitFor` on `aria-checked`: the switch starts unchecked while the
       read is in flight, so an assertion on the attribute alone would pass before the answer
       arrived and would keep passing if the answer never did. The word is what only the
       resolved state produces. */
    expect(await screen.findByText('Hidden')).toBeInTheDocument();
    expect(theSwitch()).toHaveAttribute('aria-checked', 'false');
    // A profile nobody can see has nothing to link to.
    expect(screen.queryByRole('link', { name: /See your profile/u })).not.toBeInTheDocument();
  });
});

describe('when the setting cannot be read', () => {
  it('disables the switch rather than defaulting it to public', async () => {
    readMock.mockResolvedValue(null);
    renderPanel();

    /* The switch is disabled while loading too, so the alert is what proves the read came
       back empty rather than merely being slow. */
    expect(await screen.findByText('This setting could not be read')).toBeInTheDocument();
    expect(theSwitch()).toBeDisabled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it('says so when the read is refused, too', async () => {
    readMock.mockRejectedValue(new ApiError(503, { title: 'Service unavailable' }));
    renderPanel();

    expect(await screen.findByText('This setting could not be read')).toBeInTheDocument();
    expect(theSwitch()).toBeDisabled();
  });
});

describe('when the write is refused', () => {
  it('puts the switch back and says nothing changed', async () => {
    readMock.mockResolvedValue('PUBLIC');
    setMock.mockRejectedValue(new ApiError(429, { detail: 'Too many attempts. Try again later.' }));

    const user = userEvent.setup();
    renderPanel();

    await waitFor(() => expect(theSwitch()).toBeEnabled());
    await user.click(theSwitch());

    expect(await screen.findByText('Nothing was changed')).toBeInTheDocument();
    expect(screen.getByText('Too many attempts. Try again later.')).toBeInTheDocument();
    await waitFor(() => expect(theSwitch()).toHaveAttribute('aria-checked', 'true'));
  });
});
