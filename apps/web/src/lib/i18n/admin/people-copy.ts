import type { ProjectState } from '../../projects/api';
import type { StaffCapability, StaffRole } from '../../admin/staff';
import type { TicketPriority, TicketState } from '../../admin/tickets';
import type { AdminTranslator } from '../admin-copy';
import type { PluralForms } from '../plurals';
import type { ConsoleChromeCopy, ConsoleRefusalsCopy } from './common-copy';

/**
 * The words the console's people screens draw — issue #324, epic #259.
 *
 * The rail's third group: the account directory, the support queue and the staff roster.
 *
 * <h2>Two of these keep refusals of their own</h2>
 *
 * `UserDirectory` and `StaffRoles` say something the shared table does not — one names the
 * directory and what searching it costs, the other explains that reading the roster needs a
 * capability the reader has not got. Both said that before #324, and translating a surface is
 * not the change that gets to reword it.
 *
 * <h2>The wire words that stay</h2>
 *
 * A capability is rendered as its own identifier — `ISSUE_REFUND` — with the translated
 * sentence on its `title`. That is deliberate: the identifier is what a member of staff asks an
 * administrator for and what the service's refusal names back at them, so a translated chip
 * would be a word nothing else in the system answers to. The roles, which are four and are read
 * as ordinary nouns, are translated.
 */

/**
 * AD-04, the account directory.
 *
 * <p>The dates are the reader's own `toLocaleDateString`, which needs no key. What needed one
 * is the sentence around them: "joined {date}" and "at an unknown date" were a template literal
 * and a fallback string concatenated in JSX, and the two languages that put the verb last could
 * not express either.
 */
export interface UserDirectoryCopy extends ConsoleChromeCopy {
  /**
   * What the reader was trying to read, for the shared capability refusal — #400.
   *
   * <p>This screen keeps its own not-staff sentence, which names the directory and what
   * searching it costs. The other 403 is the console's, because "you need
   * `ADMINISTER_ACCOUNTS`" is the same sentence everywhere and the service supplies the
   * only part of it that differs.
   */
  readonly subject: string;
  readonly signedOutTitle: string;
  readonly signedOutBody: string;
  readonly forbiddenTitle: string;
  readonly forbiddenBody: string;
  readonly notStaff: string;
  readonly accountNotFound: string;
  readonly selfSuspend: string;
  readonly heading: string;
  readonly searchLabel: string;
  readonly searchHint: string;
  readonly search: string;
  readonly standing: string;
  readonly suspendedOnly: string;
  readonly loadingList: string;
  readonly filteredTitle: string;
  readonly filteredBody: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  /** Carries `{date}`. */
  readonly joined: string;
  readonly unknownDate: string;
  readonly emailVerified: string;
  readonly emailUnverified: string;
  readonly suspendedTag: string;
  readonly leaving: string;
  /** Carries `{date}`. */
  readonly suspendedOn: string;
  readonly reinstate: string;
  readonly reinstating: string;
  readonly suspend: string;
  /** Carries `{count}`. */
  readonly accountCount: PluralForms;
  /** Carries `{accounts}`. */
  readonly showing: string;
  readonly andMore: string;
  /** Carries `{name}`. */
  readonly suspendTitle: string;
  /** Carries `{email}`. */
  readonly suspendDescription: string;
  readonly suspendBody: string;
  readonly suspendAccount: string;
  readonly suspending: string;
  readonly reasonLabel: string;
  readonly reasonHint: string;
  readonly reasonRequired: string;
  /** Carries `{limit}`. */
  readonly reasonTooLong: string;
  /** Carries `{name}`. */
  readonly suspendedNotice: string;
  /** Carries `{name}`. */
  readonly reinstatedNotice: string;
}

