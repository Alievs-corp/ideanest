import type { AuditActionLabels } from '../../admin/audit';
import type { AdminTranslator } from '../admin-copy';
import type { PluralForms } from '../plurals';
import { consoleChartCopyFrom, type ConsoleChartCopy, type ConsoleChromeCopy } from './common-copy';
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
 * <h2>Every machine value has a table, and falls back to itself</h2>
 *
 * The service sends identifiers — a job's name, its state, why it is held, a provider, its kind,
 * why it is down — and this screen words each of them from the catalogue. The service used to
 * send some of them as English sentences, which the screen printed under Azerbaijani headings.
 * A value a table has not been taught renders as itself rather than as nothing.
 *
 * <h2>Counts that inflect are plural forms</h2>
 *
 * "1 minutes late" is what a sentence with a number interpolated into it says in English, and
 * Russian needs three forms. Lateness and attempts are therefore `PluralForms`; the counts that
 * stand alone in a sentence — waiting, given up, needing attention — read correctly with any
 * number in all four languages.
 */
export interface HealthDashboardCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly loadingList: string;
  readonly readFailed: string;
  readonly notMonitoredTitle: string;
  readonly notMonitoredBody: string;
  readonly overall: string;
  /** Carries `{time}`. */
  readonly measuredAt: string;
  readonly measureAgain: string;
  readonly queues: string;
  /** Carries `{count}`. */
  readonly waiting: string;
  /** Carries `{count}`. Never added into {@link waiting} — see `lib/admin/health.ts`. */
  readonly givenUp: string;
  readonly givenUpHint: string;
  readonly jobs: string;
  /** Carries `{count}`. */
  readonly jobsAttention: string;
  readonly jobsAllWell: string;
  /** Each carries `{count}`. */
  readonly overdue: Readonly<Record<'minutes' | 'hours' | 'days', PluralForms>>;
  readonly onTime: string;
  /** Carries `{count}`. */
  readonly attempts: PluralForms;
  /** Carries `{time}`. */
  readonly lastRun: string;
  readonly neverRun: string;
  readonly lastErrorLabel: string;
  readonly providers: string;
  readonly notConfigured: string;
  /** Keyed by `HealthStatus`. The word, never only the colour — CLAUDE.md §2. */
  readonly status: Readonly<Record<string, string>>;
  /** Keyed by the scheduler's state: `READY`, `DEAD`. */
  readonly jobState: Readonly<Record<string, string>>;
  /** Keyed by a job's hold: `MAINTENANCE`, `UNSCHEDULED`. */
  readonly hold: Readonly<Record<string, string>>;
  /** Keyed by the queue's identifier. */
  readonly queue: Readonly<Record<string, string>>;
  /** Keyed by the provider's kind. */
  readonly kind: Readonly<Record<string, string>>;
  /** Keyed by the provider as the platform names it. */
  readonly providerName: Readonly<Record<string, string>>;
  /** Keyed by why a provider is not available. */
  readonly reason: Readonly<Record<string, string>>;
  /** Keyed by the job's identifier, which stays on the row's `title`. */
  readonly jobName: Readonly<Record<string, string>>;
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
    measuredAt: String(t.raw('screens.health.measuredAt')),
    measureAgain: t('screens.health.measureAgain'),
    queues: t('screens.health.queues'),
    waiting: String(t.raw('screens.health.waiting')),
    givenUp: String(t.raw('screens.health.givenUp')),
    givenUpHint: t('screens.health.givenUpHint'),
    jobs: t('screens.health.jobs'),
    jobsAttention: String(t.raw('screens.health.jobsAttention')),
    jobsAllWell: t('screens.health.jobsAllWell'),
    overdue: t.raw('screens.health.overdue') as Readonly<Record<'minutes' | 'hours' | 'days', PluralForms>>,
    onTime: t('screens.health.onTime'),
    attempts: t.raw('screens.health.attempts') as PluralForms,
    lastRun: String(t.raw('screens.health.lastRun')),
    neverRun: t('screens.health.neverRun'),
    lastErrorLabel: t('screens.health.lastErrorLabel'),
    providers: t('screens.health.providers'),
    notConfigured: t('screens.health.notConfigured'),
    status: t.raw('screens.health.status') as Readonly<Record<string, string>>,
    jobState: t.raw('screens.health.jobState') as Readonly<Record<string, string>>,
    hold: t.raw('screens.health.hold') as Readonly<Record<string, string>>,
    queue: t.raw('screens.health.queue') as Readonly<Record<string, string>>,
    kind: t.raw('screens.health.kind') as Readonly<Record<string, string>>,
    providerName: t.raw('screens.health.providerName') as Readonly<Record<string, string>>,
    reason: t.raw('screens.health.reason') as Readonly<Record<string, string>>,
    jobName: t.raw('screens.health.jobName') as Readonly<Record<string, string>>,
  };
}

