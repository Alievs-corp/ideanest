/**
 * The account area's navigation — §4.2, issue #275.
 *
 * <h2>Why this exists at all</h2>
 *
 * `/settings/notifications` and `/settings/sessions` shipped with no shared chrome and no way
 * to reach one from the other. Each was a page somebody arrived at from an email or from the
 * footer and left by pressing Back. #275's own sentence for it — "the navigation the existing
 * notification and session screens should already have been inside" — is the whole issue.
 *
 * <h2>Two groups, one list</h2>
 *
 * Everything a signed-in person manages about themselves is here, split by the question being
 * asked rather than by the URL prefix:
 *
 *   - **Your account** is what somebody *has* — the campaigns they saved, the creators they
 *     follow, the surveys they owe an answer to, the parcels on their way.
 *   - **Settings** is what somebody *decides* — what they are told, which devices are in,
 *     whether a second factor is required, and what happens to their data.
 *
 * They live under `/account` and `/settings` respectively, and that split is a fact about the
 * existing URLs rather than a design: `/settings/notifications` is the address in every
 * notification email the platform has ever sent, and moving it to buy a tidier prefix would
 * break links this repository does not own.
 *
 * <h2>It lists what exists, and nothing else</h2>
 *
 * `components/shell/navigation.ts`'s rule, restated because it is easy to break here — an
 * account navigation is exactly where somebody adds the entry before the page.
 *
 * **The two credentials arrived with #277 and are two entries rather than one.** A-12 and A-13
 * are one screen's worth of decisions to the service — `AccountCredentialsService` holds both
 * — and they are two here because their consequences differ in the one way a reader cares
 * about: changing the password ends every session on the account, and changing the address ends
 * none. One entry called "Sign-in details" would put one warning over both, and the warning is
 * either wrong for half the page or absent where it is needed.
 *
 * **Profile arrived with #276, and it is the entry this comment used to argue against.** The
 * argument was that the service had no write to save a name or a biography to, so an editor
 * would be a form with nowhere to send anything — and it was correct while it held. It does
 * not any more: `GET /v1/me/profile` and `PATCH /v1/me/profile` are §4.2's P-01 to P-03, and
 * `/settings/profile` is a page rather than a promise.
 *
 * It is **not** `PATCH /v1/me`, which is what that paragraph asked for and what
 * `OwnProfileController` declines to build: a patch over the whole account is a surface every
 * future column joins by default, and the first one added without thinking becomes writable
 * by anybody holding a token. The endpoint names one thing and can only ever change that
 * thing. The entry sits above **Notifications** because it is the only one in this group
 * about what other people see; everything under it is about what the account is told, who is
 * signed in to it, and what happens to its data.
 *
 * P-01's **upload and crop** are still absent from that page and the page says so: there is
 * no object storage and no media table, so the picture is the address of something already
 * published (§13.1). That is a missing half of one field rather than a page that cannot work,
 * which is the line this list draws.
 *
 * **Language arrived with #324, and it is the second entry this comment used to argue
 * against.** The argument was that P-10 was blocked on §21.1's localisation work and that
 * `SiteFooter` already refused to draw a control that would change nothing — correct while
 * it held, and it no longer does. `messages/{az,en,ru,tr}.json` exist, `i18n/request.ts`
 * negotiates a language before the first byte of an account render, and `/settings/language`
 * is a page rather than a promise. The entry is now the correct one and its absence would be
 * the defect.
 *
 * **P-10's other half — display currency — is a control on the same page since #327, and the
 * argument it replaces was about a rate rather than about a second project currency.** This
 * note used to say a chooser would convert AZN to AZN, because §21.2's approximation needs a
 * published rate and the service had none. It has one now: the Central Bank of Azerbaijan's
 * daily publication, refreshed hourly, with the rate a backer was shown stamped on their
 * pledge for audit.
 *
 * The campaign's currency is unchanged and always will be under phase 1 — it is a property of
 * the project, never of the reader, and `@ideanest/money` still formats every chargeable
 * amount against it. What the reader now chooses is the currency of the "≈" beside it. On a
 * deployment whose rate source is unreachable the panel is a sentence again, which is the
 * shape #280 chose and the reason it was right.
 *
 * <h2>Interface text lives in the catalogue, not here — §21.1</h2>
 *
 * Every entry carries a **key** rather than a sentence. The English used to be inline, which
 * meant this file was readable and untranslatable at the same time: a navigation whose labels
 * are literals is one that can only ever be drawn in one language, however many the service
 * answers in. `account.groups.*` and `account.links.*.{label,summary}` are the addresses; the
 * copy is in `messages/*.json` and `navigation.test.ts` asserts that every key here resolves
 * in all four of them, because an entry whose Turkish label is missing is precisely the defect
 * a catalogue exists to prevent.
 *
 * Each entry has a `.summary` beside its `.label` and **nothing draws it today**: `/settings`
 * and `/account` are both redirects to their first screen rather than landing pages with a
 * described list, for the reason those two files give. The line is written and translated
 * because the first landing page or command palette that wants it should find it there rather
 * than invent thirteen sentences in four languages; it is stated here so that its absence from
 * every rendered surface is a known fact rather than a puzzle.
 */

