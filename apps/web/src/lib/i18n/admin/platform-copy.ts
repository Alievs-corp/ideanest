import type { AuditActionLabels } from '../../admin/audit';
import type { AdminTranslator } from '../admin-copy';
import type { ConsoleChromeCopy } from './common-copy';
import { accountPickerCopyFrom, type AccountPickerCopy } from './people-copy';

/**
 * The words the console's platform screens draw — issue #324, epic #259.
 *
 * The rail's fifth group: the audit trail, the platform figures, the email templates, the
 * feature flags and the health board. Grouped as `CONSOLE_GROUPS` groups them so that the
 * file somebody opens to change a word is the one the rail would have sent them to.
 */

/**
 * AD-14, the audit trail.
 *
 * <h2>The two tables are open, and the fallback is the feature</h2>
 *
 * `entity` and `action` are looked up by the service's own wire spelling — `project.approved`,
 * `account.suspended` — and neither is exhaustive on purpose. The service's set of privileged
 * actions grows with every feature that adds one, and a screen that drew nothing for an action
 * it had not been taught would hide exactly the row somebody is looking for. An unknown action
 * falls back to its wire spelling, which is readable, and an unknown entity kind falls back to
 * the same.
 *
 * <p>That is also why they are open records rather than a key per known action: the
 * catalogue's set and the service's set are allowed to disagree, and the disagreement has to
 * fail soft in one direction only.
 *
 * <p>`action` is two levels deep where `entity` is one, because next-intl reads a `.` in a
 * message key as nesting and refuses a key that carries one. `project.approved` is therefore
 * `project` then `approved` in the catalogue, and `actionLabel` splits the wire spelling at
 * its first `.` to find it.
 */
export interface AuditTrailCopy extends ConsoleChromeCopy {
  /** What this screen calls the thing it reads, for the refusals. Already inflected. */
  readonly subject: string;
  readonly heading: string;
  readonly filterLabel: string;
  readonly everything: string;
  /** The group holding the actor and the two dates — issue #404. */
  readonly narrowLabel: string;
  readonly fromLabel: string;
  readonly fromHint: string;
  readonly toLabel: string;
  readonly toHint: string;
  readonly clearDates: string;
  /**
   * The actor control's words.
   *
   * <p>`AccountPicker`'s own copy with two words replaced: the picker was built for
   * `/admin/staff`, where the account being chosen is somebody about to be given a role, and
   * here it is whoever performed an action. Everything else it says — that searching is a
   * recorded read, what a search found, how to choose again — is the same on both screens and
   * is not restated under a second key.
   */
  readonly actorPicker: AccountPickerCopy;
  readonly loadingList: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly filteredTitle: string;
  readonly filteredBody: string;
  readonly refused: string;
  /** Carries `{id}`. */
  readonly requestId: string;
  readonly footnote: string;
  /** Keyed by the entity kind the service writes. Falls back to the wire spelling. */
  readonly entity: Readonly<Record<string, string>>;
  /** Keyed by the action the service writes, split at its `.`. Falls back to the wire spelling. */
  readonly action: AuditActionLabels;
}

export function auditTrailCopyFrom(t: AdminTranslator, chrome: ConsoleChromeCopy): AuditTrailCopy {
  return {
    ...chrome,
    subject: t('screens.audit.subject'),
    heading: t('screens.audit.heading'),
    filterLabel: t('screens.audit.filterLabel'),
    everything: t('screens.audit.everything'),
    narrowLabel: t('screens.audit.narrowLabel'),
    fromLabel: t('screens.audit.fromLabel'),
    fromHint: t('screens.audit.fromHint'),
    toLabel: t('screens.audit.toLabel'),
    toHint: t('screens.audit.toHint'),
    clearDates: t('screens.audit.clearDates'),
    actorPicker: {
      ...accountPickerCopyFrom(t, chrome.refusals),
      label: t('screens.audit.actorLabel'),
      hint: t('screens.audit.actorHint'),
    },
    loadingList: t('screens.audit.loadingList'),
    emptyTitle: t('screens.audit.emptyTitle'),
    emptyBody: t('screens.audit.emptyBody'),
    filteredTitle: t('screens.audit.filteredTitle'),
    filteredBody: t('screens.audit.filteredBody'),
    refused: t('screens.audit.refused'),
    requestId: String(t.raw('screens.audit.requestId')),
    footnote: t('screens.audit.footnote'),
    entity: t.raw('screens.audit.entity') as Readonly<Record<string, string>>,
    action: t.raw('screens.audit.action') as AuditActionLabels,
  };
}