/**
 * AD-12, the feature flags.
 *
 * <p>`reach` is keyed by `FlagReach` from `lib/admin/flags.ts`: one sentence for each of the
 * five things a flag can reach, so the screen never prints "On" beside a flag that reaches
 * nobody. `picker` is the account directory's own picker, labelled for this screen.
 */
export interface FlagConsoleCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly heading: string;
  readonly loadingList: string;
  readonly notReadTitle: string;
  readonly notReadBody: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly on: string;
  readonly off: string;
  readonly rollout: string;
  /** Carries `{flag}`. The rollout buttons' group name. */
  readonly rolloutGroup: string;
  /** Carries `{percent}`. */
  readonly rolloutNow: string;
  /** Keyed by `FlagReach`. `some` carries `{percent}`. */
  readonly reach: Readonly<Record<string, string>>;
  readonly accountsHeading: string;
  readonly accountsNone: string;
  readonly accountsReadOnly: string;
  readonly accountsFull: string;
  readonly addAccount: string;
  /** Carries `{flag}`. */
  readonly addAccountLabel: string;
  readonly addAccountClose: string;
  readonly removeAccount: string;
  /** Carries `{name}`, `{flag}`. */
  readonly removeAccountLabel: string;
  readonly editDescription: string;
  readonly saveDescription: string;
  /** Carries `{date}`, `{name}`. */
  readonly lastChanged: string;
  /** Carries `{flag}`. */
  readonly confirmLabel: string;
  /** Carries `{flag}`, `{reach}`. */
  readonly confirmWiden: string;
  readonly confirmYes: string;
  readonly keep: string;
  readonly addHeading: string;
  readonly addIntro: string;
  readonly nameLabel: string;
  readonly nameHint: string;
  readonly nameError: string;
  readonly switchesLabel: string;
  readonly descriptionRequired: string;
  /** Carries `{flag}`. */
  readonly created: string;
  readonly doneTitle: string;
  readonly working: string;
  readonly add: string;
  readonly failedTitle: string;
  /** Keyed by the service's refusal code. */
  readonly errors: Readonly<Record<string, string>>;
  readonly picker: AccountPickerCopy;
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
    notReadTitle: t('screens.flags.notReadTitle'),
    notReadBody: t('screens.flags.notReadBody'),
    emptyTitle: t('screens.flags.emptyTitle'),
    emptyBody: t('screens.flags.emptyBody'),
    on: t('screens.flags.on'),
    off: t('screens.flags.off'),
    rollout: t('screens.flags.rollout'),
    rolloutGroup: String(t.raw('screens.flags.rolloutGroup')),
    rolloutNow: String(t.raw('screens.flags.rolloutNow')),
    reach: t.raw('screens.flags.reach') as Readonly<Record<string, string>>,
    accountsHeading: t('screens.flags.accountsHeading'),
    accountsNone: t('screens.flags.accountsNone'),
    accountsReadOnly: t('screens.flags.accountsReadOnly'),
    accountsFull: t('screens.flags.accountsFull'),
    addAccount: t('screens.flags.addAccount'),
    addAccountLabel: String(t.raw('screens.flags.addAccountLabel')),
    addAccountClose: t('screens.flags.addAccountClose'),
    removeAccount: t('screens.flags.removeAccount'),
    removeAccountLabel: String(t.raw('screens.flags.removeAccountLabel')),
    editDescription: t('screens.flags.editDescription'),
    saveDescription: t('screens.flags.saveDescription'),
    lastChanged: String(t.raw('screens.flags.lastChanged')),
    confirmLabel: String(t.raw('screens.flags.confirmLabel')),
    confirmWiden: String(t.raw('screens.flags.confirmWiden')),
    confirmYes: t('screens.flags.confirmYes'),
    keep: t('screens.flags.keep'),
    addHeading: t('screens.flags.addHeading'),
    addIntro: t('screens.flags.addIntro'),
    nameLabel: t('screens.flags.nameLabel'),
    nameHint: t('screens.flags.nameHint'),
    nameError: t('screens.flags.nameError'),
    switchesLabel: t('screens.flags.switchesLabel'),
    descriptionRequired: t('screens.flags.descriptionRequired'),
    created: String(t.raw('screens.flags.created')),
    doneTitle: t('screens.flags.doneTitle'),
    working: t('screens.flags.working'),
    add: t('screens.flags.add'),
    failedTitle: t('screens.flags.failedTitle'),
    errors: t.raw('screens.flags.errors') as Readonly<Record<string, string>>,
    picker: { ...accountPickerCopyFrom(t, chrome.refusals), label: t('screens.flags.addAccount') },
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
  readonly planRevenue: string;
  readonly planPayments: string;
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
  readonly chart: ConsoleChartCopy;
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
    planRevenue: t('screens.analytics.planRevenue'),
    planPayments: t('screens.analytics.planPayments'),
    otherCurrencyTitle: t('screens.analytics.otherCurrencyTitle'),
    otherCurrencyBody: String(t.raw('screens.analytics.otherCurrencyBody')),
    outcomesHeading: t('screens.analytics.outcomesHeading'),
    noneClosed: t('screens.analytics.noneClosed'),
    succeeded: t('screens.analytics.succeeded'),
    didNot: t('screens.analytics.didNot'),
    successRate: t('screens.analytics.successRate'),
    dailyHeading: t('screens.analytics.dailyHeading'),
    nothingPledged: t('screens.analytics.nothingPledged'),
    chart: consoleChartCopyFrom(t),
    notBuiltHeading: t('screens.analytics.notBuiltHeading'),
    notBuilt: t.raw('screens.analytics.notBuilt') as Readonly<Record<string, string>>,
  };
}

