const PAYOUT_PAGE = /^\/(?:(?:az|en|ru|tr)\/)?settings\/payout\/?$/;

/**
 * The native app's payout-card return (#161), the same mechanism as the pledge payment return in
 * `lib/pledges/app-return.ts`: the provider may only return to the site, so the app asks for
 * `/{locale}/settings/payout?card=…&via=app` and this answers it with the app's own address, which
 * ends the app's in-app browser session.
 *
 * The hint is read here rather than through `cardReturnHint` so the proxy does not import the
 * authorised API client that `payout.ts` carries.
 */
export function appCardReturn(url: URL): string | null {
  if (url.searchParams.get('via') !== 'app') return null;
  if (!PAYOUT_PAGE.test(url.pathname)) return null;
  const card = url.searchParams.get('card');
  return card === 'returned' || card === 'failed' ? `ideanest://settings/payout?card=${card}` : null;
}
