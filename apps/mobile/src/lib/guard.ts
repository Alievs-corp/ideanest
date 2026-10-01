/**
 * Which app routes need a signed-in reader, and where `returnTo` may point — issues #150, #152.
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

/**
 * Paths that must never be a post-sign-in destination: it would loop back into auth.
 *
 * Every route of the `(auth)` group, as the web's `AUTHENTICATION_PATHS` lists them — a return to
 * `/reset-password` would send somebody who has just signed in to the form for people who cannot.
 * The prefix rule covers `/reset-password/confirm`.
 */
const AUTH_PATHS =
  /^\/(sign-in|register|forgot-password|reset-password|verify-email|confirm-email-change)(\/|\?|#|$)/;

export function isGuarded(path: string): boolean {
  return GUARDED.some((pattern) => pattern.test(path));
}

/**
 * The destination to honour after signing in, or null when `returnTo` is not safe.
 *
 * App-relative only, the same rule as the web's `lib/auth/redirect.ts`: a value that
 * starts with `//`, carries a scheme or a backslash could send somebody off the
 * application, a control character is one a URL parser strips before resolving, and an
 * auth path would leave them where they started.
 *
 * Pattern-matched rather than parsed: React Native's `URL` does not implement `pathname`,
 * so the web's parse-against-a-dummy-base is not available here.
 */
export function safeReturnTo(value: string | readonly string[] | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw === '') return null;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  if (/\s/.test(raw)) return null;
  if (AUTH_PATHS.test(raw)) return null;
  return raw;
}

/** The sign-in route to present for a guarded path, preserving where to come back to. */
export function signInHrefFor(path: string): {
  pathname: '/sign-in';
  params: { returnTo: string };
} {
  return { pathname: '/sign-in', params: { returnTo: path } };
}