/**
 * AD-15's list.
 *
 * <p>`category` is the console's own table rather than `account.notifications.category`, which
 * is written for the person receiving the notice — "Your pledges", "Campaigns you back". A
 * member of staff reading a list of templates is not the recipient, and second-person copy on
 * an administrative list reads as though the console belonged to somebody else. Unknown
 * categories fall back to the wire value.
 *
 * <p>`type` names every notification in words, because the list used to title each row with its
 * enum constant. A type the catalogue does not know falls back to the constant, which is
 * readable and is the honest failure.
 */
export interface EmailTemplateIndexCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly loadingList: string;
  readonly readFailed: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  /** The tag on the one template a recipient cannot switch off. */
  readonly mandatory: string;
  readonly shippedOnly: string;
  /** Carries `{language}`, `{version}`. */
  readonly rewritten: string;
  readonly category: Readonly<Record<string, string>>;
  readonly type: Readonly<Record<string, string>>;
  /** The four languages, by code. */
  readonly language: Readonly<Record<string, string>>;
}

export function emailTemplateIndexCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): EmailTemplateIndexCopy {
  const raw = (key: string) => String(t.raw(`screens.emailTemplates.${key}`));
  return {
    ...chrome,
    subject: raw('subject'),
    loadingList: raw('loadingList'),
    readFailed: raw('readFailed'),
    emptyTitle: raw('emptyTitle'),
    emptyBody: raw('emptyBody'),
    mandatory: raw('mandatory'),
    shippedOnly: raw('shippedOnly'),
    rewritten: raw('rewritten'),
    category: t.raw('screens.emailTemplates.category') as Readonly<Record<string, string>>,
    type: t.raw('screens.emailTemplates.type') as Readonly<Record<string, string>>,
    language: t.raw('screens.emailTemplates.language') as Readonly<Record<string, string>>,
  };
}

/**
 * AD-15's editor.
 *
 * <p>`historySubject` is a second subject for the same screen: it reads two things, and a
 * refusal about the version history that said "the email copy" would send somebody looking at
 * the wrong endpoint.
 *
 * <p>Every string is read with `t.raw`: most carry placeholders the component fills, and several
 * name a placeholder such as `{2}` literally, which the component supplies rather than the
 * catalogue — an ICU message cannot hold a bare `{2}`.
 */
