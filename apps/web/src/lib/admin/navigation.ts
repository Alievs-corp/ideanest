/**
 * The administration console's sixteen modules — §4.11, issue #294.
 *
 * <h2>Why this file is a list of what does not exist as much as what does</h2>
 *
 * Epic #259's definition of done is that "every module in §4.11's table has either a screen
 * or an open blocker naming what it waits on". A navigation listing only the built screens
 * would satisfy the letter of that and lose the point: a console showing nine entries reads
 * as a console that is nine screens, and the fourteen absent modules become something a new
 * member of staff discovers by asking. So every module is here, each carries its state, and
 * the ones that are not built say what they are waiting for and which issue owns it.
 *
 * That is the opposite of the rule `components/shell/navigation.ts` states for the public
 * site — "it lists what exists, and nothing else" — and the difference is who is reading.
 * A visitor offered a link to a page that does not exist has been lied to. A member of staff
 * told that refunds are not built yet, and why, has been told something true and useful, and
 * the alternative is that they go looking for the screen.
 *
 * <strong>Nothing here renders as a link unless {@link ConsoleModule.href} is set.</strong>
 * A blocked module is text with a reason beside it. There is no href to forget to remove.
 *
 * <h2>Translated since #324, and the earlier decision is recorded rather than deleted</h2>
 *
 * This file used to argue that the console should stay English: that §21.1's catalogue is
 * for the product's readers, that the console's readers are the few people who operate the
 * platform, and that sixteen module descriptions in four languages would be four times the
 * strings to keep current for an audience that did not exist yet.
 *
 * That has been reversed deliberately. The platform is to be legible in all four of §21.1's
 * languages to everybody who uses it, staff included — a moderator who reads Azerbaijani is
 * not a different class of reader from a backer who does. So the words are
 * `admin.modules.*`, `admin.groups.*` and `admin.links.*`, keyed by the identifiers below.
 *
 * <strong>What is left here is structure, and only structure.</strong> A module's code, its
 * state, whether it has an href, which other screens belong to it, and which issue owns it:
 * every one of those is a fact about the platform rather than a sentence about it, and the
 * `waitingOn` note is the one that would rot fastest if it were duplicated per language
 * beside a state that lives here. It is not duplicated: the state decides whether a note is
 * looked up at all, and `console.test.tsx` asserts that every module the state marks
 * unfinished has one in every language.
 */

/** What the platform can actually offer for a module today. */
export type ModuleState =
  /** A screen exists and this entry links to it. */
  | 'built'
  /** Partly built: the screen is there and part of the module is not. The note says which. */
  | 'partial'
  /** No screen, and the note says what it is waiting on rather than "coming soon". */
  | 'blocked';

export interface ConsoleModule {
  /** §4.11's identifier, which is how the specification, the issues and this file agree. */
  readonly code: string;
  readonly state: ModuleState;
  /**
   * The screen this module's row links to, or null when there is none.
   *
   * A blocked module has no link to follow — see {@link ConsoleIndex} on why a disabled link
   * is worse than no link.
   */
  readonly href: string | null;
  /**
   * The module's other screens, when it has more than one.
   *
   * <p>Two of §4.11's sixteen do. Curation is four screens over one endpoint set — the
   * collections, the badges they grant, the open calls, and the order they appear in — and
   * Finance is two, because what a provider was asked and what the money meant are different
   * questions over different tables. The row links to the first and the rail lists them all,
   * and this is what lets a test assert that every rail entry belongs to a module rather
   * than merely resolving.
   */
  readonly otherScreens?: readonly string[];
  /*
   * WHAT IT IS WAITING FOR IS `admin.modules.{code}.waitingOn` — issue #324.
   *
   * A sentence rather than a label. "Blocked" tells a reader to stop looking; "blocked on
   * the fee schedule table, which is not built" tells them why nobody can unblock it by
   * asking. It is present in the catalogue exactly when {@link state} is not `built`, which
   * is the invariant `console.test.tsx` asserts — in all four languages, because a note that
   * exists in English and not in Turkish is a module that reads as blocked for no reason.
   */
  /** The issue that owns it, so a reader can go and read the argument rather than repeat it. */
  readonly issue: number;
}

/**
 * The console, in §4.11's own order.
 *
 * Frozen because it is read by the navigation, by the console index and by a test that
 * asserts the two agree; a module list something could push onto is one that eventually
 * differs between the nav and the page describing the nav.
 */
