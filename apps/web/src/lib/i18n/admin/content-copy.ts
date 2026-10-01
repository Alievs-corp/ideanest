import type {
  CampaignOutcome,
  ReportOutcome,
  ReportReason,
  ReportState,
  ReportTargetType,
  SubmissionState,
} from '../../moderation/api';
import type { AuditActionLabels } from '../../admin/audit';
import type { ProjectState } from '../../projects/api';
import type { AdminTranslator } from '../admin-copy';
import type { PluralForms } from '../plurals';
import type { CampaignStoryCopy } from '../campaign-copy';
import type { ConsoleChromeCopy } from './common-copy';

/**
 * The words the console's content screens draw — issue #324, epic #259.
 *
 * The rail's first group: the moderation queue, the content and profile queues over it, and
 * one report's own page.
 *
 * <h2>Why the shared vocabulary is its own object rather than more fields</h2>
 *
 * Four components draw the same nine reasons, four target nouns, three states and five
 * decision verbs — the queue, the card inside it, the dialog all three open, and the detail
 * page. Spreading those into each screen's copy would give four copies of one table and three
 * chances for one of them to be given a translation the others do not have.
 *
 * <p>{@link ModerationCopy} is therefore passed down as a nested object rather than flattened
 * in, which is the one place in this directory that happens. It is the difference between a
 * screen's own words — which nothing else says — and the platform's moderation vocabulary,
 * which every one of these surfaces says identically.
 */

/**
 * The vocabulary of a complaint.
 *
 * <h2>Three tables for the target noun, and each earns its place</h2>
 *
 * `target` is the bare noun in the case these sentences put it in — "the report about
 * <em>campaign</em> 1a2b3c4d". `targetOnThis` is the whole prepositional phrase — "on this
 * campaign" — because Russian agrees the demonstrative with the noun's gender and
 * <em>эту кампанию</em> beside <em>этот комментарий</em> cannot be built from a shared "this".
 * `campaignName` is the nominative, for the three campaign verbs whose sentences make the
 * campaign the subject: "campaign 1a2b3c4d is cleared for launch" needs <em>кампания</em>
 * where "the report about campaign 1a2b3c4d" needs <em>кампанию</em>.
 *
 * <p>English distinguishes none of the three and would have been served by one table, which is
 * exactly why the old code had one. A translation surfaced the distinction the source language
 * hid.
 *
 * <h2>The state is keyed three ways for the same reason</h2>
 *
 * `state` is the tag beside a report. {@link ModerationQueueCopy.heading},
 * `emptyTitle` and `noticeReport` are whole sentences keyed by state rather than one sentence
 * with the state interpolated: "Upheld" is an adjective in the tag, a plural attributive in
 * "Upheld reports" and a past-tense verb in "Upheld the report about…", and Russian spells
 * those three differently.
 */
export interface ModerationCopy {
  /*
   * Keyed by the closed unions rather than by `string`, so `noUncheckedIndexedAccess` gives a
   * defined value at every call site and a member the service adds fails the build here rather
   * than rendering a blank in the interface. The open tables in this directory — an audit
   * action, an email category — are `string` for the opposite reason: their sets are the
   * service's and are allowed to be ahead of the catalogue.
   */
  readonly reason: Readonly<Record<ReportReason, string>>;
  /** The bare noun, in the case these sentences use. */
  readonly target: Readonly<Record<ReportTargetType, string>>;
  /** The whole "on this …" phrase. */
  readonly targetOnThis: Readonly<Record<ReportTargetType, string>>;
  /** Carries `{kind}` and `{id}`. */
  readonly targetName: string;
  /** Carries `{id}`. Nominative, for the sentences that make the campaign the subject. */
  readonly campaignName: string;
  /** The tag, never the heading. */
  readonly state: Readonly<Record<ReportState, string>>;
  readonly reportOutcome: Readonly<Record<ReportOutcome, string>>;
  readonly campaignOutcome: Readonly<Record<CampaignOutcome, string>>;
  /** Carries `{count}` and `{phrase}`, the latter from {@link targetOnThis}. */
  readonly openReports: PluralForms;
  /** Carries `{count}`. */
  readonly reportCount: PluralForms;
  readonly decisionHeading: string;
  readonly noNote: string;
  /**
   * The dialog's dismissing control.
   *
   * Passed in already resolved rather than read from a key of its own: the word is
   * `common.cancel`, which the whole product shares, and a second spelling of it under
   * `admin.moderation` would be a second one to translate and a second one to get wrong.
   */
  readonly cancel: string;
  /** Carries `{moderator}` and `{at}`, both of them nodes. */
  readonly decidedBy: Readonly<Record<ReportState, string>>;
  readonly decision: DecisionCopy;
}

