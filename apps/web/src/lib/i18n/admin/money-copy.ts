import type { DisputeState, EvidenceKind } from '../../admin/disputes';
import type { FeeScope } from '../../admin/fees';
import type { TransactionStatus, TransactionType } from '../../admin/payments';
import type { DestinationStanding, PayoutState, VerificationStanding } from '../../admin/payouts';
import type { RefundReason, RefundState } from '../../admin/refunds';
import type { PaymentMethod } from '../../admin/revenue';
import type { FindingCode, FindingKind } from '../../admin/reconciliation';
import type { AdminTranslator } from '../admin-copy';
import type { PluralForms } from '../plurals';
import type { ConsoleChromeCopy } from './common-copy';

/**
 * The words the console's money screens draw — issue #324, epic #259.
 *
 * The rail's fourth group: the payment log, the ledger, the reconciliation, the payouts, the
 * refunds, the chargebacks and the fees.
 *
 * <h2>What is not translated here, and why that is the safe direction</h2>
 *
 * A figure is never assembled from words. `lib/money.ts` formats against the currency on the
 * row — the campaign's, never the reader's — and nothing on any of these screens adds two
 * amounts together or reads one back out of a sentence. What the catalogue carries is the
 * label beside a number and never the number, which is what keeps §10.3's rule about money
 * crossing the API as a string true all the way to the screen.
 *
 * <p>Three vocabularies stay in the service's own spelling on purpose: a provider name
 * (`PAYRIFF`), a card network's reason code, and the currency. Each is a value somebody quotes
 * into a support conversation or a dispute, and a translated copy of one would be a word the
 * provider does not recognise.
 */

/** What every money screen says about the ledger's accounts. */
export interface MoneyCopy {
  /** Keyed by the stored account name. A creator's is not in here — see {@link creatorAccount}. */
  readonly account: Readonly<Record<string, string>>;
  /** Carries `{id}`. A creator's account is `creator:{uuid}` and has no name the ledger knows. */
  readonly creatorAccount: string;
  /**
   * The same account once the console directory has named the creator — issue #402.
   *
   * Carries `{name}`. A separate template rather than the same one with a different value,
   * because "Creator 07afbabf" and "Kamran Əliyev's account" are different sentences in
   * every language and the second one does not want the word "Creator" in front of it.
   */
  readonly creatorNamed: string;
}

export function moneyCopyFrom(t: AdminTranslator): MoneyCopy {
  return {
    account: t.raw('money.account') as Readonly<Record<string, string>>,
    creatorAccount: String(t.raw('money.creatorAccount')),
    creatorNamed: String(t.raw('money.creatorNamed')),
  };
}

/**
 * AD-05's payment log.
 *
 * <p>`campaignPart`, `pledgePart` and `attemptPart` are three keys rather than one sentence,
 * because the row joins whichever of them apply with a separator and the middle one is absent
 * on a payout. One template with two optional holes would leave a stray separator in it.
 */
export interface PaymentLogCopy extends ConsoleChromeCopy {
  readonly money: MoneyCopy;
  readonly subject: string;
  readonly heading: string;
  readonly identifierLabel: string;
  readonly identifierHint: string;
  readonly scopeLegend: string;
  readonly scopeProject: string;
  readonly scopePledge: string;
  readonly search: string;
  readonly clear: string;
  /** The chip row's accessible name — issue #404's outcome filter. */
  readonly outcomeLabel: string;
  readonly everyOutcome: string;
  readonly loadingList: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly filteredTitle: string;
  readonly filteredBody: string;
  /** Carries `{id}`. */
  readonly campaignPart: string;
  /** Carries `{id}`. */
  readonly pledgePart: string;
  /** Carries `{number}`. */
  readonly attemptPart: string;
  readonly noReference: string;
  readonly type: Readonly<Record<TransactionType, string>>;
  readonly status: Readonly<Record<TransactionStatus, string>>;
}

export function paymentLogCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): PaymentLogCopy {
  return {
    ...chrome,
    money: moneyCopyFrom(t),
    subject: t('screens.payments.subject'),
    heading: t('screens.payments.heading'),
    identifierLabel: t('screens.payments.identifierLabel'),
    identifierHint: t('screens.payments.identifierHint'),
    scopeLegend: t('screens.payments.scopeLegend'),
    scopeProject: t('screens.payments.scopeProject'),
    scopePledge: t('screens.payments.scopePledge'),
    search: t('screens.payments.search'),
    clear: t('screens.payments.clear'),
    outcomeLabel: t('screens.payments.outcomeLabel'),
    everyOutcome: t('screens.payments.everyOutcome'),
    loadingList: t('screens.payments.loadingList'),
    emptyTitle: t('screens.payments.emptyTitle'),
    emptyBody: t('screens.payments.emptyBody'),
    filteredTitle: t('screens.payments.filteredTitle'),
    filteredBody: t('screens.payments.filteredBody'),
    campaignPart: String(t.raw('screens.payments.campaignPart')),
    pledgePart: String(t.raw('screens.payments.pledgePart')),
    attemptPart: String(t.raw('screens.payments.attemptPart')),
    noReference: t('screens.payments.noReference'),
    type: t.raw('screens.payments.type') as Readonly<Record<TransactionType, string>>,
    status: t.raw('screens.payments.status') as Readonly<Record<TransactionStatus, string>>,
  };
}