/**
 * AD-16, the health dashboard.
 *
 * <h2>Two sentences for one measurement, and not a unit bolted onto a number</h2>
 *
 * `measuredSeconds` and `measuredMinutes` are separate messages rather than one sentence with
 * a unit interpolated into it. The unit is a word that inflects: Russian says "секунд" beside
 * one number and "секунды" beside another, and Azerbaijani puts the whole phrase in a
 * different place than English does. A sentence assembled from a number, a space and a noun
 * can express none of that, and the version of it that existed here before #324 was a template
 * literal in JSX.
 */
export interface HealthDashboardCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly loadingList: string;
  readonly readFailed: string;
  readonly notMonitoredTitle: string;
  readonly notMonitoredBody: string;
  readonly overall: string;
  /** Carries `{count}`. */
  readonly measuredSeconds: string;
  /** Carries `{count}`. */
  readonly measuredMinutes: string;
  readonly measureAgain: string;
  readonly queues: string;
  /** Carries `{count}`. */
  readonly waiting: string;
  /** Carries `{count}`. Never added into {@link waiting} — see `lib/admin/health.ts`. */
  readonly givenUp: string;
  readonly jobs: string;
  /** Carries `{count}`. */
  readonly overdue: string;
  readonly onTime: string;
  /** Carries `{count}`. */
  readonly attempts: string;
  readonly providers: string;
  readonly notConfigured: string;
  /** Keyed by `HealthStatus`. The word, never only the colour — CLAUDE.md §2. */
  readonly status: Readonly<Record<string, string>>;
  /**
   * The scheduler's own states, worded — issue #403.
   *
   * <p>`READY` was drawn raw on all nineteen rows, which is not information in any
   * language. The wire word moved to the row's `title`, so it is still one hover from
   * whoever is about to grep for it, and a state with no sentence is drawn as itself.
   */
  readonly jobState: Readonly<Record<string, string>>;
  /**
   * A queue's name in the reader's language, keyed by the identifier the service sends —
   * issue #405.
   *
   * <p>The service used to answer "Outbox" and "Scheduled jobs", which this screen rendered
   * verbatim under an Azerbaijani heading and above a section headed with the Azerbaijani
   * for the second of them. `QueueDepthSource.queueName()` answers an identifier now, and a
   * queue this table has not been taught about renders as that identifier rather than as
   * nothing — the same rule the job states one field up follow.
   */
  readonly queue: Readonly<Record<string, string>>;
}

export function healthDashboardCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): HealthDashboardCopy {
  return {
    ...chrome,
    subject: t('screens.health.subject'),
    loadingList: t('screens.health.loadingList'),
    readFailed: t('screens.health.readFailed'),
    notMonitoredTitle: t('screens.health.notMonitoredTitle'),
    notMonitoredBody: t('screens.health.notMonitoredBody'),
    overall: t('screens.health.overall'),
    measuredSeconds: String(t.raw('screens.health.measuredSeconds')),
    measuredMinutes: String(t.raw('screens.health.measuredMinutes')),
    measureAgain: t('screens.health.measureAgain'),
    queues: t('screens.health.queues'),
    waiting: String(t.raw('screens.health.waiting')),
    givenUp: String(t.raw('screens.health.givenUp')),
    jobs: t('screens.health.jobs'),
    overdue: String(t.raw('screens.health.overdue')),
    onTime: t('screens.health.onTime'),
    attempts: String(t.raw('screens.health.attempts')),
    providers: t('screens.health.providers'),
    notConfigured: t('screens.health.notConfigured'),
    status: t.raw('screens.health.status') as Readonly<Record<string, string>>,
    jobState: t.raw('screens.health.jobState') as Readonly<Record<string, string>>,
    queue: t.raw('screens.health.queue') as Readonly<Record<string, string>>,
  };
}

