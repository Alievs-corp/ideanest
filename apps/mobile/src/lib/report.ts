import { ApiError } from '@ideanest/api-client';
import {
  reportBody,
  reportPath,
  type ReportReason,
  type ReportTarget,
} from '@ideanest/campaign/report';
import { sendJson } from '../api/client';

/**
 * The report sheet's one write — §4.9's C-06 and C-07, #155.
 *
 * <p>The vocabulary (the nine reasons, which one needs a sentence, the 2000-character cap), the
 * path for each kind of target and the body are `@ideanest/campaign/report`'s, shared with the
 * web's `ReportControl`, so the two clients cannot send different requests for the same
 * complaint. What is the app's is only how the request travels: through `sendJson`, so it carries
 * the session's bearer and survives an expired access token by the same single refresh every
 * read does.
 */

/** `POST /v1/projects/{id}/report` or `POST /v1/comments/{id}/report`, with `{reason[, detail]}`. */
export async function submitReport(
  target: ReportTarget,
  reason: ReportReason,
  detail: string,
): Promise<void> {
  await sendJson('POST', reportPath(target), reportBody(reason, detail));
}

/** Which of the sheet's failure sentences a refusal is, or the service's own words. */
export type ReportFailure =
  | { readonly kind: 'detail'; readonly text: string }
  | { readonly kind: 'refused' }
  | { readonly kind: 'unreachable' };

/**
 * The web's `ReportControl` catch, as data: a refusal shows the service's `detail` (then `title`)
 * — it knows which of its rules refused the report, and a duplicate is not one of them, because a
 * second report on one thing is the same 202 — and `refused` when it sent neither. No answer at
 * all is `unreachable`.
 */
export function reportFailureOf(cause: unknown): ReportFailure {
  if (cause instanceof ApiError) {
    const text = cause.problem?.detail ?? cause.problem?.title;
    return text === undefined || text === '' ? { kind: 'refused' } : { kind: 'detail', text };
  }
  return { kind: 'unreachable' };
}