/**
 * AD-05's ledger.
 *
 * <p>`debit` and `credit` are lower case because they sit under an amount as a label rather
 * than beginning a sentence, and the component upper-cases them in CSS. A translation that
 * needs a capital can carry one; nothing here adds it.
 */
export interface LedgerExplorerCopy extends ConsoleChromeCopy {
  readonly money: MoneyCopy;
  readonly subject: string;
  readonly heading: string;
  readonly unbalancedTitle: string;
  /** Carries `{count}` in every form but `one`. */
  readonly unbalanced: PluralForms;
  readonly accountFilter: string;
  readonly everyAccount: string;
  readonly campaignLabel: string;
  readonly campaignHint: string;
  readonly apply: string;
  readonly clear: string;
  readonly loadingList: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly filteredTitle: string;
  readonly filteredBody: string;
  readonly balancesScoped: string;
  readonly balancesPlatform: string;
  readonly balancesNote: string;
  /** Carries `{campaign}`, `{transaction}`. */
  readonly postingLine: string;
  readonly doesNotBalance: string;
  readonly debit: string;
  readonly credit: string;
}

export function ledgerExplorerCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): LedgerExplorerCopy {
  return {
    ...chrome,
    money: moneyCopyFrom(t),
    subject: t('screens.ledger.subject'),
    heading: t('screens.ledger.heading'),
    unbalancedTitle: t('screens.ledger.unbalancedTitle'),
    unbalanced: t.raw('screens.ledger.unbalanced') as PluralForms,
    accountFilter: t('screens.ledger.accountFilter'),
    everyAccount: t('screens.ledger.everyAccount'),
    campaignLabel: t('screens.ledger.campaignLabel'),
    campaignHint: t('screens.ledger.campaignHint'),
    apply: t('screens.ledger.apply'),
    clear: t('screens.ledger.clear'),
    loadingList: t('screens.ledger.loadingList'),
    emptyTitle: t('screens.ledger.emptyTitle'),
    emptyBody: t('screens.ledger.emptyBody'),
    filteredTitle: t('screens.ledger.filteredTitle'),
    filteredBody: t('screens.ledger.filteredBody'),
    balancesScoped: t('screens.ledger.balancesScoped'),
    balancesPlatform: t('screens.ledger.balancesPlatform'),
    balancesNote: t('screens.ledger.balancesNote'),
    postingLine: String(t.raw('screens.ledger.postingLine')),
    doesNotBalance: t('screens.ledger.doesNotBalance'),
    debit: t('screens.ledger.debit'),
    credit: t('screens.ledger.credit'),
  };
}

/**
 * AD-05's nightly check.
 *
 * <p>`unbalancedNote` wraps `unbalancedEmphasis` rather than carrying a `<strong>` tag, so that
 * a translation cannot drop the markup and cannot be forced to keep the emphasis in the
 * position English puts it. `catalogue.test.ts` checks tags across languages precisely because
 * that failure is silent; not having the tag is better than checking for it.
 */
export interface ReconciliationCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly loadingList: string;
  readonly readFailed: string;
  readonly runFailedTitle: string;
  readonly runForbidden: string;
  readonly neverRunTitle: string;
  readonly neverRunBody: string;
  readonly unbalancedTitle: string;
  /** Carries `{at}`, `{findings}`, `{note}`, `{positions}`. */
  readonly unbalancedBody: string;
  readonly unbalancedEmphasis: string;
  /** Carries `{emphasis}`. */
  readonly unbalancedNote: string;
  readonly balancedTitle: string;
  /** Carries `{at}`, `{positions}`. */
  readonly balancedBody: string;
  readonly nothingHeld: string;
  /** Carries `{count}`. */
  readonly findingCount: PluralForms;
  /** Carries `{count}`. */
  readonly positionCount: PluralForms;
  readonly findingsHeading: string;
  readonly checkAgain: string;
  readonly checking: string;
  readonly runNote: string;
  readonly findingTitle: Readonly<Record<FindingKind, string>>;
  /** What each kind means for somebody who has to act on it. */
  readonly findingMeaning: Readonly<Record<FindingKind, string>>;
  /**
   * The finding itself, one sentence per code — issue #403.
   *
   * <p>Keyed on the code rather than the kind, because two of the four codes are
   * `IMPOSSIBLE_SIGN` and read in opposite directions: a creator paid too much, and platform
   * money paid out that was never taken. Carries `{account}`, `{amount}`, `{other}` and
   * `{currency}`, of which each sentence uses what it needs.
   *
   * <p>The service still sends its own English `detail`, and this replaces it on the screen.
   * That sentence is the log line, and it arrives with a raw account identifier and an
   * unformatted amount in it — it was the only text on this screen an Azerbaijani reader
   * could not read, on the four rows carrying the actual result.
   */
  readonly finding: Readonly<Record<FindingCode, string>>;
  /** For naming the ledger account a finding is about, the way the ledger screen names it. */
  readonly money: MoneyCopy;
}