export const CONSOLE_MODULES: readonly ConsoleModule[] = Object.freeze([
  {
    code: 'AD-01',
    state: 'built',
    href: '/admin/moderation',
    /*
     * The campaign review queue is AD-01's second screen, and its absence was the module's
     * real gap rather than a missing convenience: `approve`, `reject` and `request-changes`
     * had existed since #101 with nothing listing what they apply to, so the only route to
     * a submitted campaign was a report somebody had filed about it. A campaign nobody
     * complained about waited out of sight while its creator was told it was under review.
     */
    /*
     * And the campaign directory (#387), which is the module's third screen and the
     * answer to a question the first two cannot take: both list campaigns that have
     * DONE something — been reported, been submitted — so a draft, a live campaign, or
     * one cleared for launch a week ago and never launched appeared on no screen here.
     */
    otherScreens: ['/admin/moderation/submissions', '/admin/campaigns'],
    issue: 101,
  },
  {
    code: 'AD-02',
    state: 'partial',
    href: '/admin/moderation',
    /*
     * THE NOTE WAS STALE, WHICH IS THE ONE FAILURE THIS FILE EXISTS TO PREVENT.
     *
     * It read "fraud signals are unbuilt" until #106, and #108 had built them: there are
     * `risk_assessments`, a scored queue at `GET /v1/admin/risk/queue`, and the identity
     * review beside it at `/v1/admin/verifications/queue`. A member of staff was being told
     * something false about the platform they operate, which is worse than being told
     * nothing.
     *
     * It is still `partial`, and the reason has moved rather than gone: both queues are
     * endpoints with no screen in this console, so the only way to work them today is the
     * API. That is the gap, and it is a smaller one than the sentence it replaces.
     */
    issue: 103,
  },
  {
    code: 'AD-03',
    state: 'built',
    href: '/admin/curation',
    otherScreens: [
      '/admin/curation/badges',
      '/admin/curation/open-calls',
      '/admin/curation/placements',
    ],
    issue: 301,
  },
  {
    code: 'AD-04',
    state: 'partial',
    href: '/admin/users',
    /*
     * `/admin/staff` is here rather than in a seventeenth module, and the choice is worth
     * stating. §4.11's table has sixteen rows and no row for staff roles, because when it
     * was written there was no role model to have a screen for — staff identity was one
     * configured list of addresses, and #295 is what replaced it.
     *
     * Adding a row would mean this file and the specification disagreeing about how many
     * modules the console has. Filing it under AD-04 is the truthful alternative: that
     * module is the administration of people, and who among them works here is the same
     * subject seen from the platform's side. The rail lists both under People.
     */
    otherScreens: ['/admin/staff'],
    issue: 104,
  },
  {
    code: 'AD-05',
    state: 'built',
    href: '/admin/payments',
    /*
     * Four screens since #106, and the fourth is the one that checks the other three.
     * `/admin/reconciliation` was the gap that kept "build financial operations tooling"
     * open with the payout queue, refunds and chargebacks all built: #70's nightly pass
     * answered "do the books balance" to a log line and a Prometheus gauge, and to nobody
     * who works in this console.
     */
    otherScreens: ['/admin/ledger', '/admin/payouts', '/admin/reconciliation'],
    issue: 306,
  },
  {
    code: 'AD-06',
    state: 'built',
    href: '/admin/refunds',
    issue: 307,
  },
  {
    code: 'AD-07',
    state: 'partial',
    href: '/admin/disputes',
    issue: 308,
  },
  {
    code: 'AD-08',
    state: 'partial',
    href: '/admin/taxonomy',
    issue: 309,
  },
  {
    code: 'AD-09',
    state: 'built',
    href: '/admin/moderation/content',
    otherScreens: ['/admin/moderation/profiles'],
    issue: 297,
  },
  {
    code: 'AD-10',
    state: 'partial',
    href: '/admin/support',
    issue: 310,
  },
  {
    code: 'AD-11',
    state: 'built',
    href: '/admin/fees',
    /*
     * `/admin/plans` is here rather than in a seventeenth module, on the argument AD-04
     * makes about `/admin/staff`. §4.11's table has sixteen rows and no row for creator
     * subscriptions, because when it was written the platform charged only a fee.
     *
     * Adding a row would mean this file and the specification disagreeing about how many
     * modules the console has. Filing it here is the truthful alternative: AD-11 is what
     * the platform charges, a fee comes out of a backer's pledge and a plan comes out of a
     * creator's pocket, and those are two subjects of one authority rather than two
     * authorities. The rail lists both under Money.
     */
    /*
     * `/admin/legal` is here for the same reason `/admin/plans` is, and the reason is
     * stated once above: §4.11's table has sixteen rows and no row for §22.2's documents,
     * because when it was written the platform had none. AD-11 is the authority over what
     * the platform charges and what it obliges — a fee, a plan and the creator agreement
     * are three subjects of one authority, and all three need `CONFIGURE_PLATFORM`.
     *
     * The rail files it under Platform rather than Money, which is the one place this
     * module's screens are split across two groups. That is deliberate: a member of staff
     * looking for the terms of use is not thinking about money, and the rail is a place to
     * look things up rather than a diagram of §4.11.
     */
    /*
     * `/admin/revenue` is the plans screen's other half and is filed with it: what the
     * platform charges a creator, and what those charges brought in (#23). Its own screen
     * rather than a section of `/admin/plans`, because that one is somebody's work queue —
     * payments waiting to be recorded — and a report is read by the person closing a month,
     * who has no reason to scroll past a queue to reach it.
     */
    otherScreens: ['/admin/plans', '/admin/revenue', '/admin/legal'],
    issue: 311,
  },
  {
    code: 'AD-12',
    state: 'partial',
    href: '/admin/flags',
    issue: 312,
  },
  {
    code: 'AD-13',
    state: 'partial',
    href: '/admin/analytics',
    issue: 313,
  },
  {
    code: 'AD-14',
    state: 'built',
    href: '/admin/audit',
    issue: 314,
  },
  {
    code: 'AD-15',
    state: 'partial',
    href: '/admin/email-templates',
    issue: 315,
  },
  {
    code: 'AD-16',
    state: 'partial',
    href: '/admin/health',
    issue: 316,
  },
]);

