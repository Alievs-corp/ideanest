import { getTranslations } from 'next-intl/server';
import {
  type ConsoleChromeCopy,
  type NoteDialogCopy,
  consoleChromeCopyFrom,
  noteDialogCopyFrom,
} from './common-copy';
import { type CurationChromeCopy, curationChromeFrom } from './curation-copy';
import {
  contentReportQueueCopyFrom,
  moderationQueueCopyFrom,
  reportDetailCopyFrom,
  campaignDirectoryCopyFrom,
  campaignPreviewCopyFrom,
  submissionQueueCopyFrom,
  type ContentReportQueueCopy,
  type ModerationQueueCopy,
  type ReportDetailCopy,
  type CampaignDirectoryCopy,
  type CampaignPreviewCopy,
  type SubmissionQueueCopy,
} from './content-copy';
import {
  badgeManagerCopyFrom,
  collectionEditorCopyFrom,
  collectionManagerCopyFrom,
  openCallManagerCopyFrom,
  placementEditorCopyFrom,
  taxonomyManagerCopyFrom,
  type BadgeManagerCopy,
  type CollectionEditorCopy,
  type CollectionManagerCopy,
  type OpenCallManagerCopy,
  type PlacementEditorCopy,
  type TaxonomyManagerCopy,
} from './curation-copy';
import {
  disputeConsoleCopyFrom,
  feeEditorCopyFrom,
  ledgerExplorerCopyFrom,
  planManagerCopyFrom,
  revenueReportCopyFrom,
  paymentLogCopyFrom,
  payoutQueueCopyFrom,
  reconciliationCopyFrom,
  refundConsoleCopyFrom,
  type DisputeConsoleCopy,
  type FeeEditorCopy,
  type LedgerExplorerCopy,
  type PlanManagerCopy,
  type RevenueReportCopy,
  type PaymentLogCopy,
  type PayoutQueueCopy,
  type ReconciliationCopy,
  type RefundConsoleCopy,
} from './money-copy';
import {
  staffRolesCopyFrom,
  supportConsoleCopyFrom,
  type StaffRolesCopy,
  accountDetailCopyFrom,
  type AccountDetailCopy,
  type SupportConsoleCopy,
  type UserDirectoryCopy,
  userDirectoryCopyFrom,
} from './people-copy';
import {
  auditTrailCopyFrom,
  emailTemplateEditorCopyFrom,
  emailTemplateIndexCopyFrom,
  flagConsoleCopyFrom,
  healthDashboardCopyFrom,
  legalDocumentEditorCopyFrom,
  platformAnalyticsCopyFrom,
  type AuditTrailCopy,
  type EmailTemplateEditorCopy,
  type EmailTemplateIndexCopy,
  type FlagConsoleCopy,
  type HealthDashboardCopy,
  type LegalDocumentEditorCopy,
  type PlatformAnalyticsCopy,
} from './platform-copy';

/**
 * Where the console's screens get their words from — issue #324, epic #259.
 *
 * <h2>Its own file rather than more of `shell-copy.server.ts`</h2>
 *
 * That module resolves the copy for the shell and for the surfaces a member of the public
 * meets, and it is already the longest file in `lib/i18n`. The console adds a resolver per
 * screen to a list of about twenty, so putting them there would roughly double a file for a
 * surface that shares nothing with the rest of it except the mechanism.
 *
 * <h2>Every one of these is `async` and every one of them is called from a server</h2>
 *
 * `getTranslations` reads the request's catalogue, which exists only during a server render.
 * A screen calls its resolver in the route file and hands the result down as a prop — the
 * measurement that made a `NextIntlClientProvider` the wrong answer is in
 * `lib/i18n/shell-copy.ts`, and the console would have paid it on twenty-eight routes.
 *
 * <p>The chrome is resolved once per screen rather than once per request. next-intl caches the
 * catalogue for the render, so the repetition costs an object rather than a read.
 */
export async function consoleChrome(): Promise<ConsoleChromeCopy> {
  return consoleChromeCopyFrom(await getTranslations('admin'), await getTranslations('common'));
}

/**
 * The chrome plus the vocabulary every curation screen shares.
 *
 * A second layer rather than a field each of the six sets for itself — `curation-copy.ts`
 * records why: the kind, the publication state and the two move controls appear on all of
 * them, and six copies of that table is five chances for one to fall behind.
 */
