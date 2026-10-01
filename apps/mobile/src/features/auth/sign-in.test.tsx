import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import en from '@ideanest/messages/en.json';
import SignInScreen from '../../app/(auth)/sign-in';
import { signIn, verifyTwoFactor, type SignInOutcome } from '../../lib/auth';
import { registerIfAllowed } from '../../lib/push';

/**
 * The sign-in screen and its two-factor step — issue #152.
 *
 * <p>Here rather than beside `app/(auth)/sign-in.tsx` because every file under `src/app` is a
 * route to Expo Router, and a test file there would be offered as a screen.
 */

const mockRouter = {
  replace: jest.fn(),
  dismissTo: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  push: jest.fn(),
};
let mockParams: { returnTo?: string; notice?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

jest.mock('../../lib/auth', () => ({
  ...jest.requireActual('../../lib/auth'),
  signIn: jest.fn(),
  verifyTwoFactor: jest.fn(),
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

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          {children}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  const view = await render(<SignInScreen />, { wrapper });
  return { invalidate, view };
}

async function fillAndSubmit(email = 'backer@example.com', password = 'correct horse') {
  await fireEvent.changeText(screen.getByLabelText(copy.fields.email), email);
  await fireEvent.changeText(screen.getByLabelText(copy.fields.password), password);
  await fireEvent.press(screen.getByRole('button', { name: copy.signIn.submit }));
}

function challenge(expiresInSeconds = 300): SignInOutcome {
  return { kind: 'two-factor', challenge: 'chal-1', expiresInSeconds };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockRouter.canGoBack.mockReturnValue(true);
});

describe('the credentials step', () => {
  it('names every control', async () => {
    await renderScreen();

    expect(screen.getByRole('header', { name: copy.signIn.title })).toBeTruthy();
    expect(screen.getByLabelText(copy.fields.email)).toBeTruthy();
    expect(screen.getByLabelText(copy.fields.password)).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.fields.showPassword })).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.signIn.submit })).toBeTruthy();
  });

  it('sends the trimmed address, and leaves back to where somebody was', async () => {
    jest.mocked(signIn).mockResolvedValueOnce({ kind: 'signed-in' });
    const { invalidate } = await renderScreen();

    await fillAndSubmit('  backer@example.com ');

    expect(signIn).toHaveBeenCalledWith('backer@example.com', 'correct horse');
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
    // Push only where already allowed, and the account read again for Me.
    expect(registerIfAllowed).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] });
  });

  /*
   * `dismissTo`, not `replace`: a returnTo that is already in the stack — a tab — is popped back
   * to, where a replace would stack a second tab bar on the first.
   */
  it('goes back to a safe returnTo', async () => {
    mockParams = { returnTo: '/settings/language' };
    jest.mocked(signIn).mockResolvedValueOnce({ kind: 'signed-in' });
    await renderScreen();

    await fillAndSubmit();

    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/settings/language');
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('does not navigate when the modal was closed while the request was in flight', async () => {
    let answer: (outcome: SignInOutcome) => void = () => {};
    jest.mocked(signIn).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const { view } = await renderScreen();

    await fillAndSubmit();
    await view.unmount();
    await act(async () => answer({ kind: 'signed-in' }));

    // The person is somewhere else by now; a back() would pop the screen they went back to.
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
    // The session was still completed.
    expect(registerIfAllowed).toHaveBeenCalledTimes(1);
  });

  it.each(['/register', '//evil.example', 'https://evil.example'])(
    'ignores an unsafe returnTo %s and simply dismisses',
    async (returnTo) => {
      mockParams = { returnTo };
      jest.mocked(signIn).mockResolvedValueOnce({ kind: 'signed-in' });
      await renderScreen();

      await fillAndSubmit();

      expect(mockRouter.replace).not.toHaveBeenCalled();
      expect(mockRouter.dismissTo).not.toHaveBeenCalled();
      expect(mockRouter.back).toHaveBeenCalledTimes(1);
    },
  );

  it('disables the submit pill while the request is in flight', async () => {
    let answer: (outcome: SignInOutcome) => void = () => {};
    jest.mocked(signIn).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await renderScreen();

    await fillAndSubmit();

    const pill = screen.getByRole('button', { name: copy.signIn.submitting });
    expect(pill.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    await fireEvent.press(pill);
    expect(signIn).toHaveBeenCalledTimes(1);

    await act(async () => answer({ kind: 'signed-in' }));
  });

  it('withdraws the submit pill after a suspension', async () => {
    jest
      .mocked(signIn)
      .mockRejectedValueOnce(new ApiError(403, { code: 'ACCOUNT_SUSPENDED', status: 403 }));
    await renderScreen();

    await fillAndSubmit();

    expect(screen.getByText(copy.failures.suspendedTitle)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.signIn.submit })).toBeNull();
  });

  it('keeps the submit pill after a rate limit, and says the wait', async () => {
    jest
      .mocked(signIn)
      .mockRejectedValueOnce(new ApiError(429, { status: 429, retryAfterSeconds: 300 }));
    await renderScreen();

    await fillAndSubmit();

    expect(
      screen.getByText(`${copy.failures.rateLimitedShort} You can try again in about 5 minutes.`),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.signIn.submit })).toBeTruthy();
  });

  it('puts field errors under their fields', async () => {
    jest
      .mocked(signIn)
      .mockRejectedValueOnce(
        new ApiError(400, { status: 400, errors: { email: 'Enter a valid email address.' } }),
      );
    await renderScreen();

    await fillAndSubmit('not-an-address');

    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  });

  it('says the connection rather than the password when the phone is offline', async () => {
    jest.mocked(signIn).mockRejectedValueOnce(new TypeError('Network request failed'));
    await renderScreen();

    await fillAndSubmit();

    expect(screen.getByText(copy.failures.unreachableTitle)).toBeTruthy();
  });

  it('shows the password-changed notice for that exact value only', async () => {
    mockParams = { notice: 'password-changed' };
    await renderScreen();
    expect(screen.getByText(copy.signIn.passwordChangedTitle)).toBeTruthy();
  });

  it.each(['Password-changed', 'password-changed ', 'Your account was hacked'])(
    'shows nothing for the notice %j',
    async (notice) => {
      mockParams = { notice };
      await renderScreen();
      expect(screen.queryByText(copy.signIn.passwordChangedTitle)).toBeNull();
      expect(screen.queryByText(notice)).toBeNull();
    },
  );
});