/**
 * One titled group of destinations.
 *
 * <p>Both fields are keys rather than words since #324: `heading` names an entry under
 * `admin.groups` and each link is the path it goes to, which is also what names it under
 * `admin.links`. Keying a label by its own href means the rail cannot gain a destination
 * whose name nobody wrote — `console.test.tsx` asserts that every href here has a label in
 * every language, which a separate key would let drift.
 */
export interface ConsoleGroup {
  readonly heading: string;
  readonly links: readonly string[];
}

/**
 * The navigation, grouped by the question being asked rather than by §4.11's numbering.
 *
 * <p>AD-01, AD-02 and AD-09 are three rows of one table and two screens, so a rail that
 * followed the specification's order would put "Trust and safety" between two things that
 * are the same screen. Somebody working the console is asking "is this about content, about
 * people, about money, or about the platform" — so those are the four groups.
 *
 * <p><strong>Only screens that exist are here.</strong> Every module in §4.11's table now
 * has one except AD-04's impersonation, which is a half of a module rather than a module and
 * is blocked on a policy answer (#299) — so it stays on the console index, where there is
 * room to say what it is waiting for. A rail entry that opened a page saying "not built"
 * would be a destination in a navigation whose whole purpose is to take somebody somewhere.
 *
 * <p><strong>The rail does not vary by capability, and that is deliberate.</strong> Since
 * #295 the console knows what the reader may do, so hiding the screens they cannot use is
 * available and is not done: a member of staff who cannot see the fees screen has no way to
 * find out that it exists, and the first thing they do is ask somebody whether the console
 * is broken. Every screen refuses honestly and says which capability it wanted, which is a
 * better answer than an absence.
 */
export const CONSOLE_GROUPS: readonly ConsoleGroup[] = Object.freeze([
  {
    heading: 'content',
    links: [
      '/admin/moderation',
      '/admin/moderation/submissions',
      '/admin/campaigns',
      '/admin/moderation/content',
      '/admin/moderation/profiles',
    ],
  },
  {
    heading: 'curation',
    links: [
      '/admin/curation',
      '/admin/curation/badges',
      '/admin/curation/open-calls',
      '/admin/curation/placements',
      '/admin/taxonomy',
    ],
  },
  {
    heading: 'people',
    links: [
      '/admin/users',
      '/admin/support',
      '/admin/staff',
    ],
  },
  {
    heading: 'money',
    links: [
      '/admin/payments',
      '/admin/ledger',
      '/admin/reconciliation',
      '/admin/payouts',
      '/admin/refunds',
      '/admin/disputes',
      '/admin/fees',
      '/admin/plans',
      '/admin/revenue',
    ],
  },
  {
    heading: 'platform',
    links: [
      '/admin/analytics',
      '/admin/audit',
      '/admin/email-templates',
      '/admin/flags',
      '/admin/health',
      '/admin/legal',
    ],
  },
]);