/** One of the five verbs, as the dialog that confirms it says them. */
export interface DecisionVerbCopy {
  readonly title: string;
  /** Carries `{name}`. */
  readonly description: string;
  readonly confirmLabel: string;
  readonly busyLabel: string;
  readonly noteLabel: string;
  readonly noteHint: string;
  /**
   * What the decision does not do.
   *
   * Present on the two report outcomes, which each say something different about what they
   * leave alone. Absent on the three campaign outcomes, which share {@link
   * DecisionCopy.campaignBody} — all three move the campaign and none of them decides the
   * report, and writing that sentence three times would be three chances to reword one of them.
   */
  readonly body?: string;
}

export interface DecisionCopy {
  readonly errorTitle: string;
  readonly noteRequired: string;
  /** Carries `{limit}`. */
  readonly tooLong: string;
  readonly campaignBody: string;
  /** Keyed by the outcome, across both kinds — the union the dialog switches on. */
  readonly verb: Readonly<Record<ReportOutcome | CampaignOutcome, DecisionVerbCopy>>;
}

export interface ModerationQueueCopy extends ConsoleChromeCopy {
  readonly moderation: ModerationCopy;
  /**
   * This screen's own refusals rather than `admin.refusals`.
   *
   * The queue said something different from the rest of the console before #324 — it names the
   * queue and what clearing it means — and translating a surface is not the change that gets to
   * reword it.
   *
   * <p>Only the 403 about standing, since #400. The one that names a capability is the
   * console's, because the sentence is the same everywhere and the service supplies the only
   * part of it that differs — which is why `subject` above is now a key of its own.
   */
  readonly subject: string;
  readonly signedOutTitle: string;
  readonly signedOutBody: string;
  readonly forbiddenTitle: string;
  readonly forbiddenBody: string;
  readonly notStaff: string;
  readonly transitionNotAllowed: string;
  /** Carries `{state}`, which is the service's own campaign state and stays in its spelling. */
  readonly transitionNotAllowedFrom: string;
  readonly alreadyResolved: string;
  /** A whole heading, not a word to put in front of "reports". */
  readonly heading: Readonly<Record<ReportState, string>>;
  readonly statusLabel: string;
  readonly targetLabel: string;
  readonly triageLabel: string;
  /** Keyed by `TargetFilter`. */
  readonly targetFilter: Readonly<Record<string, string>>;
  readonly overdueOnly: string;
  readonly repeatedOnly: string;
  /** Carries `{reports}` — already pluralised — and `{loaded}`. */
  readonly showing: string;
  readonly morePages: string;
  readonly loadingList: string;
  readonly filteredTitle: string;
  readonly filteredBody: string;
  readonly emptyTitle: Readonly<Record<ReportState, string>>;
  readonly emptyBody: Readonly<Record<ReportState, string>>;
  /** Carries `{target}`. */
  readonly noticeReport: Readonly<Record<ReportState, string>>;
  /** Carries `{id}` and `{state}`. */
  readonly noticeCampaign: string;
  /** Carries `{kind}` and `{id}`, the second a styled node. */
  readonly reportedAbout: string;
  readonly fullHistory: string;
  /** Carries `{target}`. */
  readonly fullHistoryLabel: string;
  readonly overdue: string;
  readonly reported: string;
  readonly signal: string;
  readonly reporter: string;
  readonly targetTerm: string;
  /** Carries `{target}`. */
  readonly decideGroup: string;
  readonly decideHeading: string;
  /** Carries `{outcome}` and `{target}`. */
  readonly decideLabel: string;
  /** Carries `{target}`. */
  readonly actGroup: string;
  readonly actHeading: string;
  /** Carries `{outcome}` and `{target}`. */
  readonly actLabel: string;
}

