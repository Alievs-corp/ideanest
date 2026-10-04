import type { ReactNode } from 'react';
import { AccessibilityInfo, Alert, StyleSheet, type AlertButton } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import type { TestInstance } from 'test-renderer';
import MeScreen from '../app/(tabs)/me';
import { useMe, useSessionState, type Me, type SessionState } from '../lib/account';
import { signOut } from '../lib/auth';
import { forgetPersistedCache } from '../lib/offline';
import { colors } from '../theme';

/**
 * The Me tab's three layouts — issue #150.
 *
 * <p>Here rather than beside `app/(tabs)/me.tsx` because every file under `src/app` is a
 * route to Expo Router, and a test file there would be offered as a screen.
 *
 * <p>The assertions are the ORDER of what a screen reader reaches, by accessible name: that is
 * the layout the issue specifies, and it is what a reader who cannot see the screen gets. The
 * staff console is never in it.
 */

const mockRouter = { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

let mockSession = { signedIn: true, locked: false, unlocked: false };
jest.mock('../lib/use-session', () => ({ useSession: () => mockSession }));

/* Signing out is `lib/auth.ts`'s and tested there; here it is only whether and when it is asked. */
jest.mock('../lib/auth', () => ({
  ...jest.requireActual('../lib/auth'),
  signOut: jest.fn(async () => {}),
}));

/* The persisted cache's removal is `lib/offline.ts`'s and tested there; here, that it is asked. */
jest.mock('../lib/offline', () => ({
  ...jest.requireActual('../lib/offline'),
  forgetPersistedCache: jest.fn(),
}));

jest.mock('../lib/account', () => ({
  ...jest.requireActual('../lib/account'),
  useMe: jest.fn(),
  useSessionState: jest.fn(),
}));

/** A phone with a notch and a home indicator, so the sheet has real insets to read. */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const AYSEL: Me = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Aysel Məmmədova',
  email: 'aysel@example.az',
  slug: 'aysel',
  emailVerified: true,
  locale: 'en',
  currency: 'AZN',
};

function given(
  state: SessionState,
  me: Me | null | undefined,
  isError = false,
  fetchStatus: 'fetching' | 'paused' | 'idle' = isError ? 'idle' : 'fetching',
): void {
  jest.mocked(useSessionState).mockReturnValue(state);
  jest
    .mocked(useMe)
    .mockReturnValue({ data: me, isError, fetchStatus } as ReturnType<typeof useMe>);
}

async function renderMe(client = new QueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          {children}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  return render(<MeScreen />, { wrapper });
}

function textOf(node: TestInstance | string): string {
  if (typeof node === 'string') return node;
  return node.children.map(textOf).join('');
}

/** Every heading and control a screen reader stops at, in order, by its accessible name. */
function readingOrder(): string[] {
  return screen
    .getAllByRole(/^(header|button|link)$/)
    .map((node) => (node.props.accessibilityLabel as string | undefined) ?? textOf(node));
}

const ABOUT = [
  'About',
  'About IdeyaNest',
  'How it works',
  'Trust and safety',
  'Legal',
  'Message us on WhatsApp',
];

/** The way to the app lock, which lives in `settings/security` (#161). */
const THIS_PHONE = ['This phone', 'App lock'];

/** What a session the service has not answered for still offers: the lock, and the way out. */
const HELD = [...THIS_PHONE, ...ABOUT, 'Sign out'];

/*
 * The whole Me tab plus a role query over it: the first render also pays for loading the
 * screen's module graph, which took past jest's 5 s default on a CI runner.
 */
jest.setTimeout(20_000);

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = { signedIn: true, locked: false, unlocked: false };
});