/** AD-12, the feature flags. */
export interface FlagConsoleCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly heading: string;
  readonly loadingList: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly on: string;
  readonly off: string;
  readonly rollout: string;
  /** Carries `{count}`. */
  readonly alwaysIn: string;
  /** Carries `{date}`. */
  readonly lastChanged: string;
  readonly offForEverybody: string;
  readonly addHeading: string;
  readonly addIntro: string;
  readonly nameLabel: string;
  readonly nameHint: string;
  readonly nameError: string;
  readonly switchesLabel: string;
  readonly working: string;
  readonly add: string;
  readonly failedTitle: string;
}

export function flagConsoleCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): FlagConsoleCopy {
  return {
    ...chrome,
    subject: t('screens.flags.subject'),
    heading: t('screens.flags.heading'),
    loadingList: t('screens.flags.loadingList'),
    emptyTitle: t('screens.flags.emptyTitle'),
    emptyBody: t('screens.flags.emptyBody'),
    on: t('screens.flags.on'),
    off: t('screens.flags.off'),
    rollout: t('screens.flags.rollout'),
    alwaysIn: String(t.raw('screens.flags.alwaysIn')),
    lastChanged: String(t.raw('screens.flags.lastChanged')),
    offForEverybody: t('screens.flags.offForEverybody'),
    addHeading: t('screens.flags.addHeading'),
    addIntro: t('screens.flags.addIntro'),
    nameLabel: t('screens.flags.nameLabel'),
    nameHint: t('screens.flags.nameHint'),
    nameError: t('screens.flags.nameError'),
    switchesLabel: t('screens.flags.switchesLabel'),
    working: t('screens.flags.working'),
    add: t('screens.flags.add'),
    failedTitle: t('screens.flags.failedTitle'),
  };
}

/**
 * AD-13, the platform's own figures.
 *
 * <p>`windows` is keyed by the number of days rather than holding a formatted string per
 * option, because "30 days" is a noun phrase that inflects and three of them written as
 * `${n} days` in JSX is three sentences no translation can reach. The keys are the values the
 * screen already offers.
 *
 * <p>What the screen does <em>not</em> answer — cohorts and funnels — is named by the service
 * and worded here, since #403. It sent the sentences themselves until then, in English, under
 * a translated heading, which made them the only untranslated paragraph on the screen.
 *
 * <p>Codes keep the property the arrangement existed for: the day cohorts are built the
 * service stops sending `COHORTS` and the panel disappears without a frontend change. A code
 * this table has no sentence for is drawn as itself, so a new one shows up in English rather
 * than vanishing.
 */
export interface PlatformAnalyticsCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly loadingList: string;
  readonly windows: Readonly<Record<string, string>>;
  /** Carries `{from}`, `{to}`. */
  readonly range: string;
  readonly volume: string;
  readonly pledges: string;
  readonly backers: string;
  readonly averagePledge: string;
  readonly liveProjects: string;
  readonly otherCurrencyTitle: string;
  /** Carries `{count}`. */
  readonly otherCurrencyBody: string;
  readonly outcomesHeading: string;
  readonly noneClosed: string;
  readonly succeeded: string;
  readonly didNot: string;
  readonly successRate: string;
  readonly dailyHeading: string;
  readonly nothingPledged: string;
  /**
   * The chart's one stated figure, under the series — issue #405.
   *
   * <p>Carries `{day}` and `{amount}`. A column chart shows shape and not magnitude, so the
   * peak is named: without it, thirty bars scaled to their own maximum look identical
   * whether the busiest day took two hundred manat or two hundred thousand.
   */
  readonly busiestDay: string;
  readonly notBuiltHeading: string;
  /** Keyed by the code the service sends. Unknown codes fall through to themselves. */
  readonly notBuilt: Readonly<Record<string, string>>;
}

