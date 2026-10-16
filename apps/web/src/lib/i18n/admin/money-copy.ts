import type { DisputeState, EvidenceKind } from '../../admin/disputes';
import type { FeeScope } from '../../admin/fees';
import type { DestinationKind, DestinationRejectionReason } from '../../admin/api';
import type { ProviderName, TransactionStatus, TransactionType } from '../../admin/payments';
import type { DestinationStanding, PayoutState, VerificationStanding } from '../../admin/payouts';
import type { RefundReason, RefundState } from '../../admin/refunds';
import type { PaymentMethod } from '../../admin/revenue';
import type { FindingCode, FindingKind } from '../../admin/reconciliation';
import type { AdminTranslator } from '../admin-copy';
import type { PluralForms } from '../plurals';
import type { ConsoleChromeCopy } from './common-copy';
import type { BackerTicketCopy, RefundBankDetailsCopy } from './people-copy';

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
 * <p>Two vocabularies stay in the service's own spelling on purpose: a card network's reason
 * code and the currency. Each is a value somebody quotes into a support conversation or a
 * dispute, and a translated copy of one would be a word the provider does not recognise. A
 * provider is named the way the provider names itself (`Payriff`, not `PAYRIFF`), and the two
 * values that are not providers at all, the sandbox and a bank transfer, are words.
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
  /** A pending or failed call with no reference: it may have reached the provider. */
  readonly noReference: string;
  /** A succeeded call with no reference. Neutral: the call plainly reached the provider. */
  readonly noReferenceSettled: string;
  readonly type: Readonly<Record<TransactionType, string>>;
  readonly status: Readonly<Record<TransactionStatus, string>>;
  /** The provider's name as staff say it, keyed by the service's enum. */
  readonly provider: Readonly<Record<ProviderName, string>>;
  /**
   * A refusal in the reader's language, keyed by the `failureCode` the service writes —
   * `payment_failed`, `provider_unreachable` and the adapters' fallbacks. A provider's own
   * code (a card network's `51`) is not in here and falls to {@link failureUnknown}.
   */
  readonly failure: Readonly<Record<string, string>>;
  /** Beside a code this table has no sentence for, which is printed after it as it came. */
  readonly failureUnknown: string;
  /** Under the identifier box, when what was typed is not a UUID. Nothing is sent. */
  readonly invalidId: string;
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
    noReferenceSettled: t('screens.payments.noReferenceSettled'),
    type: t.raw('screens.payments.type') as Readonly<Record<TransactionType, string>>,
    status: t.raw('screens.payments.status') as Readonly<Record<TransactionStatus, string>>,
    provider: t.raw('screens.payments.provider') as Readonly<Record<ProviderName, string>>,
    failure: t.raw('screens.payments.failure') as Readonly<Record<string, string>>,
    failureUnknown: t('screens.payments.failureUnknown'),
    invalidId: t('screens.payments.invalidId'),
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
  /** Under the campaign box, when what was typed is not a UUID. Nothing is sent. */
  readonly invalidId: string;
  /** A page with nothing on it that still has a next page — never the "nothing matches" state. */
  readonly emptyPageMore: string;
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
    invalidId: t('screens.ledger.invalidId'),
    emptyPageMore: t('screens.ledger.emptyPageMore'),
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
  /** "Check again" refused with a 401: the session expired, which is not lost permission. */
  readonly runSignedOut: string;
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
    runSignedOut: t('screens.reconciliation.runSignedOut'),
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
  /** The "transfer by hand" panel for a creator paid into a bank account — #398. */
  readonly bankTransfer: PayoutBankTransferCopy;
  /**
   * A sentence per refusal the payout file can meet, keyed by the service's `code` — #398.
   *
   * <p>`FIGURES_MOVED` is the one key that is not a code: it is `PAYOUT_NOT_SENDABLE` with the
   * payout already cancelled, which sends the reader to a fresh calculation rather than to a
   * signature. `BANK_TRANSFER_DATE_OUT_OF_RANGE` carries `{start}` and `{today}`.
   */
  readonly refusal: Readonly<Record<PayoutRefusalKey, string>>;
}