export function userDirectoryCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): UserDirectoryCopy {
  return {
    ...chrome,
    subject: t('screens.users.subject'),
    signedOutTitle: t('screens.users.signedOutTitle'),
    signedOutBody: t('screens.users.signedOutBody'),
    forbiddenTitle: t('screens.users.forbiddenTitle'),
    forbiddenBody: t('screens.users.forbiddenBody'),
    notStaff: t('screens.users.notStaff'),
    accountNotFound: t('screens.users.accountNotFound'),
    selfSuspend: t('screens.users.selfSuspend'),
    heading: t('screens.users.heading'),
    searchLabel: t('screens.users.searchLabel'),
    searchHint: t('screens.users.searchHint'),
    search: t('screens.users.search'),
    standing: t('screens.users.standing'),
    suspendedOnly: t('screens.users.suspendedOnly'),
    loadingList: t('screens.users.loadingList'),
    filteredTitle: t('screens.users.filteredTitle'),
    filteredBody: t('screens.users.filteredBody'),
    emptyTitle: t('screens.users.emptyTitle'),
    emptyBody: t('screens.users.emptyBody'),
    joined: String(t.raw('screens.users.joined')),
    unknownDate: t('screens.users.unknownDate'),
    emailVerified: t('screens.users.emailVerified'),
    emailUnverified: t('screens.users.emailUnverified'),
    suspendedTag: t('screens.users.suspendedTag'),
    leaving: t('screens.users.leaving'),
    suspendedOn: String(t.raw('screens.users.suspendedOn')),
    reinstate: t('screens.users.reinstate'),
    reinstating: t('screens.users.reinstating'),
    suspend: t('screens.users.suspend'),
    accountCount: t.raw('screens.users.accountCount') as PluralForms,
    showing: String(t.raw('screens.users.showing')),
    andMore: t('screens.users.andMore'),
    suspendTitle: String(t.raw('screens.users.suspendTitle')),
    suspendDescription: String(t.raw('screens.users.suspendDescription')),
    suspendBody: t('screens.users.suspendBody'),
    suspendAccount: t('screens.users.suspendAccount'),
    suspending: t('screens.users.suspending'),
    reasonLabel: t('screens.users.reasonLabel'),
    reasonHint: t('screens.users.reasonHint'),
    reasonRequired: t('screens.users.reasonRequired'),
    reasonTooLong: String(t.raw('screens.users.reasonTooLong')),
    suspendedNotice: String(t.raw('screens.users.suspendedNotice')),
    reinstatedNotice: String(t.raw('screens.users.reinstatedNotice')),
  };
}

/**
 * AD-10, the support queue.
 *
 * <p>`priority` and `state` are translated where a ticket's other enum-ish values are not,
 * because these two are what a member of staff sorts and filters by rather than what they quote
 * back to an engineer. The `<option value>` beneath each stays the wire word.
 */
export interface SupportConsoleCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly ticketSubject: string;
  readonly heading: string;
  readonly intro: string;
  readonly loadingList: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  /** What an empty list says once one of #404's three filters is on. */
  readonly filteredTitle: string;
  readonly filteredBody: string;
  /** The three chip rows' accessible names, and the "no filter" chip in each — issue #404. */
  readonly stateFilterLabel: string;
  readonly queueOnly: string;
  readonly priorityFilterLabel: string;
  readonly anyPriority: string;
  readonly assignmentFilterLabel: string;
  readonly anyAssignee: string;
  readonly unassignedOnly: string;
  /**
   * The named-assignee control's words — issue #414.
   *
   * <p>`AccountPicker`'s own copy with two words replaced, which is the shape the audit
   * trail's actor filter already uses: the picker was built for `/admin/staff`, where the
   * account being chosen is somebody about to be given a role, and here it is whoever is
   * handling a ticket. Everything else it says — that searching is a recorded read, what a
   * search found, how to choose again — is the same on all three screens and is not restated
   * under a third key.
   *
   * <p>The hint carries one thing the other two do not: that choosing somebody replaces
   * "Nobody yet". The two cannot both be true and the service answers the contradiction with
   * nothing, so the screen says which one wins rather than letting a reader discover it from
   * an empty list.
   */
  readonly assigneePicker: AccountPickerCopy;
  readonly unassigned: string;
  readonly loadingTicket: string;
  readonly ticketFailedTitle: string;
  readonly tryAgainShort: string;
  readonly staff: string;
  readonly requester: string;
  readonly internalNote: string;
  readonly replyLabel: string;
  readonly send: string;
  readonly internalLabel: string;
  readonly priorityLabel: string;
  readonly stateLabel: string;
  readonly putBack: string;
  /** Carries `{count}`. */
  readonly otherTickets: PluralForms;
  readonly failedTitle: string;
  readonly priority: Readonly<Record<TicketPriority, string>>;
  readonly state: Readonly<Record<TicketState, string>>;
}

