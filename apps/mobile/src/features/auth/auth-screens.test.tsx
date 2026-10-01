import type { ReactElement, ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IntlProvider } from 'use-intl';
import { ApiError } from '@ideanest/api-client';
import en from '@ideanest/messages/en.json';
import ConfirmEmailChangeScreen from '../../app/(auth)/confirm-email-change';
import RegisterScreen from '../../app/(auth)/register';
import ResetPasswordScreen from '../../app/(auth)/reset-password';
import ResetPasswordConfirmScreen from '../../app/(auth)/reset-password/confirm';
import SignInScreen from '../../app/(auth)/sign-in';
import VerifyEmailScreen from '../../app/(auth)/verify-email';
import {
  confirmEmailChange,
  register,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
} from '../../lib/auth';
import { forgetSpentTokens } from './link-token';

/**
 * Register, the password reset, and the two emailed links — issue #152.
 *
 * <p>Here rather than beside the routes because every file under `src/app` is a route to Expo
 * Router, and a test file there would be offered as a screen.
 */

const mockRouter = {
  replace: jest.fn(),
  back: jest.fn(),
  dismissTo: jest.fn(),
  setParams: jest.fn(),
  canGoBack: jest.fn(() => true),
  push: jest.fn(),
};
let mockParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

jest.mock('../../lib/auth', () => ({
  ...jest.requireActual('../../lib/auth'),
  register: jest.fn(),
  requestPasswordReset: jest.fn(),
  resetPassword: jest.fn(),
  verifyEmail: jest.fn(),
  confirmEmailChange: jest.fn(),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const copy = en.auth;

function problem(status: number, body: Record<string, unknown>): ApiError {
  return new ApiError(status, { status, ...body });
}

async function show(element: ReactElement, client = new QueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={en}>
          {children}
        </IntlProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  return await render(element, { wrapper });
}

/** A promise the test settles, so a "verifying" state can be looked at before it resolves. */
function deferred() {
  let settle: () => void = () => {};
  let refuse: (cause: unknown) => void = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    settle = resolve;
    refuse = reject;
  });
  return { promise, settle, refuse };
}

/** The shape `AuthExceptionHandler` sends for these refusals: a `type`, and no `code`. */
function refused(status: number, slug: string, detail?: string): ApiError {
  return problem(status, {
    type: `https://ideanest.az/problems/${slug}`,
    ...(detail === undefined ? {} : { detail }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  forgetSpentTokens();
  mockParams = {};
});

describe('sign-in links', () => {
  it('goes to the reset request, and to register carrying returnTo', async () => {
    mockParams = { returnTo: '/pledges' };
    await show(<SignInScreen />);

    await fireEvent.press(screen.getByRole('link', { name: copy.signIn.forgot }));
    expect(mockRouter.replace).toHaveBeenLastCalledWith('/reset-password');

    await fireEvent.press(screen.getByRole('link', { name: copy.signIn.createOne }));
    expect(mockRouter.replace).toHaveBeenLastCalledWith({
      pathname: '/register',
      params: { returnTo: '/pledges' },
    });
  });
});

describe('register', () => {
  async function fill(email = 'new@example.com') {
    await fireEvent.changeText(screen.getByLabelText(`${copy.register.name}, required`), 'Aysel');
    await fireEvent.changeText(screen.getByLabelText(`${copy.fields.email}, required`), email);
    await fireEvent.changeText(
      screen.getByLabelText(`${copy.fields.password}, required`),
      'a long password',
    );
    await fireEvent.press(screen.getByRole('button', { name: copy.register.submit }));
  }

  it('names every control', async () => {
    await show(<RegisterScreen />);
    expect(screen.getByRole('header', { name: copy.register.title })).toBeTruthy();
    expect(screen.getByLabelText(`${copy.register.name}, required`)).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.fields.showPassword })).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.register.signIn })).toBeTruthy();
  });

  it('lands on "check your email" with the address shown back', async () => {
    jest.mocked(register).mockResolvedValueOnce();
    await show(<RegisterScreen />);

    await fill(' new@example.com ');

    expect(register).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'a long password',
      name: 'Aysel',
    });
    expect(screen.getByRole('header', { name: copy.register.sentTitle })).toBeTruthy();
    expect(screen.getByText('new@example.com')).toBeTruthy();
    expect(screen.getByText(copy.register.sentExisting)).toBeTruthy();
  });

  /*
   * The service answers 202 for an address that already has an account, on purpose, so the client
   * cannot tell the two apart — and the sent state has no sentence that would claim otherwise.
   */
  it('never says whether the address already had an account', async () => {
    jest.mocked(register).mockResolvedValueOnce();
    await show(<RegisterScreen />);

    await fill('same@example.com');

    expect(screen.queryByText(/already registered|already exists|already has an account/i)).toBeNull();
    expect(screen.getByText(copy.register.sentExisting)).toBeTruthy();
  });

  it('puts the policy’s weak-password sentence under the password field', async () => {
    jest
      .mocked(register)
      .mockRejectedValueOnce(refused(400, 'weak-password', 'Use at least 10 characters.'));
    await show(<RegisterScreen />);

    await fill();

    // Once in the summary and once under the field — the response carries no `errors` map.
    expect(screen.getAllByText('Use at least 10 characters.')).toHaveLength(2);
    expect(screen.getByRole('button', { name: copy.register.submit })).toBeTruthy();
  });

  it('puts a validation error under its own field', async () => {
    jest
      .mocked(register)
      .mockRejectedValueOnce(problem(400, { errors: { name: 'A name is required.' } }));
    await show(<RegisterScreen />);

    await fill();

    expect(screen.getByText('A name is required.')).toBeTruthy();
  });

  it('says the wait after a 429 and keeps the form', async () => {
    jest.mocked(register).mockRejectedValueOnce(problem(429, { retryAfterSeconds: 30 }));
    await show(<RegisterScreen />);

    await fill();

    expect(
      screen.getByText(`${copy.failures.rateLimitedShort} You can try again in under a minute.`),
    ).toBeTruthy();
  });

  it('goes back to sign-in carrying returnTo', async () => {
    mockParams = { returnTo: '/settings/language' };
    await show(<RegisterScreen />);

    await fireEvent.press(screen.getByRole('link', { name: copy.register.signIn }));

    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/settings/language' },
    });
  });
});