export function platformAnalyticsCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): PlatformAnalyticsCopy {
  return {
    ...chrome,
    subject: t('screens.analytics.subject'),
    loadingList: t('screens.analytics.loadingList'),
    windows: t.raw('screens.analytics.windows') as Readonly<Record<string, string>>,
    range: String(t.raw('screens.analytics.range')),
    volume: t('screens.analytics.volume'),
    pledges: t('screens.analytics.pledges'),
    backers: t('screens.analytics.backers'),
    averagePledge: t('screens.analytics.averagePledge'),
    liveProjects: t('screens.analytics.liveProjects'),
    otherCurrencyTitle: t('screens.analytics.otherCurrencyTitle'),
    otherCurrencyBody: String(t.raw('screens.analytics.otherCurrencyBody')),
    outcomesHeading: t('screens.analytics.outcomesHeading'),
    noneClosed: t('screens.analytics.noneClosed'),
    succeeded: t('screens.analytics.succeeded'),
    didNot: t('screens.analytics.didNot'),
    successRate: t('screens.analytics.successRate'),
    dailyHeading: t('screens.analytics.dailyHeading'),
    nothingPledged: t('screens.analytics.nothingPledged'),
    /* `raw`, because next-intl renders a template's own key when it is read with `t()` and
       has no value for the argument. */
    busiestDay: String(t.raw('screens.analytics.busiestDay')),
    notBuiltHeading: t('screens.analytics.notBuiltHeading'),
    notBuilt: t.raw('screens.analytics.notBuilt') as Readonly<Record<string, string>>,
  };
}

/**
 * AD-15's list.
 *
 * <p>`category` is the console's own table rather than `account.notifications.category`, which
 * is written for the person receiving the notice â€” "Your pledges", "Campaigns you back". A
 * member of staff reading a list of templates is not the recipient, and second-person copy on
 * an administrative list reads as though the console belonged to somebody else. Unknown
 * categories fall back to the wire value.
 */
export interface EmailTemplateIndexCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly loadingList: string;
  readonly readFailed: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly transactional: string;
  readonly category: Readonly<Record<string, string>>;
}

export function emailTemplateIndexCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): EmailTemplateIndexCopy {
  return {
    ...chrome,
    subject: t('screens.emailTemplates.subject'),
    loadingList: t('screens.emailTemplates.loadingList'),
    readFailed: t('screens.emailTemplates.readFailed'),
    emptyTitle: t('screens.emailTemplates.emptyTitle'),
    emptyBody: t('screens.emailTemplates.emptyBody'),
    transactional: t('screens.emailTemplates.transactional'),
    category: t.raw('screens.emailTemplates.category') as Readonly<Record<string, string>>,
  };
}

/**
 * AD-15's editor.
 *
 * <p>`historySubject` is a second subject for the same screen: it reads two things, and a
 * refusal about the version history that said "the email copy" would send somebody looking at
 * the wrong endpoint.
 *
 * <p>`mustKeep` and `mustKeepWhy` bracket a list of `{n}` placeholders the component renders as
 * `<code>` elements. Two keys rather than one because the middle is markup, and the alternative
 * â€” a single sentence with the codes interpolated as text â€” would lose the styling that tells
 * an editor these are literals rather than words.
 */
export interface EmailTemplateEditorCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly historySubject: string;
  readonly loadingList: string;
  readonly readFailed: string;
  readonly overriddenTitle: string;
  /** Carries `{version}`. */
  readonly overriddenBody: string;
  readonly shippedTitle: string;
  readonly shippedBody: string;
  readonly shippedHeading: string;
  readonly yourHeading: string;
  readonly mustKeep: string;
  readonly mustKeepWhy: string;
  readonly subjectLabel: string;
  readonly bodyLabel: string;
  readonly whyLabel: string;
  readonly whyHint: string;
  readonly missingTitle: string;
  /** Carries `{placeholders}`. */
  readonly missingBody: string;
  readonly saving: string;
  readonly saveNew: string;
  readonly withdraw: string;
  readonly savedNew: string;
  readonly savedWithdrawn: string;
  readonly doneTitle: string;
  readonly failedTitle: string;
  readonly versionsHeading: string;
  /** Carries `{date}`, `{version}`. */
  readonly versionLine: string;
  readonly live: string;
}

