import { ApiError, type Problem } from '@ideanest/api-client';
import type { Translate } from './i18n';

/**
 * What an authentication refusal means, and what the reader is told about it — the web's
 * `lib/auth/failures.ts` and `credentials.ts#refusalOf`, on a phone (issue #152).
 *
 * <h2>The service's own words, and a `code` to branch on</h2>
 *
 * §10.4 gives every refusal a `title`, a `detail` and a `code`. Branching happens on `code` and
 * never on `detail`: `detail` is prose written for a person and may be reworded or translated at
 * any time. What is SHOWN is that prose, because the endpoint knows why it refused and this
 * module does not.
 *
 * <h2>Three refusals need more than their sentence</h2>
 *
 *   - `ACCOUNT_SUSPENDED` (403): the credentials were correct and no retry will change the
 *     answer, so it is the one refusal that withdraws the submit control.
 *   - The rate limit (429): the refusal expires, so the control stays and the wait is said.
 *   - No problem body at all: the request never reached the service, which points at the
 *     connection rather than at the password.
 *
 * <p>The sentences are the web's `auth.failures`, the same keys in the same four languages.
 */

export interface AuthFailure {
  /** The heading. Short, and never a status code. */
  readonly title: string;
  /** The sentence under it — the service's own where there is one. */
  readonly detail: string;
  /** False for exactly one refusal, a suspension. See the module note. */
  readonly retryable: boolean;
}

/**
 * "In under a minute", "in about a minute", "in about {n} minutes" — three keys rather than one
 * plural, because "under a minute" is a different claim from "about a minute".
 */
function waitFor(seconds: number, t: Translate): string {
  if (seconds <= 60) return t('auth.failures.waitUnderMinute');
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1
    ? t('auth.failures.waitOneMinute')
    : t('auth.failures.waitMinutes', { minutes });
}

export function describeAuthFailure(cause: unknown, t: Translate): AuthFailure {
  if (!(cause instanceof ApiError)) {
    /*
     * Not a refusal. `fetch` rejects with a TypeError when there is no connection, which is
     * the case a phone meets most — so a TypeError is the network, and anything else is a bug
     * in this application that must not be presented as though the reader's details were wrong.
     */
    return cause instanceof TypeError
      ? {
          title: t('auth.failures.unreachableTitle'),
          detail: t('auth.failures.unreachableDetail'),
          retryable: true,
        }
      : {
          title: t('auth.failures.unexpectedTitle'),
          detail: t('auth.failures.unexpectedDetail'),
          retryable: true,
        };
  }

  const problem = cause.problem;
  if (problem === null) {
    return {
      title: t('auth.failures.unreachableTitle'),
      detail: t('auth.failures.unreachableDetail'),
      retryable: true,
    };
  }

  if (problem.code === 'ACCOUNT_SUSPENDED') {
    return {
      title: problem.title ?? t('auth.failures.suspendedTitle'),
      detail: problem.detail ?? t('auth.failures.suspendedDetail'),
      retryable: false,
    };
  }

  if (cause.status === 429) {
    const seconds = problem.retryAfterSeconds;
    return {
      title: problem.title ?? t('auth.failures.rateLimitedTitle'),
      detail:
        seconds === undefined
          ? (problem.detail ?? t('auth.failures.rateLimitedDetail'))
          : t('auth.failures.retryAfter', {
              detail: problem.detail ?? t('auth.failures.rateLimitedShort'),
              wait: waitFor(seconds, t),
            }),
      retryable: true,
    };
  }

  return {
    title: problem.title ?? t('auth.failures.refusedTitle'),
    detail: problem.detail ?? t('auth.failures.refusedDetail'),
    retryable: true,
  };
}

/**
 * Field-level messages from a validation refusal, keyed by field name (§10.4's `errors`).
 * An empty map for anything else, so a screen can read it unconditionally.
 */
export function fieldErrorsOf(cause: unknown): Readonly<Record<string, string>> {
  if (!(cause instanceof ApiError)) return {};
  return cause.problem?.errors ?? {};
}

/** The credential refusals a screen branches on, as the web names them. */
export type CredentialRefusal =
  | 'incorrect-password'
  | 'weak-password'
  | 'email-already-in-use'
  | 'invalid-verification-link'
  | 'other';

const KNOWN: ReadonlySet<string> = new Set<CredentialRefusal>([
  'incorrect-password',
  'weak-password',
  'email-already-in-use',
  'invalid-verification-link',
]);

/**
 * Which credential refusal this is, from §10.4's `code` (`WEAK_PASSWORD` → `weak-password`) or,
 * on a body without one, the last segment of `type`. Never from `detail`.
 */
export function refusalOf(cause: unknown): CredentialRefusal {
  if (!(cause instanceof ApiError) || cause.problem === null) return 'other';
  const slug = slugOf(cause.problem);
  return slug !== null && KNOWN.has(slug) ? (slug as CredentialRefusal) : 'other';
}

function slugOf(problem: Problem): string | null {
  const code = problem.code?.trim() ?? '';
  if (code !== '') return code.toLowerCase().replace(/_/g, '-');

  const type = problem.type?.trim() ?? '';
  if (type === '') return null;
  const last = type.split('/').pop() ?? '';
  return last === '' ? null : last.toLowerCase();
}

/** The service's own sentence for a refusal, when it gave one. */
export function refusalDetailOf(cause: unknown): string | null {
  if (!(cause instanceof ApiError)) return null;
  return cause.problem?.detail ?? null;
}