export function supportConsoleCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): SupportConsoleCopy {
  return {
    ...chrome,
    subject: t('screens.support.subject'),
    ticketSubject: t('screens.support.ticketSubject'),
    heading: t('screens.support.heading'),
    intro: t('screens.support.intro'),
    loadingList: t('screens.support.loadingList'),
    emptyTitle: t('screens.support.emptyTitle'),
    emptyBody: t('screens.support.emptyBody'),
    filteredTitle: t('screens.support.filteredTitle'),
    filteredBody: t('screens.support.filteredBody'),
    stateFilterLabel: t('screens.support.stateFilterLabel'),
    queueOnly: t('screens.support.queueOnly'),
    priorityFilterLabel: t('screens.support.priorityFilterLabel'),
    anyPriority: t('screens.support.anyPriority'),
    assignmentFilterLabel: t('screens.support.assignmentFilterLabel'),
    anyAssignee: t('screens.support.anyAssignee'),
    unassignedOnly: t('screens.support.unassignedOnly'),
    assigneePicker: {
      ...accountPickerCopyFrom(t, chrome.refusals),
      label: t('screens.support.assigneeLabel'),
      hint: t('screens.support.assigneeHint'),
    },
    unassigned: t('screens.support.unassigned'),
    loadingTicket: t('screens.support.loadingTicket'),
    ticketFailedTitle: t('screens.support.ticketFailedTitle'),
    tryAgainShort: t('screens.support.tryAgainShort'),
    staff: t('screens.support.staff'),
    requester: t('screens.support.requester'),
    internalNote: t('screens.support.internalNote'),
    replyLabel: t('screens.support.replyLabel'),
    send: t('screens.support.send'),
    internalLabel: t('screens.support.internalLabel'),
    priorityLabel: t('screens.support.priorityLabel'),
    stateLabel: t('screens.support.stateLabel'),
    putBack: t('screens.support.putBack'),
    otherTickets: t.raw('screens.support.otherTickets') as PluralForms,
    failedTitle: t('screens.support.failedTitle'),
    priority: t.raw('screens.support.priority') as Readonly<Record<TicketPriority, string>>,
    state: t.raw('screens.support.state') as Readonly<Record<TicketState, string>>,
  };
}

/**
 * The role model, as a screen.
 *
 * <p>`capability` is a table of sentences rather than of names: the name is drawn as itself and
 * this is what sits on its `title`. It moved out of `lib/admin/staff.ts`, where it was the one
 * English table in a module otherwise made of identifiers.
 */
/**
 * `AccountPicker`'s own words — issue #402.
 *
 * <p>Its own interface rather than more fields on the screen that uses it, because the
 * control is a candidate for the five other screens that take a hand-typed identifier the
 * day #404 makes the campaign directory searchable. A screen hands it one object.
 */
