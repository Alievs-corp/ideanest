import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { ProjectState } from '../projects/api';
import type { ReportReason } from '@ideanest/campaign/report';

/**
 * ONE MODULE, ONE PLACE for everything the moderation queue asks the service.
 *
 * The screen behind this reaches TWO controllers, and the split is not
 * cosmetic. `ReportQueueController` owns the complaint — the queue, and the two
 * terminal outcomes a moderator can record about it. `ProjectModerationController`
 * owns the campaign's state machine, and its three outcomes are what
 * docs/architecture.md §4.11 calls AD-01. Deciding a report deliberately does not
 * act on what was reported (AD-02's own note says so), so a moderator who agrees
 * with a complaint and a moderator who takes a campaign down are performing two
 * requests, and this module keeps them two functions.
 *
 * The campaign review queue is `GET /v1/admin/moderation/submissions`, added because
 * the three campaign outcomes had existed since #101 with nothing listing what they
 * apply to: a moderator could reach a submitted campaign only through a report somebody
 * had filed about it, so a campaign nobody complained about waited out of sight while
 * its creator was told it was under review.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/* -------------------------------------------------------------------------
 * The complaint — `/v1/admin/moderation/reports`
 * ---------------------------------------------------------------------- */

/**
 * `OPEN` is the queue. The other two are how a decision is looked up afterwards,
 * which is what makes them this screen's history rather than a second feature.
 */
export type ReportState = 'OPEN' | 'UPHELD' | 'DISMISSED';

export const REPORT_STATES: readonly ReportState[] = ['OPEN', 'UPHELD', 'DISMISSED'];

/**
 * All four are in the service's taxonomy and in V23's check constraint; three of
 * them have a route that can produce one. `PROJECT_UPDATE` does not — §10.2 gives
 * an update no report route, so that queue has no intake and #297 is the issue
 * that gives it one. It is enumerated anyway, because the endpoint accepts it and
 * answers with an empty page, and a client that crashes on a value the service
 * will one day return is worse than one that renders it.
 */
export type ReportTargetType = 'PROJECT' | 'PROJECT_UPDATE' | 'COMMENT' | 'USER';

/* §5.4's nine reasons are `@ideanest/campaign/report`'s since #155 — the app files them too. */
export type { ReportReason };

/** What was reported. No foreign key behind it, so the id may outlive the thing. */
export interface ReportTarget {
  type: ReportTargetType;
  id: string;
}

/**
 * Who decided it, when, and what they wrote — the audited record, read back
 * rather than reconstructed here.
 *
 * `moderatorId` is an account id and not a name. There is no endpoint that turns
 * one into a person, so this screen shows the identifier and says that is what
 * it is.
 */
export interface ReportResolution {
  moderatorId: string;
  /** ISO-8601 instant, UTC. */
  at: string;
  note?: string | null;
}

/**
 * A report as the queue shows it to staff.
 *
 * Optional fields are `?: T | null` because the service serialises with
 * `default-property-inclusion: non_null` — an absent note is absent from the
 * JSON rather than present and null.
 */
export interface QueuedReport {
  id: string;
  target: ReportTarget;
  /**
   * The queue's only triage signal. One complaint about a campaign and fourteen
   * are different situations, and the service says as much.
   */
  openReportsOnTarget: number;
  reporterId: string;
  reason: ReportReason;
  /** What the reporter wrote. Untrusted, so only ever rendered as text. */
  detail?: string | null;
  state: ReportState;
  /** ISO-8601 instant, UTC. */
  createdAt: string;
  /** Absent while the report is open — which is what the action row is rendered from. */
  resolution?: ReportResolution | null;
}

export interface ReportQueuePage {
  /** Echoed by the service so a stale response cannot be filed under the wrong filter. */
  state: ReportState;
  /**
   * Which kind of reported thing was asked for, echoed for the same reason, and absent
   * when the request asked for every kind.
   *
   * AD-09 draws the campaign queue and the profile queue from this one endpoint, so a
   * screen that filed the wrong response would be showing complaints about people under a
   * heading about campaigns.
   */
  target?: ReportTargetType | null;
  reports: QueuedReport[];
  /**
   * Absent on the last page. KEYSET, not an offset: a moderator working the
   * queue removes rows from it as they go, and an offset against a shifting set
   * skips reports. A short page is therefore not the end of the queue — only
   * the absence of this is.
   */
  nextCursor?: string | null;
}

/**
 * Under the service's default page (50) and well under its maximum (200).
 *
 * A triage screen is read top to bottom, and a first paint holding fifty cards
 * is fifty cards nobody has looked at yet.
 */
export const QUEUE_PAGE_SIZE = 25;

export interface QueueRequest {
  state: ReportState;
  /**
   * One kind of reported thing, or absent for every kind.
   *
   * A SERVER FILTER, and it has to be. Narrowing a loaded page in the browser would leave
   * a client holding a cursor that has already moved past the rows it dropped, with no way
   * to ask for them back: twenty-five reports of which two are about profiles is not a page
   * of two. `/admin/moderation/profiles` is the screen that needs it.
   */
  target?: ReportTargetType | null;
  /** The previous page's `nextCursor`. */
  after?: string | null;
  limit?: number;
  signal?: AbortSignal;
}

export function queueQuery(request: QueueRequest): string {
  const params = new URLSearchParams();
  params.set('state', request.state);
  params.set('limit', String(request.limit ?? QUEUE_PAGE_SIZE));
  if (request.target != null) params.set('target', request.target);
  if (request.after != null && request.after !== '') params.set('after', request.after);
  return params.toString();
}