export function reconciliationCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): ReconciliationCopy {
  return {
    ...chrome,
    subject: t('screens.reconciliation.subject'),
    loadingList: t('screens.reconciliation.loadingList'),
    readFailed: t('screens.reconciliation.readFailed'),
    runFailedTitle: t('screens.reconciliation.runFailedTitle'),
    runForbidden: t('screens.reconciliation.runForbidden'),
    neverRunTitle: t('screens.reconciliation.neverRunTitle'),
    neverRunBody: t('screens.reconciliation.neverRunBody'),
    unbalancedTitle: t('screens.reconciliation.unbalancedTitle'),
    unbalancedBody: String(t.raw('screens.reconciliation.unbalancedBody')),
    unbalancedEmphasis: t('screens.reconciliation.unbalancedEmphasis'),
    unbalancedNote: String(t.raw('screens.reconciliation.unbalancedNote')),
    balancedTitle: t('screens.reconciliation.balancedTitle'),
    balancedBody: String(t.raw('screens.reconciliation.balancedBody')),
    nothingHeld: t('screens.reconciliation.nothingHeld'),
    findingCount: t.raw('screens.reconciliation.findingCount') as PluralForms,
    positionCount: t.raw('screens.reconciliation.positionCount') as PluralForms,
    findingsHeading: t('screens.reconciliation.findingsHeading'),
    checkAgain: t('screens.reconciliation.checkAgain'),
    checking: t('screens.reconciliation.checking'),
    runNote: t('screens.reconciliation.runNote'),
    findingTitle: t.raw('screens.reconciliation.findingTitle') as Readonly<Record<FindingKind, string>>,
    findingMeaning: t.raw('screens.reconciliation.findingMeaning') as Readonly<Record<FindingKind, string>>,
    finding: t.raw('screens.reconciliation.finding') as Readonly<Record<FindingCode, string>>,
    money: moneyCopyFrom(t),
  };
}

/**
 * AD-05's payouts, and the signatures before money leaves.
 *
 * <p>The five figures in the breakdown are labels only. The minus signs in front of three of
 * them are the component's, because they are arithmetic notation rather than words â€” and a
 * translation that lost one would turn a deduction into an addition on the screen where that
 * matters most.
 */
export interface PayoutQueueCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly payoutSubject: string;
  /** What the reader was trying to read when `/v1/admin/me` refused — their own standing. */
  readonly meSubject: string;
  readonly calculateHeading: string;
  readonly calculateIntro: string;
  readonly campaignLabel: string;
  readonly campaignHint: string;
  readonly calculate: string;
  readonly working: string;
  readonly calculatedTitle: string;
  /** Carries `{amount}`, `{date}`, `{id}`. */
  readonly calculatedNotice: string;
  readonly failedTitle: string;
  readonly queueHeading: string;
  readonly loadingList: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  /** Carries `{id}`. */
  readonly toCreator: string;
  readonly held: string;
  readonly collected: string;
  readonly platformFee: string;
  readonly processing: string;
  readonly refunded: string;
  readonly net: string;
  readonly loadingPayout: string;
  readonly payoutFailedTitle: string;
  readonly tryAgainShort: string;
  readonly signatures: string;
  /** Carries `{have}`, `{need}`. */
  readonly signatureCount: string;
  readonly noSignatures: string;
  readonly needsTwo: string;
  /** Carries `{approver}`, `{date}`. */
  readonly approvalLine: string;
  /**
   * Marks the reader's own signature in the list — #405.
   *
   * <p>The controls below the list turn on "one of these is you", and a reader who cannot
   * see which one is being asked to take the buttons on trust.
   */
  readonly thisIsYou: string;
  readonly stillHeldTitle: string;
  /** Carries `{date}`. */
  readonly stillHeldBody: string;
  readonly noteLabel: string;
  readonly noteHint: string;
  readonly approve: string;
  /**
   * Why approving is not offered: the reader has already signed — #405.
   *
   * <p>The control used to stay enabled and offer a second signature from the same person.
   * `approve()` is idempotent, so nothing was ever written twice; what was wrong was the
   * screen, which could not be told apart from one where the click had not registered.
   */
  readonly youHaveSigned: string;
  /** Why approving is not offered yet: §9's hold has not expired. Carries `{date}`. */
  readonly awaitingHold: string;
  readonly withdrawMine: string;
  readonly send: string;
  /** Carries `{count}`. */
  readonly needsMore: string;
  readonly state: Readonly<Record<PayoutState, string>>;
  /**
   * Why a payout is held on identity rather than on the clock — #431.
   *
   * <p>Its own alert beside {@link PayoutQueueCopy.stillHeldTitle} rather than a second
   * sentence inside it, because the two holds end differently: §9's ends when a date passes
   * and nobody need do anything, and this one ends when a creator sends a document. An
   * operator reading one message for both would wait for the wrong thing.
   */
  readonly verificationHeldTitle: string;
  /** Carries `{standing}`, filled from {@link PayoutQueueCopy.standing}. */
  readonly verificationHeldBody: string;
  /** The tag on the row, so the queue says which payouts are waiting on a person. */
  readonly verificationHeld: string;
  readonly standing: Readonly<Record<VerificationStanding, string>>;
  /**
   * Why a payout is held on where the money would go rather than on who the creator is — #432.
   *
   * <p>A third alert beside {@link PayoutQueueCopy.verificationHeldTitle} and for the same
   * reason that one is separate from the hold: the three end differently. §9's ends when a
   * date passes, the identity hold ends when a creator sends a document, and this one ends
   * when a creator files a bank account or a compliance reviewer looks at the one they filed.
   *
   * <p>Until #432 this screen had a text field here instead, and an operator typed the
   * destination at the moment of sending. There is deliberately nothing on this screen that
   * decides where money goes.
   */
  readonly destinationHeldTitle: string;
  /** Carries `{standing}`, filled from {@link PayoutQueueCopy.destinationStanding}. */
  readonly destinationHeldBody: string;
  /** The tag on the row, so the queue says which payouts are waiting on an account. */
  readonly destinationHeld: string;
  readonly destinationStanding: Readonly<Record<DestinationStanding, string>>;
}

