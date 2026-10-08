/**
 * The screens an in-app browser session is about to return to, so the link listener leaves their
 * links to it (#165).
 *
 * The payment page and the payout card page end by sending the browser to the site's return page,
 * which forwards to `ideanest://…` and ends the session (`features/checkout/payment.ts`,
 * `features/settings/payout/card-return.ts`). On Android that forward is also a `Linking` event,
 * and since #165 the site's own return URL is an App Link as well — so `listenForLinks` would push
 * the pledge, or the payout panel, on top of the flow that is already handling the return: two
 * navigations, and a checkout left on the wrong step.
 *
 * <p>While a session is open its target is claimed here and `listenForLinks` ignores a link that
 * routes to it. The claim outlives the session by {@link RETURN_GRACE_MS}: Android's polyfill
 * resolves on the app becoming active, which can come before the link that woke it. A return with
 * no session open — the process was killed while the browser was up — is not claimed, and opens
 * its screen as any link does.
 */

/** How long a claim holds after its session settles. */
export const RETURN_GRACE_MS = 2000;

/** Each claim's route, and when it lapses: `Infinity` while its session is open. */
const claims = new Map<symbol, { readonly pathname: string; until: number }>();

/**
 * Claims the route `pathname` (as `@ideanest/links` names it: `/pledges/<id>`, `/settings/payout`)
 * for an auth session, and returns the release — which takes effect {@link RETURN_GRACE_MS} later.
 */
export function claimReturnRoute(pathname: string): () => void {
  const key = Symbol(pathname);
  const claim = { pathname: pathname.toLowerCase(), until: Number.POSITIVE_INFINITY };
  claims.set(key, claim);
  return () => {
    if (claim.until === Number.POSITIVE_INFINITY) claim.until = Date.now() + RETURN_GRACE_MS;
  };
}

/** Whether an open (or just-settled) auth session is returning to this route. */
export function isClaimedReturnRoute(pathname: string): boolean {
  const wanted = pathname.toLowerCase();
  const now = Date.now();
  let claimed = false;
  for (const [key, claim] of claims) {
    if (claim.until <= now) claims.delete(key);
    else if (claim.pathname === wanted) claimed = true;
  }
  return claimed;
}

/** Runs `session` with `pathname` claimed, releasing the claim however it ends. */
export async function withClaimedReturnRoute<T>(pathname: string, session: () => Promise<T>): Promise<T> {
  const release = claimReturnRoute(pathname);
  try {
    return await session();
  } finally {
    release();
  }
}