/** The refusals {@link PayoutQueueCopy.refusal} has words for. */
export type PayoutRefusalKey =
  | 'PAYOUT_SETTLES_THROUGH_PROVIDER'
  | 'PAYOUT_SETTLES_BY_BANK_TRANSFER'
  | 'PAYOUT_BACKER_DISPUTE_OPEN'
  | 'FIGURES_MOVED'
  | 'PAYOUT_NOT_SENDABLE'
  | 'PAYOUT_DESTINATION_NOT_VERIFIED'
  | 'SELF_PAID_PAYOUT'
  | 'PAYOUT_BANK_TRANSFER_ALREADY_RECORDED'
  | 'PAYOUT_REFERENCE_TAKEN'
  | 'BANK_TRANSFER_DATE_OUT_OF_RANGE'
  | 'PAYOUT_BANK_TRANSFER_IN_PROGRESS'
  | 'PAYOUT_BANK_TRANSFER_NOT_STARTED'
  | 'PAYOUT_SIGNATURES_SHORT'
  | 'CAMPAIGN_ALREADY_PAID_OUT'
  | 'PAYOUT_SEND_UNCONFIRMED';

/**
 * Paying a payout by hand from IdeyaNest's bank account — #398.
 *
 * <p>The amount is never in the catalogue: `confirmRecord` carries `{amount}`, filled with the
 * service's own figure through `formatMoney`, beside `{reference}` and `{date}`.
 */
export interface PayoutBankTransferCopy {
  readonly heading: string;
  readonly intro: string;
  readonly inProgressTag: string;
  readonly notApproved: string;
  readonly needsApprovePayout: string;
  readonly needsReadBankDetails: string;
  /** Said beside the control that opens the account, before anybody presses it. */
  readonly audited: string;
  readonly startTransfer: string;
  readonly starting: string;
  /** Carries `{who}` and `{date}`. */
  readonly transferStarted: string;
  readonly revealIban: string;
  readonly hide: string;
  readonly amountLabel: string;
  readonly ibanLabel: string;
  readonly holderLabel: string;
  readonly descriptionLabel: string;
  readonly copy: string;
  /** A copy control's accessible name. Carries `{field}`. */
  readonly copyField: string;
  readonly copied: string;
  readonly revealFailed: string;
  readonly recordHeading: string;
  readonly recordIntro: string;
  readonly bankReference: string;
  readonly bankReferenceHint: string;
  readonly transferredOn: string;
  readonly transferredOnHint: string;
  readonly bankFee: string;
  readonly bankFeeHint: string;
  readonly bankFeeInvalid: string;
  /** Carries `{amount}`. */
  readonly confirmBankFee: string;
  readonly noteLabel: string;
  readonly recordNoteHint: string;
  readonly recordTransfer: string;
  /** Carries `{amount}`, `{reference}`, `{date}`. */
  readonly confirmRecord: string;
  readonly confirmRecordAction: string;
  readonly recording: string;
  readonly back: string;
  readonly abandonTransfer: string;
  readonly abandonIntro: string;
  readonly abandonNoteLabel: string;
  readonly confirmAbandon: string;
  readonly abandoning: string;
  /** Carries `{date}`. */
  readonly paidOn: string;
}

