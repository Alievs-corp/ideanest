import type { PluralForms } from './plurals';

/**
 * Every word the creator dashboard draws — issue #79, under epic #78.
 *
 * <h2>Why all of it is a prop</h2>
 *
 * The five panels under `/projects/[id]/dashboard` are client components and have to be. Each
 * reads one creator's own money behind a bearer token, `lib/api/server.ts` is deliberately
 * anonymous, and the service answers every one of these reads `no-store` — so there is nothing
 * to render on the server and the fetch happens after hydration. `useTranslations` needs a
 * `NextIntlClientProvider`, which `lib/i18n/shell-copy.ts` measured at +24.7 KiB on every route
 * in a group, so the route resolves the words once and hands down a plain object. That is the
 * arrangement `checkout-copy.ts` and `prelaunch-copy.ts` already carry, and this file is the
 * same shape for a bigger surface.
 *
 * <h2>One namespace, six accessors</h2>
 *
 * `dashboard` in the catalogue, read once per route by the builder that route needs. The
 * charts page does not ship the survey builder's vocabulary and the survey page does not ship
 * the ledger's; what they do share — the five pledge states, the two refusals that mean the
 * same thing on every panel — is one group read by both rather than two spellings that agree
 * until somebody edits one.
 *
 * <h2>Counts are plural forms, not ternaries</h2>
 *
 * "1 backer" against "2 backers" is the whole of English and none of Russian, which picks
 * between three forms by the last digit. Every counted sentence here is a {@link PluralForms}
 * resolved through `lib/i18n/plurals.ts` in the browser, beside the number, because the number
 * arrives with the fetch rather than with the render. `plurals.ts` carries the rest of that
 * argument.
 *
 * <h2>Two label maps moved here rather than staying constants</h2>
 *
 * `lib/dashboard/surveys.ts` exported `QUESTION_TYPE_LABELS` and `lib/dashboard/clock.ts`
 * spelled its countdown in English. Both are module-level constants resolved before any copy
 * prop exists, which is the shape `lib/moderation/describe.ts` is in: they take the words as
 * an argument now, and they do not read the catalogue themselves.
 */

/**
 * A message lookup over the `dashboard` namespace, narrowed to what these builders need.
 *
 * `raw` is required for every key carrying a placeholder or a plural: asking the formatter for
 * `overview.outcome` without a value for `{pledged}` is a formatting error in next-intl, and a
 * `{count}` is filled beside the number rather than here.
 */
export interface DashboardTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

/** The dashboard layout's own metadata. `noindex, nofollow` — one creator's view of their money. */
export interface DashboardMetaCopy {
  readonly title: string;
  readonly description: string;
}

export function dashboardMetaCopyFrom(t: DashboardTranslator): DashboardMetaCopy {
  return { title: t('meta.title'), description: t('meta.description') };
}

/** The way between the five panels. */
export interface DashboardNavCopy {
  /** Names the `<nav>`, so the tab stop it introduces is explicable. */
  readonly label: string;
  readonly overview: string;
  readonly charts: string;
  readonly backers: string;
  readonly finance: string;
  readonly surveys: string;
}

export function dashboardNavCopyFrom(t: DashboardTranslator): DashboardNavCopy {
  return {
    label: t('nav.label'),
    overview: t('nav.overview'),
    charts: t('nav.charts'),
    backers: t('nav.backers'),
    finance: t('nav.finance'),
    surveys: t('nav.surveys'),
  };
}

/**
 * §4.5's pledge states, in the words a creator uses.
 *
 * The wire constant is `CHARGE_FAILED`; what a creator needs to read is "Payment failed". The
 * report's filter chips and the table's own column draw from this one group, because they are
 * the same five facts and a second spelling of "Awaiting collection" beside the first is how a
 * filter stops looking like it selects what the column says.
 */
export type PledgeStatesCopy = Readonly<
  Record<'CONFIRMED' | 'CHARGE_PENDING' | 'CHARGE_FAILED' | 'COLLECTED' | 'FULFILLED', string>
>;