describe('the Me tab', () => {
  it('signed in: identity, account, creator, settings, this phone, About, sign out', async () => {
    given('signed-in', AYSEL);
    await renderMe();

    expect(readingOrder()).toEqual([
      'Aysel Məmmədova, aysel@example.az',
      'Your account',
      'Pledges',
      'My campaigns',
      'Saved projects',
      'Following',
      'Surveys',
      'Deliveries',
      'Creators',
      'Start a campaign',
      'Pricing',
      'Settings',
      'Profile',
      'Notifications',
      'Devices',
      'Email address',
      'Password',
      'Security',
      'Data and closure',
      'Payout details',
      'Language and currency',
      ...THIS_PHONE,
      ...ABOUT,
      'Sign out',
    ]);
  });

  it('signed out: the invitation, the language, About — and no account rows', async () => {
    mockSession = { signedIn: false, locked: false, unlocked: false };
    given('signed-out', null);
    await renderMe();

    expect(readingOrder()).toEqual(['Register', 'Sign in', 'Settings', 'Language', ...ABOUT]);
  });

  it('unknown: this phone, About and sign out — no account rows and, above all, no "Sign in"', async () => {
    given('unknown', undefined, true);
    await renderMe();

    expect(readingOrder()).toEqual(HELD);
    expect(
      screen.queryByTestId('identity-skeleton', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it('still loading: the neutral layout under a skeleton identity row', async () => {
    given('unknown', undefined);
    await renderMe();

    expect(screen.getByTestId('identity-skeleton', { includeHiddenElements: true })).toBeTruthy();
    expect(readingOrder()).toEqual(HELD);
  });

  it('offline, the read paused for a connection: the unknown layout, not a skeleton', async () => {
    // Issue #150: a paused query is neither fetching nor an error. A skeleton would wait on
    // it for as long as the phone is offline.
    given('unknown', undefined, false, 'paused');
    await renderMe();

    expect(readingOrder()).toEqual(HELD);
    expect(
      screen.queryByTestId('identity-skeleton', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it('locked, prompt dismissed: still no "Sign in", and the lock is still within reach', async () => {
    // The lock armed, nothing unlocked: the account is not read, so the state is unknown.
    mockSession = { signedIn: true, locked: true, unlocked: false };
    given('unknown', undefined);
    await renderMe();

    expect(readingOrder()).toEqual(HELD);
    expect(screen.queryByRole('button', { name: 'Register' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    // Nothing is on its way, so no skeleton waiting for it.
    expect(
      screen.queryByTestId('identity-skeleton', { includeHiddenElements: true }),
    ).toBeNull();

    // The lock itself is `settings/security`'s now (#161; `features/settings/app-lock.test.tsx`).
    // What the Me tab owes this reader is the way to it, with no account answer needed.
    await fireEvent.press(screen.getByRole('button', { name: 'App lock' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/security');
  });

  it.each([
    ['signed-in', AYSEL],
    ['signed-out', null],
    ['unknown', undefined],
  ] as const)('never renders the staff console (%s)', async (state, me) => {
    mockSession = { signedIn: state !== 'signed-out', locked: false, unlocked: false };
    given(state, me);
    await renderMe();

    expect(screen.queryByText(en.shell.actions.console)).toBeNull();
    expect(readingOrder()).not.toContain(en.shell.actions.console);
  });

  it('opens the public profile from the identity row', async () => {
    given('signed-in', AYSEL);
    await renderMe();

    await fireEvent.press(
      screen.getByRole('button', { name: 'Aysel Məmmədova, aysel@example.az' }),
    );

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/u/[slug]',
      params: { slug: 'aysel' },
    });
  });

  it('switches to the Pledges tab rather than stacking a second copy of it', async () => {
    given('signed-in', AYSEL);
    await renderMe();

    await fireEvent.press(screen.getByRole('button', { name: 'Pledges' }));

    expect(mockRouter.navigate).toHaveBeenCalledWith('/pledges');
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  /*
   * Issue #281, `mobile-design` skill §2: who you are on the dark canvas, every row in the white
   * content sheet below it, and Sign out as the danger pill.
   */
  it('draws the identity on the canvas and the rows in the white sheet', async () => {
    given('signed-in', AYSEL);
    await renderMe();

    const onWhite = (node: TestInstance) => {
      for (let at: TestInstance | null = node; at !== null; at = at.parent) {
        if (StyleSheet.flatten(at.props.style)?.backgroundColor === colors.whiteSurface) return true;
      }
      return false;
    };
    expect(onWhite(screen.getByRole('button', { name: 'Aysel Məmmədova, aysel@example.az' }))).toBe(
      false,
    );
    for (const name of ['Saved projects', 'Profile', 'App lock', 'Sign out']) {
      expect(onWhite(screen.getByRole('button', { name }))).toBe(true);
    }
    expect(onWhite(screen.getByRole('link', { name: 'Legal' }))).toBe(true);
    expect(
      StyleSheet.flatten(screen.getByRole('button', { name: 'Sign out' }).props.style)
        .backgroundColor,
    ).toBe(colors.danger);
  });

  it('opens Saved as a screen of its own: it left the tab bar for the Me hub (#276)', async () => {
    given('signed-in', AYSEL);
    await renderMe();

    await fireEvent.press(screen.getByRole('button', { name: 'Saved projects' }));

    expect(mockRouter.push).toHaveBeenCalledWith('/saved');
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('says the address is unverified, naming it, only when it is', async () => {
    given('signed-in', { ...AYSEL, emailVerified: false });
    await renderMe();

    expect(
      screen.getByText(
        'Your email address is not verified yet. Open the link we sent to aysel@example.az.',
      ),
    ).toBeTruthy();
  });

  it('says nothing about verification for a verified address', async () => {
    given('signed-in', AYSEL);
    await renderMe();

    expect(screen.queryByText(/not verified/)).toBeNull();
    expect(screen.queryByText(en.settings.panels.closure.scheduledTitle)).toBeNull();
  });

  it('shows both standing warnings politely, without interrupting a screen reader', async () => {
    const said = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    said.mockClear();
    given('signed-in', {
      ...AYSEL,
      emailVerified: false,
      deletionScheduledAt: '2026-10-30T12:00:00Z',
    });
    await renderMe();

    // Standing conditions of the account, not events: read in place, never announced on arrival.
    const unverified = screen.getByText(/not verified/);
    const closure = screen.getByText(en.settings.panels.closure.scheduledTitle);
    for (const words of [unverified, closure]) {
      let region = words.parent;
      while (region !== null && region.props.accessibilityLiveRegion === undefined) {
        region = region.parent;
      }
      expect(region?.props.accessibilityLiveRegion).toBe('polite');
    }
    expect(said).not.toHaveBeenCalled();
  });

  it('warns of a scheduled closure and links to the page that cancels it', async () => {
    given('signed-in', { ...AYSEL, deletionScheduledAt: '2026-10-30T12:00:00Z' });
    await renderMe();

    expect(screen.getByText(en.settings.panels.closure.scheduledTitle)).toBeTruthy();
    // The first "Data and closure" is the alert's; the settings row comes later.
    await fireEvent.press(screen.getAllByRole('button', { name: 'Data and closure' })[0]!);
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/privacy');
  });

  /*
   * Spec item 9: the web footer's last row, in all three layouts. One text, so the assertion
   * is the whole block — which is also what a screen reader reads in its one stop.
   */
  it.each([
    ['signed-in', AYSEL],
    ['signed-out', null],
    ['unknown', undefined],
  ] as const)('ends with the copyright, the currency and the build (%s)', async (state, me) => {
    mockSession = { signedIn: state !== 'signed-out', locked: false, unlocked: false };
    given(state, me);
    await renderMe();

    // `jest.setup.ts` gives the binary version 1.2.3, build 45.
    expect(
      screen.getByText(
        ['© IdeyaNest', 'Currency: Azerbaijani manat (AZN)', 'Version 1.2.3, build 45'].join('\n'),
      ),
    ).toBeTruthy();

    // Last on the tab: after everything, Sign out included where there is one.
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf('© IdeyaNest')).toBeGreaterThan(tree.lastIndexOf('Sign out'));
    expect(tree.indexOf('© IdeyaNest')).toBeGreaterThan(tree.lastIndexOf('Message us on WhatsApp'));
  });

  it('asks before signing out, and signs out only on the destructive choice', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    given('signed-in', AYSEL);
    const client = new QueryClient();
    client.setQueryData(['pledges'], [{ id: 'a pledge' }]);
    await renderMe(client);

    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOut).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, body, buttons = []] = alert.mock.calls[0]!;
    expect(title).toBe(en.mobile.me.signOutConfirm.title);
    expect(body).toBe(en.mobile.me.signOutConfirm.body);
    expect(buttons.map((button: AlertButton) => [button.text, button.style])).toEqual([
      ['Cancel', 'cancel'],
      ['Sign out', 'destructive'],
    ]);

    await act(async () => {
      buttons[1]!.onPress?.();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    // The next person on this phone sees none of this account: memory and disk are emptied.
    expect(client.getQueryData(['pledges'])).toBeUndefined();
    expect(forgetPersistedCache).toHaveBeenCalledTimes(1);
    expect(mockRouter.navigate).toHaveBeenCalledWith('/');
    alert.mockRestore();
  });

  it('cancelling signs nobody out, and the pill asks again afterwards', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    given('signed-in', AYSEL);
    await renderMe();

    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    const [, , buttons = []] = alert.mock.calls[0]!;
    await act(async () => {
      buttons[0]!.onPress?.();
    });
    expect(signOut).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(alert).toHaveBeenCalledTimes(2);
    alert.mockRestore();
  });

  it('opens one confirmation for a double tap, not two queued ones', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    given('signed-in', AYSEL);
    await renderMe();

    const pill = screen.getByRole('button', { name: 'Sign out' });
    await fireEvent.press(pill);
    await fireEvent.press(pill);

    expect(alert).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('opens the WhatsApp sheet from the About group', async () => {
    given('unknown', undefined, true);
    await renderMe();

    expect(screen.queryByText(en.shell.whatsapp.title)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: en.shell.whatsapp.open }));
    expect(screen.getByText(en.shell.whatsapp.title)).toBeTruthy();
  });
});
