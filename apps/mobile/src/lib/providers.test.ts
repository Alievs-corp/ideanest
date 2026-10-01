import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import { signInWithProvider } from './auth';
import {
  configuredProviders,
  generateNonce,
  hashNonce,
  ProviderCancelled,
  signInWithApple,
  signInWithGoogle,
} from './providers';

/**
 * Google and Apple on a phone — issue #152. The service has `require-nonce: true`, so the
 * assertions this file exists for are about the nonce: that what the provider is given and what
 * the service is sent are the same value, in the form each provider puts in its token.
 */

jest.mock('./auth', () => ({
  ...jest.requireActual('./auth'),
  signInWithProvider: jest.fn(async () => ({ kind: 'signed-in' })),
}));

/** The test controls `jest.setup.ts`'s `AuthRequest` mock exposes. */
const Request = AuthSession.AuthRequest as unknown as {
  last: { config: Record<string, unknown>; codeVerifier: string } | null;
  nextResult: unknown;
};

beforeEach(() => {
  jest.clearAllMocks();
  Request.last = null;
  Request.nextResult = null;
});

describe('configuredProviders', () => {
  it.each([
    ['ios', { googleIosClientId: 'g', appleSignIn: true }, ['google', 'apple']],
    ['ios', { googleIosClientId: 'g', appleSignIn: false }, ['google']],
    ['ios', { googleIosClientId: '', appleSignIn: true }, ['apple']],
    ['ios', { googleIosClientId: '', appleSignIn: false }, []],
    // Neither on Android yet: no Apple SDK, and Google's flow there cannot carry our nonce.
    ['android', { googleIosClientId: 'g', appleSignIn: true }, []],
  ] as const)('on %s with %j offers %j', (os, settings, offered) => {
    expect(configuredProviders(os, settings)).toEqual(offered);
  });
});

describe('the nonce', () => {
  it('is 32 random bytes as base64url, fresh each time', () => {
    const first = generateNonce();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateNonce()).not.toBe(first);
  });

  it('hashes to lowercase SHA-256 hex', async () => {
    await expect(hashNonce('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('Sign in with Apple', () => {
  it('gives the sheet a SHA-256 and sends the service that same hash, with the name', async () => {
    jest.mocked(AppleAuthentication.signInAsync).mockResolvedValueOnce({
      identityToken: 'apple-id-token',
      fullName: { givenName: 'Aysel', familyName: 'Məmmədova' },
    } as AppleAuthentication.AppleAuthenticationCredential);

    await expect(signInWithApple()).resolves.toEqual({ kind: 'signed-in' });

    const given = jest.mocked(AppleAuthentication.signInAsync).mock.calls[0]?.[0];
    expect(given?.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(given?.requestedScopes).toEqual([
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ]);
    expect(signInWithProvider).toHaveBeenCalledWith({
      provider: 'apple',
      idToken: 'apple-id-token',
      nonce: given?.nonce,
      name: 'Aysel Məmmədova',
    });
  });

  it('sends no name on a later sign-in, when Apple gives none', async () => {
    jest.mocked(AppleAuthentication.signInAsync).mockResolvedValueOnce({
      identityToken: 'apple-id-token',
      fullName: { givenName: null, familyName: null },
    } as unknown as AppleAuthentication.AppleAuthenticationCredential);

    await signInWithApple();

    expect(jest.mocked(signInWithProvider).mock.calls[0]?.[0]).not.toHaveProperty('name');
  });

  it('reports a closed sheet as a cancellation, and asks the service nothing', async () => {
    await expect(signInWithApple()).rejects.toBeInstanceOf(ProviderCancelled);
    expect(signInWithProvider).not.toHaveBeenCalled();
  });
});

describe('Sign in with Google', () => {
  it('puts the nonce in the request, exchanges the code with PKCE, and sends the same nonce', async () => {
    Request.nextResult = { type: 'success', params: { code: 'auth-code' } };
    jest.mocked(AuthSession.exchangeCodeAsync).mockResolvedValueOnce({
      idToken: 'google-id-token',
    } as AuthSession.TokenResponse);

    await expect(signInWithGoogle('ios-client-id')).resolves.toEqual({ kind: 'signed-in' });

    const config = Request.last?.config as {
      clientId: string;
      redirectUri: string;
      usePKCE: boolean;
      extraParams: { nonce: string };
    };
    expect(config.clientId).toBe('ios-client-id');
    expect(config.redirectUri).toBe('az.ideanest.app:/oauthredirect');
    expect(config.usePKCE).toBe(true);
    expect(config.extraParams.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(jest.mocked(AuthSession.exchangeCodeAsync).mock.calls[0]?.[0]).toMatchObject({
      clientId: 'ios-client-id',
      code: 'auth-code',
      redirectUri: 'az.ideanest.app:/oauthredirect',
      extraParams: { code_verifier: 'test-code-verifier' },
    });
    expect(signInWithProvider).toHaveBeenCalledWith({
      provider: 'google',
      idToken: 'google-id-token',
      nonce: config.extraParams.nonce,
    });
  });

  it.each(['cancel', 'dismiss'])('reports a %s as a cancellation', async (type) => {
    Request.nextResult = { type };
    await expect(signInWithGoogle('ios-client-id')).rejects.toBeInstanceOf(ProviderCancelled);
    expect(AuthSession.exchangeCodeAsync).not.toHaveBeenCalled();
  });

  it('throws the provider’s error', async () => {
    Request.nextResult = { type: 'error', error: new Error('access_denied') };
    await expect(signInWithGoogle('ios-client-id')).rejects.toThrow('access_denied');
  });

  it('refuses an exchange that returned no ID token', async () => {
    Request.nextResult = { type: 'success', params: { code: 'auth-code' } };
    await expect(signInWithGoogle('ios-client-id')).rejects.toThrow(/no ID token/);
    expect(signInWithProvider).not.toHaveBeenCalled();
  });
});