export interface ContentReportQueueCopy extends ConsoleChromeCopy {
  /** The queue this screen puts two chips over, and hands its own copy straight down to. */
  readonly queue: ModerationQueueCopy;
  /** Keyed by the two `ReportTargetType`s this screen offers. */
  readonly surface: Readonly<Record<ReportTargetType, string>>;
  readonly noticeTitle: string;
  readonly noticeBody: string;
}

export interface ReportDetailCopy extends ConsoleChromeCopy {
  readonly moderation: ModerationCopy;
  /**
   * The audit trail's action table, borrowed from `admin.screens.audit`.
   *
   * The same rows, drawn by a second screen. A copy of the table under this screen's node
   * would be a second set of translations for `report.upheld` that nothing keeps in step.
   */
  readonly auditAction: AuditActionLabels;
  readonly subject: string;
  readonly historySubject: string;
  readonly loadingList: string;
  readonly notFoundTitle: string;
  readonly notFoundBody: string;
  readonly backToQueue: string;
  /** Carries `{kind}` and `{id}`, the second a styled node. */
  readonly reportedAbout: string;
  readonly reported: string;
  readonly signal: string;
  readonly reporter: string;
  readonly decideGroup: string;
  readonly decideHeading: string;
  readonly decideFootnote: string;
  readonly historyHeading: string;
  readonly historyIntro: string;
  readonly historyFailedTitle: string;
  readonly loadingHistory: string;
  readonly historyEmpty: string;
  /** Carries `{action}` and `{actor}`, the second a styled node. */
  readonly actionBy: string;
  readonly refused: string;
  /** What was reported — the block this page spent its whole life without. See #399. */
  readonly evidence: ReportedContentCopy;
}

/**
 * The reported content, in words — issue #399.
 *
 * <p>This page used to render the reporter's claim, the reporter, and two irreversible
 * buttons. Counted in the DOM, zero links: not the comment, not who wrote it, not which
 * campaign it is on, and no route to any of the three. Everything below is the sentence
 * "here is what you are being asked to rule on", said four different ways because the
 * platform can be in four different positions about it.
 */
export interface ReportedContentCopy {
  /** What this block calls what it reads, for a refusal. Already inflected. */
  readonly subject: string;
  readonly heading: string;
  readonly intro: string;
  readonly loading: string;
  readonly failedTitle: string;
  /** The one thing a moderator must not miss: somebody has already taken this down. */
  readonly removedTitle: string;
  readonly removedBody: string;
  readonly goneTitle: string;
  readonly goneBody: string;
  /** A campaign or an account: the console reaches it directly rather than inlining it. */
  readonly addressedBody: string;
  readonly authorLabel: string;
  readonly campaignLabel: string;
  readonly writtenLabel: string;
  /** Carries `{number}` — "Update 4", which is what a creator and a backer both call it. */
  readonly updateNumber: string;
  readonly openCampaign: string;
  readonly noText: string;
}

function verb(t: AdminTranslator, outcome: string): DecisionVerbCopy {
  return t.raw(`moderation.decision.${outcome}`) as DecisionVerbCopy;
}