function pledgeStatesFrom(t: DashboardTranslator): PledgeStatesCopy {
  return {
    CONFIRMED: t('states.CONFIRMED'),
    CHARGE_PENDING: t('states.CHARGE_PENDING'),
    CHARGE_FAILED: t('states.CHARGE_FAILED'),
    COLLECTED: t('states.COLLECTED'),
    FULFILLED: t('states.FULFILLED'),
  };
}

/** The two refusals that mean the same thing on every panel. */
interface SharedFailures {
  readonly signedOut: string;
  readonly noCampaign: string;
}

function failuresFrom(t: DashboardTranslator): SharedFailures {
  return { signedOut: t('failures.signedOut'), noCampaign: t('failures.noCampaign') };
}

/**
 * The countdown's vocabulary — `lib/dashboard/clock.ts` renders it.
 *
 * The unit shown changes with how much is left, so there are four sentences rather than one
 * template: days while there are days, hours and minutes inside a day, seconds in the last
 * hour. `days` is a plural because the count is the subject of it; the rest carry two numbers
 * each and neither is the one a language would decline for.
 */
export interface CampaignClockCopy {
  readonly none: string;
  readonly urgent: string;
  readonly closed: string;
  /** Carries `{count}`. */
  readonly days: PluralForms;
  /** Carries `{hours}` and `{minutes}`. */
  readonly hours: string;
  /** Carries `{minutes}` and `{seconds}`. */
  readonly minutes: string;
  /** Carries `{seconds}`. */
  readonly seconds: string;
}

function clockCopyFrom(t: DashboardTranslator): CampaignClockCopy {
  return {
    none: t('clock.none'),
    urgent: t('clock.urgent'),
    closed: t('clock.closed'),
    days: t.raw('clock.days') as PluralForms,
    hours: String(t.raw('clock.hours')),
    minutes: String(t.raw('clock.minutes')),
    seconds: String(t.raw('clock.seconds')),
  };
}

/** §4.7's CD-01 — raised, backers, completion, and the clock beneath them. */
export interface DashboardOverviewCopy {
  readonly loading: string;
  readonly notGranted: string;
  readonly unavailable: string;
  readonly failures: SharedFailures;
  readonly raised: string;
  readonly backers: string;
  readonly goal: string;
  readonly goalUnset: string;
  readonly noGoal: string;
  /** Carries `{percent}`. The progress bar's accessible name. */
  readonly progressLabel: string;
  /** Carries `{percent}`. */
  readonly percentFunded: string;
  readonly goalReached: string;
  readonly outcomeHeading: string;
  /** Carries `{pledged}`, `{backers}` and `{goal}`. */
  readonly outcome: string;
  /** Carries `{count}`. Fills `{backers}` above, so the count declines with the sentence. */
  readonly outcomeBackers: PluralForms;
  readonly clock: CampaignClockCopy;
}

export function dashboardOverviewCopyFrom(t: DashboardTranslator): DashboardOverviewCopy {
  return {
    loading: t('overview.loading'),
    notGranted: t('overview.notGranted'),
    unavailable: t('overview.unavailable'),
    failures: failuresFrom(t),
    raised: t('overview.raised'),
    backers: t('overview.backers'),
    goal: t('overview.goal'),
    goalUnset: t('overview.goalUnset'),
    noGoal: t('overview.noGoal'),
    progressLabel: String(t.raw('overview.progressLabel')),
    percentFunded: String(t.raw('overview.percentFunded')),
    goalReached: t('overview.goalReached'),
    outcomeHeading: t('overview.outcomeHeading'),
    outcome: String(t.raw('overview.outcome')),
    outcomeBackers: t.raw('overview.outcomeBackers') as PluralForms,
    clock: clockCopyFrom(t),
  };
}

/** The figure under the trend chart, and the table folded behind it. */
export interface TrendChartCopy {
  /** Carries `{amount}` and `{day}`. */
  readonly peak: string;
  readonly showDaily: string;
  readonly dailyLabel: string;
  readonly day: string;
  readonly backers: string;
  readonly pledged: string;
  readonly runningTotal: string;
}