export interface EmailTemplateEditorCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly historySubject: string;
  readonly loadingList: string;
  readonly readFailed: string;
  readonly languageLabel: string;
  /** Carries `{language}`. */
  readonly reach: string;
  readonly reachPrimary: string;
  readonly overriddenTitle: string;
  /** Carries `{version}`, `{language}`. */
  readonly overriddenBody: string;
  readonly shippedTitle: string;
  readonly shippedBody: string;
  readonly shippedHeading: string;
  readonly shippedNamedLabel: string;
  readonly shippedPlainLabel: string;
  readonly yourHeading: string;
  readonly placeholdersHeading: string;
  readonly placeholdersIntro: string;
  readonly mustKeep: string;
  /** What each of the six facts is, by its index. */
  readonly placeholder: Readonly<Record<string, string>>;
  /** Carries `{placeholder}`. */
  readonly campaignFallback: string;
  readonly subjectLabel: string;
  readonly bodyLabel: string;
  readonly whyLabel: string;
  readonly whyHint: string;
  readonly missingTitle: string;
  /** Carries `{placeholders}`. */
  readonly missingBody: string;
  readonly unknownTitle: string;
  /** Carries `{placeholders}`. */
  readonly unknownBody: string;
  /** Carries `{field}`, `{example}`. */
  readonly malformedBody: string;
  /** The two editable fields, as `malformedBody` names them. */
  readonly field: { readonly subject: string; readonly body: string };
  readonly preview: string;
  readonly previewing: string;
  readonly previewHeading: string;
  readonly previewIntro: string;
  /** Carries `{subject}`. */
  readonly previewSubject: string;
  readonly previewFrameTitle: string;
  readonly previewStale: string;
  readonly testSend: string;
  readonly testSending: string;
  readonly testSent: string;
  readonly saving: string;
  readonly saveNew: string;
  readonly confirmSaveLabel: string;
  /** Carries `{version}`, `{language}`. */
  readonly confirmSave: string;
  readonly confirmSaveAction: string;
  readonly back: string;
  readonly withdraw: string;
  readonly confirmWithdrawLabel: string;
  /** Carries `{version}`, `{language}`. */
  readonly confirmWithdraw: string;
  /** Carries `{version}`. */
  readonly savedNew: string;
  readonly savedWithdrawn: string;
  readonly restore: string;
  readonly confirmRestoreLabel: string;
  /** Carries `{from}`, `{version}`. */
  readonly confirmRestore: string;
  /** Carries `{version}`. The note a restored version is saved with. */
  readonly restoredNote: string;
  readonly showText: string;
  readonly switchLabel: string;
  readonly switchConfirm: string;
  readonly switchAction: string;
  readonly doneTitle: string;
  readonly failedTitle: string;
  readonly versionsHeading: string;
  readonly versionsEmpty: string;
  /** Carries `{date}`, `{version}`. */
  readonly versionLine: string;
  readonly writtenBy: string;
  readonly live: string;
  readonly tryAgain: string;
  /** The refusals the editor words itself, by the service's code. */
  readonly errors: Readonly<Record<string, string>>;
  /** The four languages, by code — the list's table, so both screens name them alike. */
  readonly language: Readonly<Record<string, string>>;
}