/** Raw rather than formatted throughout, because several carry placeholders the component fills. */
function payoutBankTransferCopyFrom(t: AdminTranslator): PayoutBankTransferCopy {
  const raw = (key: keyof PayoutBankTransferCopy): string =>
    String(t.raw(`screens.payouts.bankTransfer.${key}`));

  return {
    heading: raw('heading'),
    intro: raw('intro'),
    inProgressTag: raw('inProgressTag'),
    notApproved: raw('notApproved'),
    needsApprovePayout: raw('needsApprovePayout'),
    needsReadBankDetails: raw('needsReadBankDetails'),
    audited: raw('audited'),
    startTransfer: raw('startTransfer'),
    starting: raw('starting'),
    transferStarted: raw('transferStarted'),
    revealIban: raw('revealIban'),
    hide: raw('hide'),
    amountLabel: raw('amountLabel'),
    ibanLabel: raw('ibanLabel'),
    holderLabel: raw('holderLabel'),
    descriptionLabel: raw('descriptionLabel'),
    copy: raw('copy'),
    copyField: raw('copyField'),
    copied: raw('copied'),
    revealFailed: raw('revealFailed'),
    recordHeading: raw('recordHeading'),
    recordIntro: raw('recordIntro'),
    bankReference: raw('bankReference'),
    bankReferenceHint: raw('bankReferenceHint'),
    transferredOn: raw('transferredOn'),
    transferredOnHint: raw('transferredOnHint'),
    bankFee: raw('bankFee'),
    bankFeeHint: raw('bankFeeHint'),
    bankFeeInvalid: raw('bankFeeInvalid'),
    confirmBankFee: raw('confirmBankFee'),
    noteLabel: raw('noteLabel'),
    recordNoteHint: raw('recordNoteHint'),
    recordTransfer: raw('recordTransfer'),
    confirmRecord: raw('confirmRecord'),
    confirmRecordAction: raw('confirmRecordAction'),
    recording: raw('recording'),
    back: raw('back'),
    abandonTransfer: raw('abandonTransfer'),
    abandonIntro: raw('abandonIntro'),
    abandonNoteLabel: raw('abandonNoteLabel'),
    confirmAbandon: raw('confirmAbandon'),
    abandoning: raw('abandoning'),
    paidOn: raw('paidOn'),
  };
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
    bankTransfer: payoutBankTransferCopyFrom(t),
    refusal: t.raw('screens.payouts.refusal') as Readonly<Record<PayoutRefusalKey, string>>,
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
  /**
   * #176: a refund the provider did not answer stays REQUESTED until reconcile asks it, and
   * a second attempt is refused. Said so that nobody reads the pending banner as a fault.
   */
  readonly awaitingProvider: string;
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
  /** The row's tag for a refund meant to return the rest of the pledge, and for one that was not. */
  readonly fullRefund: string;
  readonly partialRefund: string;
  /** Carries `{backer}`, `{campaign}`, `{pledge}` — names from the console directory. */
  readonly pledgeLine: string;
  /** Where the directory has no name: a pledge with no backer left to name. */
  readonly unnamed: string;
  /** A settled refund's amount. Carries `{amount}`. */
  readonly amountSent: string;
  /** #436's fee kept back, beside the amount. Carries `{fee}`. */
  readonly withheldNote: string;
  /** Carries `{detail}`, `{reason}`. */
  readonly reasonAndDetail: string;
  /** Carries `{by}`, `{date}`. */
  readonly requestedBy: string;
  /** Who issued a refund the platform issued itself (#40). */
  readonly platform: string;
  /**
   * Why a refund failed, by the failure code the platform writes itself (`not_sent`,
   * `reverse_not_confirmed`, `provider_unreachable`). A provider's own code falls through to
   * {@link failureOther}, which quotes it.
   */
  readonly failure: Readonly<Record<string, string>>;
  /** Carries `{code}`. */
  readonly failureOther: string;
  /**
   * The rows whose `detail` the service writes itself, in English, worded here from the row's
   * own fields instead: a refund sent by bank transfer in place of a refused one (`{refund}`), a
   * lost chargeback (`{dispute}`), and the platform's own refunds, by reason.
   */
  readonly detailRoutedFrom: string;
  readonly detailChargeback: string;
  readonly detailPlatform: Readonly<Record<string, string>>;
  /** The issue form's own checks, before anything is sent. */
  readonly pledgeInvalid: string;
  readonly amountInvalid: string;
  readonly checking: string;
  /** The confirmation: what is about to be sent, to whom, and why. */
  readonly confirmHeading: string;
  /** Carries `{amount}`, `{backer}`, `{campaign}`, `{pledge}`, `{reason}`. */
  readonly confirmIssue: string;
  /** "Everything left", with the figure. Carries `{amount}`. */
  readonly allRemaining: string;
  /** Carries `{fee}`. */
  readonly confirmWithheld: string;
  readonly confirmAction: string;
  /** A refund sent in more than one part (#171). Carries `{count}`. */
  readonly partsNote: string;
  /**
   * The issue form's refusals, by the service's `code`. `REFUND_EXCEEDS_COLLECTION` carries
   * `{remaining}`, `CURRENCY_MISMATCH` `{currency}`. A code with none falls through to the shared
   * refusal table, which is what a capability refusal reaches.
   */
  readonly issueErrors: Readonly<Record<string, string>>;
  readonly state: Readonly<Record<RefundState, string>>;
  readonly reason: Readonly<Record<RefundReason, string>>;
  readonly bank: RefundBankTransferCopy;
  /**
   * #416: support's half, on a refund waiting for bank details — the backer's ticket and the
   * account recorded from it. The support console's own keys, because they are its forms.
   */
  readonly backerTicket: BackerTicketCopy;
  readonly bankDetails: RefundBankDetailsCopy;
  /** #457: plan payments that arrived after the subscription ended, and their return. */
  readonly planPayments: PlanPaymentReturnsCopy;
}

/**
 * #457: the plan payments the refund console returns to their creators.
 *
 * <p>`errors` is keyed by the service's `code` (`PlanRefundRefusedException`). A code with no
 * sentence falls through to the console's shared refusal table, which is what a capability
 * refusal reaches.
 */