export function payoutQueueCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): PayoutQueueCopy {
  return {
    ...chrome,
    subject: t('screens.payouts.subject'),
    payoutSubject: t('screens.payouts.payoutSubject'),
    meSubject: t('screens.payouts.meSubject'),
    calculateHeading: t('screens.payouts.calculateHeading'),
    calculateIntro: t('screens.payouts.calculateIntro'),
    campaignLabel: t('screens.payouts.campaignLabel'),
    campaignHint: t('screens.payouts.campaignHint'),
    calculate: t('screens.payouts.calculate'),
    working: t('screens.payouts.working'),
    calculatedTitle: t('screens.payouts.calculatedTitle'),
    calculatedNotice: String(t.raw('screens.payouts.calculatedNotice')),
    failedTitle: t('screens.payouts.failedTitle'),
    queueHeading: t('screens.payouts.queueHeading'),
    loadingList: t('screens.payouts.loadingList'),
    emptyTitle: t('screens.payouts.emptyTitle'),
    emptyBody: t('screens.payouts.emptyBody'),
    toCreator: String(t.raw('screens.payouts.toCreator')),
    held: t('screens.payouts.held'),
    collected: t('screens.payouts.collected'),
    platformFee: t('screens.payouts.platformFee'),
    processing: t('screens.payouts.processing'),
    refunded: t('screens.payouts.refunded'),
    net: t('screens.payouts.net'),
    loadingPayout: t('screens.payouts.loadingPayout'),
    payoutFailedTitle: t('screens.payouts.payoutFailedTitle'),
    tryAgainShort: t('screens.payouts.tryAgainShort'),
    signatures: t('screens.payouts.signatures'),
    signatureCount: String(t.raw('screens.payouts.signatureCount')),
    noSignatures: t('screens.payouts.noSignatures'),
    needsTwo: t('screens.payouts.needsTwo'),
    approvalLine: String(t.raw('screens.payouts.approvalLine')),
    thisIsYou: t('screens.payouts.thisIsYou'),
    stillHeldTitle: t('screens.payouts.stillHeldTitle'),
    stillHeldBody: String(t.raw('screens.payouts.stillHeldBody')),
    noteLabel: t('screens.payouts.noteLabel'),
    noteHint: t('screens.payouts.noteHint'),
    approve: t('screens.payouts.approve'),
    youHaveSigned: t('screens.payouts.youHaveSigned'),
    awaitingHold: String(t.raw('screens.payouts.awaitingHold')),
    withdrawMine: t('screens.payouts.withdrawMine'),
    send: t('screens.payouts.send'),
    needsMore: String(t.raw('screens.payouts.needsMore')),
    state: t.raw('screens.payouts.state') as Readonly<Record<PayoutState, string>>,
    verificationHeldTitle: t('screens.payouts.verificationHeldTitle'),
    verificationHeldBody: String(t.raw('screens.payouts.verificationHeldBody')),
    verificationHeld: t('screens.payouts.verificationHeld'),
    standing: t.raw('screens.payouts.standing') as Readonly<Record<VerificationStanding, string>>,
    destinationHeldTitle: t('screens.payouts.destinationHeldTitle'),
    destinationHeldBody: String(t.raw('screens.payouts.destinationHeldBody')),
    destinationHeld: t('screens.payouts.destinationHeld'),
    destinationStanding: t.raw('screens.payouts.destinationStanding') as Readonly<
      Record<DestinationStanding, string>
    >,
  };
}

/**
 * AD-06's refunds.
 *
 * <p>`filteredTitle` and `pendingTitle` carry `{state}` filled from {@link RefundConsoleCopy.state},
 * so the word in the sentence is the same word as the one on the chip above it.
 */
export interface RefundConsoleCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly issueHeading: string;
  readonly issueIntro: string;
  readonly pledgeLabel: string;
  readonly pledgeHint: string;
  readonly amountLabel: string;
  readonly amountHint: string;
  readonly reasonLabel: string;
  readonly noteLabel: string;
  readonly noteHint: string;
  readonly issue: string;
  readonly sending: string;
  readonly sentTitle: string;
  /** Carries `{state}`. */
  readonly pendingTitle: string;
  /** Carries `{amount}`, `{id}`. */
  readonly issuedBody: string;
  /** Carries `{message}`. */
  readonly providerSaid: string;
  readonly failedTitle: string;
  readonly logHeading: string;
  readonly all: string;
  readonly loadingList: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  /** Carries `{state}`. */
  readonly filteredTitle: string;
  readonly filteredBody: string;
  readonly full: string;
  readonly partial: string;
  /** Carries `{fullness}`, `{id}`. */
  readonly onPledge: string;
  /** Carries `{detail}`, `{reason}`. */
  readonly reasonAndDetail: string;
  /** Carries `{by}`, `{date}`. */
  readonly requestedBy: string;
  /** Carries `{code}`. */
  readonly refused: string;
  readonly state: Readonly<Record<RefundState, string>>;
  readonly reason: Readonly<Record<RefundReason, string>>;
}