export function emailTemplateEditorCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): EmailTemplateEditorCopy {
  const raw = (key: string) => String(t.raw(`screens.emailTemplateEditor.${key}`));
  return {
    ...chrome,
    subject: raw('subject'),
    historySubject: raw('historySubject'),
    loadingList: raw('loadingList'),
    readFailed: raw('readFailed'),
    languageLabel: raw('languageLabel'),
    reach: raw('reach'),
    reachPrimary: raw('reachPrimary'),
    overriddenTitle: raw('overriddenTitle'),
    overriddenBody: raw('overriddenBody'),
    shippedTitle: raw('shippedTitle'),
    shippedBody: raw('shippedBody'),
    shippedHeading: raw('shippedHeading'),
    shippedNamedLabel: raw('shippedNamedLabel'),
    shippedPlainLabel: raw('shippedPlainLabel'),
    yourHeading: raw('yourHeading'),
    placeholdersHeading: raw('placeholdersHeading'),
    placeholdersIntro: raw('placeholdersIntro'),
    mustKeep: raw('mustKeep'),
    placeholder: t.raw('screens.emailTemplateEditor.placeholder') as Readonly<Record<string, string>>,
    campaignFallback: raw('campaignFallback'),
    subjectLabel: raw('subjectLabel'),
    bodyLabel: raw('bodyLabel'),
    whyLabel: raw('whyLabel'),
    whyHint: raw('whyHint'),
    missingTitle: raw('missingTitle'),
    missingBody: raw('missingBody'),
    unknownTitle: raw('unknownTitle'),
    unknownBody: raw('unknownBody'),
    malformedBody: raw('malformedBody'),
    field: t.raw('screens.emailTemplateEditor.field') as { readonly subject: string; readonly body: string },
    preview: raw('preview'),
    previewing: raw('previewing'),
    previewHeading: raw('previewHeading'),
    previewIntro: raw('previewIntro'),
    previewSubject: raw('previewSubject'),
    previewFrameTitle: raw('previewFrameTitle'),
    previewStale: raw('previewStale'),
    testSend: raw('testSend'),
    testSending: raw('testSending'),
    testSent: raw('testSent'),
    saving: raw('saving'),
    saveNew: raw('saveNew'),
    confirmSaveLabel: raw('confirmSaveLabel'),
    confirmSave: raw('confirmSave'),
    confirmSaveAction: raw('confirmSaveAction'),
    back: raw('back'),
    withdraw: raw('withdraw'),
    confirmWithdrawLabel: raw('confirmWithdrawLabel'),
    confirmWithdraw: raw('confirmWithdraw'),
    savedNew: raw('savedNew'),
    savedWithdrawn: raw('savedWithdrawn'),
    restore: raw('restore'),
    confirmRestoreLabel: raw('confirmRestoreLabel'),
    confirmRestore: raw('confirmRestore'),
    restoredNote: raw('restoredNote'),
    showText: raw('showText'),
    switchLabel: raw('switchLabel'),
    switchConfirm: raw('switchConfirm'),
    switchAction: raw('switchAction'),
    doneTitle: raw('doneTitle'),
    failedTitle: raw('failedTitle'),
    versionsHeading: raw('versionsHeading'),
    versionsEmpty: raw('versionsEmpty'),
    versionLine: raw('versionLine'),
    writtenBy: raw('writtenBy'),
    live: raw('live'),
    tryAgain: raw('tryAgain'),
    errors: t.raw('screens.emailTemplateEditor.errors') as Readonly<Record<string, string>>,
    language: t.raw('screens.emailTemplates.language') as Readonly<Record<string, string>>,
  };
}

/**
 * §22.2's eight documents, drafted and published — issue #425.
 *
 * <p>Exhaustive and typed rather than an index signature, for the reason this file's other
 * shapes give and one of its own: the screen's whole job is to make an irreversible action
 * legible, and a missing string here would be a blank where the sentence explaining that a
 * published version cannot be edited should be.
 *
 * <p>Read with `t.raw` throughout, because most of these carry placeholders the screen fills.
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
  /** Carries `{language}`, `{version}`. */
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
  /** Carries `{languages}`, `{version}`, `{date}`. */
  readonly publishedFuture: string;
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
  /** Carries `{date}`. */
  readonly takesEffect: string;
  readonly openOnSite: string;
  readonly showOnSite: string;
  readonly shownOnSite: string;
  /** Carries `{version}`. */
  readonly activatedNotice: string;
  readonly doneTitle: string;
  readonly failedTitle: string;
  readonly loadingList: string;
  readonly readFailed: string;
  readonly tryAgain: string;
  readonly back: string;
  readonly confirmPublishLabel: string;
  /** Carries `{document}`, `{version}`, `{languages}`, `{when}`. */
  readonly confirmPublish: string;
  readonly confirmPublishAction: string;
  readonly whenNow: string;
  /** Carries `{date}`. */
  readonly whenDate: string;
  /** Who must accept a new version again, by document. Only the two agreements have an entry. */
  readonly reaccept: Readonly<Record<string, string>>;
  readonly confirmActivateLabel: string;
  /** Carries `{document}`, `{version}`. */
  readonly confirmActivate: string;
  readonly unsavedTitle: string;
  /** Carries `{languages}`. */
  readonly unsavedBody: string;
  /** Carries `{language}`. */
  readonly unsavedOption: string;
  readonly switchDocumentLabel: string;
  /** Carries `{languages}`. */
  readonly switchDocument: string;
  readonly switchDocumentAction: string;
  /** The refusals the screen words itself, by the service's code. */
  readonly errors: Readonly<Record<string, string>>;
  /** §22.2's eight, named in the reader's language rather than by their code. */
  readonly kind: Readonly<Record<string, string>>;
  /** §21.1's four, for the selector. The Azerbaijani entry says that it is the governing text. */
  readonly locale: Readonly<Record<string, string>>;
  /** The same four as plain names, for sentences. */
  readonly languageName: Readonly<Record<string, string>>;
}

