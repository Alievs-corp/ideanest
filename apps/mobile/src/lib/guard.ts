/**
 * Which app routes need a signed-in reader, and where `next` may point — issue #150.
 *
 * The list is the web's `SESSION_REQUIRED_PATHS` (minus the administration console,
 * which is not in the app) written in this application's route names: the id-keyed
 * routes live under `campaigns/`, not `projects/`. `campaigns/[id]/back` is public on
 * purpose, exactly as the web page is: only reserving and paying need a token.
 *
 * Pure, so the table can be tested without a simulator.
 */

const GUARDED: readonly RegExp[] = [
  /^\/settings(\/|$)/,
  /^\/account(\/|$)/,
  /^\/notifications\/?$/,
  /^\/campaigns\/new\/?$/,
  /^\/campaigns\/[^/]+\/(edit|dashboard)(\/|$)/,
  /^\/pledges(\/|$)/,
];

/** Paths that must never be a post-sign-in destination: it would loop back into auth. */
const AUTH_PATHS = /^\/(sign-in|register|forgot-password|reset-password)(\/|\?|$)/;

export function isGuarded(path: string): boolean {
  return GUARDED.some((pattern) => pattern.test(path));
}

/**
 * The destination to honour after signing in, or null when `next` is not safe.
 *
 * App-relative only, the same rule as the web's `lib/auth/redirect.ts`: a value that
 * starts with `//`, carries a scheme or a backslash could send somebody off the
 * application, and an auth path would leave them where they started.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (typeof next !== 'string' || next === '') return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(next)) return null;
  if (AUTH_PATHS.test(next)) return null;
  return next;
}

/** The sign-in route to present for a guarded path, preserving where to come back to. */
export function signInHrefFor(path: string): { pathname: '/sign-in'; params: { next: string } } {
  return { pathname: '/sign-in', params: { next: path } };
}
