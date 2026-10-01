/**
 * The campaign page's tabs — §4.4's table, as addresses rather than as component state.
 *
 * <h2>A query parameter, and the two alternatives it beat</h2>
 *
 * §4.4 lists seven tabs on one page. Three ways to express that:
 *
 * <ol>
 *   <li><strong>Local state.</strong> `useState` in a client component that swaps the panel.
 *       Rejected outright, twice over. It makes the whole tab shell a client boundary on the
 *       one route #119 exists to keep server-rendered, and — worse — it makes the Comments
 *       tab unlinkable and uncrawlable. A creator who answers a question in the comments
 *       cannot send anybody to the answer, and a search engine is served a page whose
 *       updates and comments do not exist. The content is public and the endpoints behind it
 *       are `permitAll`; hiding it behind a click is throwing it away.
 *   <li><strong>A nested route per tab</strong> — `/projects/{creator}/{slug}/comments`.
 *       Linkable and crawlable, and still rejected. It multiplies one URL into six that
 *       differ by a panel, so every one of them needs a canonical pointing at the campaign
 *       and five of them are duplicate-content candidates until it does; it needs a layout
 *       to hold the header, which means the header's read is either repeated or lifted into
 *       a layout that cannot see the tab; and it adds five entries to
 *       `apps/web/performance/budgets.json`, which CI fails on in both directions.
 *   <li><strong>A query parameter</strong> — `?tab=comments`. One route, one budget entry,
 *       one canonical URL (`projectPageMetadata` already builds it from the path alone, so
 *       every tab points at the campaign), and a link that opens the tab it names. The tab
 *       list is `<a href>` elements, so it works with no JavaScript at all and a crawler
 *       follows it like any other link.
 * </ol>
 *
 * <h2>On the app, the same parameter</h2>
 *
 * The app's campaign screen keeps the tab in local state synced to the same `?tab=` route
 * parameter (#155), so a shared link `/projects/a/b?tab=comments` opens the Comments tab on a
 * phone exactly as it does in a browser. That is why the parameter names, the tab order and
 * the readers live in `@ideanest/campaign`; building a web address (`campaignTabHref`) stays
 * in `apps/web`, because only the web has addresses of that shape.
 *
 * The cost of the third option is that switching tabs is a navigation rather than a repaint.
 * That is the right cost on this page: each tab is a separate public read, so a click was
 * always going to be a round trip, and Next serves it as an RSC payload rather than a
 * document.
 *
 * <h2>The default tab has no parameter</h2>
 *
 * `?tab=campaign` and the bare path are the same page, so the bare path is the only one this
 * module ever produces. One address for the default state is what keeps the canonical URL,
 * the sitemap entry and the link somebody pastes into a message from being three different
 * strings for one campaign.
 *
 * <h2>Five tabs, not seven, and the missing two are named</h2>
 *
 * <ul>
 *   <li><strong>Rewards</strong> is on the page rather than in the tab list. The tier list is
 *       the column beside the story (`CampaignRewards`), where it stays visible while a
 *       reader is deciding — moving it into a tab is its own issue, and doing it here would
 *       hide the reward tiers behind a click on every campaign for the sake of matching a
 *       table.
 *   <li><strong>Community</strong> is blocked on #209, and §4.4 says why: a backer-statistics
 *       bucket below a minimum cell size identifies the person in it, and the minimum is a
 *       product and legal answer rather than an implementation detail.
 * </ul>
 *
 * <h2>The tab strip is five wide, and it scrolls rather than wraps</h2>
 *
 * `CampaignTabs` renders one row with `overflow-x-auto` and no wrapping. Five labels do not
 * fit across a narrow phone, and a wrapped second row would push the campaign's own content
 * down by a line on exactly the viewports where vertical space is scarcest. The row is
 * therefore scrollable, every label stays on one line, and each link is reachable by Tab —
 * which scrolls it into view without any script.
 */

/** The name in the address bar. One constant, read by the page and by every link. */
export const CAMPAIGN_TAB_PARAM = 'tab';

/**
 * Where a paged tab starts reading from.
 *
 * <h2>One parameter for two tabs, and why that is not a collision</h2>
 *
 * The Updates and Comments tabs are both cursor-paged, and exactly one of them is rendered
 * per request — the tab parameter decides which — so one name can serve both. Two names
 * (`updatesFrom`, `commentsFrom`) would be two parameters of which one is always dead, and
 * the dead one is the one that goes stale in a link somebody bookmarked.
 *
 * <h2>The value is the service's, unread</h2>
 *
 * An update cursor is an integer and a comment cursor is a UUID. Neither is parsed here:
 * they are carried from the `nextCursor` the service sent, through the URL, back to the
 * service. A client that looked inside either would be a client that breaks the day the
 * encoding changes — which is the argument `lib/community/signals.ts` already makes about the
 * same kind of value.
 *
 * <h2>Forward only, deliberately</h2>
 *
 * There is a link to the older page and none back to the newer one. A keyset cursor names
 * where to start, not where you came from, so a "newer" link would have to be built from a
 * history this page does not keep — and the browser already keeps it, correctly, under the
 * Back button.
 */
