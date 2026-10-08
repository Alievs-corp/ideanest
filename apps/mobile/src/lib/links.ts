/**
 * Deep links and universal links in the application — §4.12 MB-02, issue #165.
 *
 * The claim (which paths open the app) and the parser (which screen a URL opens) are
 * `@ideanest/links`, shared with the web's association files and with `app.config.ts`'s intent
 * filters, so the three cannot drift. What is here is what only the application decides: what
 * to do with a link the parser does not answer, and the URL the share sheet sends.
 */
import { NOT_FOUND, destinationFor, type Destination } from '@ideanest/links/destination';
import { isClaimedReturnRoute } from './auth-session-links';

export { NOT_FOUND, destinationFor, hrefOf, isNotFound, type Destination } from '@ideanest/links/destination';

/** What an incoming link does. */
export type IncomingLink =
  | { readonly kind: 'route'; readonly destination: Destination }
  | { readonly kind: 'browser'; readonly url: string }
  | { readonly kind: 'ignore' };

const IGNORE: IncomingLink = { kind: 'ignore' };

/**
 * What to do with a URL the operating system handed over — a universal link, an app link, or the
 * custom scheme. Pure, so every branch is tested without a phone.
 *
 * <ul>
 *   <li>A link the parser answers opens its screen.</li>
 *   <li>Our host, over https, on a path the parser refuses (an OG image under `/projects/`,
 *       which Android's prefix cannot leave out; a page this build has no screen for) opens in the
 *       in-app browser. Refusing it silently would leave the reader in an app that opened and
 *       did nothing.</li>
 *   <li>`ideanest://` with a path the parser refuses opens the not-found screen: only this
 *       application writes that scheme, so there is no web page to fall back to.</li>
 *   <li>Any other host, `http:`, or something that is not a URL is ignored: an implicit intent
 *       from another application can carry anything, and `destinationFor` explains why http is
 *       never honoured.</li>
 * </ul>
 *
 * Nothing here logs the URL: an emailed link carries a one-time token in its query.
 */
export function incomingLink(url: string, siteHost: string): IncomingLink {
  const destination = destinationFor(url, siteHost);
  if (destination !== null) return { kind: 'route', destination };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return IGNORE;
  }
  if (parsed.protocol === 'ideanest:') return { kind: 'route', destination: NOT_FOUND };
  if (parsed.protocol === 'https:' && parsed.host.toLowerCase() === siteHost.toLowerCase()) {
    return { kind: 'browser', url: parsed.href };
  }
  return IGNORE;
}

/** The parts of `expo-linking` the listener uses, so a test can drive it. */
export interface LinkSource {
  getInitialURL(): Promise<string | null>;
  addEventListener(type: 'url', listener: (event: { url: string }) => void): { remove(): void };
}

/** Where an incoming link goes once {@link incomingLink} has decided. */
export interface LinkHandlers {
  readonly navigate: (destination: Destination) => void;
  readonly openBrowser: (url: string) => void;
}

/**
 * Routes the launch URL (a cold start) and every later one (the app in the background or open)
 * through {@link incomingLink}. One path for both, because a link that works only when the app is
 * already running is the bug deep links most often meet. Returns the unsubscribe.
 *
 * The handlers are the caller's, and `_layout.tsx` runs both through `openWhenAllowed`, so the app
 * lock and maintenance hold a link — the in-app browser included — until they open.
 */
export function listenForLinks(source: LinkSource, siteHost: string, handlers: LinkHandlers): () => void {
  let live = true;

  const open = (url: string | null) => {
    if (!live || url === null) return;
    const link = incomingLink(url, siteHost);
    if (link.kind === 'route') {
      if (!isClaimedReturnRoute(link.destination.pathname)) handlers.navigate(link.destination);
    }
    else if (link.kind === 'browser') handlers.openBrowser(link.url);
  };

  void source.getInitialURL().then(open);
  const subscription = source.addEventListener('url', (event) => open(event.url));

  return () => {
    live = false;
    subscription.remove();
  };
}

/**
 * The canonical web URL for a campaign — what the share sheet sends.
 *
 * The https form rather than the custom scheme, because a link sent to somebody
 * without the application installed has to be openable, and `ideanest://` is a
 * dead end in every browser. The universal-link association is what makes it
 * open the application for everybody who does have it.
 */
export function shareUrlFor(siteUrl: string, creatorSlug: string, projectSlug: string): string {
  return `${siteUrl}/projects/${encodeURIComponent(creatorSlug)}/${encodeURIComponent(projectSlug)}`;
}
