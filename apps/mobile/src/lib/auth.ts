import { ApiError, errorFrom } from '@ideanest/api-client';
import * as Device from 'expo-device';
import { apiOrigin } from '../api/config';
import { translate } from './i18n';
import { currentLocale } from './locale';
import { observeResponse } from './maintenance';
import { unregisterFromPush } from './push';
import {
  endSession,
  rememberAccessToken,
  storeRefreshToken,
  storedRefreshToken,
} from './session';

/**
 * Signing in, refreshing, and signing out on a phone — §17.1, and MB-03's other half.
 *
 * <h2>Why this is not in `@ideanest/api-client`</h2>
 *
 * That package's own docblock says it: "no token handling, no refresh, no
 * retry… they are decisions about a session rather than about a request, and
 * mobile's will differ". They do differ, in the two ways that matter. The web
 * holds its refresh token in a `SameSite=Strict; HttpOnly` cookie and asks for
 * `tokenDelivery: "cookie"`; this asks for `"body"` — the shape §17.1 defines for
 * exactly this client — and puts what comes back in the platform keychain.
 *
 * <h2>REFRESH IS SINGLE-FLIGHT, AND IT IS NOT AN OPTIMISATION</h2>
 *
 * §17.1: a refresh token rotates on every use, and a token that is presented
 * twice is treated as stolen — the whole session family is revoked. Two
 * concurrent refreshes present the same rotated token, which is indistinguishable
 * from theft, so they do not merely waste a request: they end the session.
 *
 * A phone produces that situation far more readily than a browser does. Four
 * tabs of a feed, a saved list and a pledge list all resume together when
 * somebody unlocks their phone, and TanStack Query refetches every stale query
 * at once. All of them meet a fifteen-minute-old access token in the same
 * millisecond. {@link refreshAccessToken} is therefore one promise shared by
 * every caller until it settles, which `auth.test.ts` asserts by driving twenty
 * simultaneous callers and counting one network call.
 *
 * <p>The lock adds a second reason. With the lock (MB-03) on, a refresh reads a keychain item
 * that presents a biometric prompt; two of those would be two prompts stacked on
 * top of each other, and on Android the second is refused outright.
 *
 * <h2>What a failed refresh means</h2>
 *
 * The service has already revoked the session by the time it answers, so there
 * is nothing on this device worth keeping — {@link refreshAccessToken} clears
 * both halves before returning null. The one case that is deliberately NOT a
 * sign-out is a prompt the reader dismissed: {@code storedRefreshToken} returns
 * null without having asked the service anything, and the session stays where it
 * is so that "not now" does not mean "sign in again".
 */

/** How the service tells a native client apart from a browser. */
const TOKEN_DELIVERY = 'body';

/** Set on every call, exactly as `apps/web` sets it. §17.3's second lock. */
const CLIENT_HEADER = 'X-IdeaNest-Client';
const CLIENT_HEADER_VALUE = 'ideanest-mobile';

/**
 * What the account's session list calls this phone. Display only; never trusted.
 *
 * <p>The phone's own name where the platform gives one ("Aysel's iPhone"), because that is what
 * the owner recognises on the Devices screen. The fallback is a catalogue sentence rather than an
 * English literal: it is read back to the owner in their language on every device they own.
 */
export function deviceLabel(): string {
  const name = Device.deviceName?.trim();
  const label = name !== undefined && name !== '' ? name : translate()('mobile.auth.deviceFallback');
  // `SignInRequest` caps it at 120, and a longer phone name would refuse every sign-in with a
  // sentence about a field the owner cannot see. Cut by code point, not by UTF-16 unit.
  return Array.from(label).slice(0, DEVICE_LABEL_MAX).join('');
}

/** `SignInRequest.deviceLabel` and `OAuthSignInRequest.deviceLabel`: `@Size(max = 120)`. */
const DEVICE_LABEL_MAX = 120;

/** The two shapes `POST /v1/auth/login` can answer with. */
export type SignInOutcome =
  | { readonly kind: 'signed-in' }
  /**
   * The credentials were right and §17.1's second factor is owed — after a password or after a
   * provider, which is why both reach the same two-factor step.
   *
   * <p>The challenge is a credential for the next few minutes, so it is returned
   * to the caller and held in component state rather than written anywhere — the
   * same reasoning `apps/web`'s `TwoFactorChallenge` gives for the sign-in form
   * not having a URL of its own.
   */
  | { readonly kind: 'two-factor'; readonly challenge: string; readonly expiresInSeconds: number };

interface TokenBody {
  readonly accessToken?: string;
  readonly refreshToken?: string;
}

interface ChallengeBody {
  readonly twoFactorRequired?: boolean;
  readonly challenge?: string;
  readonly expiresInSeconds?: number;
}

/**
 * Signs in with an address and a password.
 *
 * @throws ApiError on any refusal, so a screen branches on `status` and on
 *     §10.4's `code` rather than on a boolean that has lost the reason
 */
