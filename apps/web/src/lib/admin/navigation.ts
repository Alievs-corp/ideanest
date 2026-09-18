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

import type { StaffCapability } from './staff';

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
 * <p><strong>The rail varies by capability, and it used to argue that it should not.</strong>
 * The argument was that a member of staff who cannot see the fees screen has no way to find
 * out that it exists, and would ask whether the console was broken. That is a real cost and
 * it is the smaller one. A curator signing in met twenty-eight entries, twenty-three of which
 * refused them - so the rail's job, which is to take somebody to the screen they need, was
 * being done by a list where four fifths of the entries were dead ends. Six of those entries
 * are the platform's books.
 *
 * <p>So an entry is drawn when the reader holds a capability that opens it, and
 * {@link CONSOLE_LINK_CAPABILITIES} is where each entry says which. The earlier objection is
 * answered rather than dismissed: `/admin/staff` lists all nineteen capabilities and what
 * each one is for, in the reader's own language, so "which screens exist and who holds them"
 * is a question the console answers on a screen made for it - and the refusals stay, because
 * a URL somebody was sent still has to say what it wanted rather than nothing.
 *
 * <p><strong>The rail is not the gate.</strong> `ConsoleGate` decides whether the console
 * opens at all and the service decides every read behind every screen; this decides what is
 * <em>offered</em>, which is a different question with a much lower cost of being wrong.
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
 * What a console entry needs before it is worth offering - §4.11's role model, issue #295.
 *
 * <h2>Why a table here rather than a field on the module</h2>
 *
 * <p>Because the unit a reader holds is a screen, not a module. AD-11 is one module and its
 * four screens want two different capabilities - a fee schedule and a plan are
 * `CONFIGURE_PLATFORM`, the creator agreement is `PUBLISH_LEGAL_DOCUMENT` - and AD-04's two
 * are `ADMINISTER_ACCOUNTS` and `ADMINISTER_STAFF`, which is the difference between reading
 * somebody's account and granting them the authority to read everybody's. A capability per
 * module would have to pick the loosest of them, and the loosest is the wrong answer.
 *
 * <h2>Each entry names what the service actually asks for</h2>
 *
 * <p>Read off the guard on the first read each screen makes, not invented here. Where the two
 * could drift they now cannot in the direction that matters: every screen still refuses on
 * its own, so a table that is too generous shows an entry that refuses honestly, and one that
 * is too strict hides a screen somebody could have used. The second is the failure worth a
 * test, and `navigation.test.ts` asserts that every rail entry appears here exactly once.
 *
 * <p><strong>Two capabilities means either, not both.</strong> `/admin/disputes` is one page
 * over two reads the service guards separately - the chargeback queue is `VIEW_FINANCE` and
 * the backer disputes below it are `MANAGE_DISPUTES` - and somebody who can work half of it
 * needs the entry. `holdsAny` in `staff.ts` is that rule.
 */
export const CONSOLE_LINK_CAPABILITIES: Readonly<Record<string, readonly StaffCapability[]>> =
  Object.freeze({
    // Content - the report queues, the submission queue and the campaign directory are all
    // one authority: MODERATE_CONTENT, which is what StaffRole.MODERATOR is mostly made of.
    '/admin/moderation': ['MODERATE_CONTENT'],
    '/admin/moderation/submissions': ['MODERATE_CONTENT'],
    '/admin/campaigns': ['MODERATE_CONTENT'],
    '/admin/moderation/content': ['MODERATE_CONTENT'],
    '/admin/moderation/profiles': ['MODERATE_CONTENT'],

    // Curation - CURATE is the whole of StaffRole.CURATOR, and the taxonomy is filed with it
    // because a category is what a collection is assembled out of.
    '/admin/curation': ['CURATE'],
    '/admin/curation/badges': ['CURATE'],
    '/admin/curation/open-calls': ['CURATE'],
    '/admin/curation/placements': ['CURATE'],
    '/admin/taxonomy': ['CURATE'],

    // People - and the third of these is not the same authority as the other two. Granting a
    // role is how somebody gets every capability in this table, so ADMINISTER_STAFF is an
    // administrator's alone.
    '/admin/users': ['ADMINISTER_ACCOUNTS'],
    '/admin/support': ['HANDLE_SUPPORT'],
    '/admin/staff': ['ADMINISTER_STAFF'],

    /*
     * Money - VIEW_FINANCE reads, and the two narrower capabilities act rather than open.
     * The refund console and the payout queue are VIEW_FINANCE to read: ISSUE_REFUND and
     * APPROVE_PAYOUT are what the buttons on them need, and hiding the screen from somebody
     * who can read it would hide the queue from the person about to be asked to sign.
     */
    '/admin/payments': ['VIEW_FINANCE'],
    '/admin/ledger': ['VIEW_FINANCE'],
    '/admin/reconciliation': ['VIEW_FINANCE'],
    '/admin/payouts': ['VIEW_FINANCE'],
    '/admin/refunds': ['VIEW_FINANCE'],
    '/admin/disputes': ['VIEW_FINANCE', 'MANAGE_DISPUTES'],
    '/admin/fees': ['CONFIGURE_PLATFORM'],
    '/admin/plans': ['CONFIGURE_PLATFORM'],
    '/admin/revenue': ['CONFIGURE_PLATFORM'],

    /*
     * Platform - four different authorities, which is why this group is the one that proves
     * the table was worth writing. The platform figures are finance's, the trail is every
     * role's, the queue depths are VIEW_HEALTH, and §22.2's documents are the one thing on
     * this rail that only an administrator may publish.
     */
    '/admin/analytics': ['VIEW_FINANCE'],
    '/admin/audit': ['VIEW_AUDIT'],
    '/admin/email-templates': ['CONFIGURE_PLATFORM'],
    '/admin/flags': ['CONFIGURE_PLATFORM'],
    '/admin/health': ['VIEW_HEALTH'],
    '/admin/legal': ['PUBLISH_LEGAL_DOCUMENT'],
  });