/** One page of the queue, oldest first, for the state asked for. */
export async function listReports(request: QueueRequest): Promise<ReportQueuePage> {
  const response = await authorizedFetch(`/v1/admin/moderation/reports?${queueQuery(request)}`, {
    signal: request.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as ReportQueuePage;
}

/**
 * One report, for correcting a single card rather than reloading the queue.
 *
 * This is what a `409 REPORT_ALREADY_RESOLVED` is answered with: two moderators
 * with the same queue open is the ordinary way to reach that refusal, and the
 * honest response is to show what the other one decided.
 */
export async function getReport(id: string, signal?: AbortSignal): Promise<QueuedReport> {
  const response = await authorizedFetch(
    `/v1/admin/moderation/reports/${encodeURIComponent(id)}`,
    { signal },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as QueuedReport;
}

/** The service's verbs, spelled the way the path spells them. */
export type ReportOutcome = 'uphold' | 'dismiss';

/**
 * Records a judgement about the complaint. Terminal, and audited.
 *
 * The note is optional for both, because nothing in this release shows a
 * resolution note to the person who made the report — it is written for the next
 * moderator.
 */
export async function resolveReport(
  id: string,
  outcome: ReportOutcome,
  note: string | null,
  signal?: AbortSignal,
): Promise<QueuedReport> {
  const response = await authorizedFetch(
    `/v1/admin/moderation/reports/${encodeURIComponent(id)}/${outcome}`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ note }), signal },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as QueuedReport;
}

/* -------------------------------------------------------------------------
 * The campaign — `/v1/admin/moderation/{id}`
 * ---------------------------------------------------------------------- */

/** AD-01's three outcomes, spelled the way the paths spell them. */
export type CampaignOutcome = 'approve' | 'reject' | 'request-changes';

/**
 * Whether the service will refuse an outcome for want of a note.
 *
 * A rejection and a request for changes are shown to the creator and have to say
 * why; an approval need not. Checked here as well as in the service so that a
 * moderator is told before the request rather than by a 400 after it.
 */
export function requiresNote(outcome: CampaignOutcome): boolean {
  return outcome !== 'approve';
}

/**
 * What this screen reads out of the editor projection the three endpoints return.
 *
 * Narrower than `ProjectEdit` on purpose: a moderation queue has no business
 * holding a campaign's story document, and a type that named every field would
 * have to be kept in step with an editor this screen does not open.
 */
export interface CampaignDecision {
  id: string;
  slug: string;
  state: ProjectState;
  title: string;
}

/**
 * Moves the campaign's state machine. A separate privileged action from
 * deciding the report, and it does not touch the report at all.
 *
 * Refused with `409 PROJECT_TRANSITION_NOT_ALLOWED` when the campaign is not in
 * a state the outcome can be reached from — a report about a campaign that is
 * already live, for instance. The refusal carries the state it is actually in.
 */
export async function decideCampaign(
  projectId: string,
  outcome: CampaignOutcome,
  note: string | null,
  signal?: AbortSignal,
): Promise<CampaignDecision> {
  const response = await authorizedFetch(
    `/v1/admin/moderation/${encodeURIComponent(projectId)}/${outcome}`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ note }), signal },
  );
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as CampaignDecision;
}

/* -------------------------------------------------------------------------
 * The campaign review queue — `/v1/admin/moderation/submissions`
 * ---------------------------------------------------------------------- */

/**
 * The four states the queue serves.
 *
 * `SUBMITTED` is the queue itself; the other three are how a decision is looked up
 * afterwards, which is the same shape `ReportState` has and for the same reason. Asking
 * for any other campaign state is a `400 UNREVIEWABLE_STATE` rather than an empty page —
 * see the service, which argues why an empty answer there would read as a fact about the
 * platform.
 */
export type SubmissionState = 'SUBMITTED' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED';

export const SUBMISSION_STATES: readonly SubmissionState[] = [
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
];

/** One campaign waiting on a decision, or one that has had one. */
export interface QueuedSubmission {
  /** This row's keyset position, and what `after` takes to continue from here. */
  cursor: string;
  projectId: string;
  title: string;
  slug: string;
  state: ProjectState;
  /** When it entered this state. What the queue is sorted by, and what it is about. */
  waitingSince: string;
  /** Whatever was written on the transition into this state, or absent. */
  note?: string | null;
  creatorId: string;
  /**
   * Absent when the account has been anonymised since — §17.4 leaves the campaign behind.
   * The screen says so rather than rendering an empty name.
   */
  creatorName?: string | null;
  creatorSlug?: string | null;
  goal?: { amount: string; currency: string } | null;
}

export interface SubmissionQueuePage {
  state: SubmissionState;
  submissions: QueuedSubmission[];
  /** Absent at the end of the queue. A short page is the end. */
  nextCursor?: string | null;
}

/**
 * One page of campaigns awaiting a decision, oldest first.
 *
 * Keyset rather than offset, for the reason the report queue gives: a moderator working
 * the queue removes rows from it as they go, and an offset against a shifting set skips
 * the campaigns that have been waiting longest.
 */
export async function listSubmissions(options: {
  state: SubmissionState;
  after?: string | null;
  limit?: number;
  signal?: AbortSignal;
}): Promise<SubmissionQueuePage> {
  const query = new URLSearchParams({ state: options.state });
  if (options.after) query.set('after', options.after);
  if (options.limit !== undefined) query.set('limit', String(options.limit));

  const response = await authorizedFetch(`/v1/admin/moderation/submissions?${query}`, {
    signal: options.signal,
  });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as SubmissionQueuePage;
}