function trendCopyFrom(t: DashboardTranslator): TrendChartCopy {
  return {
    peak: String(t.raw('trend.peak')),
    showDaily: t('trend.showDaily'),
    dailyLabel: t('trend.dailyLabel'),
    day: t('trend.day'),
    backers: t('trend.backers'),
    pledged: t('trend.pledged'),
    runningTotal: t('trend.runningTotal'),
  };
}

/**
 * §4.7's CD-02, CD-07 and CD-08 — the trend, the reward mix, and where the backers are.
 *
 * The two reads fail separately and are worded separately. A `{subject}` interpolated into one
 * refusal would have been fewer keys and the wrong shape: "does not include the funding trend"
 * declines its object in three of the four languages, and a translator handed a hole cannot
 * put a case ending on what goes in it.
 */
export interface FundingChartsCopy {
  readonly heading: string;
  readonly intro: string;
  readonly failures: SharedFailures;
  readonly trendHeading: string;
  readonly trendLoading: string;
  readonly trendNotGranted: string;
  readonly trendUnavailable: string;
  /** Carries `{from}` and `{to}`. */
  readonly trendEmpty: string;
  /** Carries `{from}`, `{to}` and `{zone}`. Names the figure. */
  readonly trendLabel: string;
  /** Carries `{when}`, which is a relative time formatted in the browser. */
  readonly aggregated: string;
  readonly splitHeading: string;
  readonly splitLoading: string;
  readonly splitNotGranted: string;
  readonly splitUnavailable: string;
  readonly splitEmpty: string;
  readonly backers: string;
  readonly pledged: string;
  readonly nothingYet: string;
  readonly rewardHeading: string;
  readonly rewardEmpty: string;
  readonly rewardLabel: string;
  readonly rewardNote: string;
  readonly destinationHeading: string;
  readonly destinationLabel: string;
  readonly destinationNote: string;
  /** A tier the campaign has since removed keeps its pledges and loses its name. */
  readonly removedTier: string;
  /** What `destinationNote` quotes. The two must stay the same words. */
  readonly noDestination: string;
  /** Carries `{count}`. One row of `ShareBars`. */
  readonly shareBackers: PluralForms;
  readonly trend: TrendChartCopy;
}

export function fundingChartsCopyFrom(t: DashboardTranslator): FundingChartsCopy {
  return {
    heading: t('charts.heading'),
    intro: t('charts.intro'),
    failures: failuresFrom(t),
    trendHeading: t('charts.trendHeading'),
    trendLoading: t('charts.trendLoading'),
    trendNotGranted: t('charts.trendNotGranted'),
    trendUnavailable: t('charts.trendUnavailable'),
    trendEmpty: String(t.raw('charts.trendEmpty')),
    trendLabel: String(t.raw('charts.trendLabel')),
    aggregated: String(t.raw('charts.aggregated')),
    splitHeading: t('charts.splitHeading'),
    splitLoading: t('charts.splitLoading'),
    splitNotGranted: t('charts.splitNotGranted'),
    splitUnavailable: t('charts.splitUnavailable'),
    splitEmpty: t('charts.splitEmpty'),
    backers: t('charts.backers'),
    pledged: t('charts.pledged'),
    nothingYet: t('charts.nothingYet'),
    rewardHeading: t('charts.rewardHeading'),
    rewardEmpty: t('charts.rewardEmpty'),
    rewardLabel: t('charts.rewardLabel'),
    rewardNote: t('charts.rewardNote'),
    destinationHeading: t('charts.destinationHeading'),
    destinationLabel: t('charts.destinationLabel'),
    destinationNote: t('charts.destinationNote'),
    removedTier: t('charts.removedTier'),
    noDestination: t('charts.noDestination'),
    shareBackers: t.raw('charts.shareBackers') as PluralForms,
    trend: trendCopyFrom(t),
  };
}

