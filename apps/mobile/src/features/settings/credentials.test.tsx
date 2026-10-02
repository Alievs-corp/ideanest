import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import en from '@ideanest/messages/en.json';
import * as client from '../../api/client';
import { setOnline } from '../../lib/connectivity';
import { setLocale } from '../../lib/locale';
import { EmailSettingsScreen } from './email-change';
import { PasswordSettingsScreen } from './password-change';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
const mockSessionStore = {
  value: { signedIn: true, locked: false, unlocked: false },
  listeners: new Set<() => void>(),
  set(signedIn: boolean) {
    this.value = { ...this.value, signedIn };
    this.listeners.forEach((listener) => listener());
  },
};
const mockGet = jest.fn();
// The real helper ends the session, which flips the keychain flag the gate reads.
const mockEndLocalSession = jest.fn(async () => {
  mockSessionStore.set(false);
});

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('../../lib/use-session', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react');
  return {
    useSession: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          mockSessionStore.listeners.add(listener);
          return () => mockSessionStore.listeners.delete(listener);
        },
        () => mockSessionStore.value,
      ),
  };
});
jest.mock('../../api/client', () => ({ api: () => ({ get: mockGet }), sendJson: jest.fn() }));
jest.mock('../../lib/local-sign-out', () => ({ useEndLocalSession: () => mockEndLocalSession }));

jest.setTimeout(30_000);

const sendJson = jest.mocked(client.sendJson);
// Plain phrases, so a secret scanner does not read the fixtures as credentials.
const HELD = 'the one I have';
const CURRENT = 'the old one';
const FRESH = 'a fresh long one';
const OTHER = 'a different one';
const E = en.settings.panels.emailChange;
const P = en.settings.panels.passwordChange;
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function refusal(status: number, code: string, detail: string): ApiError {
  return new ApiError(status, { type: 'about:blank', title: 'Refused', status, detail, code });
}

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(element: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider locale="en" messages={en}>
          {element}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await settle();
}

beforeEach(async () => {
  await act(async () => setLocale('en'));
  jest.clearAllMocks();
  mockSessionStore.value = { signedIn: true, locked: false, unlocked: false };
  setOnline(true);
  mockGet.mockResolvedValue({ email: 'aysel@example.com', emailVerified: true, name: 'Aysel' });
});

describe('email address', () => {
  it('sends the change and says only that a link was sent', async () => {
    sendJson.mockResolvedValue(null);
    await show(<EmailSettingsScreen />);

    expect(screen.getByText('aysel@example.com')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('email-change-password'), HELD);
    await fireEvent.changeText(screen.getByTestId('email-change-address'), ' new@example.com ');
    await fireEvent.press(screen.getByTestId('email-change-submit'));
    await settle();

    expect(sendJson).toHaveBeenCalledWith('POST', '/v1/auth/change-email', {
      currentPassword: HELD,
      newEmail: 'new@example.com',
    });
    expect(screen.getByTestId('email-change-sent')).toBeTruthy();
    expect(screen.getByText(E.nothingChanged)).toBeTruthy();
    expect(screen.getByText('new@example.com')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('email-change-again'));
    expect(screen.getByTestId('email-change-submit')).toBeTruthy();
  });

  it('puts a wrong password under the password field and a taken address under the address', async () => {
    sendJson.mockRejectedValueOnce(refusal(403, 'INCORRECT_PASSWORD', 'That password is not right.'));
    await show(<EmailSettingsScreen />);
    await fireEvent.changeText(screen.getByTestId('email-change-password'), 'wrong');
    await fireEvent.changeText(screen.getByTestId('email-change-address'), 'new@example.com');
    await fireEvent.press(screen.getByTestId('email-change-submit'));
    await settle();
    expect(screen.getAllByText('That password is not right.').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('email-change-sent')).toBeNull();

    sendJson.mockRejectedValueOnce(refusal(409, 'EMAIL_ALREADY_IN_USE', 'That address is taken.'));
    await fireEvent.press(screen.getByTestId('email-change-submit'));
    await settle();
    expect(screen.getAllByText('That address is taken.').length).toBeGreaterThan(0);
  });

  it('says when the address is not verified yet', async () => {
    mockGet.mockResolvedValue({ email: 'aysel@example.com', emailVerified: false });
    await show(<EmailSettingsScreen />);
    expect(screen.getByText(/which is not verified yet/)).toBeTruthy();
  });

  it('cannot send while offline', async () => {
    setOnline(false);
    await show(<EmailSettingsScreen />);
    await fireEvent.changeText(screen.getByTestId('email-change-password'), HELD);
    await fireEvent.changeText(screen.getByTestId('email-change-address'), 'new@example.com');
    await fireEvent.press(screen.getByTestId('email-change-submit'));
    expect(sendJson).not.toHaveBeenCalled();
    expect(screen.getByTestId('settings-offline')).toBeTruthy();
  });

  it('does not send from the keyboard while the password is empty', async () => {
    await show(<EmailSettingsScreen />);
    await fireEvent.changeText(screen.getByTestId('email-change-address'), 'new@example.com');
    await fireEvent(screen.getByTestId('email-change-address'), 'submitEditing');
    await settle();
    expect(sendJson).not.toHaveBeenCalled();
  });

  it('sends a signed-out reader to sign in, and back here after', async () => {
    mockSessionStore.value = { signedIn: false, locked: false, unlocked: false };
    await show(<EmailSettingsScreen />);
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/settings/email' },
    });
    expect(screen.queryByTestId('email-change-submit')).toBeNull();
  });
});