export function moderationCopyFrom(t: AdminTranslator, cancel: string): ModerationCopy {
  /*
   * One cast per table rather than one per key. `t.raw` is next-intl's own escape hatch for a
   * message that is not a string, and what comes back is the catalogue node — the shape of
   * which `catalogue.test.ts` holds identical across the four languages, so a table that is
   * complete in English is complete everywhere.
   */
  const table = <T>(key: string) => t.raw(`moderation.${key}`) as Readonly<T>;

  return {
    reason: table<Record<ReportReason, string>>('reason'),
    target: table<Record<ReportTargetType, string>>('target'),
    targetOnThis: table<Record<ReportTargetType, string>>('targetOnThis'),
    targetName: String(t.raw('moderation.targetName')),
    campaignName: String(t.raw('moderation.campaignName')),
    state: table<Record<ReportState, string>>('state'),
    reportOutcome: table<Record<ReportOutcome, string>>('reportOutcome'),
    campaignOutcome: table<Record<CampaignOutcome, string>>('campaignOutcome'),
    openReports: t.raw('moderation.openReports') as PluralForms,
    reportCount: t.raw('moderation.reportCount') as PluralForms,
    decisionHeading: t('moderation.decisionHeading'),
    noNote: t('moderation.noNote'),
    cancel,
    decidedBy: table<Record<ReportState, string>>('decidedBy'),
    decision: {
      errorTitle: t('moderation.decision.errorTitle'),
      noteRequired: t('moderation.decision.noteRequired'),
      tooLong: String(t.raw('moderation.decision.tooLong')),
      campaignBody: t('moderation.decision.campaignBody'),
      verb: {
        uphold: verb(t, 'uphold'),
        dismiss: verb(t, 'dismiss'),
        approve: verb(t, 'approve'),
        'request-changes': verb(t, 'request-changes'),
        reject: verb(t, 'reject'),
      },
    },
  };
}

export function moderationQueueCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): ModerationQueueCopy {
  const at = (key: string) => `screens.moderationQueue.${key}`;
  const table = <T>(key: string) => t.raw(at(key)) as Readonly<T>;

  return {
    ...chrome,
    moderation: moderationCopyFrom(t, chrome.cancel),
    subject: t(at('subject')),
    signedOutTitle: t(at('signedOutTitle')),
    signedOutBody: t(at('signedOutBody')),
    forbiddenTitle: t(at('forbiddenTitle')),
    forbiddenBody: t(at('forbiddenBody')),
    notStaff: t(at('notStaff')),
    transitionNotAllowed: t(at('transitionNotAllowed')),
    transitionNotAllowedFrom: String(t.raw(at('transitionNotAllowedFrom'))),
    alreadyResolved: t(at('alreadyResolved')),
    heading: table<Record<ReportState, string>>('heading'),
    statusLabel: t(at('statusLabel')),
    targetLabel: t(at('targetLabel')),
    triageLabel: t(at('triageLabel')),
    targetFilter: table<Record<string, string>>('targetFilter'),
    overdueOnly: t(at('overdueOnly')),
    repeatedOnly: t(at('repeatedOnly')),
    showing: String(t.raw(at('showing'))),
    morePages: t(at('morePages')),
    loadingList: t(at('loadingList')),
    filteredTitle: t(at('filteredTitle')),
    filteredBody: t(at('filteredBody')),
    emptyTitle: table<Record<ReportState, string>>('emptyTitle'),
    emptyBody: table<Record<ReportState, string>>('emptyBody'),
    noticeReport: table<Record<ReportState, string>>('noticeReport'),
    noticeCampaign: String(t.raw(at('noticeCampaign'))),
    reportedAbout: String(t.raw(at('reportedAbout'))),
    fullHistory: t(at('fullHistory')),
    fullHistoryLabel: String(t.raw(at('fullHistoryLabel'))),
    overdue: t(at('overdue')),
    reported: t(at('reported')),
    signal: t(at('signal')),
    reporter: t(at('reporter')),
    targetTerm: t(at('targetTerm')),
    decideGroup: String(t.raw(at('decideGroup'))),
    decideHeading: t(at('decideHeading')),
    decideLabel: String(t.raw(at('decideLabel'))),
    actGroup: String(t.raw(at('actGroup'))),
    actHeading: t(at('actHeading')),
    actLabel: String(t.raw(at('actLabel'))),
  };
}

/**
 * AD-01's campaign review queue — the screen that says what the three outcomes apply to.
 *
 * <p>Its own contract rather than a reuse of {@link ModerationQueueCopy}: that one is
 * about complaints, and every heading, empty state and notice on this screen is about a
 * campaign waiting on us. What the two do share is {@link ModerationCopy}, because the
 * three campaign verbs and the dialog around them are the same three verbs.
 */
