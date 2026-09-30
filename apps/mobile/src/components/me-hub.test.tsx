import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import en from '@ideanest/messages/en.json';
import type { TestInstance } from 'test-renderer';
import MeScreen from '../app/(tabs)/me';
import { useMe, useSessionState, type Me, type SessionState } from '../lib/account';

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

function given(state: SessionState, me: Me | null | undefined, isError = false): void {
  jest.mocked(useSessionState).mockReturnValue(state);
  jest.mocked(useMe).mockReturnValue({ data: me, isError } as ReturnType<typeof useMe>);
}

async function renderMe() {
  const client = new QueryClient();
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

/** What a session the service has not answered for still offers: the lock, and the way out. */
const HELD = ['This phone', ...ABOUT, 'Sign out'];

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
      'Two-factor authentication',
      'Data and closure',
      'Payout details',
      'Language and currency',
      'This phone',
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

  it('locked, prompt dismissed: still no "Sign in", and the lock can still be turned off', async () => {
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
    expect(await screen.findByLabelText('Require your fingerprint')).toBeTruthy();
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

  it('warns of a scheduled closure and links to the page that cancels it', async () => {
    given('signed-in', { ...AYSEL, deletionScheduledAt: '2026-10-30T12:00:00Z' });
    await renderMe();

    expect(screen.getByText(en.settings.panels.closure.scheduledTitle)).toBeTruthy();
    // The first "Data and closure" is the alert's; the settings row comes later.
    await fireEvent.press(screen.getAllByRole('button', { name: 'Data and closure' })[0]!);
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/privacy');
  });

  it('opens the WhatsApp sheet from the About group', async () => {
    given('unknown', undefined, true);
    await renderMe();

    expect(screen.queryByText(en.shell.whatsapp.title)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: en.shell.whatsapp.open }));
    expect(screen.getByText(en.shell.whatsapp.title)).toBeTruthy();
  });
});