/**
 * AD-04, one account — issue #404.
 *
 * <h2>Two state tables, and neither is written here twice</h2>
 *
 * `state` is `admin.screens.campaignDirectory.state`, borrowed rather than restated, for the
 * reason {@link CampaignPreviewCopy} gives about the same table: sixteen state names under a
 * second key is a second set of translations for `CHANGES_REQUESTED` that nothing keeps in
 * step with the first.
 *
 * <p>`pledgeState` is this screen's own, and it has to be. `lib/pledges/backer.ts` carries a
 * table for the same twelve states written for the person who made the pledge —
 * "Cancelled by you", "Payment failed" — and a moderator is not that person. `CANCELED_BY_BACKER`
 * reads "Cancelled by the backer" here, which is the same fact from the other side of the
 * console. (That table is also untranslated English in a client module, which is a defect of
 * its own and not this one's to fix.)
 *
 * <h2>The two panels fail separately, so they refuse separately</h2>
 *
 * `campaignsFailed` and `pledgesFailed` are one sentence each rather than the shared refusal
 * table. `ConsoleRefusal`'s sentences are written for a whole screen that could not be read;
 * these are for a panel beside a page that rendered perfectly well, and a reader who can see
 * the account but not the pledges needs to be told which half is missing.
 */
export interface AccountDetailCopy extends ConsoleChromeCopy {
  /** What the reader was trying to read, for the shared refusals. Already inflected. */
  readonly subject: string;
  readonly backToDirectory: string;
  readonly loadingAccount: string;

  /* The standing panel, which is the account directory's row said at length. */
  /** Carries `{date}`. */
  readonly joined: string;
  readonly unknownDate: string;
  readonly emailVerified: string;
  readonly emailUnverified: string;
  readonly suspendedTag: string;
  readonly leaving: string;
  /** Carries `{date}`. */
  readonly suspendedOn: string;
  /** Carries `{date}`. V5's grace period, which is not the same fact as a suspension. */
  readonly leavingOn: string;

  /* What they created. */
  readonly campaignsHeading: string;
  readonly loadingCampaigns: string;
  readonly campaignsFailed: string;
  readonly noCampaignsTitle: string;
  readonly noCampaignsBody: string;
  /** Carries `{date}`. */
  readonly startedOn: string;
  /** Borrowed from the campaign directory. See the interface note. */
  readonly state: Readonly<Record<ProjectState, string>>;

  /* What they backed. */
  readonly pledgesHeading: string;
  readonly loadingPledges: string;
  readonly pledgesFailed: string;
  readonly noPledgesTitle: string;
  readonly noPledgesBody: string;
  /** Carries `{date}`. */
  readonly backedOn: string;
  /** A pledge that never reached a confirmation, where a date would be a blank. */
  readonly neverConfirmed: string;
  /** A pledge whose campaign row is gone. It is still the person's money. */
  readonly campaignGone: string;
  /** Keyed by §6.2's twelve, worded for a moderator. Falls back to the wire spelling. */
  readonly pledgeState: Readonly<Record<string, string>>;

  /* What they held and paid — #23. */
  readonly subscriptionsHeading: string;
  readonly loadingSubscriptions: string;
  readonly subscriptionsFailed: string;
  readonly noSubscriptionsTitle: string;
  readonly noSubscriptionsBody: string;
  /** Keyed by V62's four states. `ACTIVE` with `entitled: false` is drawn as `EXPIRED`. */
  readonly subscriptionState: Readonly<Record<string, string>>;
  /** Carries `{from}` and `{to}`. */
  readonly subscriptionWindow: string;
  /** Carries `{date}`. A plan chosen and not yet paid for has no window to show. */
  readonly subscriptionChosen: string;
  readonly notRenewing: string;
  readonly paymentsHeading: string;
  readonly noPaymentsBody: string;
  /** Carries `{date}`. */
  readonly paymentReceived: string;
  /** Keyed by the service's own spelling of the method. */
  readonly paymentMethod: Readonly<Record<string, string>>;
  readonly reversal: string;
}