export async function signIn(email: string, password: string): Promise<SignInOutcome> {
  const body = await post('/v1/auth/login', {
    email,
    password,
    deviceLabel: deviceLabel(),
    tokenDelivery: TOKEN_DELIVERY,
  });
  return await outcomeOf(body);
}

/** The two identity providers the service verifies (`OAuthSignInRequest`). */
export type ProviderId = 'google' | 'apple';

export interface ProviderSignInInput {
  readonly provider: ProviderId;
  /** The provider's ID token, exactly as the provider issued it. */
  readonly idToken: string;
  /**
   * The value the token's `nonce` claim carries — for Apple, the SHA-256 the sheet was given,
   * not the raw value (see `OAuthSignInRequest`). The service has `require-nonce: true`.
   */
  readonly nonce: string;
  /** Apple sends the person's name on the first authorisation only, and never again. */
  readonly name?: string;
}

/**
 * Signs in — or registers — with a provider's ID token.
 *
 * <p>The same answer as {@link signIn}: a provider account with two-factor switched on owes the
 * second factor exactly as a password sign-in does, so it reaches the same step. `locale` is the
 * app's language, which becomes the account's when the token creates one; the web sends none and
 * every account it creates starts in Azerbaijani.
 */
export async function signInWithProvider(input: ProviderSignInInput): Promise<SignInOutcome> {
  const name = input.name?.trim() ?? '';
  const body = await post(`/v1/auth/oauth/${input.provider}`, {
    idToken: input.idToken,
    nonce: input.nonce,
    ...(name === '' ? {} : { name }),
    locale: currentLocale(),
    deviceLabel: deviceLabel(),
    tokenDelivery: TOKEN_DELIVERY,
  });
  return await outcomeOf(body);
}

/** A sign-in answer: a session to adopt, or a challenge to hand back. */
async function outcomeOf(body: unknown): Promise<SignInOutcome> {
  const challenge = body as ChallengeBody | null;
  if (challenge?.twoFactorRequired === true) {
    /*
     * Nothing is adopted. Half a sign-in is not a session, and a client that ignored the flag
     * would store `undefined` and believe itself signed in. A flag with no challenge is a
     * contract this build does not understand: the step it leads to could never be answered.
     */
    if (typeof challenge.challenge !== 'string' || challenge.challenge === '') {
      throw new Error('The sign-in response asked for a second factor and carried no challenge.');
    }
    return {
      kind: 'two-factor',
      challenge: challenge.challenge,
      expiresInSeconds: challenge.expiresInSeconds ?? 0,
    };
  }

  await adopt(issuedPair(body, 'The sign-in response carried neither a token pair nor a challenge.'));
  return { kind: 'signed-in' };
}

/**
 * The pair a token-issuing call answered with, or a throw.
 *
 * <p>A 200 carrying no pair is a contract this build does not understand. Treating it as success
 * would leave the phone believing it is signed in while every request 401s — the confusing half
 * of that failure.
 */
function issuedPair(body: unknown, complaint: string): Required<TokenBody> {
  const tokens = body as TokenBody | null;
  if (typeof tokens?.accessToken !== 'string' || typeof tokens.refreshToken !== 'string') {
    throw new Error(complaint);
  }
  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
}

/**
 * What answers a two-factor challenge: a code from the authenticator, or a recovery code.
 *
 * <p>Two shapes rather than two optional strings, because the service reads them differently:
 * `SecondFactors.accepts` treats any non-blank `code` as a TOTP and never falls back, and `code`
 * is at most 16 characters. A recovery code typed into the code field is therefore always
 * refused — which is the bug the old single field had.
 */
export type TwoFactorProof =
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'recovery-code'; readonly recoveryCode: string };

/** Finishes a sign-in that owed a second factor. */
export async function verifyTwoFactor(challenge: string, proof: TwoFactorProof): Promise<void> {
  const body = await post('/v1/auth/2fa/verify', {
    challenge,
    code: proof.kind === 'code' ? proof.code : null,
    recoveryCode: proof.kind === 'recovery-code' ? proof.recoveryCode : null,
    tokenDelivery: TOKEN_DELIVERY,
  });
  await adopt(issuedPair(body, 'The two-factor response carried no token pair.'));
}

/* ------------------------------------------------------------------------------------------
 * The account lifecycle. None of these issues a session.
 * --------------------------------------------------------------------------------------- */

export interface RegistrationInput {
  readonly email: string;
  readonly password: string;
  readonly name: string;
}

/**
 * Asks for an account. The answer is always 202, whether or not the address already has one —
 * the service hides that on purpose, and the email says which it was.
 *
 * <p>`locale` is the app's language, which the service accepts (`az|en|ru|tr`) and keeps as the
 * account's language and the verification email's.
 */
export async function register(input: RegistrationInput): Promise<void> {
  await post('/v1/auth/register', {
    email: input.email,
    password: input.password,
    name: input.name,
    locale: currentLocale(),
  });
}