export function refundConsoleCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): RefundConsoleCopy {
  return {
    ...chrome,
    subject: t('screens.refunds.subject'),
    issueHeading: t('screens.refunds.issueHeading'),
    issueIntro: t('screens.refunds.issueIntro'),
    pledgeLabel: t('screens.refunds.pledgeLabel'),
    pledgeHint: t('screens.refunds.pledgeHint'),
    amountLabel: t('screens.refunds.amountLabel'),
    amountHint: t('screens.refunds.amountHint'),
    reasonLabel: t('screens.refunds.reasonLabel'),
    noteLabel: t('screens.refunds.noteLabel'),
    noteHint: t('screens.refunds.noteHint'),
    issue: t('screens.refunds.issue'),
    sending: t('screens.refunds.sending'),
    sentTitle: t('screens.refunds.sentTitle'),
    pendingTitle: String(t.raw('screens.refunds.pendingTitle')),
    issuedBody: String(t.raw('screens.refunds.issuedBody')),
    providerSaid: String(t.raw('screens.refunds.providerSaid')),
    failedTitle: t('screens.refunds.failedTitle'),
    logHeading: t('screens.refunds.logHeading'),
    all: t('screens.refunds.all'),
    loadingList: t('screens.refunds.loadingList'),
    emptyTitle: t('screens.refunds.emptyTitle'),
    emptyBody: t('screens.refunds.emptyBody'),
    filteredTitle: String(t.raw('screens.refunds.filteredTitle')),
    filteredBody: t('screens.refunds.filteredBody'),
    full: t('screens.refunds.full'),
    partial: t('screens.refunds.partial'),
    onPledge: String(t.raw('screens.refunds.onPledge')),
    reasonAndDetail: String(t.raw('screens.refunds.reasonAndDetail')),
    requestedBy: String(t.raw('screens.refunds.requestedBy')),
    refused: String(t.raw('screens.refunds.refused')),
    state: t.raw('screens.refunds.state') as Readonly<Record<RefundState, string>>,
    reason: t.raw('screens.refunds.reason') as Readonly<Record<RefundReason, string>>,
  };
}

/**
 * AD-07's chargebacks.
 *
 * <p>`outcomeNote` names LOST, CONCEDED and WON in the service's own spelling inside an
 * otherwise translated sentence. That is deliberate: those three are what the row will read
 * afterwards and what the provider's console calls them, and a reader matching the sentence to
 * the button needs the same string in both.
 */
export interface DisputeConsoleCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly caseSubject: string;
  readonly noticeTitle: string;
  readonly noticeBody: string;
  readonly heading: string;
  readonly loadingList: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  /** Carries `{code}`, `{provider}`. */
  readonly providerAndReason: string;
  /**
   * The card network's reason codes, worded — issue #403.
   *
   * <p>Keyed by the provider's own spelling, and a code with no sentence falls through to
   * itself: the set belongs to the networks and they add to it, so this is a table of the
   * ones seen rather than a closed enum.
   */
  readonly reason: Readonly<Record<string, string>>;
  /** Carries `{fee}`, `{pledge}`. */
  readonly pledgeLine: string;
  readonly noDeadline: string;
  readonly deadlinePassed: string;
  /** Carries `{count}`. */
  readonly hoursLeft: string;
  /** Carries `{count}`. */
  readonly daysLeft: string;
  readonly loadingCase: string;
  readonly caseFailedTitle: string;
  readonly tryAgainShort: string;
  readonly evidenceHeading: string;
  readonly noEvidence: string;
  readonly notSent: string;
  readonly sent: string;
  readonly kindLabel: string;
  readonly showsLabel: string;
  readonly add: string;
  readonly markAnswered: string;
  readonly outcomeNote: string;
  readonly failedTitle: string;
  readonly state: Readonly<Record<DisputeState, string>>;
  readonly evidenceKind: Readonly<Record<EvidenceKind, string>>;
}