describe('the two-factor step', () => {
  it('replaces the form, keeping the header', async () => {
    jest.mocked(signIn).mockResolvedValueOnce(challenge());
    await renderScreen();

    await fillAndSubmit();

    expect(screen.getByRole('header', { name: copy.signIn.title })).toBeTruthy();
    expect(screen.getByText(copy.twoFactor.acceptedTitle)).toBeTruthy();
    expect(screen.getByLabelText(copy.twoFactor.codeLabel)).toBeTruthy();
    expect(screen.queryByLabelText(copy.fields.email)).toBeNull();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('sends the code as code, then leaves', async () => {
    jest.mocked(signIn).mockResolvedValueOnce(challenge());
    jest.mocked(verifyTwoFactor).mockResolvedValueOnce();
    await renderScreen();
    await fillAndSubmit();

    await fireEvent.changeText(screen.getByLabelText(copy.twoFactor.codeLabel), ' 123456 ');
    await fireEvent.press(screen.getByRole('button', { name: copy.twoFactor.submit }));

    expect(verifyTwoFactor).toHaveBeenCalledWith('chal-1', { kind: 'code', code: '123456' });
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });

  it('keeps the recovery code behind a disclosure, and sends it as recoveryCode when both are filled', async () => {
    jest.mocked(signIn).mockResolvedValueOnce(challenge());
    jest.mocked(verifyTwoFactor).mockResolvedValueOnce();
    await renderScreen();
    await fillAndSubmit();

    const disclosure = screen.getByRole('button', { name: copy.twoFactor.cannotReach });
    expect(disclosure.props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.queryByLabelText(copy.twoFactor.recoveryLabel)).toBeNull();

    await fireEvent.press(disclosure);
    expect(
      screen.getByRole('button', { name: copy.twoFactor.cannotReach }).props.accessibilityState,
    ).toMatchObject({ expanded: true });

    await fireEvent.changeText(screen.getByLabelText(copy.twoFactor.codeLabel), '123456');
    await fireEvent.changeText(
      screen.getByLabelText(copy.twoFactor.recoveryLabel),
      'abcd-efgh-ijkl',
    );
    await fireEvent.press(screen.getByRole('button', { name: copy.twoFactor.submit }));

    expect(verifyTwoFactor).toHaveBeenCalledWith('chal-1', {
      kind: 'recovery-code',
      recoveryCode: 'abcd-efgh-ijkl',
    });
  });

  it('does not send a recovery code left behind a collapsed disclosure', async () => {
    jest.mocked(signIn).mockResolvedValueOnce(challenge());
    jest.mocked(verifyTwoFactor).mockResolvedValueOnce();
    await renderScreen();
    await fillAndSubmit();

    await fireEvent.press(screen.getByRole('button', { name: copy.twoFactor.cannotReach }));
    await fireEvent.changeText(screen.getByLabelText(copy.twoFactor.recoveryLabel), 'abcd-efgh');
    await fireEvent.press(screen.getByRole('button', { name: copy.twoFactor.cannotReach }));
    await fireEvent.changeText(screen.getByLabelText(copy.twoFactor.codeLabel), '123456');
    await fireEvent.press(screen.getByRole('button', { name: copy.twoFactor.submit }));

    expect(verifyTwoFactor).toHaveBeenCalledWith('chal-1', { kind: 'code', code: '123456' });
  });

  it('clears both fields after a refusal and says the service’s sentence', async () => {
    jest.mocked(signIn).mockResolvedValueOnce(challenge());
    jest
      .mocked(verifyTwoFactor)
      .mockRejectedValueOnce(new ApiError(401, { detail: 'That code was not accepted.' }));
    await renderScreen();
    await fillAndSubmit();

    await fireEvent.changeText(screen.getByLabelText(copy.twoFactor.codeLabel), '000000');
    await fireEvent.press(screen.getByRole('button', { name: copy.twoFactor.submit }));

    expect(screen.getByText('That code was not accepted.')).toBeTruthy();
    expect(screen.getByLabelText(copy.twoFactor.codeLabel).props.value).toBe('');
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('"Use a different account" returns to the credentials with the password cleared', async () => {
    jest.mocked(signIn).mockResolvedValueOnce(challenge());
    await renderScreen();
    await fillAndSubmit();

    await fireEvent.press(screen.getByRole('button', { name: copy.twoFactor.differentAccount }));

    expect(screen.getByLabelText(copy.fields.email).props.value).toBe('backer@example.com');
    expect(screen.getByLabelText(copy.fields.password).props.value).toBe('');
  });

  it('says the challenge has expired when its time is up, and starts over from there', async () => {
    jest.useFakeTimers();
    try {
      jest.mocked(signIn).mockResolvedValueOnce(challenge(300));
      await renderScreen();
      await fillAndSubmit();

      await act(async () => {
        jest.advanceTimersByTime(299_000);
      });
      expect(screen.queryByText(copy.twoFactor.expiredTitle)).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(1_000);
      });
      expect(screen.getByText(copy.twoFactor.expiredTitle)).toBeTruthy();
      expect(screen.queryByLabelText(copy.twoFactor.codeLabel)).toBeNull();

      await fireEvent.press(screen.getByRole('button', { name: copy.twoFactor.signInAgain }));
      expect(screen.getByLabelText(copy.fields.password).props.value).toBe('');
    } finally {
      jest.useRealTimers();
    }
  });
});
