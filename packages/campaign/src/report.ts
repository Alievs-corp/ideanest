/**
 * §4.9's C-06 and C-07 — the reporter's vocabulary, and the request a report becomes.
 *
 * <h2>Shared since #155, and what stays behind</h2>
 *
 * The web's Report dialog and the app's report sheet offer the same nine reasons in the same
 * order, require a sentence for the same one, cap it at the same length and send the same body
 * to the same three paths. All of that moved here from `apps/web/src/lib/moderation/report.ts`,
 * which re-exports it under the same names. Sending the request — `authorizedFetch` on the web,
 * the typed client in the app — and the words, which are the catalogue's
 * (`moderation.report.*`, `admin.moderation.reason.*`), stay with each client.
 *
 * <h2>Three targets, one budget</h2>
 *
 * `ContentReportController` publishes `/projects/{id}/report`, `/users/{slug}/report` and
 * `/comments/{id}/report` on one controller sharing one rate limit, and says why: separate
 * counters would let somebody who had spent their allowance on campaigns spend a second one
 * on people. {@link reportPath} mirrors that — one function over a target type, so a fourth
 * surface cannot arrive spelling its path its own way.
 *
 * <h2>A second report on one thing is not a second report</h2>
 *
 * V23 carries a partial unique index, so reporting the same target twice returns the report
 * already on file. Both are 202. Neither client pretends the second one added weight.
 */

/** §5.4's taxonomy — the nine reasons a reporter chooses from and the queue reads back. */
export type ReportReason =
  | 'PROHIBITED_ITEM'
  | 'MISREPRESENTATION'
  | 'NOT_ORIGINAL'
  | 'INTELLECTUAL_PROPERTY'
  | 'OFFENSIVE'
  | 'DISCRIMINATION'
  | 'SPAM'
  | 'FRAUD'
  | 'OTHER';

/**
 * What is being reported.
 *
 * An account is named by its public **slug**, not an id (#143): the public profile carries
 * the slug and deliberately no identifier, and the follow route beside it is keyed the same
 * way. The field is called `slug` so an id cannot be passed where a slug belongs.
 */
export type ReportTarget =
  | { readonly kind: 'campaign'; readonly id: string }
  | { readonly kind: 'account'; readonly slug: string }
  | { readonly kind: 'comment'; readonly id: string };

/** The path each target reports to. One place, so a fourth cannot be spelled two ways. */
export function reportPath(target: ReportTarget): string {
  switch (target.kind) {
    case 'campaign':
      return `/v1/projects/${encodeURIComponent(target.id)}/report`;
    case 'account':
      return `/v1/users/${encodeURIComponent(target.slug)}/report`;
    case 'comment':
      return `/v1/comments/${encodeURIComponent(target.id)}/report`;
  }
}

/**
 * The reasons, in the order they are offered.
 *
 * `OTHER` is last because a list that opens with it is a list nobody reads to the end of, and
 * a queue of `OTHER` is a queue with no shape. The rest follow §5.4's own order.
 */
export const REPORT_REASONS: readonly ReportReason[] = Object.freeze([
  'PROHIBITED_ITEM',
  'MISREPRESENTATION',
  'NOT_ORIGINAL',
  'INTELLECTUAL_PROPERTY',
  'OFFENSIVE',
  'DISCRIMINATION',
  'SPAM',
  'FRAUD',
  'OTHER',
]);

/** §5.4's `OTHER` is the one reason a moderator cannot act on without a sentence. */
export function requiresDetail(reason: ReportReason): boolean {
  return reason === 'OTHER';
}

/** `ContentReport.DETAIL_MAX_LENGTH`, and the service refuses anything longer. */
export const DETAIL_MAX_LENGTH = 2000;

/** What `POST …/report` is sent. */
export interface ReportBody {
  readonly reason: ReportReason;
  readonly detail?: string;
}

/**
 * The request body for a report: the reason, and the detail only when there is one.
 *
 * <p>The detail is trimmed, and an empty one is <strong>omitted rather than sent as
 * `""`</strong>. The service stores what it is given, and a moderator reading a queue of empty
 * strings cannot tell "the reporter had nothing to add" from "the client dropped what they
 * typed". Absent says the first unambiguously.
 */
export function reportBody(reason: ReportReason, detail: string): ReportBody {
  const trimmed = detail.trim();
  return trimmed === '' ? { reason } : { reason, detail: trimmed };
}

/** The 202's body. The report is not addressable by the person who made it. */
export interface SubmittedReport {
  readonly id: string;
  readonly target: { readonly type: string; readonly id: string };
  readonly reason: string;
  readonly state: string;
  readonly createdAt: string;
}