export interface SubmissionQueueCopy extends ConsoleChromeCopy {
  readonly moderation: ModerationCopy;
  readonly signedOutTitle: string;
  readonly signedOutBody: string;
  readonly forbiddenTitle: string;
  readonly forbiddenBody: string;
  readonly notStaff: string;
  readonly transitionNotAllowed: string;
  /** Carries `{state}`, which stays in the service's own spelling. */
  readonly transitionNotAllowedFrom: string;
  readonly refused: string;
  readonly unreachable: string;
  /** A whole heading per state, not a word put in front of "campaigns". */
  readonly heading: Readonly<Record<SubmissionState, string>>;
  /** The tag on a row, and the chips. */
  readonly state: Readonly<Record<SubmissionState, string>>;
  readonly statusLabel: string;
  readonly loadingList: string;
  readonly emptyTitle: Readonly<Record<SubmissionState, string>>;
  readonly emptyBody: Readonly<Record<SubmissionState, string>>;
  /** Carries `{days}`. The queue's one number: how long somebody has been waiting. */
  readonly waiting: string;
  readonly goalLabel: string;
  readonly noGoal: string;
  readonly stateLabel: string;
  /** What a row says instead of a name when §17.4 has anonymised the creator. */
  readonly creatorGone: string;
  readonly decideHeading: string;
  /** Carries `{title}`, for the group label a screen reader announces. */
  readonly decideGroup: string;
  /** Carries `{title}` and `{state}`. */
  readonly notice: string;
}

/**
 * AD-01's campaign directory: every campaign, in any state.
 *
 * <h2>Its own state table, and the reason there is a third one</h2>
 *
 * `profile.card.states` and `campaign.state` describe a campaign to a backer and cover
 * only the states a backer can see — there is no public word for `DRAFT`, and "Coming
 * soon" is a promise rather than a state. `screens.submissionQueue.state` covers the four
 * a moderator decides. This screen lists §6.1 entire, so it needs a word for every state,
 * written for somebody operating the platform rather than browsing it.
 */
export interface CampaignDirectoryCopy extends ConsoleChromeCopy {
  /** What this screen calls the thing it reads, for the refusals. Already inflected. */
  readonly subject: string;
  readonly heading: string;
  /** The search box, its hint and its two controls — issue #404. */
  readonly searchLabel: string;
  readonly searchHint: string;
  readonly search: string;
  readonly clearSearch: string;
  readonly filterLabel: string;
  readonly everything: string;
  readonly loadingList: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly filteredTitle: string;
  readonly filteredBody: string;
  readonly creatorGone: string;
  readonly goalLabel: string;
  readonly noGoal: string;
  readonly raisedLabel: string;
  readonly backersLabel: string;
  readonly startedLabel: string;
  readonly launchedLabel: string;
  readonly deadlineLabel: string;
  readonly notLaunched: string;
  /**
   * Keyed by §6.1's states, all of them.
   *
   * A total record rather than an open one: the catalogue carries a word for every state
   * the enum has, and `catalogue.test.ts` holds the four languages to the same set. A
   * screen still falls back to the wire spelling, for a state added to the enum before the
   * catalogue caught up.
   */
  readonly state: Readonly<Record<ProjectState, string>>;
}

/**
 * The staff preview of one campaign — issue #399.
 *
 * <p>The state table is borrowed from `admin.screens.campaignDirectory`, for the reason
 * {@link ReportDetailCopy} gives about the audit action table: sixteen state names under a
 * second key is a second set of translations for `CHANGES_REQUESTED` that nothing keeps in
 * step with the first.
 */
