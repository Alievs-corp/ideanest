import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { ReportReason } from './api';

/**
 * §4.9's C-06 and C-07 — how somebody tells the platform that something is wrong.
 *
 * <h2>Separate from `./api.ts`, and it is not an accident</h2>
 *
 * That module is the moderator's side: the queue, and the decisions taken on it. This one is
 * the reporter's, and the only thing they share is the vocabulary. Keeping them apart is what
 * stops a public surface importing the admin reads — every route that ships a Report control
 * would otherwise pull the queue's types and its client into its first load.
 *
 * <h2>Three targets, one budget, one function</h2>
 *
 * `ContentReportController` publishes `/projects/{id}/report`, `/users/{id}/report` and
 * `/comments/{id}/report` on one controller sharing one rate limit, and says why: separate
 * counters would let somebody who had spent their allowance on campaigns spend a second one
 * on people. This mirrors that — one function over a target type, so a fourth surface cannot
 * arrive with its own error handling.
 *
 * <h2>Reporting needs an account, and that is the mechanism rather than friction</h2>
 *
 * All three endpoints fall through to the catch-all rule and require a bearer token. The
 * controller's own note: the duplicate suppression this feature is built on is unstateable
 * without an identity to compare. So the control is offered to a signed-in reader and a
 * sign-in prompt to everybody else — never a form that collects a complaint and then loses it.
 *
 * <h2>A second report on one thing is not a second report</h2>
 *
 * V23 carries a partial unique index, so reporting the same target twice returns the report
 * already on file. Both are 202. The screen says "we have this" either way and does not
 * pretend the second one added weight.
 */

export type ReportTarget =
  | { readonly kind: 'campaign'; readonly id: string }
  | { readonly kind: 'account'; readonly id: string }
  | { readonly kind: 'comment'; readonly id: string };

/** The path each target reports to. One place, so a fourth cannot be spelled two ways. */
const PATHS: Readonly<Record<ReportTarget['kind'], (id: string) => string>> = {
  campaign: (id) => `/v1/projects/${encodeURIComponent(id)}/report`,
  account: (id) => `/v1/users/${encodeURIComponent(id)}/report`,
  comment: (id) => `/v1/comments/${encodeURIComponent(id)}/report`,
};

/*
 * `TARGET_NOUNS` WAS HERE. It was three English nouns the dialog dropped into "Report this
 * ___", which is a sentence only English builds that way: Russian declines the noun after
 * the preposition and agrees the demonstrative with its gender. #85 replaced it with three
 * whole phrases per language under `moderation.report.triggerOn`, keyed by the same three
 * kinds — the shape `admin/content-copy.ts` had already reached for the queue.
 */

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

/*
 * `REASON_DESCRIPTIONS` WAS HERE — a sentence per reason, for the person choosing one, since
 * "Not original work" is self-explanatory to a moderator who knows §5.4's taxonomy and to
 * nobody else. The nine sentences are `moderation.report.descriptions` in four languages
 * since #85. One of them states a protected-characteristic clause, which is why they are
 * translated rather than transliterated.
 */

/** §5.4's `OTHER` is the one reason a moderator cannot act on without a sentence. */
export function requiresDetail(reason: ReportReason): boolean {
  return reason === 'OTHER';
}

/** `ContentReport.DETAIL_MAX_LENGTH`, and the service refuses anything longer. */
export const DETAIL_MAX_LENGTH = 2000;

export interface SubmittedReport {
  readonly id: string;
  readonly target: { readonly type: string; readonly id: string };
  readonly reason: string;
  readonly state: string;
  readonly createdAt: string;
}

/**
 * Files a report — 202, and nothing to go and read afterwards.
 *
 * The report is deliberately not addressable by the person who made it, which is why the
 * dialog closes on an acknowledgement rather than linking anywhere.
 */
export async function submitReport(
  target: ReportTarget,
  reason: ReportReason,
  detail: string,
): Promise<SubmittedReport> {
  const trimmed = detail.trim();

  const response = await authorizedFetch(PATHS[target.kind](target.id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason, ...(trimmed === '' ? {} : { detail: trimmed }) }),
  });

  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as SubmittedReport;
}