export function emailTemplateEditorCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): EmailTemplateEditorCopy {
  return {
    ...chrome,
    subject: t('screens.emailTemplateEditor.subject'),
    historySubject: t('screens.emailTemplateEditor.historySubject'),
    loadingList: t('screens.emailTemplateEditor.loadingList'),
    readFailed: t('screens.emailTemplateEditor.readFailed'),
    overriddenTitle: t('screens.emailTemplateEditor.overriddenTitle'),
    overriddenBody: String(t.raw('screens.emailTemplateEditor.overriddenBody')),
    shippedTitle: t('screens.emailTemplateEditor.shippedTitle'),
    shippedBody: t('screens.emailTemplateEditor.shippedBody'),
    shippedHeading: t('screens.emailTemplateEditor.shippedHeading'),
    yourHeading: t('screens.emailTemplateEditor.yourHeading'),
    mustKeep: t('screens.emailTemplateEditor.mustKeep'),
    mustKeepWhy: t('screens.emailTemplateEditor.mustKeepWhy'),
    subjectLabel: t('screens.emailTemplateEditor.subjectLabel'),
    bodyLabel: t('screens.emailTemplateEditor.bodyLabel'),
    whyLabel: t('screens.emailTemplateEditor.whyLabel'),
    whyHint: t('screens.emailTemplateEditor.whyHint'),
    missingTitle: t('screens.emailTemplateEditor.missingTitle'),
    missingBody: String(t.raw('screens.emailTemplateEditor.missingBody')),
    saving: t('screens.emailTemplateEditor.saving'),
    saveNew: t('screens.emailTemplateEditor.saveNew'),
    withdraw: t('screens.emailTemplateEditor.withdraw'),
    savedNew: t('screens.emailTemplateEditor.savedNew'),
    savedWithdrawn: t('screens.emailTemplateEditor.savedWithdrawn'),
    doneTitle: t('screens.emailTemplateEditor.doneTitle'),
    failedTitle: t('screens.emailTemplateEditor.failedTitle'),
    versionsHeading: t('screens.emailTemplateEditor.versionsHeading'),
    versionLine: String(t.raw('screens.emailTemplateEditor.versionLine')),
    live: t('screens.emailTemplateEditor.live'),
  };
}

/**
 * §22.2's eight documents, drafted and published — issue #425.
 *
 * <p>Exhaustive and typed rather than an index signature, for the reason this file's other
 * shapes give and one of its own: the screen's whole job is to make an irreversible action
 * legible, and a missing string here would be a blank where the sentence explaining that a
 * published version cannot be edited should be.
 */
export interface LegalDocumentEditorCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly noticeTitle: string;
  readonly noticeBody: string;
  readonly documentLabel: string;
  readonly languageLabel: string;
  readonly languageHint: string;
  readonly draftHeading: string;
  readonly draftIntro: string;
  readonly titleLabel: string;
  readonly bodyLabel: string;
  readonly bodyHint: string;
  readonly save: string;
  readonly working: string;
  /** Carries `{locale}`, `{version}`. */
  readonly savedNotice: string;
  readonly publishHeading: string;
  readonly publishIntro: string;
  /** Carries `{languages}`. */
  readonly willPublish: string;
  readonly governingMissingTitle: string;
  readonly governingMissingBody: string;
  readonly effectiveFromLabel: string;
  readonly effectiveFromHint: string;
  readonly publish: string;
  /** Carries `{languages}`, `{version}`. */
  readonly publishedNotice: string;
  readonly nothingDraftedTitle: string;
  readonly nothingDraftedBody: string;
  readonly historyHeading: string;
  readonly historyIntro: string;
  readonly noVersionsTitle: string;
  readonly noVersionsBody: string;
  /** Carries `{version}`. */
  readonly versionLabel: string;
  /** Carries `{from}`, `{hash}`. */
  readonly versionMeta: string;
  readonly doneTitle: string;
  readonly failedTitle: string;
  readonly loadingList: string;
  readonly tryAgain: string;
  /** §22.2's eight, named in the reader's language rather than by their code. */
  readonly kind: Readonly<Record<string, string>>;
  /** §21.1's four, likewise. The Azerbaijani entry says that it is the governing text. */
  readonly locale: Readonly<Record<string, string>>;
}