export function disputeConsoleCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): DisputeConsoleCopy {
  return {
    ...chrome,
    subject: t('screens.disputes.subject'),
    caseSubject: t('screens.disputes.caseSubject'),
    noticeTitle: t('screens.disputes.noticeTitle'),
    noticeBody: t('screens.disputes.noticeBody'),
    heading: t('screens.disputes.heading'),
    loadingList: t('screens.disputes.loadingList'),
    emptyTitle: t('screens.disputes.emptyTitle'),
    emptyBody: t('screens.disputes.emptyBody'),
    providerAndReason: String(t.raw('screens.disputes.providerAndReason')),
    reason: t.raw('screens.disputes.reason') as Readonly<Record<string, string>>,
    pledgeLine: String(t.raw('screens.disputes.pledgeLine')),
    noDeadline: t('screens.disputes.noDeadline'),
    deadlinePassed: t('screens.disputes.deadlinePassed'),
    hoursLeft: String(t.raw('screens.disputes.hoursLeft')),
    daysLeft: String(t.raw('screens.disputes.daysLeft')),
    loadingCase: t('screens.disputes.loadingCase'),
    caseFailedTitle: t('screens.disputes.caseFailedTitle'),
    tryAgainShort: t('screens.disputes.tryAgainShort'),
    evidenceHeading: t('screens.disputes.evidenceHeading'),
    noEvidence: t('screens.disputes.noEvidence'),
    notSent: t('screens.disputes.notSent'),
    sent: t('screens.disputes.sent'),
    kindLabel: t('screens.disputes.kindLabel'),
    showsLabel: t('screens.disputes.showsLabel'),
    add: t('screens.disputes.add'),
    markAnswered: t('screens.disputes.markAnswered'),
    outcomeNote: t('screens.disputes.outcomeNote'),
    failedTitle: t('screens.disputes.failedTitle'),
    state: t.raw('screens.disputes.state') as Readonly<Record<DisputeState, string>>,
    evidenceKind: t.raw('screens.disputes.evidenceKind') as Readonly<Record<EvidenceKind, string>>,
  };
}

/**
 * AD-11's fee schedules.
 *
 * <p>`fractionHint` carries `{percentage}`, which `asPercentage` computes for display only â€”
 * the rate itself crosses as the string that gets multiplied, and nothing on this screen
 * multiplies a rate by money.
 */
/**
 * AD-11's second screen: the plan catalogue and the payment queue beside it.
 *
 * <h2>`noticeBody` is the one string on the screen that is load-bearing</h2>
 *
 * It is the only place an operator is told that editing a plan reaches every subscriber's
 * limits and no subscriber's bill. The fee editor next door refuses to edit anything at all,
 * so somebody moving between the two screens arrives here with the opposite expectation --
 * and a limit lowered by somebody who thought it applied only to new customers is a change
 * nobody meant to make.
 */
export interface PlanManagerCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly noticeTitle: string;
  readonly noticeBody: string;

  readonly catalogueHeading: string;
  readonly catalogueIntro: string;
  readonly loadingCatalogue: string;
  readonly emptyCatalogueTitle: string;
  readonly emptyCatalogueBody: string;
  /** Carries `{campaigns}`, `{ceiling}`, `{period}`, `{price}`. */
  readonly planSummary: string;
  readonly onSale: string;
  readonly retired: string;
  readonly repriceLabel: string;
  readonly reprice: string;
  readonly retire: string;
  readonly putOnSale: string;
  readonly unlimited: string;

  readonly addHeading: string;
  readonly codeLabel: string;
  readonly codeHint: string;
  readonly nameLabel: string;
  readonly descriptionLabel: string;
  readonly descriptionHint: string;
  readonly priceLabel: string;
  readonly priceHint: string;
  readonly periodLabel: string;
  readonly maxActiveLabel: string;
  readonly goalCeilingLabel: string;
  readonly unlimitedHint: string;
  readonly addPlan: string;

  readonly queueHeading: string;
  readonly queueIntro: string;
  readonly loadingQueue: string;
  readonly showAll: string;
  readonly showQueue: string;
  readonly emptyQueueTitle: string;
  readonly emptyQueueBody: string;
  /** Carries `{price}`, `{until}`. */
  readonly subscriptionSummary: string;
  readonly unknownPlan: string;
  readonly notStarted: string;
  readonly noteLabel: string;
  readonly noteHint: string;
  readonly recordPayment: string;
  readonly endReasonLabel: string;
  readonly endReasonHint: string;
  readonly endSubscription: string;

  readonly doneTitle: string;
  readonly failedTitle: string;
  /** Carries `{plan}`. */
  readonly addedNotice: string;
  /** Carries `{plan}`. */
  readonly repricedNotice: string;
  /** Carries `{id}`. */
  readonly activatedNotice: string;
  /** Carries `{id}`. */
  readonly endedNotice: string;

  readonly period: Readonly<Record<'MONTHLY' | 'YEARLY', string>>;
  readonly state: Readonly<
    Record<'PENDING_PAYMENT' | 'ACTIVE' | 'CANCELED' | 'EXPIRED', string>
  >;
}

