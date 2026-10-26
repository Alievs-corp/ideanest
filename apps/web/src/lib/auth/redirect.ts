/**
 * Where a sign-in sends somebody afterwards — and why almost nothing is allowed to decide
 * it.
 *
 * A GUARD THAT REDIRECTS TO A SIGN-IN HAS TO REMEMBER WHERE IT INTERRUPTED, or the price of
 * a fifteen-minute token expiring is that everybody lands on the home page and navigates
 * back by hand. It remembers it in the query string, which is the only place that survives
 * the full-page reload a sign-in performs.
 *
 * THAT MAKES IT ATTACKER-CONTROLLED, and an open redirect on a sign-in page is the classic
 * phishing primitive: a link to *our own* domain, with our own certificate and our own
 * padlock, that hands the reader to somebody else's login form the moment they have typed
 * their password into ours. So the value is never used as given.
 *
 * ONE FUNCTION, TWO CALLERS. The guard writes it and the sign-in page reads it. Splitting
 * "how it is written" from "how it is read" is how the two come to disagree about escaping,
 * and a redirect the reader half-decodes is a redirect that leaks a path segment.
 */

/** The parameter the guard writes and the sign-in page reads. */
export const RETURN_TO_PARAM = 'next';

/** Where somebody lands when there is nothing better to say. */
export const DEFAULT_SIGNED_IN_PATH = '/';

/**
 * The value in `?next=`, reduced to a path on this origin, or `null`.
 *
 * Every one of these is refused, and each has been a real vulnerability somewhere:
 *
 *   - **An absolute URL.** `https://ideanest.example.com.evil.test/` is a different site
 *     that starts with our name, and the reader reads the first thing after `https://`.
 *   - **A protocol-relative URL.** `//evil.test/x` has no scheme, is not "absolute" to a
 *     naive check, and is resolved by every browser as `https://evil.test/x`.
 *   - **A backslash.** Browsers normalise `\` to `/` in a URL, so `/\evil.test` and
 *     `\/evil.test` are the protocol-relative case wearing a hat.
 *   - **A `javascript:` or `data:` value**, which a check for "starts with a slash" catches
 *     and a check for "is not http" does not.
 *   - **A control character**, including the tab, newline and carriage return that browsers
 *     strip from a URL before resolving it — so `/\tx//evil.test` is `//evil.test` by the
 *     time it is followed.
 *
 * What survives is a path, its query, and its fragment, all on this origin. The path is
 * rebuilt from a parse against a fixed dummy base rather than pattern-matched, because a
 * parser is what the browser will use and a regular expression is what somebody will find
 * one more case for.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  const path = sameOriginPath(value);
  if (path === null) return null;

  /*
   * A return path pointing back at a sign-in page is a loop: signing in would land on the
   * form that has just been completed. It is not an attack, only a mistake — a link to
   * `/sign-in` clicked while already being sent to `/sign-in` — and the answer is the same
   * as having no value at all.
   *
   * The pathname is everything before the query or fragment: `sameOriginPath` rebuilt the
   * value from a parse, so a literal `?` or `#` inside the path is already percent-encoded.
   */
  const pathname = path.split(/[?#]/u)[0] ?? path;
  return isAuthenticationPath(pathname) ? null : path;
}

/**
 * The checks {@link safeReturnPath} makes about the ORIGIN, and nothing about where in the
 * application the path leads — the part every return address on this site needs (#587).
 *
 * SELF-CONTAINED ON PURPOSE: it closes over nothing in this module and uses nothing a
 * compiler would lower to a helper, because the maintenance page writes it into an inline
 * script with `Function.prototype.toString` (`lib/maintenance/script.ts`). The page's own
 * "go back to `?from=`" used to check two characters; this is the same parse the sign-in
 * redirect trusts, not a second copy of it.
 */
export function sameOriginPath(value: string | null | undefined): string | null {
  if (value == null) return null;

  const raw = value.trim();
  if (raw === '') return null;

  // Before anything else: a character a browser would strip is a character that changes
  // what the rest of the string means.
  if (/[\u0000-\u001f\u007f]/u.test(raw)) return null;

  // A path, not a URL. `//` and `/\` are the protocol-relative forms.
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;

  let parsed: URL;
  try {
    /*
     * The base is a constant nobody deploys to, and that is the point: anything that
     * resolves to a different host than this one is rejected below, whatever host we are
     * actually served from. Reading `location` here would make the function untestable and
     * unusable on the server for no gain.
     */
    parsed = new URL(raw, 'https://ideanest.invalid');
  } catch {
    return null;
  }

  if (parsed.origin !== 'https://ideanest.invalid') return null;

  return parsed.pathname + parsed.search + parsed.hash;
}

/**
 * The routes of `app/(auth)`, as paths.
 *
 * NAMED HERE RATHER THAN IMPORTED FROM THE ROUTE TREE, because the route tree has no
 * runtime representation to import. The list is short, it is checked by a test, and both
 * `safeReturnPath` and the guard read this one copy.
 */
const AUTHENTICATION_PATHS: readonly string[] = Object.freeze([
  '/sign-in',
  '/register',
  '/verify-email',

  /*
   * #271 and #277's landing pages, added with them.
   *
   * THE LOOP THESE PREVENT IS WORSE THAN THE ONE ABOVE, and it is why the list had to grow
   * rather than being left as "the three original screens". `?next=/reset-password` sends
   * somebody who has just signed in to the form for people who cannot; `?next=/verify-email`
   * at least lands on a page that does something. Both are mistakes rather than attacks — a
   * link clicked while the guard was already redirecting — and the answer is the same as
   * having no return path at all.
   *
   * The prefix rule below covers `/reset-password/confirm` without a second entry.
   */
  '/reset-password',
  '/confirm-email-change',
]);

export function isAuthenticationPath(pathname: string): boolean {
  return AUTHENTICATION_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * The sign-in URL that will come back to `pathname` afterwards.
 *
 * The current path is encoded once, here, so the guard has nothing to remember about
 * escaping. A path that is already a sign-in page produces a bare `/sign-in` rather than
 * one that returns to itself.
 */
export function signInHref(pathname: string): string {
  const target = safeReturnPath(pathname);
  if (target === null) return '/sign-in';
  return `/sign-in?${RETURN_TO_PARAM}=${encodeURIComponent(target)}`;
}