export interface CampaignPreviewCopy extends ConsoleChromeCopy {
  /** What this screen calls the thing it reads, for the refusals. Already inflected. */
  readonly subject: string;
  readonly loadingPreview: string;
  readonly notFoundTitle: string;
  readonly notFoundBody: string;
  readonly backToDirectory: string;
  /** The notice at the top. Never dismissible — this screen renders drafts. */
  readonly previewNoticeTitle: string;
  readonly previewNoticeBody: string;
  readonly goalLabel: string;
  readonly noGoal: string;
  readonly raisedLabel: string;
  readonly backersLabel: string;
  readonly filedUnder: string;
  readonly notFiled: string;
  readonly launchedLabel: string;
  readonly deadlineLabel: string;
  readonly publicPage: string;
  /** What is said instead of a link, on a campaign that has no public page yet. */
  readonly notPublicYet: string;
  readonly storyHeading: string;
  readonly noStory: string;
  readonly risksHeading: string;
  readonly noRisks: string;
  /** Carries `{title}`. */
  readonly coverAlt: string;
  readonly state: Readonly<Record<ProjectState, string>>;
  /** `CampaignStory`'s own phrases, from `campaign.story` — the preview draws the public story (#155). */
  readonly story: CampaignStoryCopy;
}

export function campaignPreviewCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
  story: CampaignStoryCopy,
): CampaignPreviewCopy {
  const at = (key: string) => `screens.campaignPreview.${key}`;

  return {
    ...chrome,
    subject: t(at('subject')),
    loadingPreview: t(at('loadingPreview')),
    notFoundTitle: t(at('notFoundTitle')),
    notFoundBody: t(at('notFoundBody')),
    backToDirectory: t(at('backToDirectory')),
    previewNoticeTitle: t(at('previewNoticeTitle')),
    previewNoticeBody: t(at('previewNoticeBody')),
    goalLabel: t(at('goalLabel')),
    noGoal: t(at('noGoal')),
    raisedLabel: t(at('raisedLabel')),
    backersLabel: t(at('backersLabel')),
    filedUnder: t(at('filedUnder')),
    notFiled: t(at('notFiled')),
    launchedLabel: t(at('launchedLabel')),
    deadlineLabel: t(at('deadlineLabel')),
    publicPage: t(at('publicPage')),
    notPublicYet: t(at('notPublicYet')),
    storyHeading: t(at('storyHeading')),
    noStory: t(at('noStory')),
    risksHeading: t(at('risksHeading')),
    noRisks: t(at('noRisks')),
    /* `raw`, because next-intl renders a template's own key when it is read with `t()` and
       has no value for the argument — `src/test-copy.ts` refuses the same mistake in tests. */
    coverAlt: String(t.raw(at('coverAlt'))),
    state: t.raw('screens.campaignDirectory.state') as Readonly<Record<ProjectState, string>>,
    story,
  };
}

export function campaignDirectoryCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): CampaignDirectoryCopy {
  const at = (key: string) => `screens.campaignDirectory.${key}`;

  return {
    ...chrome,
    subject: t(at('subject')),
    heading: t(at('heading')),
    searchLabel: t(at('searchLabel')),
    searchHint: t(at('searchHint')),
    search: t(at('search')),
    clearSearch: t(at('clearSearch')),
    filterLabel: t(at('filterLabel')),
    everything: t(at('everything')),
    loadingList: t(at('loadingList')),
    emptyTitle: t(at('emptyTitle')),
    emptyBody: t(at('emptyBody')),
    filteredTitle: t(at('filteredTitle')),
    filteredBody: t(at('filteredBody')),
    creatorGone: t(at('creatorGone')),
    goalLabel: t(at('goalLabel')),
    noGoal: t(at('noGoal')),
    raisedLabel: t(at('raisedLabel')),
    backersLabel: t(at('backersLabel')),
    startedLabel: t(at('startedLabel')),
    launchedLabel: t(at('launchedLabel')),
    deadlineLabel: t(at('deadlineLabel')),
    notLaunched: t(at('notLaunched')),
    state: t.raw(at('state')) as Readonly<Record<ProjectState, string>>,
  };
}