export interface PlanPaymentReturnsCopy {
  readonly subject: string;
  readonly heading: string;
  readonly intro: string;
  readonly loadingList: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  /** Carries `{date}`. */
  readonly paidOn: string;
  /** Carries `{provider}`, `{order}`. */
  readonly providerOrder: string;
  /** Carries `{account}`. */
  readonly paidBy: string;
  readonly openAccount: string;
  /** Carries `{id}`. */
  readonly openAccountLabel: string;
  /** Carries `{date}`, `{left}`. */
  readonly cardOpenUntil: string;
  /** Carries `{count}`. */
  readonly daysLeft: string;
  readonly lastDay: string;
  /** Carries `{date}`. */
  readonly cardClosed: string;
  readonly noCardWindow: string;
  readonly refundToCard: string;
  readonly cardClosedReason: string;
  /** Carries `{amount}`, `{provider}`. */
  readonly confirmRefund: string;
  readonly confirmRefundAction: string;
  readonly refunding: string;
  readonly recordBankTransfer: string;
  readonly bankIntro: string;
  readonly bankReference: string;
  readonly bankReferenceHint: string;
  readonly note: string;
  readonly noteHint: string;
  /** Carries `{amount}`, `{reference}`. */
  readonly confirmRecord: string;
  readonly confirmRecordAction: string;
  readonly recording: string;
  readonly cancel: string;
  readonly refundedTitle: string;
  /** Carries `{amount}`, `{order}`. */
  readonly refundedBody: string;
  readonly recordedTitle: string;
  /** Carries `{amount}`, `{reference}`. */
  readonly recordedBody: string;
  readonly alreadyReturnedTitle: string;
  readonly errors: Readonly<Record<string, string>>;
}

/**
 * #400: a refund paid by bank transfer, on the refund console — the account, the reveal, the
 * record form, the four-eyes rule and the fallback for a refund the provider refused.
 *
 * <p>`errors` is keyed by the service's `code` (`BankRefundRefusedException.Reason`, and the
 * shared 503 for a missing keyring). A code with no sentence falls through to the console's
 * shared refusal table, which is what a capability refusal reaches.
 */
