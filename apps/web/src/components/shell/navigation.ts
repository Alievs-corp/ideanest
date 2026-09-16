/**
 * What the header and the footer point at — §4.13 WS-01 and WS-02, stated once.
 *
 * <h2>It lists what exists, and nothing else</h2>
 *
 * The rule `DashboardNav` already states, and it matters more here because this is on every
 * page: an entry pointing at a 404 tells a visitor the site is broken, and one that is
 * disabled tells them it is unfinished. §4.13 names nine capabilities. About, How it works and
 * Trust and safety (WS-07) were absent until #292 built them and are in the footer now; the
 * legal pages (WS-08, #293) are still **not**, because that issue is blocked on a legal
 * deliverable §22 owns. They arrive with their pages.
 *
 * `apps/web/README.md` carries the route table this is derived from. When a route lands, it
 * is added here — one file, both surfaces, no chance of the footer knowing about a page the
 * header does not.
 *
 * <h2>Two lists, not one</h2>
 *
 * The header's is short because §8.6 gives it a 445-pixel pill to live in when collapsed;
 * the footer's is grouped because a footer is where somebody looks for the thing that was
 * not worth a slot in the header. They are separate data rather than one list with flags,
 * because "which of these is in the header" is a design decision that changes, and a flag
 * would put that decision in the wrong file.
 */

export interface NavigationLink {
  readonly href: string;
  /**
   * A key into `shell.*` in `messages/*.json`, never a word — issue #324.
   *
   * The label used to live here as an English literal, which made this module the copy as
   * well as the structure and meant a fifth language could not be added without editing the
   * route table. `SiteShell` resolves these on the server and hands the words down; nothing
   * in the browser ever sees the catalogue. `AccountLink` in `lib/account/navigation.ts`
   * made the same move first and carries the longer argument.
   */
  readonly key: string;
}

/** A link once its word has been looked up. What a component actually renders. */
export interface ResolvedNavigationLink {
  readonly href: string;
  readonly label: string;
}

/**
 * The primary navigation — the pill in the middle of the header, and the top of the mobile
 * drawer.
 *
 * THREE ENTRIES, AND THE THIRD IS THE LAST ONE THAT FITS. Discovery is the front door and
 * the categories are the indexable way into it (WS-05); everything else a visitor wants is
 * either behind the search field beside these or is an account surface, which lives in the
 * actions on the right.
 *
 * Pricing is the exception, and it is here rather than in the footer because it answers the
 * question somebody asks before they are a creator — what the platform takes — and a footer
 * column is where that question goes unanswered. It is the one destination outside discovery
 * that decides whether a campaign is started at all.
 *
 * §8.6 gives the collapsed header a 445-pixel pill and three short labels is what it holds,
 * so a fourth entry belongs in the footer rather than here.
 */
export const PRIMARY_NAVIGATION: readonly NavigationLink[] = Object.freeze([
  { href: '/discover', key: 'discover' },
  { href: '/categories', key: 'categories' },
  { href: '/pricing', key: 'pricing' },
]);

export interface FooterGroup {
  /** A key into `shell.footer.groups`. See `NavigationLink.key`. */
  readonly headingKey: string;
  readonly links: readonly NavigationLink[];
}

/** A footer group once its words have been looked up. */
export interface ResolvedFooterGroup {
  readonly heading: string;
  readonly links: readonly ResolvedNavigationLink[];
}

/**
 * The footer's columns.
 *
 * Four, not the three there were before #292 and not the four §8.6's sketch draws. The fourth
 * here is **About** — WS-07's three static pages — and the column §8.6 draws is Legal, which
 * is still deliberately absent: §22 owns that copy, #293 is `status: needs-decision` on it,
 * and a Terms link that resolves to nothing is worse than no Terms link at all — it is a
 * promise about a document that does not exist.
 *
 * The account column gained the four screens #288, #289, #290 and #279 built. The footer is
 * where somebody looks for the thing that was not worth a slot in the header, and an account
 * area with eight destinations and no entry point outside its own navigation is an account
 * area reachable only by people who already know where it is.
 *
 * **Explore gained Collections with #266, and deliberately only here.** D-08's index is a
 * public, indexable entry point, so leaving it reachable from the sitemap alone would be a
 * set of pages a crawler finds and a reader never does. It is not in `PRIMARY_NAVIGATION`
 * for the reason that list states about itself: two entries is what fits the 445-pixel pill
 * §8.6 gives the collapsed header, and discovery is already the front door that curation is
 * an editorial slice of.
 */
export const FOOTER_GROUPS: readonly FooterGroup[] = Object.freeze([
  {
    headingKey: 'explore',
    links: [
      { href: '/discover', key: 'discover' },
      { href: '/categories', key: 'categories' },
      { href: '/collections', key: 'collections' },
      { href: '/search', key: 'search' },
    ],
  },
  {
    headingKey: 'creators',
    links: [{ href: '/projects/new', key: 'startCampaign' }],
  },
  {
    headingKey: 'yourAccount',
    links: [
      { href: '/notifications', key: 'notifications' },
      { href: '/account/saved', key: 'saved' },
      { href: '/account/surveys', key: 'surveys' },
      { href: '/account/deliveries', key: 'deliveries' },
      { href: '/settings/notifications', key: 'settings' },
    ],
  },
  {
    headingKey: 'about',
    links: [
      { href: '/about', key: 'about' },
      { href: '/how-it-works', key: 'howItWorks' },
      { href: '/trust-safety', key: 'trustSafety' },
      /*
       * §22.2's eight, behind one address — #439.
       *
       * There was deliberately no legal link here until this issue, and the reason
       * `navigation.test.ts` gave was exact: "a Terms link resolving to nothing is a promise
       * about a document that does not exist". `/legal` is not that link. It lists all eight
       * required documents and says which of them have been published, so the honest state
       * — machinery built, words still #423's adviser's — is what a reader arrives at rather
       * than a 404 or a blank page pretending to be terms.
       *
       * One entry and not eight. A footer column with eight legal documents in it is a column
       * nobody reads, and the index is the page a regulator actually wants: one address that
       * answers what the platform must have, what it has, and since when.
       */
      { href: '/legal', key: 'legal' },
    ],
  },
]);

/**
 * Whether a link is the page being read.
 *
 * A PREFIX FOR EVERYTHING BUT THE ROOT. `/categories` is current on
 * `/categories/games/prints`, because a reader on a subcategory is inside Categories and a
 * navigation that says otherwise is a navigation that has lost them. `/` is exact, or it
 * would be current everywhere.
 *
 * This decides `aria-current="page"`, which is the carrier — the underline is the second,
 * visual signal for the same fact, because docs/ui-kit.md §9.2 forbids colour alone.
 */
export function isCurrent(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