describe('reset request', () => {
  it('names every control', async () => {
    await show(<ResetPasswordScreen />);
    expect(screen.getByRole('header', { name: copy.reset.title })).toBeTruthy();
    expect(screen.getByLabelText(`${copy.fields.email}, required`)).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.reset.submit })).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.reset.signIn })).toBeTruthy();
  });

  it('shows the address back, and "try another address" brings the form back with it', async () => {
    jest.mocked(requestPasswordReset).mockResolvedValueOnce();
    await show(<ResetPasswordScreen />);

    await fireEvent.changeText(
      screen.getByLabelText(`${copy.fields.email}, required`),
      'who@example.com',
    );
    await fireEvent.press(screen.getByRole('button', { name: copy.reset.submit }));

    expect(requestPasswordReset).toHaveBeenCalledWith('who@example.com');
    expect(screen.getByRole('header', { name: copy.reset.sentTitle })).toBeTruthy();
    expect(screen.getByText('who@example.com')).toBeTruthy();

    await fireEvent.press(screen.getByRole('link', { name: copy.reset.tryAnother }));
    expect(screen.getByLabelText(`${copy.fields.email}, required`).props.value).toBe(
      'who@example.com',
    );
  });

  it('keeps the button after a rate limit', async () => {
    jest.mocked(requestPasswordReset).mockRejectedValueOnce(problem(429, { retryAfterSeconds: 600 }));
    await show(<ResetPasswordScreen />);

    await fireEvent.changeText(screen.getByLabelText(`${copy.fields.email}, required`), 'a@b.c');
    await fireEvent.press(screen.getByRole('button', { name: copy.reset.submit }));

    expect(screen.getByText(copy.failures.rateLimitedTitle)).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.reset.submit })).toBeTruthy();
  });
});

