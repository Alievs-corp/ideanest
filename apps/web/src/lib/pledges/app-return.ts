import { paymentReturnHint, raiseReturnHint } from './payment';

const PLEDGE_PAGE = /^\/(?:(?:az|en|ru|tr)\/)?pledges\/([0-9A-Za-z-]{1,64})\/?$/;

/**
 * The native app's payment return (#157). The provider may only return to the site
 * (docs/architecture.md §9.4), so the app asks for `/{locale}/pledges/{id}?payment=…&via=app` and
 * this answers it with the app's own address, which ends the app's in-app browser session.
 */
export function appPaymentReturn(url: URL): string | null {
  if (url.searchParams.get('via') !== 'app') return null;
  const match = PLEDGE_PAGE.exec(url.pathname);
  if (match === null) return null;
  const payment = paymentReturnHint(url.search);
  if (payment !== null) return `ideanest://pledges/${match[1]}?payment=${payment}`;
  const raise = raiseReturnHint(url.search);
  return raise === null ? null : `ideanest://pledges/${match[1]}?raise=${raise}`;
}