export function legalDocumentEditorCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): LegalDocumentEditorCopy {
  return {
    ...chrome,
    subject: t('screens.legal.subject'),
    noticeTitle: t('screens.legal.noticeTitle'),
    noticeBody: t('screens.legal.noticeBody'),
    documentLabel: t('screens.legal.documentLabel'),
    languageLabel: t('screens.legal.languageLabel'),
    languageHint: t('screens.legal.languageHint'),
    draftHeading: t('screens.legal.draftHeading'),
    draftIntro: t('screens.legal.draftIntro'),
    titleLabel: t('screens.legal.titleLabel'),
    bodyLabel: t('screens.legal.bodyLabel'),
    bodyHint: t('screens.legal.bodyHint'),
    save: t('screens.legal.save'),
    working: t('screens.legal.working'),
    /* `t.raw`, because it carries placeholders — `test-copy.ts` refuses `t()` on one. */
    savedNotice: String(t.raw('screens.legal.savedNotice')),
    publishHeading: t('screens.legal.publishHeading'),
    publishIntro: t('screens.legal.publishIntro'),
    willPublish: String(t.raw('screens.legal.willPublish')),
    governingMissingTitle: t('screens.legal.governingMissingTitle'),
    governingMissingBody: t('screens.legal.governingMissingBody'),
    effectiveFromLabel: t('screens.legal.effectiveFromLabel'),
    effectiveFromHint: t('screens.legal.effectiveFromHint'),
    publish: t('screens.legal.publish'),
    publishedNotice: String(t.raw('screens.legal.publishedNotice')),
    nothingDraftedTitle: t('screens.legal.nothingDraftedTitle'),
    nothingDraftedBody: t('screens.legal.nothingDraftedBody'),
    historyHeading: t('screens.legal.historyHeading'),
    historyIntro: t('screens.legal.historyIntro'),
    noVersionsTitle: t('screens.legal.noVersionsTitle'),
    noVersionsBody: t('screens.legal.noVersionsBody'),
    versionLabel: String(t.raw('screens.legal.versionLabel')),
    versionMeta: String(t.raw('screens.legal.versionMeta')),
    doneTitle: t('screens.legal.doneTitle'),
    failedTitle: t('screens.legal.failedTitle'),
    loadingList: t('screens.legal.loadingList'),
    tryAgain: t('screens.legal.tryAgain'),
    kind: t.raw('screens.legal.kind') as Readonly<Record<string, string>>,
    locale: t.raw('screens.legal.locale') as Readonly<Record<string, string>>,
  };
}

/**
 * The maintenance windows — §19.6, issue #214. Filed with AD-16's health board, because
 * closing the platform is an operational decision rather than a configuration one.
 *
 * <p>`refusal` is keyed by the service's code, and is open for the reason the audit tables
 * are: a code this screen was not taught falls back to the console's ordinary refusal
 * sentence rather than to nothing.
 */