export async function curationChrome(): Promise<CurationChromeCopy> {
  return curationChromeFrom(await getTranslations('admin'), await consoleChrome());
}

/** `NoteDialog`'s own words, for the curation screens that open it. */
export async function noteDialogCopy(): Promise<NoteDialogCopy> {
  return noteDialogCopyFrom(await getTranslations('admin'), await getTranslations('common'));
}

export async function auditTrailCopy(): Promise<AuditTrailCopy> {
  return auditTrailCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function healthDashboardCopy(): Promise<HealthDashboardCopy> {
  return healthDashboardCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function flagConsoleCopy(): Promise<FlagConsoleCopy> {
  return flagConsoleCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function platformAnalyticsCopy(): Promise<PlatformAnalyticsCopy> {
  return platformAnalyticsCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function emailTemplateIndexCopy(): Promise<EmailTemplateIndexCopy> {
  return emailTemplateIndexCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function emailTemplateEditorCopy(): Promise<EmailTemplateEditorCopy> {
  return emailTemplateEditorCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function legalDocumentEditorCopy(): Promise<LegalDocumentEditorCopy> {
  return legalDocumentEditorCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function collectionManagerCopy(): Promise<CollectionManagerCopy> {
  return collectionManagerCopyFrom(await getTranslations('admin'), await curationChrome());
}

export async function collectionEditorCopy(): Promise<CollectionEditorCopy> {
  return collectionEditorCopyFrom(await getTranslations('admin'), await curationChrome());
}

export async function badgeManagerCopy(): Promise<BadgeManagerCopy> {
  return badgeManagerCopyFrom(await getTranslations('admin'), await curationChrome());
}

export async function openCallManagerCopy(): Promise<OpenCallManagerCopy> {
  return openCallManagerCopyFrom(await getTranslations('admin'), await curationChrome());
}

export async function placementEditorCopy(): Promise<PlacementEditorCopy> {
  return placementEditorCopyFrom(await getTranslations('admin'), await curationChrome());
}

export async function taxonomyManagerCopy(): Promise<TaxonomyManagerCopy> {
  return taxonomyManagerCopyFrom(await getTranslations('admin'), await curationChrome());
}

export async function userDirectoryCopy(): Promise<UserDirectoryCopy> {
  return userDirectoryCopyFrom(await getTranslations('admin'), await consoleChrome());
}

/** AD-04's other screen: one account, its campaigns and its pledges — issue #404. */
export async function accountDetailCopy(): Promise<AccountDetailCopy> {
  return accountDetailCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function supportConsoleCopy(): Promise<SupportConsoleCopy> {
  return supportConsoleCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function staffRolesCopy(): Promise<StaffRolesCopy> {
  return staffRolesCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function paymentLogCopy(): Promise<PaymentLogCopy> {
  return paymentLogCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function ledgerExplorerCopy(): Promise<LedgerExplorerCopy> {
  return ledgerExplorerCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function reconciliationCopy(): Promise<ReconciliationCopy> {
  return reconciliationCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function payoutQueueCopy(): Promise<PayoutQueueCopy> {
  return payoutQueueCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function refundConsoleCopy(): Promise<RefundConsoleCopy> {
  return refundConsoleCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function disputeConsoleCopy(): Promise<DisputeConsoleCopy> {
  return disputeConsoleCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function feeEditorCopy(): Promise<FeeEditorCopy> {
  return feeEditorCopyFrom(await getTranslations('admin'), await consoleChrome());
}

/** AD-11's other screen: the plan catalogue and the payments waiting to be recorded. */
export async function planManagerCopy(): Promise<PlanManagerCopy> {
  return planManagerCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function revenueReportCopy(): Promise<RevenueReportCopy> {
  return revenueReportCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function moderationQueueCopy(): Promise<ModerationQueueCopy> {
  return moderationQueueCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function contentReportQueueCopy(): Promise<ContentReportQueueCopy> {
  return contentReportQueueCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function reportDetailCopy(): Promise<ReportDetailCopy> {
  return reportDetailCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function submissionQueueCopy(): Promise<SubmissionQueueCopy> {
  return submissionQueueCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function campaignDirectoryCopy(): Promise<CampaignDirectoryCopy> {
  return campaignDirectoryCopyFrom(await getTranslations('admin'), await consoleChrome());
}

export async function campaignPreviewCopy(): Promise<CampaignPreviewCopy> {
  return campaignPreviewCopyFrom(await getTranslations('admin'), await consoleChrome());
}
