import type { ReactElement, ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import * as AppleAuthentication from 'expo-apple-authentication';
import { ApiError } from '@ideanest/api-client';
import en from '@ideanest/messages/en.json';
import RegisterScreen from '../../app/(auth)/register';
import SignInScreen from '../../app/(auth)/sign-in';
import { providerSettings } from '../../api/config';
import { ProviderCancelled, signInWithApple, signInWithGoogle } from '../../lib/providers';

/**
 * The provider block on sign-in and register — issue #152. The flows themselves are
 * `lib/providers.test.ts`'s; here, which buttons appear, what they are called, and that every
 * answer goes through the form's one `settle()` — a challenge included.
 */

const mockRouter = {
  replace: jest.fn(),
  dismissTo: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  setParams: jest.fn(),
};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

jest.mock('../../api/config', () => ({
  ...jest.requireActual('../../api/config'),
  providerSettings: jest.fn(() => ({ googleIosClientId: 'ios-client-id', appleSignIn: true })),
}));

jest.mock('../../lib/providers', () => ({
  ...jest.requireActual('../../lib/providers'),
  signInWithGoogle: jest.fn(),
  signInWithApple: jest.fn(),
}));

jest.mock('../../lib/push', () => ({
  ...jest.requireActual('../../lib/push'),
  registerIfAllowed: jest.fn(async () => ({ status: 'denied' })),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const copy = en.auth;
const mobile = en.mobile.auth;

async function show(screenElement: ReactElement) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={en}>
          {children}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  await render(screenElement, { wrapper });
  // `isAvailableAsync` settles after the first render.
  await act(async () => {});
}

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(providerSettings)
    .mockReturnValue({ googleIosClientId: 'ios-client-id', appleSignIn: true });
  jest.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValue(true);
});

it('names the separator and both buttons in the app’s language on sign-in', async () => {
  await show(<SignInScreen />);

  expect(screen.getByLabelText(copy.providers.separatorLabel)).toBeTruthy();
  expect(screen.getByRole('button', { name: mobile.googleSignIn })).toBeTruthy();
  expect(screen.getByRole('button', { name: copy.providers.appleSignIn })).toBeTruthy();
});

it('uses the sign-up wording on register', async () => {
  await show(<RegisterScreen />);

  expect(screen.getByRole('button', { name: mobile.googleRegister })).toBeTruthy();
  expect(screen.getByRole('button', { name: copy.providers.appleRegister })).toBeTruthy();
});

it('draws no provider block when the build configures none', async () => {
  jest.mocked(providerSettings).mockReturnValue({ googleIosClientId: '', appleSignIn: false });
  await show(<SignInScreen />);

  expect(screen.queryByTestId('provider-buttons')).toBeNull();
  expect(screen.queryByLabelText(copy.providers.separatorLabel)).toBeNull();
});

it('hides Apple where the device cannot offer it', async () => {
  jest.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValue(false);
  await show(<SignInScreen />);

  expect(screen.queryByRole('button', { name: copy.providers.appleSignIn })).toBeNull();
  expect(screen.getByRole('button', { name: mobile.googleSignIn })).toBeTruthy();
});

it('finishes a Google sign-in through the same settle as a password', async () => {
  jest.mocked(signInWithGoogle).mockResolvedValueOnce({ kind: 'signed-in' });
  await show(<SignInScreen />);

  await fireEvent.press(screen.getByRole('button', { name: mobile.googleSignIn }));

  expect(signInWithGoogle).toHaveBeenCalledTimes(1);
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

it('takes an Apple account with two-factor on to the two-factor step', async () => {
  jest
    .mocked(signInWithApple)
    .mockResolvedValueOnce({ kind: 'two-factor', challenge: 'chal-1', expiresInSeconds: 300 });
  await show(<RegisterScreen />);

  await act(async () => {
    screen.getByRole('button', { name: copy.providers.appleRegister }).props.onAccessibilityTap();
  });

  expect(screen.getByRole('header', { name: copy.register.twoFactorTitle })).toBeTruthy();
  expect(screen.getByLabelText(copy.twoFactor.codeLabel)).toBeTruthy();
  expect(mockRouter.back).not.toHaveBeenCalled();
});

it('signs in when the native Apple button itself is pressed', async () => {
  jest.mocked(signInWithApple).mockResolvedValueOnce({ kind: 'signed-in' });
  await show(<SignInScreen />);

  // The native control's own press, which is what a finger reaches.
  await fireEvent.press(
    screen.getByTestId(
      `apple-native-button-${AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}`,
      { includeHiddenElements: true },
    ),
  );

  expect(signInWithApple).toHaveBeenCalledTimes(1);
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

it('holds the password submit while a provider sign-in is in flight', async () => {
  let answer: () => void = () => {};
  jest.mocked(signInWithGoogle).mockReturnValueOnce(
    new Promise((resolve) => (answer = () => resolve({ kind: 'signed-in' }))),
  );
  await show(<SignInScreen />);
  await fireEvent.changeText(screen.getByLabelText(copy.fields.email), 'a@example.com');
  await fireEvent.changeText(screen.getByLabelText(copy.fields.password), 'correct horse');

  await fireEvent.press(screen.getByRole('button', { name: mobile.googleSignIn }));

  expect(
    screen.getByRole('button', { name: copy.signIn.submit }).props.accessibilityState,
  ).toMatchObject({ disabled: true });
  await act(async () => answer());
});

it('says nothing when the person closes the browser', async () => {
  jest.mocked(signInWithGoogle).mockRejectedValueOnce(new ProviderCancelled());
  await show(<SignInScreen />);

  await fireEvent.press(screen.getByRole('button', { name: mobile.googleSignIn }));

  expect(screen.queryByTestId('provider-failure')).toBeNull();
  expect(screen.getByRole('button', { name: mobile.googleSignIn })).toBeTruthy();
});

it('describes a refusal as a password refusal is described', async () => {
  jest
    .mocked(signInWithGoogle)
    .mockRejectedValueOnce(new ApiError(403, { status: 403, code: 'ACCOUNT_SUSPENDED' }));
  await show(<SignInScreen />);

  await fireEvent.press(screen.getByRole('button', { name: mobile.googleSignIn }));

  expect(screen.getByText(copy.failures.suspendedTitle)).toBeTruthy();
});