export interface MaintenanceConsoleCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly loadingList: string;
  readonly currentHeading: string;
  readonly currentEmpty: string;
  readonly upcomingHeading: string;
  readonly upcomingEmpty: string;
  readonly recentHeading: string;
  readonly recentEmpty: string;
  /** Keyed by `MaintenanceWindowState`. */
  readonly state: Readonly<Record<string, string>>;
  readonly startsLabel: string;
  readonly endsLabel: string;
  readonly announceLabel: string;
  readonly endedLabel: string;
  readonly cancelledLabel: string;
  readonly noteLabel: string;
  readonly untilFurtherNotice: string;
  readonly startNow: string;
  readonly startNowConfirm: string;
  readonly startNowYes: string;
  readonly endNow: string;
  readonly endNowConfirm: string;
  readonly endNowYes: string;
  readonly keep: string;
  readonly changeEnd: string;
  readonly newEndLabel: string;
  readonly openEndLabel: string;
  readonly saveEnd: string;
  readonly cancelWindow: string;
  readonly scheduleHeading: string;
  /** Carries `{zone}`. */
  readonly scheduleIntro: string;
  readonly startsAtLabel: string;
  readonly endsAtLabel: string;
  readonly endsAtHint: string;
  readonly announceFromLabel: string;
  readonly announceFromHint: string;
  readonly noteFieldLabel: string;
  readonly noteHint: string;
  readonly schedule: string;
  readonly working: string;
  readonly failedTitle: string;
  /** Keyed by the service's refusal code. */
  readonly refusal: Readonly<Record<string, string>>;
}

export function maintenanceConsoleCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): MaintenanceConsoleCopy {
  return {
    ...chrome,
    subject: t('screens.maintenance.subject'),
    loadingList: t('screens.maintenance.loadingList'),
    currentHeading: t('screens.maintenance.currentHeading'),
    currentEmpty: t('screens.maintenance.currentEmpty'),
    upcomingHeading: t('screens.maintenance.upcomingHeading'),
    upcomingEmpty: t('screens.maintenance.upcomingEmpty'),
    recentHeading: t('screens.maintenance.recentHeading'),
    recentEmpty: t('screens.maintenance.recentEmpty'),
    state: t.raw('screens.maintenance.state') as Readonly<Record<string, string>>,
    startsLabel: t('screens.maintenance.startsLabel'),
    endsLabel: t('screens.maintenance.endsLabel'),
    announceLabel: t('screens.maintenance.announceLabel'),
    endedLabel: t('screens.maintenance.endedLabel'),
    cancelledLabel: t('screens.maintenance.cancelledLabel'),
    noteLabel: t('screens.maintenance.noteLabel'),
    untilFurtherNotice: t('screens.maintenance.untilFurtherNotice'),
    startNow: t('screens.maintenance.startNow'),
    startNowConfirm: t('screens.maintenance.startNowConfirm'),
    startNowYes: t('screens.maintenance.startNowYes'),
    endNow: t('screens.maintenance.endNow'),
    endNowConfirm: t('screens.maintenance.endNowConfirm'),
    endNowYes: t('screens.maintenance.endNowYes'),
    keep: t('screens.maintenance.keep'),
    changeEnd: t('screens.maintenance.changeEnd'),
    newEndLabel: t('screens.maintenance.newEndLabel'),
    openEndLabel: t('screens.maintenance.openEndLabel'),
    saveEnd: t('screens.maintenance.saveEnd'),
    cancelWindow: t('screens.maintenance.cancelWindow'),
    scheduleHeading: t('screens.maintenance.scheduleHeading'),
    scheduleIntro: String(t.raw('screens.maintenance.scheduleIntro')),
    startsAtLabel: t('screens.maintenance.startsAtLabel'),
    endsAtLabel: t('screens.maintenance.endsAtLabel'),
    endsAtHint: t('screens.maintenance.endsAtHint'),
    announceFromLabel: t('screens.maintenance.announceFromLabel'),
    announceFromHint: t('screens.maintenance.announceFromHint'),
    noteFieldLabel: t('screens.maintenance.noteFieldLabel'),
    noteHint: t('screens.maintenance.noteHint'),
    schedule: t('screens.maintenance.schedule'),
    working: t('screens.maintenance.working'),
    failedTitle: t('screens.maintenance.failedTitle'),
    refusal: t.raw('screens.maintenance.refusal') as Readonly<Record<string, string>>,
  };
}