/** §4.7's CD-10 as a table: who backed the campaign, and what each of them took. */
export interface BackerTableCopy {
  readonly backer: string;
  readonly reward: string;
  readonly pledged: string;
  readonly state: string;
  readonly destination: string;
  readonly backed: string;
  readonly anonymous: string;
  readonly noReward: string;
  readonly removedTier: string;
  readonly states: PledgeStatesCopy;
}

function backerTableCopyFrom(t: DashboardTranslator): BackerTableCopy {
  return {
    backer: t('table.backer'),
    reward: t('table.reward'),
    pledged: t('table.pledged'),
    state: t('table.state'),
    destination: t('table.destination'),
    backed: t('table.backed'),
    anonymous: t('table.anonymous'),
    noReward: t('table.noReward'),
    removedTier: t('table.removedTier'),
    states: pledgeStatesFrom(t),
  };
}

/** §4.7's CD-10 and CD-11: the backer report, its saved segments, and its export. */
export interface BackerReportCopy {
  readonly heading: string;
  readonly intro: string;
  readonly loading: string;
  readonly notGranted: string;
  readonly tooManyExports: string;
  readonly unavailable: string;
  readonly failures: SharedFailures;
  readonly searchLabel: string;
  readonly searchHint: string;
  readonly search: string;
  readonly export: string;
  readonly stateLegend: string;
  readonly segmentsLegend: string;
  /** Carries `{name}`. The accessible name of an icon-only control. */
  readonly deleteSegment: string;
  readonly saveLabel: string;
  readonly saveHint: string;
  readonly savePlaceholder: string;
  readonly saveSegment: string;
  /** Carries `{name}`. */
  readonly saved: string;
  readonly saveConflict: string;
  readonly saveFailed: string;
  /** Carries `{name}`. */
  readonly deleted: string;
  readonly deleteFailed: string;
  /** Carries `{count}`. */
  readonly exported: PluralForms;
  /** Carries `{count}`. Only ever drawn for a file the service cut short. */
  readonly exportedTruncated: string;
  /** Carries `{count}`, which is drawn as its own node so the figure keeps `tabular-nums`. */
  readonly matched: PluralForms;
  readonly emptyFiltered: string;
  readonly emptyNone: string;
  readonly tableLabel: string;
  /** Carries `{count}`. */
  readonly more: string;
  readonly states: PledgeStatesCopy;
  readonly table: BackerTableCopy;
}

export function backerReportCopyFrom(t: DashboardTranslator): BackerReportCopy {
  return {
    heading: t('backers.heading'),
    intro: t('backers.intro'),
    loading: t('backers.loading'),
    notGranted: t('backers.notGranted'),
    tooManyExports: t('backers.tooManyExports'),
    unavailable: t('backers.unavailable'),
    failures: failuresFrom(t),
    searchLabel: t('backers.searchLabel'),
    searchHint: t('backers.searchHint'),
    search: t('backers.search'),
    export: t('backers.export'),
    stateLegend: t('backers.stateLegend'),
    segmentsLegend: t('backers.segmentsLegend'),
    deleteSegment: String(t.raw('backers.deleteSegment')),
    saveLabel: t('backers.saveLabel'),
    saveHint: t('backers.saveHint'),
    savePlaceholder: t('backers.savePlaceholder'),
    saveSegment: t('backers.saveSegment'),
    saved: String(t.raw('backers.saved')),
    saveConflict: t('backers.saveConflict'),
    saveFailed: t('backers.saveFailed'),
    deleted: String(t.raw('backers.deleted')),
    deleteFailed: t('backers.deleteFailed'),
    exported: t.raw('backers.exported') as PluralForms,
    exportedTruncated: String(t.raw('backers.exportedTruncated')),
    matched: t.raw('backers.matched') as PluralForms,
    emptyFiltered: t('backers.emptyFiltered'),
    emptyNone: t('backers.emptyNone'),
    tableLabel: t('backers.tableLabel'),
    more: String(t.raw('backers.more')),
    states: pledgeStatesFrom(t),
    table: backerTableCopyFrom(t),
  };
}

/** §9.5's payout states. A state this list has not met renders as its own name. */
export type PayoutStatesCopy = Readonly<Record<string, string>>;

