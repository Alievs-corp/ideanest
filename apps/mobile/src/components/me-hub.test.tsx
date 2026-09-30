import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

jest.mock('../lib/use-session', () => ({
  useSession: () => ({ signedIn: true, locked: false, unlocked: false }),
}));

jest.mock('../lib/account', () => ({
  ...jest.requireActual('../lib/account'),
  useMe: jest.fn(),
  useSessionState: jest.fn(),
}));

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
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={en}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
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

beforeEach(() => {
  jest.clearAllMocks();
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
    given('signed-out', null);
    await renderMe();

    expect(readingOrder()).toEqual(['Register', 'Sign in', 'Settings', 'Language', ...ABOUT]);
  });

  it('unknown: About and WhatsApp only — no account rows and, above all, no "Sign in"', async () => {
    given('unknown', undefined, true);
    await renderMe();

    expect(readingOrder()).toEqual(ABOUT);
    expect(
      screen.queryByTestId('identity-skeleton', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it('still loading: the neutral layout under a skeleton identity row', async () => {
    given('unknown', undefined);
    await renderMe();

    expect(screen.getByTestId('identity-skeleton', { includeHiddenElements: true })).toBeTruthy();
    expect(readingOrder()).toEqual(ABOUT);
  });

  it.each([
    ['signed-in', AYSEL],
    ['signed-out', null],
    ['unknown', undefined],
  ] as const)('never renders the staff console (%s)', async (state, me) => {
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
