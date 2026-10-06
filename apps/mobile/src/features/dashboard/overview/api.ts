import { ApiError, type components } from '@ideanest/api-client';
import { clockSkewMs } from '@ideanest/dashboard/clock';
import { api, sendJson } from '../../../api/client';

/**
 * The Overview's reads and its two writes — the web's `lib/dashboard/api.ts` `getDashboard` and
 * `lib/projects/api.ts` `extendProject` / `withdrawProject` (#163).
 */

export type CampaignDashboard = components['schemas']['DashboardResponse'];

/** The dashboard, with the reader's clock skew measured once, when it arrived. */
export interface OverviewRead {
  readonly dashboard: CampaignDashboard;
  /** Milliseconds this phone's clock is ahead of the service's. */
  readonly skewMs: number;
  /** When it arrived, by this phone's clock — the "As of" of a cached copy. */
  readonly receivedAt: number;
}

export async function readOverview(
  projectId: string,
  signal?: AbortSignal,
  now: () => number = Date.now,
): Promise<OverviewRead> {
  const dashboard = await api().get('/v1/projects/{id}/dashboard', {
    path: { id: projectId },
    ...(signal === undefined ? {} : { signal }),
  });
  const receivedAt = now();
  return {
    dashboard,
    skewMs: dashboard.serverTime ? clockSkewMs(dashboard.serverTime, receivedAt) : 0,
    receivedAt,
  };
}

/**
 * How long a write waits for an answer before it is treated as one that may or may not have
 * happened. A request still in flight past this is not cancelled, and its answer is still
 * waited for ({@link UnansweredWrite#answer}).
 */
export const WRITE_TIMEOUT_MS = 20_000;

/**
 * How much longer, past {@link WRITE_TIMEOUT_MS}, a late answer is waited for. React Native's
 * fetch has no timeout of its own on Android, so a request can hang for ever; past this the
 * screen re-reads the campaign and says it could not confirm the outcome.
 */
export const LATE_ANSWER_MS = 100_000;

/** How a write's request finally came back. */
export type WriteAnswer = { readonly ok: true } | { readonly ok: false; readonly cause: unknown };

/** A write that went out and got no answer in time, so whether it happened is not known yet. */
export class UnansweredWrite extends Error {
  /** The request itself, still running: settles when it is answered or fails. */
  readonly answer: Promise<WriteAnswer>;

  constructor(answer: Promise<WriteAnswer>) {
    super('The service did not answer in time.');
    this.name = 'UnansweredWrite';
    this.answer = answer;
  }
}

/** The request, or an {@link UnansweredWrite} carrying it once `timeoutMs` has passed. */
export function withinTimeout<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
  const answer = request.then<WriteAnswer, WriteAnswer>(
    () => ({ ok: true }),
    (cause: unknown) => ({ ok: false, cause }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UnansweredWrite(answer)), timeoutMs);
  });
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}

/** A timed-out write's answer once it comes, or null when it has not come within `waitMs`. */
export function lateAnswer(write: UnansweredWrite, waitMs: number = LATE_ANSWER_MS): Promise<WriteAnswer | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
  });
  return Promise.race([write.answer, cap]).finally(() => clearTimeout(timer));
}

/** `POST /v1/projects/{id}/extension {until}`: the deadline moves, once. */
export async function extendCampaign(projectId: string, until: string, timeoutMs = WRITE_TIMEOUT_MS): Promise<void> {
  await withinTimeout(
    sendJson('POST', `/v1/projects/${encodeURIComponent(projectId)}/extension`, { until }),
    timeoutMs,
  );
}

/**
 * `POST /v1/projects/{id}/withdrawal`, no body. No `Idempotency-Key` either: it is a one-way state
 * transition, and a repeat is refused with `409 WITHDRAWAL_NOT_AVAILABLE`.
 */
export async function withdrawCampaign(projectId: string, timeoutMs = WRITE_TIMEOUT_MS): Promise<void> {
  await withinTimeout(
    sendJson('POST', `/v1/projects/${encodeURIComponent(projectId)}/withdrawal`),
    timeoutMs,
  );
}

/**
 * Whether a failed write may still have happened: no answer at all (a timeout, a dropped
 * connection), or a gateway that gave up waiting on the service. A refusal the service worded
 * did not happen.
 */
export function isAmbiguous(cause: unknown): boolean {
  if (!(cause instanceof ApiError)) return true;
  return cause.status === 408 || cause.status === 502 || cause.status === 504;
}