describe('password', () => {
  async function fill(current: string, next: string, again: string) {
    await fireEvent.changeText(screen.getByTestId('password-change-current'), current);
    await fireEvent.changeText(screen.getByTestId('password-change-new'), next);
    await fireEvent.changeText(screen.getByTestId('password-change-repeat'), again);
  }

  it('compares the two new passwords on the phone and sends nothing on a mismatch', async () => {
    await show(<PasswordSettingsScreen />);
    await fill(CURRENT, FRESH, OTHER);
    await fireEvent.press(screen.getByTestId('password-change-submit'));
    await settle();

    expect(sendJson).not.toHaveBeenCalled();
    expect(screen.getByText(P.mismatchTitle)).toBeTruthy();
    expect(screen.getByText(P.mismatchField)).toBeTruthy();
  });

  it('on success forgets the session on this phone and lands on sign-in with the notice', async () => {
    sendJson.mockResolvedValue(null);
    await show(<PasswordSettingsScreen />);
    await fill(CURRENT, FRESH, FRESH);
    await fireEvent.press(screen.getByTestId('password-change-submit'));
    await settle();

    expect(sendJson).toHaveBeenCalledWith('POST', '/v1/auth/change-password', {
      currentPassword: CURRENT,
      newPassword: FRESH,
    });
    expect(mockEndLocalSession).toHaveBeenCalledTimes(1);
    // Once, with the notice: the gate must not race it to sign-in with a returnTo.
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { notice: 'password-changed' },
    });
  });

  it('puts a wrong current password under the current field', async () => {
    sendJson.mockRejectedValue(refusal(403, 'INCORRECT_PASSWORD', 'That password is not right.'));
    await show(<PasswordSettingsScreen />);
    await fill(CURRENT, FRESH, FRESH);
    await fireEvent.press(screen.getByTestId('password-change-submit'));
    await settle();

    expect(screen.getAllByText('That password is not right.').length).toBeGreaterThan(0);
    expect(mockEndLocalSession).not.toHaveBeenCalled();
  });

  it('sends nothing while offline', async () => {
    setOnline(false);
    await show(<PasswordSettingsScreen />);
    await fill(CURRENT, FRESH, FRESH);
    await fireEvent.press(screen.getByTestId('password-change-submit'));
    expect(sendJson).not.toHaveBeenCalled();
  });

  it('sends a signed-out reader to sign in, and back here after', async () => {
    mockSessionStore.value = { signedIn: false, locked: false, unlocked: false };
    await show(<PasswordSettingsScreen />);
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/settings/password' },
    });
  });

  it('puts a weak password under the new field and keeps the session', async () => {
    sendJson.mockRejectedValue(refusal(400, 'WEAK_PASSWORD', 'Use at least twelve characters.'));
    await show(<PasswordSettingsScreen />);
    await fill(CURRENT, 'short', 'short');
    await fireEvent.press(screen.getByTestId('password-change-submit'));
    await settle();

    expect(screen.getAllByText('Use at least twelve characters.').length).toBeGreaterThan(0);
    expect(mockEndLocalSession).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