describe('reset confirm', () => {
  const newPassword = `${copy.resetConfirm.newPassword}, required`;
  const repeat = `${copy.resetConfirm.repeat}, required`;

  async function type(first: string, second: string) {
    await fireEvent.changeText(screen.getByLabelText(newPassword), first);
    await fireEvent.changeText(screen.getByLabelText(repeat), second);
    await fireEvent.press(screen.getByRole('button', { name: copy.resetConfirm.submit }));
  }

  it('without a token, asks for the link instead of showing a form', async () => {
    await show(<ResetPasswordConfirmScreen />);
    expect(screen.getByRole('header', { name: copy.resetConfirm.noTokenTitle })).toBeTruthy();
    expect(screen.queryByLabelText(newPassword)).toBeNull();
    await fireEvent.press(screen.getByRole('link', { name: copy.resetConfirm.askForLink }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/reset-password');
  });

  it('takes the token off the route once it has it', async () => {
    mockParams = { token: 'tok-1' };
    await show(<ResetPasswordConfirmScreen />);
    expect(mockRouter.setParams).toHaveBeenCalledWith({ token: undefined });
  });

  it('refuses mismatched passwords without sending anything', async () => {
    mockParams = { token: 'tok-1' };
    await show(<ResetPasswordConfirmScreen />);

    await type('first password', 'first passwrod');

    expect(resetPassword).not.toHaveBeenCalled();
    expect(screen.getByText(copy.resetConfirm.mismatchTitle)).toBeTruthy();
    expect(screen.getByText(copy.resetConfirm.mismatchField)).toBeTruthy();
  });

  it('keeps the form — and the unspent token — on a weak password', async () => {
    mockParams = { token: 'tok-1' };
    jest
      .mocked(resetPassword)
      .mockRejectedValueOnce(refused(400, 'weak-password', 'Too short.'))
      .mockResolvedValueOnce();
    await show(<ResetPasswordConfirmScreen />);

    await type('short', 'short');
    expect(screen.getAllByText('Too short.').length).toBeGreaterThan(0);
    expect(screen.getByLabelText(newPassword)).toBeTruthy();

    await type('a much longer password', 'a much longer password');
    expect(resetPassword).toHaveBeenLastCalledWith('tok-1', 'a much longer password');
    expect(screen.getByRole('header', { name: copy.resetConfirm.doneTitle })).toBeTruthy();
  });

  it('shows the dead-link state with the service’s own sentence', async () => {
    mockParams = { token: 'tok-1' };
    jest
      .mocked(resetPassword)
      .mockRejectedValueOnce(refused(400, 'invalid-verification-link', 'This link has expired.'));
    await show(<ResetPasswordConfirmScreen />);

    await type('a long password', 'a long password');

    expect(screen.getByRole('header', { name: copy.resetConfirm.deadTitle })).toBeTruthy();
    expect(screen.getByText('This link has expired.')).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.resetConfirm.askNewLink })).toBeTruthy();
  });

  it('is done, and offers sign-in', async () => {
    mockParams = { token: 'tok-1' };
    jest.mocked(resetPassword).mockResolvedValueOnce();
    await show(<ResetPasswordConfirmScreen />);

    await type('a long password', 'a long password');
    await fireEvent.press(screen.getByRole('button', { name: copy.resetConfirm.signIn }));

    expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in');
  });
});

