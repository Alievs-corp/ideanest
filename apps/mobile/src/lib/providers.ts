import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Application from 'expo-application';
import {
  AuthRequest,
  exchangeCodeAsync,
  makeRedirectUri,
  ResponseType,
  type DiscoveryDocument,
} from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import { providerSettings, type ProviderSettings } from '../api/config';
import { signInWithProvider, type ProviderId, type SignInOutcome } from './auth';

/**
 * Signing in with Google and Apple on a phone — the web's `lib/auth/providers.ts` (issue #152).
 *
 * <h2>The same request as the web, from a different place</h2>
 *
 * Both end in `POST /v1/auth/oauth/{provider}` with an ID token and the nonce that token carries
 * (`signInWithProvider`). Nothing is exchanged on our server. What differs is where the token comes
 * from: the web renders Google's own button and Apple's JS; here Apple is the native sheet and
 * Google a system browser session.
 *
 * <h2>The nonce, which the service requires</h2>
 *
 * `require-nonce: true` for both providers. Each sign-in makes a fresh one from the platform's
 * CSPRNG (`expo-crypto`).
 *
 *   - **Apple** puts into the token exactly what the request was given, so the request is given
 *     the SHA-256 of a raw value and the service is sent the same hash (`OAuthSignInRequest`).
 *   - **Google** puts the `nonce` parameter of the authorisation request into the token as it is,
 *     so the raw value goes to both.
 *
 * <h2>Google on Android is not offered yet</h2>
 *
 * The system-browser flow used on iOS cannot be used there: Google refuses custom-scheme
 * redirects for Android OAuth clients, and there is no https endpoint of ours to redirect to. The
 * native route — Credential Manager — has to carry our nonce into the token, which the free
 * Google Sign-In library does not do. Android therefore shows email and password until that is
 * built and checked on a device (#241); Apple has no Android SDK at all.
 */

/**
 * Which providers this build offers on this platform, in the web's order. A provider with no
 * configuration renders no button, because the service would answer 501 or refuse the audience.
 */
export function configuredProviders(
  os: string = Platform.OS,
  settings: ProviderSettings = providerSettings(),
): readonly ProviderId[] {
  if (os !== 'ios') return [];
  const offered: ProviderId[] = [];
  if (settings.googleIosClientId !== '') offered.push('google');
  if (settings.appleSignIn) offered.push('apple');
  return offered;
}

/** A nonce: 32 bytes from the platform CSPRNG, base64url without padding — the web's shape. */
export function generateNonce(): string {
  const bytes = Crypto.getRandomBytes(32);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The SHA-256 of `raw`, as lowercase hex — what Apple is given and what its token carries. */
export async function hashNonce(raw: string): Promise<string> {
  return (
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw, {
      encoding: Crypto.CryptoEncoding.HEX,
    })
  ).toLowerCase();
}

/** The person closed the provider's sheet or browser. Not a failure: nothing is said. */
export class ProviderCancelled extends Error {
  constructor() {
    super('The provider sign-in was cancelled.');
    this.name = 'ProviderCancelled';
  }
}

/**
 * Sign in with Apple through the native sheet, then with the service.
 *
 * <p>The name comes only on the first authorisation and never again, so it is forwarded whenever
 * Apple gives it; the service uses it only when this sign-in creates the account.
 */
export async function signInWithApple(): Promise<SignInOutcome> {
  const nonce = await hashNonce(generateNonce());

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce,
    });
  } catch (cause) {
    if ((cause as { code?: unknown } | null)?.code === 'ERR_REQUEST_CANCELED') {
      throw new ProviderCancelled();
    }
    throw cause;
  }

  if (credential.identityToken === null || credential.identityToken === '') {
    throw new Error('Apple returned no identity token.');
  }

  const name = [credential.fullName?.givenName, credential.fullName?.familyName]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(' ');

  return await signInWithProvider({
    provider: 'apple',
    idToken: credential.identityToken,
    nonce,
    ...(name === '' ? {} : { name }),
  });
}

/** Google's endpoints, written out rather than read from the deprecated provider module. */
export const GOOGLE_DISCOVERY: DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

/**
 * Sign in with Google in a system browser session, then with the service.
 *
 * <p>Authorisation code with PKCE, as Google requires of an installed app; the exchange needs no
 * secret. The redirect is the bundle identifier's scheme (`app.config.ts` registers it). The ID
 * token comes from the exchange, and carries the `nonce` this request put in the URL.
 */
export async function signInWithGoogle(
  clientId: string = providerSettings().googleIosClientId,
): Promise<SignInOutcome> {
  const nonce = generateNonce();
  const redirectUri = makeRedirectUri({
    native: `${Application.applicationId ?? 'az.ideanest.app'}:/oauthredirect`,
  });
  const request = new AuthRequest({
    clientId,
    redirectUri,
    responseType: ResponseType.Code,
    scopes: ['openid', 'email', 'profile'],
    usePKCE: true,
    extraParams: { nonce, prompt: 'select_account' },
  });

  const result = await request.promptAsync(GOOGLE_DISCOVERY);
  if (result.type === 'cancel' || result.type === 'dismiss') throw new ProviderCancelled();
  if (result.type !== 'success') {
    throw result.type === 'error' && result.error !== null && result.error !== undefined
      ? result.error
      : new Error(`The Google sign-in ended with ${result.type}.`);
  }

  const code = result.params.code;
  if (code === undefined || code === '') throw new Error('Google returned no authorisation code.');

  const tokens = await exchangeCodeAsync(
    {
      clientId,
      code,
      redirectUri,
      extraParams: { code_verifier: request.codeVerifier ?? '' },
    },
    GOOGLE_DISCOVERY,
  );
  if (tokens.idToken === undefined || tokens.idToken === '') {
    throw new Error('Google returned no ID token.');
  }

  return await signInWithProvider({ provider: 'google', idToken: tokens.idToken, nonce });
}