/**
 * Whether a reader holding these capabilities has any business with this entry.
 *
 * <p>Takes the capabilities rather than the membership, and that is what keeps this module
 * free of everything `staff.ts` imports: the type is erased at compile time, so the rail's
 * structure stays a file of facts that a server component can read without pulling the API
 * client in behind it.
 *
 * <p><strong>An entry that is not in the table is not drawn.</strong> Fail closed, in the one
 * direction where the cost is a member of staff asking a colleague where a screen went rather
 * than a curator reading the platform's books. The test that every entry is in the table is
 * what stops that being a way to lose a screen quietly.
 */
export function mayOpenConsoleLink(
  href: string,
  capabilities: readonly StaffCapability[] | null,
): boolean {
  if (capabilities === null) return false;

  const wanted = CONSOLE_LINK_CAPABILITIES[href];
  if (wanted === undefined) return false;

  return wanted.some((capability) => capabilities.includes(capability));
}

/**
 * The rail this reader gets: their entries, in the console's order, and no empty headings.
 *
 * <p>A group whose every entry is gone goes with them. "Money" over nothing is a heading that
 * tells a curator there is money in here somewhere and they are not allowed to see it, which
 * is both true and useless; the staff screen is where what somebody holds is explained.
 *
 * <p>Returns nothing at all for `null` - a reader whose membership has not arrived yet, and
 * one who is not staff. The first is a beat during which a rail drawn from a guess would have
 * to be redrawn when the answer came, which is movement on a surface docs/motion-system.md §5
 * gives none; the second gets `ConsoleGate`'s sentence instead of a navigation.
 */
export function visibleConsoleGroups(
  capabilities: readonly StaffCapability[] | null,
): readonly ConsoleGroup[] {
  if (capabilities === null) return [];

  return CONSOLE_GROUPS.map((group) => ({
    heading: group.heading,
    links: group.links.filter((link) => mayOpenConsoleLink(link, capabilities)),
  })).filter((group) => group.links.length > 0);
}

/**
 * The first screen of a module this reader may open, or null if none of them is theirs.
 *
 * <p>The module's own `href` where it is permitted, and one of `otherScreens` where it is not:
 * AD-04 is the case that needs it. Its row points at `/admin/users`, which wants
 * `ADMINISTER_ACCOUNTS`, while `/admin/staff` under the same module wants `ADMINISTER_STAFF` —
 * so an administrator of staff who is not an administrator of accounts holds half of one module
 * and would otherwise be handed a link that refuses them.
 */
export function firstOpenableScreen(
  module: ConsoleModule,
  capabilities: readonly StaffCapability[] | null,
): string | null {
  return screensOf(module).find((screen) => mayOpenConsoleLink(screen, capabilities)) ?? null;
}

/**
 * The modules worth listing on the console index for this reader — the rail's rule, by module.
 *
 * <p>A module is listed when any one of its screens is, which is not the same question the rail
 * asks: the rail is a list of destinations and this is a list of *subjects*, so AD-11 belongs
 * here for somebody who may open the plans screen and not the creator agreement.
 *
 * <p><strong>A module with no screen at all stays.</strong> §4.11's table is sixteen rows and
 * this page exists to say that every one of them has either a screen or a stated blocker — a
 * blocked module is an announcement rather than a destination, there is nothing behind it to
 * be refused from, and dropping it would leave the page quietly claiming the console is
 * smaller than the platform. Every module has an `href` today, so this branch guards a case
 * that does not exist yet and is the reason it will not be got wrong when it does.
 *
 * <p>`null` — a membership that has not arrived — lists nothing, as everywhere else. In
 * practice the index never renders in that state: `ConsoleGate` is above it and draws nothing
 * until the answer is in.
 */
export function visibleConsoleModules(
  capabilities: readonly StaffCapability[] | null,
): readonly ConsoleModule[] {
  if (capabilities === null) return [];

  return CONSOLE_MODULES.filter(
    (module) => screensOf(module).length === 0 || firstOpenableScreen(module, capabilities) !== null,
  );
}

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

/*
 * COMPLETE AND PARTIAL COUNTS LIVED HERE AND ARE GONE — #295.
 *
 * They answered "how many of §4.11's sixteen are finished", which is what the console index
 * opened with until the index started describing the reader's own list instead. It counts the
 * modules it is showing, over a subset this file cannot compute without a membership, so a
 * platform-wide count is now a second answer to a question the page does not ask. Deleted
 * rather than left: `builtModuleCount` below stays because a test asserts the rail invariant
 * through it, and that is the difference between a fact nothing records and code nothing runs.
 */

/** Every path a module owns, for a check that the rail lists nothing that is not one. */
export function screensOf(module: ConsoleModule): readonly string[] {
  return module.href === null ? [] : [module.href, ...(module.otherScreens ?? [])];
}
