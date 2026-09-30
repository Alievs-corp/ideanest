import { ApiError, errorFrom } from '@ideanest/api-client';
import * as Device from 'expo-device';
import { apiOrigin } from '../api/config';
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

/** What the account's session list calls this phone. Display only; never trusted. */
function deviceLabel(): string {
  return Device.deviceName ?? 'IdeyaNest on mobile';
}

/** The two shapes `POST /v1/auth/login` can answer with. */
export type SignInOutcome =
  | { readonly kind: 'signed-in' }
  /**
   * The password was right and §17.1's second factor is owed.
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

  const challenge = body as ChallengeBody;
  if (challenge.twoFactorRequired === true && typeof challenge.challenge === 'string') {
    return {
      kind: 'two-factor',
      challenge: challenge.challenge,
      expiresInSeconds: challenge.expiresInSeconds ?? 0,
    };
  }

  await adopt(body as TokenBody);
  return { kind: 'signed-in' };
}

/**
 * Finishes a sign-in that owed a second factor.
 *
 * <p>`code` and `recoveryCode` are both sent and the service reads the recovery
 * code only when no code arrived, so a form that filled in both is one attempt
 * rather than two — its own request object says so.
 */
export async function verifyTwoFactor(
  challenge: string,
  code: string,
  recoveryCode?: string,
): Promise<void> {
  const body = await post('/v1/auth/2fa/verify', {
    challenge,
    code: code === '' ? null : code,
    recoveryCode: recoveryCode === undefined || recoveryCode === '' ? null : recoveryCode,
    tokenDelivery: TOKEN_DELIVERY,
  });
  await adopt(body as TokenBody);
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
    // A network fault is not a revoked session, and neither is a 5xx — a 503 is
    // maintenance (issue #150). Nothing is cleared and the next attempt can succeed.
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
   * Shown to the maintenance trigger (issue #150) like every `sessionFetch` response. A cold
   * start with a stored session refreshes BEFORE its first read, so during an outage the
   * refresh is the first request to meet the 503 — and it throws here, before any read gets
   * as far as `sessionFetch`'s own check. A 503 is not a 401, so `runRefresh` keeps the
   * session: an outage never signs anybody out.
   */
  const response = observeResponse(
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
  return response.status === 204 ? null : await response.json();
}
