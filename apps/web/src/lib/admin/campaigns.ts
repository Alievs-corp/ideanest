import type { components } from '@ideanest/api-client';
import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { ProjectState } from '../projects/api';
import { readCampaignFields, type CampaignPage } from '../projects/publicPage';

/**
 * §4.11's campaign directory: what campaigns exist — issue #387.
 *
 * <h2>Why the console needed one</h2>
 *
 * <p>Three screens could reach a campaign and all three start from something the
 * campaign did: a report somebody filed about it, the submission queue it entered by
 * being submitted, and a suspension that takes an identifier a member of staff already
 * had. A campaign that is simply a draft, or simply live, or that was approved a week
 * ago and has been sitting unlaunched since, was in none of them — and the only way to
 * look one up was a psql session.
 *
 * <h2>Not the submission queue with the filter widened</h2>
 *
 * <p>`/v1/admin/moderation/submissions` is a queue: oldest first, keyed on the
 * transition that put each campaign in its state, and refusing any state that is not
 * one a moderator decides. This is a directory: newest first, every state, and the
 * funding figures rather than the last moderator's note. `CampaignDirectory` on the
 * service side carries the argument at length.
 */

/** What one request reads. The service clamps anything larger. */
export const DIRECTORY_PAGE_SIZE = 25;

/**
 * The states this screen offers as filters, in the order a campaign passes through them.
 *
 * <p>§6.1's whole enum, because the question this screen answers is "what is there" and
 * any state is a legitimate answer to it. A shorter list would be this module deciding
 * which parts of the platform staff are allowed to look at.
 */
export const DIRECTORY_STATES: readonly ProjectState[] = [
  'DRAFT',
  'PRELAUNCH',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'SCHEDULED',
  'LIVE',
  'CLOSING_WINDOW',
  'EXTENDED',
  'COLLECTING',
  'LATE_PLEDGE',
  'SUCCESSFUL',
  'WITHDRAWN',
  'UNSUCCESSFUL',
  'FULFILLING',
  'COMPLETED',
  'REJECTED',
  'SUSPENDED',
  'CANCELED',
];

/** One campaign, as the directory lists it. */
export interface DirectoryCampaign {
  /** Also this row's keyset position: `after` takes it to continue from here. */
  projectId: string;
  title: string;
  slug: string;
  state: ProjectState;
  /** When the creator started it. What this list is ordered by. */
  createdAt: string;
  /** Absent for everything that has never been live. */
  launchedAt?: string | null;
  /** Absent until it launches, and frozen from that moment. */
  deadline?: string | null;
  /** Absent on a draft that has not said what it needs yet. */
  goal?: { amount: string; currency: string } | null;
  /** Always present: a campaign that has raised nothing has raised zero. */
  pledged: { amount: string; currency: string };
  backersCount: number;
  creatorId: string;
  /**
   * Absent when the account has been anonymised since — §17.4 leaves the campaign
   * behind. The screen says so rather than rendering an empty name.
   */
  creatorName?: string | null;
  creatorSlug?: string | null;
}

export interface CampaignDirectoryPage {
  /** The filter this page was read with, or absent for every campaign. */
  state?: ProjectState | null;
  /** Whose campaigns were asked for, or absent for everybody's — issue #404. */
  creatorId?: string | null;
  /**
   * The search this page was read with, trimmed, or absent when there was none.
   *
   * <p>Echoed so a screen with two requests in flight can tell which answer it is looking
   * at. A search box typed into twice has two reads outstanding, and the older one
   * arriving second would otherwise leave the list disagreeing with the box above it.
   */
  query?: string | null;
  campaigns: readonly DirectoryCampaign[];
  /** Absent at the end of the list. A full page is the only signal there may be more. */
  nextCursor?: string | null;
}

/**
 * One page of the directory, newest first.
 *
 * <p>Every filter reaches the service rather than narrowing a loaded page, which is the
 * rule the report queue states: twenty-five campaigns of which two are drafts is not a
 * page of two, and a client that dropped rows locally would hold a cursor that has
 * already moved past them.
 *
 * <p><strong>`query` is #404's search, and until it existed this screen had no input of any
 * kind</strong> — sixteen status chips and "load more", on the one screen that lists
 * campaigns in every state. It matches the title, the campaign's path, the creator's name
 * and path, or an identifier when the term is one; `CampaignDirectoryRows` on the service
 * side records what each of those costs.
 *
 * <p>`creatorId` is the same endpoint answering "what has this person created", which is
 * what the account detail screen reads. It combines with the other two rather than
 * replacing them.
 */
export async function listCampaigns(options: {
  state?: ProjectState | null;
  creatorId?: string | null;
  query?: string | null;
  after?: string | null;
  limit?: number;
  signal?: AbortSignal;
}): Promise<CampaignDirectoryPage> {
  const query = new URLSearchParams();
  if (options.state != null) query.set('state', options.state);
  if (options.creatorId != null && options.creatorId !== '')
    query.set('creatorId', options.creatorId);
  // Blank is no search rather than a search for nothing, matching the service: a cleared
  // box behaves like a fresh one instead of asking for every campaign the slow way.
  if (options.query != null && options.query.trim() !== '')
    query.set('query', options.query.trim());
  if (options.after != null && options.after !== '') query.set('after', options.after);
  query.set('limit', String(options.limit ?? DIRECTORY_PAGE_SIZE));

  const response = await authorizedFetch(`/v1/admin/projects?${query}`, { signal: options.signal });
  if (!response.ok) throw await errorFrom(response);

  return (await response.json()) as CampaignDirectoryPage;
}

/**
 * One campaign, as its page reads, in whatever state it is in — issue #399.
 *
 * <h2>The link the submission queue was missing</h2>
 *
 * <p>That queue asks a moderator to approve, reject or send back a campaign, and the only
 * link on each card pointed at the public page. A campaign in review is not public — that
 * is what being in review means — so the link answered 404 by construction, and approval
 * happened on a title, a creator's name and a goal figure. Everything the creator actually
 * wrote was one screen away and unreachable.
 *
 * <h2>The same projection the public page is served from</h2>
 *
 * <p>`GET /v1/admin/projects/{id}` returns `ProjectPageResponse`, unchanged, without the
 * state filter that makes the public endpoint public. A moderator decides whether a
 * campaign may be published, so what they are shown has to be what publishing it would
 * show; a narrower preview would be a second description of the campaign, and the decision
 * would be taken against the description.
 *
 * <p>Narrowed by {@link readCampaignFields} rather than by `readCampaignPage`, which is the
 * one difference and is the whole reason that function exists — see it for why the public
 * reader's state check is not a parameter.
 *
 * @returns the campaign, or `null` when the response is missing something every campaign
 *     has. The screen renders that as "this could not be read" rather than as a page with
 *     holes in it: a half-built preview is a decision taken against a page that is not there
 */
export async function readCampaignPreview(
  projectId: string,
  signal?: AbortSignal,
): Promise<CampaignPage | null> {
  const response = await authorizedFetch(`/v1/admin/projects/${encodeURIComponent(projectId)}`, {
    signal,
  });
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as components['schemas']['ProjectPageResponse'];

  /*
   * The creator's slug comes from the body rather than from the caller. The public page is
   * addressed by the pair of slugs in its URL, so `readCampaignPage` takes the creator's
   * half as an argument; this screen is addressed by identifier and has no such half until
   * the response arrives.
   */
  return readCampaignFields(body, body.creator?.slug ?? '');
}