export interface RefundBankTransferCopy {
  readonly awaitingBankDetails: string;
  readonly awaitingTransfer: string;
  readonly heading: string;
  /** Carries `{hint}`, `{ticket}`. */
  readonly accountOnFile: string;
  /** Carries `{by}`, `{date}`. */
  readonly detailsRecordedBy: string;
  /** Carries `{date}`, `{reference}`, `{by}`. */
  readonly transferRecorded: string;
  readonly ibanLabel: string;
  readonly holderLabel: string;
  readonly ticketLabel: string;
  readonly amountLabel: string;
  readonly reveal: {
    readonly action: string;
    readonly revealing: string;
    readonly hide: string;
    readonly audited: string;
    readonly failed: string;
    readonly forbidden: string;
  };
  readonly copy: {
    readonly copy: string;
    readonly copied: string;
    readonly iban: string;
    readonly holder: string;
    readonly amount: string;
  };
  readonly recordTransfer: string;
  readonly recordIntro: string;
  readonly bankReference: string;
  readonly bankReferenceHint: string;
  readonly transferredOn: string;
  readonly transferredOnHint: string;
  readonly bankFee: string;
  readonly bankFeeHint: string;
  readonly bankFeeInvalid: string;
  /** Carries `{amount}`. */
  readonly confirmBankFee: string;
  /** Carries `{amount}`, `{hint}`, `{date}`, `{reference}`. */
  readonly confirmRecord: string;
  readonly confirmRecordAction: string;
  readonly recording: string;
  readonly cancel: string;
  readonly recordedTitle: string;
  /** Carries `{amount}`, `{id}`. */
  readonly recordedBody: string;
  readonly fourEyesTitle: string;
  readonly fourEyes: string;
  readonly refundByBank: string;
  readonly confirmRefundByBank: string;
  readonly confirmRefundByBankAction: string;
  readonly routing: string;
  readonly routedTitle: string;
  /** Carries `{amount}`, `{id}`. */
  readonly routedBody: string;
  /** On a refused row already routed: where its money went. Carries `{state}`. */
  readonly routedTo: string;
  /** A repeated route, answered with the bank refund it made before. */
  readonly routedAlreadyTitle: string;
  /** Carries `{id}`, `{state}`. */
  readonly routedAlready: string;
  readonly errors: Readonly<Record<string, string>>;
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
    awaitingProvider: t('screens.refunds.awaitingProvider'),
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
    fullRefund: t('screens.refunds.fullRefund'),
    partialRefund: t('screens.refunds.partialRefund'),
    pledgeLine: String(t.raw('screens.refunds.pledgeLine')),
    unnamed: t('screens.refunds.unnamed'),
    amountSent: String(t.raw('screens.refunds.amountSent')),
    withheldNote: String(t.raw('screens.refunds.withheldNote')),
    reasonAndDetail: String(t.raw('screens.refunds.reasonAndDetail')),
    requestedBy: String(t.raw('screens.refunds.requestedBy')),
    platform: String(t.raw('screens.refunds.platform')),
    failure: t.raw('screens.refunds.failure') as Readonly<Record<string, string>>,
    failureOther: String(t.raw('screens.refunds.failureOther')),
    detailRoutedFrom: String(t.raw('screens.refunds.detailRoutedFrom')),
    detailChargeback: String(t.raw('screens.refunds.detailChargeback')),
    detailPlatform: t.raw('screens.refunds.detailPlatform') as Readonly<Record<string, string>>,
    pledgeInvalid: t('screens.refunds.pledgeInvalid'),
    amountInvalid: t('screens.refunds.amountInvalid'),
    checking: t('screens.refunds.checking'),
    confirmHeading: t('screens.refunds.confirmHeading'),
    confirmIssue: String(t.raw('screens.refunds.confirmIssue')),
    allRemaining: String(t.raw('screens.refunds.allRemaining')),
    confirmWithheld: String(t.raw('screens.refunds.confirmWithheld')),
    confirmAction: t('screens.refunds.confirmAction'),
    partsNote: String(t.raw('screens.refunds.partsNote')),
    issueErrors: t.raw('screens.refunds.issueErrors') as Readonly<Record<string, string>>,
    state: t.raw('screens.refunds.state') as Readonly<Record<RefundState, string>>,
    reason: t.raw('screens.refunds.reason') as Readonly<Record<RefundReason, string>>,
    bank: {
      awaitingBankDetails: t('screens.refunds.awaitingBankDetails'),
      awaitingTransfer: t('screens.refunds.awaitingTransfer'),
      heading: t('screens.refunds.bankDetailsHeading'),
      accountOnFile: String(t.raw('screens.refunds.accountOnFile')),
      detailsRecordedBy: String(t.raw('screens.refunds.detailsRecordedBy')),
      transferRecorded: String(t.raw('screens.refunds.transferRecorded')),
      ibanLabel: t('screens.refunds.ibanLabel'),
      holderLabel: t('screens.refunds.holderLabel'),
      ticketLabel: t('screens.refunds.ticketLabel'),
      amountLabel: t('screens.refunds.transferAmountLabel'),
      reveal: t.raw('screens.refunds.reveal') as RefundBankTransferCopy['reveal'],
      copy: t.raw('screens.refunds.copy') as RefundBankTransferCopy['copy'],
      recordTransfer: t('screens.refunds.recordTransfer'),
      recordIntro: t('screens.refunds.recordIntro'),
      bankReference: t('screens.refunds.bankReference'),
      bankReferenceHint: t('screens.refunds.bankReferenceHint'),
      transferredOn: t('screens.refunds.transferredOn'),
      transferredOnHint: t('screens.refunds.transferredOnHint'),
      bankFee: t('screens.refunds.bankFee'),
      bankFeeHint: t('screens.refunds.bankFeeHint'),
      bankFeeInvalid: t('screens.refunds.bankFeeInvalid'),
      confirmBankFee: String(t.raw('screens.refunds.confirmBankFee')),
      confirmRecord: String(t.raw('screens.refunds.confirmRecord')),
      confirmRecordAction: t('screens.refunds.confirmRecordAction'),
      recording: t('screens.refunds.recording'),
      cancel: t('screens.refunds.cancel'),
      recordedTitle: t('screens.refunds.recordedTitle'),
      recordedBody: String(t.raw('screens.refunds.recordedBody')),
      fourEyesTitle: t('screens.refunds.fourEyesTitle'),
      fourEyes: t('screens.refunds.fourEyes'),
      refundByBank: t('screens.refunds.refundByBank'),
      confirmRefundByBank: t('screens.refunds.confirmRefundByBank'),
      confirmRefundByBankAction: t('screens.refunds.confirmRefundByBankAction'),
      routing: t('screens.refunds.routing'),
      routedTitle: t('screens.refunds.routedTitle'),
      routedBody: String(t.raw('screens.refunds.routedBody')),
      routedTo: String(t.raw('screens.refunds.routedTo')),
      routedAlreadyTitle: t('screens.refunds.routedAlreadyTitle'),
      routedAlready: String(t.raw('screens.refunds.routedAlready')),
      errors: t.raw('screens.refunds.errors') as Readonly<Record<string, string>>,
    },
    backerTicket: t.raw('screens.support.backerTicket') as BackerTicketCopy,
    bankDetails: t.raw('screens.support.bankDetails') as RefundBankDetailsCopy,
    planPayments: t.raw('screens.refunds.planPayments') as PlanPaymentReturnsCopy,
  };
}