/** Spends an emailed verification link. Creates no session. */
export async function verifyEmail(token: string): Promise<void> {
  await post('/v1/auth/verify-email', { token });
}

/** Asks for a reset link. Always 202, for the reason {@link register} gives. */
export async function requestPasswordReset(email: string): Promise<void> {
  await post('/v1/auth/forgot-password', { email });
}

/**
 * Sets a new password with an emailed reset link.
 *
 * <p>The service revokes every session of that account. Nothing is signed out here: the account
 * this phone holds may be a different one, and if it is the same one its next refresh answers
 * 401, which {@link refreshAccessToken} already turns into a sign-out.
 */
export async function resetPassword(token: string, password: string): Promise<void> {
  await post('/v1/auth/reset-password', { token, password });
}

/** Spends an emailed email-change link. Sessions are not revoked by it. */
export async function confirmEmailChange(token: string): Promise<void> {
  await post('/v1/auth/confirm-email-change', { token });
}

let refreshInFlight: Promise<string | null> | null = null;

/**
 * Exchanges the stored refresh token for a fresh access token.
 *
 * <p>Single-flight — see the class note, which is where the reason lives.
 *
 * @returns the new access token, or null when there is no session, the prompt
 *     was refused, or the service refused the token
 */
export function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= runRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function runRefresh(): Promise<string | null> {
  const refreshToken = await storedRefreshToken();
  if (refreshToken === null) {
    /*
     * Either nobody is signed in or the biometric prompt was dismissed. Neither
     * is a reason to destroy the session: the first has nothing to destroy, and
     * the second is somebody deciding to stay locked. The access token is
     * dropped so that nothing carries on with a stale bearer.
     */
    rememberAccessToken(null);
    return null;
  }

  let body: TokenBody;
  try {
    body = (await post('/v1/auth/refresh', { refreshToken })) as TokenBody;
  } catch (failure) {
    if (failure instanceof ApiError && failure.status === 401) {
      // The service has already revoked the family. Keeping the local half would
      // mean every subsequent request carrying a credential that can only fail.
      await endSession();
      return null;
    }
    // A network fault is not a revoked session, and neither is a 5xx — maintenance
    // included (issue #214). Nothing is cleared and the next attempt can succeed.
    rememberAccessToken(null);
    throw failure;
  }

  await adopt(body);
  return body.accessToken ?? null;
}

/**
 * Ends the session on the service and on the device.
 *
 * <p>The local half goes first and unconditionally. If the network call fails
 * the reader is still signed out here, which is the safer of the two ways to be
 * wrong — the same order `apps/web`'s `signOut` takes.
 *
 * <p><strong>The push registration is dropped BEFORE the tokens are.</strong>
 * `lib/push.ts` needs the access token to make the call, and its own note says
 * why the order matters more than it looks: a token belongs to whoever signed in
 * most recently, and a registration that outlived a sign-out delivers one
 * person's pledge confirmations to the next person's lock screen. It cannot
 * fail loudly — sign-out completes whatever the network is doing — and the
 * service's retention sweep is the backstop.
 */
export async function signOut(): Promise<void> {
  const refreshToken = await storedRefreshToken();
  await unregisterFromPush();
  await endSession();

  if (refreshToken === null) return;
  try {
    await post('/v1/auth/logout', { refreshToken });
  } catch {
    /*
     * Swallowed deliberately. The token is already gone from this device, and
     * the session expires on its own; surfacing a failure would ask somebody to
     * retry an action that has, from their side, already happened.
     */
  }
}

/** Puts an issued pair where each half belongs. */
async function adopt(body: TokenBody): Promise<void> {
  rememberAccessToken(body.accessToken ?? null);
  await storeRefreshToken(body.refreshToken ?? null);
}

/**
 * One unauthenticated JSON write.
 *
 * <p>Every call in this module is one, which is why there is no bearer here: a
 * sign-in has no token yet and a refresh authenticates with the refresh token in
 * the body. `api/client.ts` is where an authenticated read goes.
 */
async function post(path: string, body: unknown): Promise<unknown> {
  /*
   * Shown to the maintenance trigger (issues #150, #214) like every `sessionFetch` response. A
   * cold start with a stored session refreshes BEFORE its first read, so during a window the
   * refresh is the first request to meet the maintenance problem (the service refuses a
   * reader's refresh without spending the token) — and it throws here, before any read gets
   * as far as `sessionFetch`'s own check. A 503 is not a 401, so `runRefresh` keeps the
   * session: maintenance never signs anybody out.
   */
  const response = await observeResponse(
    await fetch(apiOrigin() + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        [CLIENT_HEADER]: CLIENT_HEADER_VALUE,
      },
      body: JSON.stringify(body),
    }),
  );

  if (!response.ok) throw await errorFrom(response);
  /*
   * Read as text first: register, forgot-password and the reset answer 202 with no body at all,
   * and `json()` on an empty body throws — which would turn every accepted request into a
   * failure on screen.
   */
  const text = await response.text();
  return text === '' ? null : (JSON.parse(text) as unknown);
}