/** §4.7's CD-16: gross, fees, tax, refunds and net — issue #99. */
export interface FinanceCopy {
  readonly heading: string;
  readonly loading: string;
  readonly notGranted: string;
  readonly unavailable: string;
  readonly failures: SharedFailures;
  readonly projected: string;
  readonly settled: string;
  readonly projectedIntro: string;
  readonly settledIntro: string;
  readonly gross: string;
  readonly net: string;
  readonly netProjected: string;
  readonly paidOut: string;
  readonly deductionsHeading: string;
  readonly deductionsCaption: string;
  readonly grossCollected: string;
  readonly platformFee: string;
  readonly processingFee: string;
  readonly taxWithheld: string;
  readonly taxNote: string;
  readonly refunded: string;
  readonly payable: string;
  readonly payableProjected: string;
  readonly payoutsHeading: string;
  readonly payoutsEmpty: string;
  readonly booksHeading: string;
  readonly booksIntro: string;
  readonly unbalancedTitle: string;
  readonly unbalancedBody: string;
  readonly ledgerEmpty: string;
  readonly ledgerCaption: string;
  readonly account: string;
  readonly balance: string;
  /** Carries `{time}`, which is a `<time>` element rather than a string. */
  readonly asOf: string;
  readonly payoutStates: PayoutStatesCopy;
}

export function financeCopyFrom(t: DashboardTranslator): FinanceCopy {
  return {
    heading: t('finance.heading'),
    loading: t('finance.loading'),
    notGranted: t('finance.notGranted'),
    unavailable: t('finance.unavailable'),
    failures: failuresFrom(t),
    projected: t('finance.projected'),
    settled: t('finance.settled'),
    projectedIntro: t('finance.projectedIntro'),
    settledIntro: t('finance.settledIntro'),
    gross: t('finance.gross'),
    net: t('finance.net'),
    netProjected: t('finance.netProjected'),
    paidOut: t('finance.paidOut'),
    deductionsHeading: t('finance.deductionsHeading'),
    deductionsCaption: t('finance.deductionsCaption'),
    grossCollected: t('finance.grossCollected'),
    platformFee: t('finance.platformFee'),
    processingFee: t('finance.processingFee'),
    taxWithheld: t('finance.taxWithheld'),
    taxNote: t('finance.taxNote'),
    refunded: t('finance.refunded'),
    payable: t('finance.payable'),
    payableProjected: t('finance.payableProjected'),
    payoutsHeading: t('finance.payoutsHeading'),
    payoutsEmpty: t('finance.payoutsEmpty'),
    booksHeading: t('finance.booksHeading'),
    booksIntro: t('finance.booksIntro'),
    unbalancedTitle: t('finance.unbalancedTitle'),
    unbalancedBody: t('finance.unbalancedBody'),
    ledgerEmpty: t('finance.ledgerEmpty'),
    ledgerCaption: t('finance.ledgerCaption'),
    account: t('finance.account'),
    balance: t('finance.balance'),
    asOf: String(t.raw('finance.asOf')),
    payoutStates: {
      CALCULATED: t('finance.payoutStates.CALCULATED'),
      PENDING_APPROVAL: t('finance.payoutStates.PENDING_APPROVAL'),
      APPROVED: t('finance.payoutStates.APPROVED'),
      PAID: t('finance.payoutStates.PAID'),
      FAILED: t('finance.payoutStates.FAILED'),
      CANCELLED: t('finance.payoutStates.CANCELLED'),
    },
  };
}

/** §4.8's PM-03, in the order the builder offers them. */
export type QuestionTypesCopy = Readonly<
  Record<'TEXT' | 'CHOICE' | 'MULTI_CHOICE' | 'DATE' | 'ADDRESS', string>
>;