export function planManagerCopyFrom(t: AdminTranslator, chrome: ConsoleChromeCopy): PlanManagerCopy {
  return {
    ...chrome,
    subject: t('screens.plans.subject'),
    noticeTitle: t('screens.plans.noticeTitle'),
    noticeBody: t('screens.plans.noticeBody'),

    catalogueHeading: t('screens.plans.catalogueHeading'),
    catalogueIntro: t('screens.plans.catalogueIntro'),
    loadingCatalogue: t('screens.plans.loadingCatalogue'),
    emptyCatalogueTitle: t('screens.plans.emptyCatalogueTitle'),
    emptyCatalogueBody: t('screens.plans.emptyCatalogueBody'),
    // `t.raw` for every template, because `t('key')` on a message holding a placeholder
    // renders the key's own path -- `test-copy.ts` refuses it.
    planSummary: String(t.raw('screens.plans.planSummary')),
    onSale: t('screens.plans.onSale'),
    retired: t('screens.plans.retired'),
    repriceLabel: t('screens.plans.repriceLabel'),
    reprice: t('screens.plans.reprice'),
    retire: t('screens.plans.retire'),
    putOnSale: t('screens.plans.putOnSale'),
    unlimited: t('screens.plans.unlimited'),

    addHeading: t('screens.plans.addHeading'),
    codeLabel: t('screens.plans.codeLabel'),
    codeHint: t('screens.plans.codeHint'),
    nameLabel: t('screens.plans.nameLabel'),
    descriptionLabel: t('screens.plans.descriptionLabel'),
    descriptionHint: t('screens.plans.descriptionHint'),
    priceLabel: t('screens.plans.priceLabel'),
    priceHint: t('screens.plans.priceHint'),
    periodLabel: t('screens.plans.periodLabel'),
    maxActiveLabel: t('screens.plans.maxActiveLabel'),
    goalCeilingLabel: t('screens.plans.goalCeilingLabel'),
    unlimitedHint: t('screens.plans.unlimitedHint'),
    addPlan: t('screens.plans.addPlan'),

    queueHeading: t('screens.plans.queueHeading'),
    queueIntro: t('screens.plans.queueIntro'),
    loadingQueue: t('screens.plans.loadingQueue'),
    showAll: t('screens.plans.showAll'),
    showQueue: t('screens.plans.showQueue'),
    emptyQueueTitle: t('screens.plans.emptyQueueTitle'),
    emptyQueueBody: t('screens.plans.emptyQueueBody'),
    subscriptionSummary: String(t.raw('screens.plans.subscriptionSummary')),
    unknownPlan: t('screens.plans.unknownPlan'),
    notStarted: t('screens.plans.notStarted'),
    noteLabel: t('screens.plans.noteLabel'),
    noteHint: t('screens.plans.noteHint'),
    recordPayment: t('screens.plans.recordPayment'),
    endReasonLabel: t('screens.plans.endReasonLabel'),
    endReasonHint: t('screens.plans.endReasonHint'),
    endSubscription: t('screens.plans.endSubscription'),

    doneTitle: t('screens.plans.doneTitle'),
    failedTitle: t('screens.plans.failedTitle'),
    addedNotice: String(t.raw('screens.plans.addedNotice')),
    repricedNotice: String(t.raw('screens.plans.repricedNotice')),
    activatedNotice: String(t.raw('screens.plans.activatedNotice')),
    endedNotice: String(t.raw('screens.plans.endedNotice')),

    period: t.raw('screens.plans.period') as Readonly<Record<'MONTHLY' | 'YEARLY', string>>,
    state: t.raw('screens.plans.state') as Readonly<
      Record<'PENDING_PAYMENT' | 'ACTIVE' | 'CANCELED' | 'EXPIRED', string>
    >,
  };
}

export interface FeeEditorCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly noticeTitle: string;
  readonly noticeBody: string;
  readonly inForceHeading: string;
  readonly loadingList: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly replaceHeading: string;
  readonly scopeLabel: string;
  readonly categoryLabel: string;
  readonly campaignLabel: string;
  readonly scopeRefHint: string;
  readonly platformRateLabel: string;
  readonly processingRateLabel: string;
  /** Carries `{percentage}`. */
  readonly fractionHint: string;
  readonly fixedLabel: string;
  readonly whyLabel: string;
  readonly whyHint: string;
  readonly open: string;
  readonly working: string;
  readonly doneTitle: string;
  /** Carries `{date}`, `{scope}`. */
  readonly openedNotice: string;
  readonly failedTitle: string;
  readonly pastHeading: string;
  readonly pastIntro: string;
  readonly inForceTag: string;
  /** Carries `{currency}`, `{fixed}`, `{platform}`, `{processing}`. */
  readonly rates: string;
  /** Carries `{from}`, `{note}`, `{to}`. */
  readonly window: string;
  readonly now: string;
  readonly scope: Readonly<Record<FeeScope, string>>;
}

export function feeEditorCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): FeeEditorCopy {
  return {
    ...chrome,
    subject: t('screens.fees.subject'),
    noticeTitle: t('screens.fees.noticeTitle'),
    noticeBody: t('screens.fees.noticeBody'),
    inForceHeading: t('screens.fees.inForceHeading'),
    loadingList: t('screens.fees.loadingList'),
    emptyTitle: t('screens.fees.emptyTitle'),
    emptyBody: t('screens.fees.emptyBody'),
    replaceHeading: t('screens.fees.replaceHeading'),
    scopeLabel: t('screens.fees.scopeLabel'),
    categoryLabel: t('screens.fees.categoryLabel'),
    campaignLabel: t('screens.fees.campaignLabel'),
    scopeRefHint: t('screens.fees.scopeRefHint'),
    platformRateLabel: t('screens.fees.platformRateLabel'),
    processingRateLabel: t('screens.fees.processingRateLabel'),
    fractionHint: String(t.raw('screens.fees.fractionHint')),
    fixedLabel: t('screens.fees.fixedLabel'),
    whyLabel: t('screens.fees.whyLabel'),
    whyHint: t('screens.fees.whyHint'),
    open: t('screens.fees.open'),
    working: t('screens.fees.working'),
    doneTitle: t('screens.fees.doneTitle'),
    openedNotice: String(t.raw('screens.fees.openedNotice')),
    failedTitle: t('screens.fees.failedTitle'),
    pastHeading: t('screens.fees.pastHeading'),
    pastIntro: t('screens.fees.pastIntro'),
    inForceTag: t('screens.fees.inForceTag'),
    rates: String(t.raw('screens.fees.rates')),
    window: String(t.raw('screens.fees.window')),
    now: t('screens.fees.now'),
    scope: t.raw('screens.fees.scope') as Readonly<Record<FeeScope, string>>,
  };
}