export interface AccountLink {
  readonly href: string;
  /** The `account.links.*` entry in the message catalogue that names this destination. */
  readonly key: string;
}

export interface AccountGroup {
  /** The `account.groups.*` entry. */
  readonly headingKey: string;
  readonly links: readonly AccountLink[];
}

export const ACCOUNT_GROUPS: readonly AccountGroup[] = Object.freeze([
  {
    headingKey: 'yourAccount',
    links: [
      /*
       * FIRST, AND NOT UNDER `/account/*` LIKE THE FOUR BELOW IT — #287.
       *
       * The prefix split this navigation is built on (`/settings/*` for what somebody
       * decides, `/account/*` for what they have) would put the pledge list under
       * `/account`, and it is not there because `/pledges/{id}/address` has been a real
       * URL since #75 and is linked from survey and delivery email. Moving the parent to
       * buy a tidier tree would either break those links or leave one screen addressed two
       * ways; §4.2's own note about `/settings/notifications` makes the same argument.
       *
       * First in the group because it is the only entry about money. What somebody has
       * committed outranks what they have saved to look at later.
       */
      { href: '/pledges', key: 'pledges' },
      /*
       * Second, and the only entry here about work rather than about spending.
       *
       * <p>Nothing listed a creator's own campaigns before this. Every project route
       * takes an identifier in its path, and the account menu's one campaign-shaped
       * row posted a new draft, so an unfinished campaign was reachable only by a URL
       * somebody had written down.
       */
      { href: '/account/campaigns', key: 'campaigns' },
      { href: '/account/saved', key: 'saved' },
      { href: '/account/following', key: 'following' },
      { href: '/account/surveys', key: 'surveys' },
      { href: '/account/deliveries', key: 'deliveries' },
    ],
  },
  {
    headingKey: 'settings',
    links: [
      /*
       * FIRST IN THE GROUP — #276. It is the only entry here about what strangers see; the
       * seven below it are about what the account is told, which devices are in, what happens
       * to its data, and which language all of it is written in. The visibility switch that
       * decides whether the profile answers at all stays on "Data and closure" and
       * `ProfileVisibilityPanel` explains why.
       */
      { href: '/settings/profile', key: 'profile' },
      { href: '/settings/notifications', key: 'notifications' },
      { href: '/settings/sessions', key: 'sessions' },
      { href: '/settings/email', key: 'email' },
      { href: '/settings/password', key: 'password' },
      { href: '/settings/security', key: 'security' },
      { href: '/settings/privacy', key: 'privacy' },
      // IDN-EXT-01 (#44): the VÖEN and the business card a creator's payouts go to.
      { href: '/settings/payout', key: 'payout' },
      /*
       * LAST, BELOW "Data and closure" — #280.
       *
       * The group is ordered by how much a change here costs the person making it: what
       * strangers see, then what the account is told, then which devices are in, then the
       * credentials, then the two irreversible ones. Nothing in it costs less than the
       * language the interface is drawn in — it changes nothing the account holds, nothing
       * anybody else sees, and it is undone by choosing again — so it sits at the end rather
       * than beside Profile, where it would push the settings that carry consequences down.
       */
      { href: '/settings/language', key: 'language' },
    ],
  },
]);

/** Every link in both groups, flattened — what `accountLinkFor` searches, and what the tests read. */
export const ACCOUNT_LINKS: readonly AccountLink[] = Object.freeze(
  ACCOUNT_GROUPS.flatMap((group) => group.links),
);

/**
 * Whether a link is the page being read.
 *
 * EXACT, unlike the site header's prefix match. Every entry here is a leaf: nothing sits
 * under `/settings/security`, and a prefix match would make `/account/saved` current on a
 * hypothetical `/account/saved-something` for no gain. `aria-current="page"` is the carrier;
 * the visual treatment is the second signal, because docs/ui-kit.md §9.2 forbids colour
 * alone.
 */
export function isCurrentAccountLink(href: string, pathname: string): boolean {
  return pathname === href;
}

/** The catalogue entry for a path, or `null` where the path is not one of ours. */
export function accountLinkFor(pathname: string): AccountLink | null {
  return ACCOUNT_LINKS.find((link) => link.href === pathname) ?? null;
}