export function submissionQueueCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): SubmissionQueueCopy {
  const at = (key: string) => `screens.submissionQueue.${key}`;
  const table = <T,>(key: string) => t.raw(at(key)) as Readonly<T>;

  return {
    ...chrome,
    moderation: moderationCopyFrom(t, chrome.cancel),
    signedOutTitle: t(at('signedOutTitle')),
    signedOutBody: t(at('signedOutBody')),
    forbiddenTitle: t(at('forbiddenTitle')),
    forbiddenBody: t(at('forbiddenBody')),
    notStaff: t(at('notStaff')),
    transitionNotAllowed: t(at('transitionNotAllowed')),
    transitionNotAllowedFrom: String(t.raw(at('transitionNotAllowedFrom'))),
    refused: t(at('refused')),
    unreachable: t(at('unreachable')),
    heading: table<Record<SubmissionState, string>>('heading'),
    state: table<Record<SubmissionState, string>>('state'),
    statusLabel: t(at('statusLabel')),
    loadingList: t(at('loadingList')),
    emptyTitle: table<Record<SubmissionState, string>>('emptyTitle'),
    emptyBody: table<Record<SubmissionState, string>>('emptyBody'),
    waiting: String(t.raw(at('waiting'))),
    goalLabel: t(at('goalLabel')),
    noGoal: t(at('noGoal')),
    stateLabel: t(at('stateLabel')),
    creatorGone: t(at('creatorGone')),
    decideHeading: t(at('decideHeading')),
    decideGroup: String(t.raw(at('decideGroup'))),
    notice: String(t.raw(at('notice'))),
  };
}

export function contentReportQueueCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): ContentReportQueueCopy {
  return {
    ...chrome,
    queue: moderationQueueCopyFrom(t, chrome),
    surface: t.raw('screens.contentReports.surface') as Readonly<Record<ReportTargetType, string>>,
    noticeTitle: t('screens.contentReports.noticeTitle'),
    noticeBody: t('screens.contentReports.noticeBody'),
  };
}

export function reportDetailCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): ReportDetailCopy {
  const at = (key: string) => `screens.reportDetail.${key}`;

  return {
    ...chrome,
    moderation: moderationCopyFrom(t, chrome.cancel),
    auditAction: t.raw('screens.audit.action') as AuditActionLabels,
    subject: t(at('subject')),
    historySubject: t(at('historySubject')),
    loadingList: t(at('loadingList')),
    notFoundTitle: t(at('notFoundTitle')),
    notFoundBody: t(at('notFoundBody')),
    backToQueue: t(at('backToQueue')),
    reportedAbout: String(t.raw(at('reportedAbout'))),
    reported: t(at('reported')),
    signal: t(at('signal')),
    reporter: t(at('reporter')),
    decideGroup: t(at('decideGroup')),
    decideHeading: t(at('decideHeading')),
    decideFootnote: t(at('decideFootnote')),
    historyHeading: t(at('historyHeading')),
    historyIntro: t(at('historyIntro')),
    historyFailedTitle: t(at('historyFailedTitle')),
    loadingHistory: t(at('loadingHistory')),
    historyEmpty: t(at('historyEmpty')),
    actionBy: String(t.raw(at('actionBy'))),
    refused: t(at('refused')),
    evidence: {
      subject: t(at('evidence.subject')),
      heading: t(at('evidence.heading')),
      intro: t(at('evidence.intro')),
      loading: t(at('evidence.loading')),
      failedTitle: t(at('evidence.failedTitle')),
      removedTitle: t(at('evidence.removedTitle')),
      removedBody: t(at('evidence.removedBody')),
      goneTitle: t(at('evidence.goneTitle')),
      goneBody: t(at('evidence.goneBody')),
      addressedBody: t(at('evidence.addressedBody')),
      authorLabel: t(at('evidence.authorLabel')),
      campaignLabel: t(at('evidence.campaignLabel')),
      writtenLabel: t(at('evidence.writtenLabel')),
      /* `raw`, because next-intl renders a template's own key when it is read with `t()`
         and has no value for the argument — `src/test-copy.ts` refuses it in tests too. */
      updateNumber: String(t.raw(at('evidence.updateNumber'))),
      openCampaign: t(at('evidence.openCampaign')),
      noText: t(at('evidence.noText')),
    },
  };
}