export const CAMPAIGN_CURSOR_PARAM = 'from';

/**
 * Which conversation to open in full — the Comments tab only.
 *
 * `GET /v1/projects/{id}/comments` publishes two reads on one route: without `thread` it is
 * the tab, a page of conversations each carrying a preview of its replies; with it, one
 * conversation and a page of that conversation's replies. The service's own controller argues
 * why it is a parameter rather than a second route — "the same resource with a narrower
 * question" — and the same argument decides it here.
 *
 * <strong>It is what makes "show more replies" a link.</strong> The alternative is a client
 * component that fetches the rest of a thread on a press, which would be a client boundary
 * per conversation on the route #119 exists for, and a reply nobody could link to.
 */
export const CAMPAIGN_THREAD_PARAM = 'thread';

export type CampaignTabId = 'campaign' | 'creator' | 'faq' | 'updates' | 'comments';

/**
 * One tab, as an identity and a position — and deliberately without a label.
 *
 * The words are the catalogue's (`campaign.tabs.{id}`), resolved by `CampaignTabs` on the server
 * in the reader's language (and by the app's tab bar with `useT()`). #132 found this constant carrying English labels that every locale
 * drew, and the id is already the key, so a label here could only ever be a second, English-only
 * copy of what the catalogue says.
 */
export interface CampaignTab {
  readonly id: CampaignTabId;
}

/**
 * The tabs, in the order §4.4 lists the ones that exist.
 *
 * Campaign first because it is the default and the page's own content; Creator, FAQ, Updates
 * and Comments after it, which is the order of how far a reader has already got — who made
 * this, what they have already been asked, what has happened since, what everybody else is
 * saying.
 *
 * FAQ sits between Creator and Updates because that is where §4.4's table puts it, and the
 * table's order is the reading order: the answers a creator has already written are what a
 * reader with a question should meet before the comment box.
 */
export const CAMPAIGN_TABS: readonly CampaignTab[] = Object.freeze([
  { id: 'campaign' },
  { id: 'creator' },
  { id: 'faq' },
  { id: 'updates' },
  { id: 'comments' },
]);

/** The tab a bare campaign URL opens. */
export const DEFAULT_CAMPAIGN_TAB: CampaignTabId = 'campaign';

/**
 * The tab a query parameter names, or the default.
 *
 * <strong>An unknown value is the default rather than a 404.</strong> `?tab=nonsense` is a
 * mistyped link or a stripped-down crawler, and answering it with a missing page would take
 * a real campaign off the internet because of a query string nobody has to get right. The
 * canonical URL on every one of those responses still points at the bare path, so a search
 * engine is never told the mistyped address is a page of its own.
 *
 * A repeated parameter — `?tab=a&tab=b`, which Next hands over as an array — takes the first
 * value, for the same reason: one of them was meant, and refusing to guess would mean
 * refusing the page.
 */
export function campaignTabFrom(value: string | readonly string[] | undefined): CampaignTabId {
  const first = Array.isArray(value) ? value[0] : (value as string | undefined);
  if (typeof first !== 'string') return DEFAULT_CAMPAIGN_TAB;

  const match = CAMPAIGN_TABS.find((tab) => tab.id === first.toLowerCase());
  return match?.id ?? DEFAULT_CAMPAIGN_TAB;
}

/**
 * An opaque identifier a query parameter carries — a cursor or a thread id — or `null`.
 *
 * Trimmed and length-bounded, and otherwise passed through untouched. The bound is not an
 * opinion about the encoding — see {@link CAMPAIGN_CURSOR_PARAM} — it is a refusal to put a
 * kilobyte of somebody else's query string into an outbound request to the service.
 *
 * One function for both parameters, because both are values the service minted and neither is
 * this application's to interpret. A malformed one is answered by the service with a refusal,
 * which the tab renders as "this could not be loaded" — the alternative, validating the shape
 * here, would be this module holding an opinion about an encoding it was told not to read.
 */
export function campaignCursorFrom(value: string | readonly string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : (value as string | undefined);
  if (typeof first !== 'string') return null;

  const trimmed = first.trim();
  return trimmed === '' || trimmed.length > MAX_CURSOR_LENGTH ? null : trimmed;
}

/** Longer than any cursor the service mints — a UUID is 36 — and short enough to be a bound. */
const MAX_CURSOR_LENGTH = 128;