export function accountDetailCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): AccountDetailCopy {
  const at = (key: string) => `screens.accountDetail.${key}`;

  return {
    ...chrome,
    subject: t(at('subject')),
    backToDirectory: t(at('backToDirectory')),
    loadingAccount: t(at('loadingAccount')),
    /* `raw`, because next-intl renders a template's own key when it is read with `t()` and
       has no value for the argument — `src/test-copy.ts` refuses the same mistake in tests. */
    joined: String(t.raw(at('joined'))),
    unknownDate: t(at('unknownDate')),
    emailVerified: t(at('emailVerified')),
    emailUnverified: t(at('emailUnverified')),
    suspendedTag: t(at('suspendedTag')),
    leaving: t(at('leaving')),
    suspendedOn: String(t.raw(at('suspendedOn'))),
    leavingOn: String(t.raw(at('leavingOn'))),
    campaignsHeading: t(at('campaignsHeading')),
    loadingCampaigns: t(at('loadingCampaigns')),
    campaignsFailed: t(at('campaignsFailed')),
    noCampaignsTitle: t(at('noCampaignsTitle')),
    noCampaignsBody: t(at('noCampaignsBody')),
    startedOn: String(t.raw(at('startedOn'))),
    state: t.raw('screens.campaignDirectory.state') as Readonly<Record<ProjectState, string>>,
    pledgesHeading: t(at('pledgesHeading')),
    loadingPledges: t(at('loadingPledges')),
    pledgesFailed: t(at('pledgesFailed')),
    noPledgesTitle: t(at('noPledgesTitle')),
    noPledgesBody: t(at('noPledgesBody')),
    backedOn: String(t.raw(at('backedOn'))),
    neverConfirmed: t(at('neverConfirmed')),
    campaignGone: t(at('campaignGone')),
    pledgeState: t.raw(at('pledgeState')) as Readonly<Record<string, string>>,
    subscriptionsHeading: t(at('subscriptionsHeading')),
    loadingSubscriptions: t(at('loadingSubscriptions')),
    subscriptionsFailed: t(at('subscriptionsFailed')),
    noSubscriptionsTitle: t(at('noSubscriptionsTitle')),
    noSubscriptionsBody: t(at('noSubscriptionsBody')),
    subscriptionState: t.raw(at('subscriptionState')) as Readonly<Record<string, string>>,
    subscriptionWindow: String(t.raw(at('subscriptionWindow'))),
    subscriptionChosen: String(t.raw(at('subscriptionChosen'))),
    notRenewing: t(at('notRenewing')),
    paymentsHeading: t(at('paymentsHeading')),
    noPaymentsBody: t(at('noPaymentsBody')),
    paymentReceived: String(t.raw(at('paymentReceived'))),
    paymentMethod: t.raw(at('paymentMethod')) as Readonly<Record<string, string>>,
    reversal: t(at('reversal')),
  };
}

export interface AccountPickerCopy {
  /** What the reader was trying to read, for the shared refusals. "the account directory". */
  readonly subject: string;
  readonly refusals: ConsoleRefusalsCopy;
  readonly label: string;
  /** Says that searching is a recorded read, which is why it happens on demand. */
  readonly hint: string;
  readonly search: string;
  readonly searching: string;
  /** Puts the chosen account back to nothing. */
  readonly change: string;
  /** Carries `{term}`. */
  readonly noneFound: string;
  /** The list's accessible name. */
  readonly resultsLabel: string;
  readonly failedTitle: string;
}

export function accountPickerCopyFrom(
  t: AdminTranslator,
  refusals: ConsoleRefusalsCopy,
): AccountPickerCopy {
  return {
    subject: t('screens.staff.picker.subject'),
    refusals,
    label: t('screens.staff.picker.label'),
    hint: t('screens.staff.picker.hint'),
    search: t('screens.staff.picker.search'),
    searching: t('screens.staff.picker.searching'),
    change: t('screens.staff.picker.change'),
    /* `raw`, because next-intl renders a template's own key when it is read with `t()` and
       has no value for the argument. */
    noneFound: String(t.raw('screens.staff.picker.noneFound')),
    resultsLabel: t('screens.staff.picker.resultsLabel'),
    failedTitle: t('screens.staff.picker.failedTitle'),
  };
}