/**
 * AD-07's chargebacks.
 *
 * <p>`outcomeNote` names the three outcomes in the words the buttons beside it carry — a reader
 * matching the sentence to the button needs the same string in both, and the buttons are
 * translated.
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
  /** The provider, by the service's enum, in its own brand spelling. An unknown one is shown as sent. */
  readonly provider: Readonly<Record<string, string>>;
  /** A network reason code with no sentence: "Other reason" with the code beside it. Carries `{code}`. */
  readonly reasonOther: string;
  /** Where the directory has no name. */
  readonly unnamed: string;
  /**
   * The card network's reason codes, worded — issue #403.
   *
   * <p>Keyed by the provider's own spelling, and a code with no sentence falls through to
   * itself: the set belongs to the networks and they add to it, so this is a table of the
   * ones seen rather than a closed enum.
   */
  readonly reason: Readonly<Record<string, string>>;
  /** Carries `{backer}`, `{campaign}`, `{pledge}`, `{fee}`. */
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
  /** Why "mark answered" is off: nothing new to send. */
  readonly nothingUnsent: string;
  readonly outcomeNote: string;
  readonly failedTitle: string;
  /** The two-step confirm before an outcome is recorded. */
  readonly confirmHeading: string;
  /** Carries `{outcome}`, `{amount}`, `{fee}`. */
  readonly confirmLoss: string;
  /** Carries `{total}`: the amount and the fee, which the creator owes when already paid out. */
  readonly confirmDebt: string;
  /** Carries `{outcome}`. */
  readonly confirmWon: string;
  readonly confirmFinal: string;
  readonly confirmAction: string;
  readonly resolving: string;
  /** What the page says once an act has landed — above the list, so a reload does not take it. */
  readonly doneTitle: string;
  /** Carries `{outcome}`. */
  readonly resolvedNotice: string;
  readonly answeredNotice: string;
  /** By the service's `code`. `DISPUTE_ALREADY_RESOLVED` carries `{state}`. */
  readonly errors: Readonly<Record<string, string>>;
  /** The closed cases, read with `listDisputes` by outcome. */
  readonly resolvedHeading: string;
  readonly resolvedIntro: string;
  readonly resolvedSubject: string;
  readonly loadingResolved: string;
  /** Carries `{state}`. */
  readonly resolvedEmpty: string;
  /** Carries `{date}`. */
  readonly resolvedOn: string;
  readonly state: Readonly<Record<DisputeState, string>>;
  readonly evidenceKind: Readonly<Record<EvidenceKind, string>>;
}

/**
 * The backer dispute queue — IDN-EXT-01 (#43, #44), below the chargebacks on `/admin/disputes`.
 *
 * <p>`pledgeLine` carries `{backer}`, `{campaign}`, `{pledge}` and `{date}`; `confirmUphold` and
 * `upheldNotice` carry `{amount}`; `refundAwaitingBank` carries `{link}`, filled with
 * `refundsLink`; `errors` is keyed by the service's `code`.
 */
export interface BackerDisputeQueueCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly heading: string;
  readonly intro: string;
  readonly loadingList: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly pledgeLine: string;
  readonly noteLabel: string;
  readonly noteHint: string;
  readonly uphold: string;
  readonly reject: string;
  readonly confirmUphold: string;
  readonly confirmNow: string;
  readonly deciding: string;
  readonly alreadyDecided: string;
  readonly refundFailed: string;
  readonly failedTitle: string;
  readonly unnamed: string;
  readonly refundableLine: string;
  readonly everythingLeft: string;
  readonly refundAwaitingBank: string;
  readonly refundsLink: string;
  readonly doneTitle: string;
  readonly upheldNotice: string;
  readonly upheldNoticeNoAmount: string;
  readonly rejectedNotice: string;
  readonly errors: Readonly<Record<string, string>>;
}

