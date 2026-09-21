import type { ReportReason } from '../moderation/api';
import type { ReportTarget } from '../moderation/report';

/**
 * Every word the public report dialog draws — issue #85, under epic #78.
 *
 * <h2>This is the one surface in the epic a stranger can reach</h2>
 *
 * `ReportControl` is mounted on the campaign page and under every comment, and neither
 * requires a session to be seen. Everything else #78 lists is behind a sign-in, where a
 * reader has at least chosen a language once. Here they may never have.
 *
 * <h2>The nine reasons come from `admin.moderation.reason`, and that is the point</h2>
 *
 * `lib/moderation/describe.ts` used to export `REASON_LABELS` — the same nine words the
 * console already had in four languages — and `lib/i18n/wording.test.ts` existed to assert
 * that the two agreed. The duplication was held still by a test because it could not be
 * removed while this dialog was English: the console's keys were translated and this
 * surface's constant was not.
 *
 * <p>Translating the dialog is what dissolves it. There is now one table of nine reasons, in
 * the catalogue, read by a moderator triaging a queue and by the person filing the complaint.
 * The constant is gone and so is the test that pinned it, which is why this child of #78
 * removes more code than it adds.
 *
 * <p>The namespace stays `admin.moderation.reason` rather than moving somewhere neutral: it
 * is where the console's own copy lives, moving it would rewrite the twenty-six screens'
 * accessor for a rename, and a key path is not a permission. What a reporter needs that a
 * moderator does not — a sentence under each reason explaining what it covers — is here
 * under `moderation.report.descriptions`, because "Not original work" is self-explanatory to
 * somebody who knows §5.4's taxonomy and to nobody else.
 *
 * <h2>Three targets, three whole sentences, never a noun in a slot</h2>
 *
 * The dialog says "Report this campaign" and "Nothing about the comment changes because of
 * it". Building those from one template and a noun works in English and breaks everywhere
 * else: Russian declines the noun after a preposition and agrees the demonstrative with its
 * gender, so "this" has three spellings before the noun is chosen. `admin/content-copy.ts`
 * reached the same conclusion for the queue's target phrases; these are keyed by target kind
 * for the same reason.
 */

/** A message lookup over a namespace, narrowed to what this builder needs. */
export interface ReportTranslator {
  (key: string): string;
  raw(key: string): unknown;
}

/** One phrase per target kind — `campaign`, `account`, `comment`. */
export type PerTarget = Readonly<Record<ReportTarget['kind'], string>>;

/** §4.9's C-06 and C-07 — the dialog a member of the public files a complaint in. */
export interface ReportControlCopy {
  /** The standalone button's label, where the control is not a link in a meta row. */
  readonly trigger: string;
  /** The link's label and the dialog's heading: "Report this campaign". */
  readonly triggerOn: PerTarget;
  /** The dialog's accessible name. Carries `{name}`. */
  readonly dialogLabel: string;
  /** What a comment is called when it is the thing being reported. Carries `{title}`. */
  readonly commentOn: string;
  /** Why a complaint needs an account, said before a form is offered rather than after. */
  readonly signedOutBody: string;
  readonly signIn: string;
  readonly cancel: string;
  readonly filedTitle: string;
  /**
   * The acknowledgement, which says the platform has the complaint and nothing more.
   *
   * It must not claim anything happened to the target. A report is a request for a person to
   * look, and a dialog that implied otherwise would invite five accounts to try removing a
   * campaign between them.
   */
  readonly filedBody: PerTarget;
  readonly close: string;
  readonly errorTitle: string;
  readonly refused: string;
  readonly unreachable: string;
  /** §5.4's `OTHER` is the one reason a moderator cannot act on without a sentence. */
  readonly detailRequired: string;
  readonly reasonLabel: string;
  readonly detailLabel: string;
  readonly detailHint: string;
  readonly sending: string;
  readonly submit: string;
  /** The nine reasons as the console names them. */
  readonly reasons: Readonly<Record<ReportReason, string>>;
  /** The nine reasons said in full, for somebody who does not know the taxonomy. */
  readonly descriptions: Readonly<Record<ReportReason, string>>;
}

export function reportControlCopyFrom(
  t: ReportTranslator,
  moderation: ReportTranslator,
  common: ReportTranslator,
): ReportControlCopy {
  return {
    trigger: t('trigger'),
    triggerOn: t.raw('triggerOn') as PerTarget,
    dialogLabel: String(t.raw('dialogLabel')),
    commentOn: String(t.raw('commentOn')),
    signedOutBody: t('signedOutBody'),
    signIn: t('signIn'),
    cancel: common('cancel'),
    filedTitle: t('filedTitle'),
    filedBody: t.raw('filedBody') as PerTarget,
    close: t('close'),
    errorTitle: t('errorTitle'),
    refused: t('refused'),
    unreachable: t('unreachable'),
    detailRequired: t('detailRequired'),
    reasonLabel: t('reasonLabel'),
    detailLabel: t('detailLabel'),
    detailHint: t('detailHint'),
    sending: t('sending'),
    submit: t('submit'),
    /*
     * Read whole rather than key by key. The nine are the service's enumeration, and a list
     * spelled out here would be a fourth copy of it — after `ReportReason`, `REPORT_REASONS`
     * and the catalogue itself — to fall out of step the day §5.4 gains a tenth.
     */
    reasons: moderation.raw('reason') as Readonly<Record<ReportReason, string>>,
    descriptions: t.raw('descriptions') as Readonly<Record<ReportReason, string>>,
  };
}