export interface StaffRolesCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly meSubject: string;
  readonly myHeading: string;
  readonly loadingMe: string;
  readonly notStaffTitle: string;
  readonly notStaffBody: string;
  /** Carries `{id}`, `{roles}`. */
  readonly signedInAs: string;
  readonly bootstrapTitle: string;
  /** Carries `{variable}`. */
  readonly bootstrapBody: string;
  readonly rosterHeading: string;
  readonly rosterForbiddenTitle: string;
  /** Carries `{capability}`. */
  readonly rosterForbiddenBody: string;
  readonly loadingRoster: string;
  readonly rosterEmptyTitle: string;
  readonly rosterEmptyBody: string;
  /** Carries `{by}`, `{date}`. */
  readonly grantedBy: string;
  readonly withdraw: string;
  readonly grantHeading: string;
  readonly grantIntro: string;
  /** The search-and-pick control that replaced the UUID field — #402. */
  readonly picker: AccountPickerCopy;
  /** Why the grant control is disabled, beside it. #405's rule, applied here. */
  readonly chooseAccountFirst: string;
  readonly roleLabel: string;
  readonly noteLabel: string;
  readonly noteHint: string;
  readonly working: string;
  readonly grant: string;
  /** Carries `{capabilities}`, `{role}`. */
  readonly confers: string;
  readonly doneTitle: string;
  readonly failedTitle: string;
  /** Carries `{name}`, `{role}`. The person, not the fragment — #402. */
  readonly grantedNotice: string;
  /** Carries `{name}`, `{role}`. */
  readonly withdrawnNotice: string;
  readonly role: Readonly<Record<StaffRole, string>>;
  readonly capability: Readonly<Record<StaffCapability, string>>;
}

export function staffRolesCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): StaffRolesCopy {
  return {
    ...chrome,
    subject: t('screens.staff.subject'),
    meSubject: t('screens.staff.meSubject'),
    myHeading: t('screens.staff.myHeading'),
    loadingMe: t('screens.staff.loadingMe'),
    notStaffTitle: t('screens.staff.notStaffTitle'),
    notStaffBody: t('screens.staff.notStaffBody'),
    signedInAs: String(t.raw('screens.staff.signedInAs')),
    bootstrapTitle: t('screens.staff.bootstrapTitle'),
    bootstrapBody: String(t.raw('screens.staff.bootstrapBody')),
    rosterHeading: t('screens.staff.rosterHeading'),
    rosterForbiddenTitle: t('screens.staff.rosterForbiddenTitle'),
    rosterForbiddenBody: String(t.raw('screens.staff.rosterForbiddenBody')),
    loadingRoster: t('screens.staff.loadingRoster'),
    rosterEmptyTitle: t('screens.staff.rosterEmptyTitle'),
    rosterEmptyBody: t('screens.staff.rosterEmptyBody'),
    grantedBy: String(t.raw('screens.staff.grantedBy')),
    withdraw: t('screens.staff.withdraw'),
    grantHeading: t('screens.staff.grantHeading'),
    grantIntro: t('screens.staff.grantIntro'),
    picker: accountPickerCopyFrom(t, chrome.refusals),
    chooseAccountFirst: t('screens.staff.chooseAccountFirst'),
    roleLabel: t('screens.staff.roleLabel'),
    noteLabel: t('screens.staff.noteLabel'),
    noteHint: t('screens.staff.noteHint'),
    working: t('screens.staff.working'),
    grant: t('screens.staff.grant'),
    confers: String(t.raw('screens.staff.confers')),
    doneTitle: t('screens.staff.doneTitle'),
    failedTitle: t('screens.staff.failedTitle'),
    grantedNotice: String(t.raw('screens.staff.grantedNotice')),
    withdrawnNotice: String(t.raw('screens.staff.withdrawnNotice')),
    role: t.raw('screens.staff.role') as Readonly<Record<StaffRole, string>>,
    capability: t.raw('screens.staff.capability') as Readonly<Record<StaffCapability, string>>,
  };
}