describe('verify email', () => {
  it('without a token, is idle and posts nothing', async () => {
    await show(<VerifyEmailScreen />);
    expect(screen.getByRole('header', { name: copy.verifyEmail.idleTitle })).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.verifyEmail.createAccount })).toBeTruthy();
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  // Strict Mode's second mount-time effect is `link-token.test.tsx`'s: this root has no strict flag.
  it('posts the token exactly once across a re-render, then says it is verified', async () => {
    mockParams = { token: 'tok-1' };
    const pending = deferred();
    jest.mocked(verifyEmail).mockReturnValueOnce(pending.promise);
    const view = await show(
      <VerifyEmailScreen />,
    );
    expect(screen.getByRole('header', { name: copy.verifyEmail.verifyingTitle })).toBeTruthy();

    await view.rerender(
      <VerifyEmailScreen />,
    );
    await act(async () => pending.settle());

    expect(verifyEmail).toHaveBeenCalledTimes(1);
    expect(verifyEmail).toHaveBeenCalledWith('tok-1');
    expect(screen.getByRole('header', { name: copy.verifyEmail.verifiedTitle })).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.verifyEmail.signIn })).toBeTruthy();
  });

  it('keeps the verified state once the token has been taken off the route', async () => {
    mockParams = { token: 'tok-1' };
    jest.mocked(verifyEmail).mockResolvedValueOnce();
    const view = await show(<VerifyEmailScreen />);
    await act(async () => {});

    // What `setParams({token: undefined})` leads to: the same screen with no token param.
    mockParams = {};
    await view.rerender(<VerifyEmailScreen />);

    expect(screen.getByRole('header', { name: copy.verifyEmail.verifiedTitle })).toBeTruthy();
    expect(verifyEmail).toHaveBeenCalledTimes(1);
  });

  it('spends a newer link opened over the screen, instead of dropping it', async () => {
    mockParams = { token: 'tok-1' };
    jest
      .mocked(verifyEmail)
      .mockRejectedValueOnce(problem(400, { detail: 'It was already used.' }))
      .mockResolvedValueOnce();
    const view = await show(<VerifyEmailScreen />);
    await act(async () => {});
    expect(screen.getByRole('header', { name: copy.verifyEmail.failedTitle })).toBeTruthy();

    mockParams = { token: 'tok-2' };
    await view.rerender(<VerifyEmailScreen />);
    await act(async () => {});

    expect(verifyEmail).toHaveBeenLastCalledWith('tok-2');
    expect(screen.getByRole('header', { name: copy.verifyEmail.verifiedTitle })).toBeTruthy();

    // And the newer token is the one held once it, too, is taken off the route.
    mockParams = {};
    await view.rerender(<VerifyEmailScreen />);
    await act(async () => {});
    expect(screen.getByRole('header', { name: copy.verifyEmail.verifiedTitle })).toBeTruthy();
    expect(verifyEmail).toHaveBeenCalledTimes(2);
  });

  it('gives a second mount of the same link the first one’s answer, without a second request', async () => {
    mockParams = { token: 'tok-1' };
    jest.mocked(verifyEmail).mockResolvedValueOnce();
    const first = await show(<VerifyEmailScreen />);
    await act(async () => {});
    await first.unmount();

    await show(<VerifyEmailScreen />);
    await act(async () => {});

    expect(verifyEmail).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('header', { name: copy.verifyEmail.verifiedTitle })).toBeTruthy();
  });

  it('shows the failure with the service’s words and the explanation', async () => {
    mockParams = { token: 'tok-1' };
    jest
      .mocked(verifyEmail)
      .mockRejectedValueOnce(problem(400, { title: 'Link refused', detail: 'It was already used.' }));
    await show(<VerifyEmailScreen />);
    await act(async () => {});

    expect(screen.getByRole('header', { name: copy.verifyEmail.failedTitle })).toBeTruthy();
    expect(screen.getByText('It was already used.')).toBeTruthy();
    expect(screen.getByText(copy.verifyEmail.failedExplain)).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: copy.verifyEmail.home }));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/');
  });
});

describe('confirm email change', () => {
  it('without a token, is idle and posts nothing', async () => {
    await show(<ConfirmEmailChangeScreen />);
    expect(screen.getByRole('header', { name: copy.emailChange.idleTitle })).toBeTruthy();
    expect(confirmEmailChange).not.toHaveBeenCalled();
  });

  it('posts once, refreshes the account, and leads to the email settings', async () => {
    mockParams = { token: 'tok-9' };
    jest.mocked(confirmEmailChange).mockResolvedValueOnce();
    const client = new QueryClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    await show(
      <ConfirmEmailChangeScreen />,
      client,
    );
    await act(async () => {});

    expect(confirmEmailChange).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] });
    expect(screen.getByRole('header', { name: copy.emailChange.confirmedTitle })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: copy.emailChange.goToAccount }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/settings/email');
  });

  it('says the address was taken first, and that the link is not spent', async () => {
    mockParams = { token: 'tok-9' };
    jest
      .mocked(confirmEmailChange)
      .mockRejectedValueOnce(refused(409, 'email-already-in-use'));
    await show(<ConfirmEmailChangeScreen />);
    await act(async () => {});

    expect(screen.getByRole('header', { name: copy.emailChange.takenTitle })).toBeTruthy();
    expect(screen.getByText(copy.emailChange.takenFallback)).toBeTruthy();
    expect(screen.getByText(copy.emailChange.takenNotSpent)).toBeTruthy();
  });

  it('refuses a dead link with the service’s sentence', async () => {
    mockParams = { token: 'tok-9' };
    jest
      .mocked(confirmEmailChange)
      .mockRejectedValueOnce(refused(400, 'invalid-verification-link', 'This link has expired.'));
    await show(<ConfirmEmailChangeScreen />);
    await act(async () => {});

    expect(screen.getByRole('header', { name: copy.emailChange.refusedTitle })).toBeTruthy();
    expect(screen.getByText(copy.emailChange.refusedAlertTitle)).toBeTruthy();
    expect(screen.getByText('This link has expired.')).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.emailChange.emailSettings })).toBeTruthy();
  });
});
