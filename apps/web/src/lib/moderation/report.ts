import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import {
  reportBody,
  reportPath,
  type ReportReason,
  type ReportTarget,
  type SubmittedReport,
} from '@ideanest/campaign/report';

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
 * <h2>The vocabulary is shared</h2>
 *
 * The reasons, `requiresDetail`, `DETAIL_MAX_LENGTH`, the target type, the paths and the body
 * are `@ideanest/campaign/report` since #155, so the app's report sheet files exactly what this
 * dialog files. They are re-exported below under the same names; sending is this file's.
 *
 * <h2>Three targets, one budget, one function</h2>
 *
 * `ContentReportController` publishes `/projects/{id}/report`, `/users/{slug}/report` and
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

export {
  DETAIL_MAX_LENGTH,
  REPORT_REASONS,
  requiresDetail,
  type ReportTarget,
  type SubmittedReport,
} from '@ideanest/campaign/report';

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
  const response = await authorizedFetch(reportPath(target), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(reportBody(reason, detail)),
  });

  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as SubmittedReport;
}