export function backerDisputeQueueCopyFrom(t: AdminTranslator, chrome: ConsoleChromeCopy): BackerDisputeQueueCopy {
  const at = (key: string) => String(t.raw(`screens.backerDisputes.${key}`));
  return {
    ...chrome,
    subject: at('subject'),
    heading: at('heading'),
    intro: at('intro'),
    loadingList: at('loadingList'),
    emptyTitle: at('emptyTitle'),
    emptyBody: at('emptyBody'),
    pledgeLine: at('pledgeLine'),
    noteLabel: at('noteLabel'),
    noteHint: at('noteHint'),
    uphold: at('uphold'),
    reject: at('reject'),
    confirmUphold: at('confirmUphold'),
    confirmNow: at('confirmNow'),
    deciding: at('deciding'),
    alreadyDecided: at('alreadyDecided'),
    refundFailed: at('refundFailed'),
    failedTitle: at('failedTitle'),
    unnamed: at('unnamed'),
    refundableLine: at('refundableLine'),
    everythingLeft: at('everythingLeft'),
    refundAwaitingBank: at('refundAwaitingBank'),
    refundsLink: at('refundsLink'),
    doneTitle: at('doneTitle'),
    upheldNotice: at('upheldNotice'),
    upheldNoticeNoAmount: at('upheldNoticeNoAmount'),
    rejectedNotice: at('rejectedNotice'),
    errors: t.raw('screens.backerDisputes.errors') as Readonly<Record<string, string>>,
  };
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
    provider: t.raw('screens.disputes.provider') as Readonly<Record<string, string>>,
    reasonOther: String(t.raw('screens.disputes.reasonOther')),
    unnamed: t('screens.disputes.unnamed'),
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
    nothingUnsent: t('screens.disputes.nothingUnsent'),
    outcomeNote: t('screens.disputes.outcomeNote'),
    failedTitle: t('screens.disputes.failedTitle'),
    confirmHeading: t('screens.disputes.confirmHeading'),
    confirmLoss: String(t.raw('screens.disputes.confirmLoss')),
    confirmDebt: String(t.raw('screens.disputes.confirmDebt')),
    confirmWon: String(t.raw('screens.disputes.confirmWon')),
    confirmFinal: t('screens.disputes.confirmFinal'),
    confirmAction: t('screens.disputes.confirmAction'),
    resolving: t('screens.disputes.resolving'),
    doneTitle: t('screens.disputes.doneTitle'),
    resolvedNotice: String(t.raw('screens.disputes.resolvedNotice')),
    answeredNotice: t('screens.disputes.answeredNotice'),
    errors: t.raw('screens.disputes.errors') as Readonly<Record<string, string>>,
    resolvedHeading: t('screens.disputes.resolvedHeading'),
    resolvedIntro: t('screens.disputes.resolvedIntro'),
    resolvedSubject: t('screens.disputes.resolvedSubject'),
    loadingResolved: t('screens.disputes.loadingResolved'),
    resolvedEmpty: String(t.raw('screens.disputes.resolvedEmpty')),
    resolvedOn: String(t.raw('screens.disputes.resolvedOn')),
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
 * the one a fixed suffix gets wrong. `packages/messages/src/plurals.ts` chooses the form; this
 * reads all four categories in every language because `catalogue.test.ts` demands identical key
 * sets.
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
  /** Nothing in the period under a plan code or method filter: the filter, not the period. */
  readonly filteredTitle: string;
  readonly filteredBody: string;
  /** The payment list, when it has nothing to list. */
  readonly listEmpty: string;
  /** `INVALID_REVENUE_PERIOD`, and the same check made before sending: the end before the start. */
  readonly periodBackwards: string;
  /** `INVALID_REVENUE_PERIOD`: longer than the service's 400 days. */
  readonly periodTooLong: string;

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
    filteredTitle: word('filteredTitle'),
    filteredBody: word('filteredBody'),
    listEmpty: word('listEmpty'),
    periodBackwards: word('periodBackwards'),
    periodTooLong: word('periodTooLong'),

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

/**
 * What a payout destination is called wherever staff see one — #396.
 *
 * <p>One table for the queue and the account screen, so that a destination is called the same
 * thing in both places. `reveal` and `decision` are the controls both of them draw.
 *
 * <p>`holder` carries `{name}`, `updated` carries `{date}` and `rejectedFor` carries `{reason}`.
 */
export interface PayoutDestinationCopy {
  readonly kind: Readonly<Record<DestinationKind, string>>;
  /** Keyed by `DestinationStanding`. */
  readonly standing: Readonly<Record<string, string>>;
  readonly rejectionReason: Readonly<Record<DestinationRejectionReason, string>>;
  readonly holder: string;
  readonly updated: string;
  readonly rejectedFor: string;
  readonly reveal: {
    readonly action: string;
    readonly revealing: string;
    readonly hide: string;
    readonly audited: string;
    readonly ibanLabel: string;
    readonly holderLabel: string;
    readonly notFound: string;
    readonly forbidden: string;
    readonly failed: string;
  };
  readonly decision: {
    readonly verify: string;
    readonly confirmVerify: string;
    readonly confirmVerifyAction: string;
    readonly verifying: string;
    readonly reject: string;
    readonly reasonLabel: string;
    readonly reasonPlaceholder: string;
    readonly confirmReject: string;
    readonly rejecting: string;
    readonly cancel: string;
    readonly nameMismatch: string;
    readonly self: string;
    readonly gone: string;
    readonly failedTitle: string;
  };
}

export function payoutDestinationCopyFrom(t: AdminTranslator): PayoutDestinationCopy {
  const at = (key: string) => String(t.raw(`screens.payoutDestinations.${key}`));
  return {
    kind: t.raw('screens.payoutDestinations.kind') as Readonly<Record<DestinationKind, string>>,
    standing: t.raw('screens.payoutDestinations.standing') as Readonly<Record<string, string>>,
    rejectionReason: t.raw('screens.payoutDestinations.rejectionReason') as Readonly<
      Record<DestinationRejectionReason, string>
    >,
    holder: at('holder'),
    updated: at('updated'),
    rejectedFor: at('rejectedFor'),
    reveal: {
      action: at('reveal.action'),
      revealing: at('reveal.revealing'),
      hide: at('reveal.hide'),
      audited: at('reveal.audited'),
      ibanLabel: at('reveal.ibanLabel'),
      holderLabel: at('reveal.holderLabel'),
      notFound: at('reveal.notFound'),
      forbidden: at('reveal.forbidden'),
      failed: at('reveal.failed'),
    },
    decision: {
      verify: at('decision.verify'),
      confirmVerify: at('decision.confirmVerify'),
      confirmVerifyAction: at('decision.confirmVerifyAction'),
      verifying: at('decision.verifying'),
      reject: at('decision.reject'),
      reasonLabel: at('decision.reasonLabel'),
      reasonPlaceholder: at('decision.reasonPlaceholder'),
      confirmReject: at('decision.confirmReject'),
      rejecting: at('decision.rejecting'),
      cancel: at('decision.cancel'),
      nameMismatch: at('decision.nameMismatch'),
      self: at('decision.self'),
      gone: at('decision.gone'),
      failedTitle: at('decision.failedTitle'),
    },
  };
}

/**
 * COMPLIANCE's queue of payout destinations — `/admin/payout-destinations`, #396.
 *
 * <p>`capped` carries `{count}` and `openAccountLabel` carries `{name}`.
 */
export interface PayoutDestinationQueueCopy extends ConsoleChromeCopy {
  readonly subject: string;
  readonly filterLabel: string;
  readonly everything: string;
  readonly loadingList: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly emptyFilterTitle: string;
  readonly emptyFilterBody: string;
  /** Past the last page: a full page with nothing behind it still offers the next one. */
  readonly emptyPageTitle: string;
  readonly emptyPageBody: string;
  readonly openAccount: string;
  readonly openAccountLabel: string;
  readonly destination: PayoutDestinationCopy;
}

export function payoutDestinationQueueCopyFrom(
  t: AdminTranslator,
  chrome: ConsoleChromeCopy,
): PayoutDestinationQueueCopy {
  const at = (key: string) => String(t.raw(`screens.payoutDestinations.${key}`));
  return {
    ...chrome,
    subject: at('subject'),
    filterLabel: at('filterLabel'),
    everything: at('everything'),
    loadingList: at('loadingList'),
    emptyTitle: at('emptyTitle'),
    emptyBody: at('emptyBody'),
    emptyFilterTitle: at('emptyFilterTitle'),
    emptyFilterBody: at('emptyFilterBody'),
    emptyPageTitle: at('emptyPageTitle'),
    emptyPageBody: at('emptyPageBody'),
    openAccount: at('openAccount'),
    openAccountLabel: at('openAccountLabel'),
    destination: payoutDestinationCopyFrom(t),
  };
}