export function legalDocumentEditorCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): LegalDocumentEditorCopy {
  const raw = (key: string) => String(t.raw(`screens.legal.${key}`));
  const table = (key: string) => t.raw(`screens.legal.${key}`) as Readonly<Record<string, string>>;
  return {
    ...chrome,
    subject: raw('subject'),
    noticeTitle: raw('noticeTitle'),
    noticeBody: raw('noticeBody'),
    documentLabel: raw('documentLabel'),
    languageLabel: raw('languageLabel'),
    languageHint: raw('languageHint'),
    draftHeading: raw('draftHeading'),
    draftIntro: raw('draftIntro'),
    titleLabel: raw('titleLabel'),
    bodyLabel: raw('bodyLabel'),
    bodyHint: raw('bodyHint'),
    save: raw('save'),
    working: raw('working'),
    savedNotice: raw('savedNotice'),
    publishHeading: raw('publishHeading'),
    publishIntro: raw('publishIntro'),
    willPublish: raw('willPublish'),
    governingMissingTitle: raw('governingMissingTitle'),
    governingMissingBody: raw('governingMissingBody'),
    effectiveFromLabel: raw('effectiveFromLabel'),
    effectiveFromHint: raw('effectiveFromHint'),
    publish: raw('publish'),
    publishedNotice: raw('publishedNotice'),
    publishedFuture: raw('publishedFuture'),
    nothingDraftedTitle: raw('nothingDraftedTitle'),
    nothingDraftedBody: raw('nothingDraftedBody'),
    historyHeading: raw('historyHeading'),
    historyIntro: raw('historyIntro'),
    noVersionsTitle: raw('noVersionsTitle'),
    noVersionsBody: raw('noVersionsBody'),
    versionLabel: raw('versionLabel'),
    versionMeta: raw('versionMeta'),
    takesEffect: raw('takesEffect'),
    openOnSite: raw('openOnSite'),
    showOnSite: raw('showOnSite'),
    shownOnSite: raw('shownOnSite'),
    activatedNotice: raw('activatedNotice'),
    doneTitle: raw('doneTitle'),
    failedTitle: raw('failedTitle'),
    loadingList: raw('loadingList'),
    readFailed: raw('readFailed'),
    tryAgain: raw('tryAgain'),
    back: raw('back'),
    confirmPublishLabel: raw('confirmPublishLabel'),
    confirmPublish: raw('confirmPublish'),
    confirmPublishAction: raw('confirmPublishAction'),
    whenNow: raw('whenNow'),
    whenDate: raw('whenDate'),
    reaccept: table('reaccept'),
    confirmActivateLabel: raw('confirmActivateLabel'),
    confirmActivate: raw('confirmActivate'),
    unsavedTitle: raw('unsavedTitle'),
    unsavedBody: raw('unsavedBody'),
    unsavedOption: raw('unsavedOption'),
    switchDocumentLabel: raw('switchDocumentLabel'),
    switchDocument: raw('switchDocument'),
    switchDocumentAction: raw('switchDocumentAction'),
    errors: table('errors'),
    kind: table('kind'),
    locale: table('locale'),
    languageName: table('languageName'),
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
  readonly cancelConfirm: string;
  readonly cancelYes: string;
  /** The inline confirmation's group name. */
  readonly confirmLabel: string;
  /** Under the end editor, when the end is not after both the start and now. */
  readonly endInvalid: string;
  /** Carries `{zone}`. Above the lists, so every time on the screen is read in one zone. */
  readonly zoneNote: string;
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
  /** Asked before scheduling a window whose start has already come. */
  readonly scheduleNowConfirm: string;
  readonly scheduleNowYes: string;
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
    cancelConfirm: t('screens.maintenance.cancelConfirm'),
    cancelYes: t('screens.maintenance.cancelYes'),
    confirmLabel: t('screens.maintenance.confirmLabel'),
    endInvalid: t('screens.maintenance.endInvalid'),
    zoneNote: String(t.raw('screens.maintenance.zoneNote')),
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
    scheduleNowConfirm: t('screens.maintenance.scheduleNowConfirm'),
    scheduleNowYes: t('screens.maintenance.scheduleNowYes'),
    working: t('screens.maintenance.working'),
    failedTitle: t('screens.maintenance.failedTitle'),
    refusal: t.raw('screens.maintenance.refusal') as Readonly<Record<string, string>>,
  };
}