/**
 * AD-11's third screen: what the subscriptions brought in — #23.
 *
 * <h2>Three figures per currency, and the words for them are chosen to be read together</h2>
 *
 * `gross`, `reversed` and `net` are labelled "Received", "Reversed" and "Kept" rather than in
 * accounting's vocabulary, because the person reading them is somebody holding a bank
 * statement and a month to close. The notice says which of the three each job uses.
 *
 * <h2>Counts are plural forms, never a number glued to a noun</h2>
 *
 * "1 payments" is wrong in English and "21 платежей" is wrong in Russian, and the second is
 * the one a fixed suffix gets wrong. `lib/i18n/plurals.ts` chooses the form; this reads all
 * four categories in every language because `catalogue.test.ts` demands identical key sets.
 */
export interface RevenueReportCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly noticeTitle: string;
  readonly noticeBody: string;

  readonly periodLegend: string;
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly toHint: string;
  readonly thisMonth: string;
  readonly lastMonth: string;
  readonly show: string;
  readonly planLabel: string;
  readonly planHint: string;
  readonly methodLabel: string;
  readonly anyMethod: string;
  /** Keyed by the service's own spelling of the method. */
  readonly method: Readonly<Record<PaymentMethod, string>>;
  /** Carries `{from}` and `{to}`, both already formatted as dates. */
  readonly periodCaption: string;

  readonly totalsHeading: string;
  readonly loadingTotals: string;
  readonly gross: string;
  readonly reversed: string;
  readonly net: string;
  readonly payments: PluralForms;
  readonly reversals: PluralForms;
  readonly byPlanHeading: string;
  readonly byMethodHeading: string;
  readonly entries: PluralForms;
  readonly emptyTitle: string;
  readonly emptyBody: string;

  readonly listHeading: string;
  readonly loadingList: string;
  readonly reversal: string;
  readonly closedAccount: string;
  /** Carries `{date}`. */
  readonly receivedOn: string;
  /** Carries `{date}`. Shown only when the payment was typed in on a different day. */
  readonly recordedOn: string;
  /** Carries `{reference}`. */
  readonly reference: string;

  readonly exportCsv: string;
  readonly exporting: string;
  readonly exported: PluralForms;
  /** Carries `{count}`. */
  readonly truncated: string;
}

export function revenueReportCopyFrom(t: AdminTranslator, chrome: ConsoleChromeCopy): RevenueReportCopy {
  // `t.raw` for every template and every set of plural forms: `t('key')` on a message holding a
  // placeholder renders the key's own path, and `test-copy.ts` refuses it.
  const template = (key: string) => String(t.raw(`screens.revenue.${key}`));
  const forms = (key: string) => t.raw(`screens.revenue.${key}`) as PluralForms;
  const word = (key: string) => t(`screens.revenue.${key}`);

  return {
    ...chrome,
    subject: word('subject'),
    noticeTitle: word('noticeTitle'),
    noticeBody: word('noticeBody'),

    periodLegend: word('periodLegend'),
    fromLabel: word('fromLabel'),
    toLabel: word('toLabel'),
    toHint: word('toHint'),
    thisMonth: word('thisMonth'),
    lastMonth: word('lastMonth'),
    show: word('show'),
    planLabel: word('planLabel'),
    planHint: word('planHint'),
    methodLabel: word('methodLabel'),
    anyMethod: word('anyMethod'),
    method: {
      BANK_TRANSFER: word('method.BANK_TRANSFER'),
      CARD: word('method.CARD'),
      CASH: word('method.CASH'),
      OTHER: word('method.OTHER'),
    },
    periodCaption: template('periodCaption'),

    totalsHeading: word('totalsHeading'),
    loadingTotals: word('loadingTotals'),
    gross: word('gross'),
    reversed: word('reversed'),
    net: word('net'),
    payments: forms('payments'),
    reversals: forms('reversals'),
    byPlanHeading: word('byPlanHeading'),
    byMethodHeading: word('byMethodHeading'),
    entries: forms('entries'),
    emptyTitle: word('emptyTitle'),
    emptyBody: word('emptyBody'),

    listHeading: word('listHeading'),
    loadingList: word('loadingList'),
    reversal: word('reversal'),
    closedAccount: word('closedAccount'),
    receivedOn: template('receivedOn'),
    recordedOn: template('recordedOn'),
    reference: template('reference'),

    exportCsv: word('exportCsv'),
    exporting: word('exporting'),
    exported: forms('exported'),
    truncated: template('truncated'),
  };
}
