import { ApiError } from '@ideanest/api-client';
import { sendJson } from '../api/client';

/**
 * The pre-launch page's rules, apart from its screen — issue #155, mirroring the web's
 * `components/prelaunch/PrelaunchView.tsx` and `lib/projects/api.ts`.
 *
 * Pure where it can be, so the address check and the failure wording are tested without
 * rendering anything, and the one write is a function a screen test can watch on the wire.
 */

/**
 * The web's address check, character for character — `looksLikeAnAddress` in
 * `apps/web/src/components/prelaunch/PrelaunchView.tsx`. `prelaunch.test.ts` reads that file
 * and fails if the two patterns part.
 */
export const ADDRESS_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Loosely, and on purpose — the web's reasoning, which holds here unchanged.
 *
 * The server's own definition is deliberately loose: the only reliable test of an address is
 * sending to it, and a stricter pattern rejects valid addresses. This catches the mistake
 * somebody has just made — no `@`, or nothing after the dot — before it costs them a round
 * trip, and is not an authority on what an address is.
 */
export function looksLikeAnAddress(value: string): boolean {
  return ADDRESS_PATTERN.test(value.trim());
}

/** The answer to "tell me when this opens" — the service's `RemindResponse`. */
export interface RemindResult {
  /**
   * The count after this request, or `null` when the answer carried none — the screen then keeps
   * the count it has rather than drawing a zero the service never said.
   */
  readonly followerCount: number | null;
}

/**
 * Asks to be told when the campaign opens — `POST /v1/projects/{id}/remind`.
 *
 * The body is `{}` for a signed-in reader and `{ email }` for a guest. The address is never sent
 * with a session: the service uses the account's verified address, and sending one from here
 * would be sending an address the client chose over the one registration proved — the web's
 * `remindMe` says the same.
 */
export async function remindMe(projectId: string, email: string | null): Promise<RemindResult> {
  const body = email === null ? {} : { email };
  const answer = (await sendJson(
    'POST',
    `/v1/projects/${encodeURIComponent(projectId)}/remind`,
    body,
  )) as { followerCount?: unknown } | null;
  const count = answer?.followerCount;
  return {
    followerCount:
      typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null,
  };
}

/**
 * The refusal that means the campaign opened while the page sat on screen. Not a failure to tell
 * the reader about: what changed is that there is now a campaign to look at, so the screen goes to
 * its unavailable state with `alreadyOpen`, as the web does.
 */
export function remindersClosed(cause: unknown): boolean {
  return cause instanceof ApiError && cause.problem?.code === 'REMINDERS_CLOSED';
}

/** A read or a write that found no pre-launch page — no such campaign, a draft, or launched. */
export function noPrelaunchPage(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 404;
}

/**
 * What a failure says, as a key under `campaign.prelaunch.errors` and its one value.
 *
 * <ul>
 *   <li>429: `rateLimitedIn` with the minutes rounded UP from `retryAfterSeconds` (150 seconds is
 *       "about 3 minutes", never 2), or `rateLimited` when the service gave no figure;</li>
 *   <li>any other refusal: `notSaved`. The web prints the service's `detail` here; the issue's
 *       specification asks for the catalogue's sentence instead, because `detail` is prose the
 *       service may word in one language and reword at any time (`Problem.code`'s note);</li>
 *   <li>no answer at all: `unreachable`.</li>
 * </ul>
 */
export type PrelaunchFailure =
  | { readonly key: 'rateLimitedIn'; readonly minutes: number }
  | { readonly key: 'rateLimited' | 'notSaved' | 'unreachable' };

export function prelaunchFailure(cause: unknown): PrelaunchFailure {
  if (!(cause instanceof ApiError)) return { key: 'unreachable' };
  if (cause.status === 429) {
    const seconds = cause.problem?.retryAfterSeconds;
    return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
      ? { key: 'rateLimitedIn', minutes: Math.ceil(seconds / 60) }
      : { key: 'rateLimited' };
  }
  return { key: 'notSaved' };
}