/**
 * Whether a navigation entry names the page being rendered.
 *
 * <p>An exact match, and deliberately not a prefix match, because the console's paths nest:
 * `/admin/curation` is the collection manager and `/admin/curation/badges` is a different
 * screen. A prefix rule would mark both current on the second one, and `aria-current="page"`
 * appearing twice is worse than not appearing at all — it tells a screen reader the page is
 * in two places.
 *
 * <p><strong>The exception is a detail route, and there are three of them.</strong> A screen
 * addressed by something the rail cannot enumerate — a collection's handle, a report's
 * identifier, a campaign's identifier — has no entry of its own and belongs under its parent.
 * It is matched here rather than left unmarked, so that opening one does not make the rail go
 * blank: a member of staff who has followed a link from a queue into a detail page still has
 * to be able to see where they are and get back.
 *
 * <p>The rule is written once rather than per parent, which is the change #399 made. It used
 * to name `/admin/curation` specifically, so the report detail page and the campaign preview
 * — both reached from a queue, both places somebody arrives at with the queue still in mind —
 * showed nothing as current. A named list would have grown a third entry now and a fourth
 * later, and the entry it eventually forgot would be the one nobody notices.
 *
 * <p>The exclusion is what keeps it from being a prefix rule: a nested path that <em>is</em>
 * an entry — `/admin/curation/badges`, `/admin/moderation/content` — marks that entry and not
 * its parent, so `aria-current="page"` never appears twice.
 */
export function isCurrentConsoleLink(href: string, pathname: string): boolean {
  if (pathname === href) return true;
  if (!pathname.startsWith(`${href}/`)) return false;

  return !CONSOLE_GROUPS.some((group) =>
    group.links.some(
      (link) =>
        // Compared on a path boundary rather than as a bare string prefix: `/admin/plans`
        // must not claim `/admin/plansomething`, and a rule that reads as a prefix match is
        // the rule somebody widens by accident.
        link !== href && (pathname === link || pathname.startsWith(`${link}/`)),
    ),
  );
}

/**
 * How many of §4.11's modules have a screen, for the sentence the console index opens with.
 *
 * <p><strong>Kept, and no longer what the sentence is built from — issue #405.</strong> The
 * standfirst read "sixteen modules; sixteen of them have a screen; the rest say what they
 * are waiting for", and there was no rest: every module has an `href`, so this counted all
 * sixteen and the clause after the semicolon described nothing. Meanwhile nine of the
 * sixteen are marked `partial` and each does carry a waiting-on note, which is the useful
 * fact the sentence was trying to state and got backwards.
 *
 * <p>It stays because "has a screen" is still a question worth being able to ask — a
 * `blocked` module is one this rail must not link to — and because a function nothing calls
 * is cheaper to delete than a fact nothing records.
 */
export function builtModuleCount(): number {
  return CONSOLE_MODULES.filter((module) => module.href !== null).length;
}

/**
 * How many modules are finished, for the sentence the console index opens with — #405.
 *
 * <p>Complete means `built`: a screen exists and nothing about the module is outstanding.
 */
export function completeModuleCount(): number {
  return CONSOLE_MODULES.filter((module) => module.state === 'built').length;
}

/**
 * How many are partly built — a screen, and a note saying which part is missing.
 *
 * <p>This is the number the standfirst was reaching for. Nine of sixteen is a fact about
 * the state of the console; "sixteen of sixteen have a screen" is a fact about routing.
 */
export function partialModuleCount(): number {
  return CONSOLE_MODULES.filter((module) => module.state === 'partial').length;
}

/** Every path a module owns, for a check that the rail lists nothing that is not one. */
export function screensOf(module: ConsoleModule): readonly string[] {
  return module.href === null ? [] : [module.href, ...(module.otherScreens ?? [])];
}