/** §4.8's PM-01 to PM-04: the survey builder. */
export interface SurveyBuilderCopy {
  readonly heading: string;
  readonly intro: string;
  readonly loading: string;
  readonly notGranted: string;
  readonly alreadySent: string;
  readonly needsQuestion: string;
  readonly invalid: string;
  readonly unavailable: string;
  readonly failures: SharedFailures;
  /** Carries `{count}` and `{answered}`. */
  readonly sentSummary: string;
  readonly draft: string;
  /** Carries `{title}`. The accessible name of an icon-only control. */
  readonly deleteDraft: string;
  readonly sentHeading: string;
  readonly editHeading: string;
  readonly newHeading: string;
  readonly titleLabel: string;
  readonly titleHint: string;
  readonly noteLabel: string;
  readonly noteHint: string;
  readonly questionsLegend: string;
  /** The whole legend, not a suffix: a sentence is not built by concatenation here. */
  readonly questionsLegendLocked: string;
  /** Carries `{number}`. */
  readonly question: string;
  readonly typeLabel: string;
  readonly types: QuestionTypesCopy;
  readonly optionsLabel: string;
  readonly optionsHint: string;
  readonly addressNote: string;
  readonly required: string;
  readonly tierLabel: string;
  /** Quotes `everybody`. The two must stay the same word. */
  readonly tierHint: string;
  readonly everybody: string;
  readonly removeQuestion: string;
  readonly addQuestion: string;
  readonly save: string;
  readonly createDraft: string;
  readonly send: string;
  readonly confirmSend: string;
  readonly startNew: string;
  readonly savedNotice: string;
  readonly createdNotice: string;
  /** Carries `{title}`. */
  readonly deletedNotice: string;
  /** Carries `{count}`. */
  readonly sentNotice: PluralForms;
}

export function surveyBuilderCopyFrom(t: DashboardTranslator): SurveyBuilderCopy {
  return {
    heading: t('surveys.heading'),
    intro: t('surveys.intro'),
    loading: t('surveys.loading'),
    notGranted: t('surveys.notGranted'),
    alreadySent: t('surveys.alreadySent'),
    needsQuestion: t('surveys.needsQuestion'),
    invalid: t('surveys.invalid'),
    unavailable: t('surveys.unavailable'),
    failures: failuresFrom(t),
    sentSummary: String(t.raw('surveys.sentSummary')),
    draft: t('surveys.draft'),
    deleteDraft: String(t.raw('surveys.deleteDraft')),
    sentHeading: t('surveys.sentHeading'),
    editHeading: t('surveys.editHeading'),
    newHeading: t('surveys.newHeading'),
    titleLabel: t('surveys.titleLabel'),
    titleHint: t('surveys.titleHint'),
    noteLabel: t('surveys.noteLabel'),
    noteHint: t('surveys.noteHint'),
    questionsLegend: t('surveys.questionsLegend'),
    questionsLegendLocked: t('surveys.questionsLegendLocked'),
    question: String(t.raw('surveys.question')),
    typeLabel: t('surveys.typeLabel'),
    types: {
      TEXT: t('surveys.types.TEXT'),
      CHOICE: t('surveys.types.CHOICE'),
      MULTI_CHOICE: t('surveys.types.MULTI_CHOICE'),
      DATE: t('surveys.types.DATE'),
      ADDRESS: t('surveys.types.ADDRESS'),
    },
    optionsLabel: t('surveys.optionsLabel'),
    optionsHint: t('surveys.optionsHint'),
    addressNote: t('surveys.addressNote'),
    required: t('surveys.required'),
    tierLabel: t('surveys.tierLabel'),
    tierHint: t('surveys.tierHint'),
    everybody: t('surveys.everybody'),
    removeQuestion: t('surveys.removeQuestion'),
    addQuestion: t('surveys.addQuestion'),
    save: t('surveys.save'),
    createDraft: t('surveys.createDraft'),
    send: t('surveys.send'),
    confirmSend: t('surveys.confirmSend'),
    startNew: t('surveys.startNew'),
    savedNotice: t('surveys.savedNotice'),
    createdNotice: t('surveys.createdNotice'),
    deletedNotice: String(t.raw('surveys.deletedNotice')),
    sentNotice: t.raw('surveys.sentNotice') as PluralForms,
  };
}
