import { authorizedFetch } from '../api/client';
import { errorFrom } from '../api/problem';
import type { Page } from '../community/signals';
import type { PledgeAmounts, PledgeState } from './api';

/**
 * The backer's own pledges, as a list — §4.5 PL-09 and PL-10, issue #287.
 *
 * <h2>Why this is a second module beside `./api.ts`</h2>
 *
 * `./api.ts` is the pledge *resource*: the draft, the confirm, the read, the edit, the cancel,
 * all keyed on one pledge, all speaking `PledgeResponse`. This is a different projection with
 * a different shape and a different audience — `GET /v1/me/pledges` answers with a summary
 * that carries the **campaign** beside each pledge and does not carry its add-ons, its
 * supplements or its shipping country. Folding it into the resource client would put two
 * unrelated wire types called "a pledge" in one file, and the first bug would be a screen
 * reading `amounts` off whichever one it happened to have.
 *
 * <h2>The list is the only place a pledge knows which campaign it is</h2>
 *
 * `PledgeResponse` carries a `projectId` and nothing else about the campaign — no title, no
 * slugs — and there is no public read keyed on a campaign id alone: `/v1/projects/{creatorSlug}/{projectSlug}`
 * needs two slugs, and `/v1/projects/{id}/prelaunch` answers only for a campaign that has not
 * launched. So the summary on this list is the one projection that can name a campaign a
 * backer has pledged to, and `findMyPledge` below is what the pledge page uses to get it.
 *
 * **That is a stopgap and is written down as one.** The proper fix is a campaign on
 * `PledgeResponse`, which is a service change this pull request does not make. What it costs
 * is bounded and explained at `findMyPledge`.
 */

/** The campaign a pledge belongs to, as the summary carries it. */
export interface BackerPledgeProject {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly creatorSlug: string;
  /** One of §6.1's states. Widened, so an unknown one from a newer service still renders. */
  readonly state: string;
  /** ISO-8601 instant, UTC, or null for a campaign with no deadline yet. */
  readonly deadline: string | null;
  readonly coverImage: { readonly url: string; readonly width: number; readonly height: number } | null;
}

/**
 * One of the caller's pledges, with enough of its campaign to be legible in a list.
 *
 * `rewardTitle` is on it and `rewardTierId` is too, which is not redundancy: the id is what a
 * request would name the tier by and the title is what a person reads. A list that carried
 * only the id would have to fetch every campaign's reward tiers to render a row, and a list
 * that carried only the title could not link to anything.
 *
 * **The amounts are here in full and that is correct**, unlike §4.2's public backed archive,
 * which carries none. This list is the caller's own pledges and nobody else's; P-04 is about
 * what a stranger may read on somebody's profile, not about what a backer may read about
 * their own money.
 */
export interface BackerPledgeSummary {
  readonly pledgeId: string;
  readonly state: PledgeState | string;
  readonly amounts: PledgeAmounts;
  readonly rewardTierId: string | null;
  /** Null for §4.5's PL-02 — support with no reward, which is a first-class choice. */
  readonly rewardTitle: string | null;
  readonly isAnonymous: boolean;
  /** §4.5's PL-16: money taken after the deadline, which §5.1's decision was not made from. */
  readonly latePledge: boolean;
  readonly confirmedAt: string | null;
  readonly canceledAt: string | null;
  readonly project: BackerPledgeProject;
}

/** How many rows a page asks for. The service clamps rather than refusing an over-large size. */
export const PLEDGE_PAGE_SIZE = 24;

interface RawPledgePage {
  readonly pledges?: readonly BackerPledgeSummary[];
  readonly nextCursor?: string | null;
}

/**
 * One page of the caller's pledges, newest first — `GET /v1/me/pledges`.
 *
 * `authorizedFetch`, because every row is somebody's own money. There is no public version of
 * this list and there must not be one: §4.5's PL-12 already keeps anonymous pledges off public
 * surfaces, and this list carries the ones that are not anonymous as well.
 */
export async function listMyPledges(
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<Page<BackerPledgeSummary>> {
  const query = new URLSearchParams({ limit: String(PLEDGE_PAGE_SIZE) });
  if (cursor !== null) query.set('cursor', cursor);

  const response = await authorizedFetch(`/v1/me/pledges?${query.toString()}`, { signal });
  if (!response.ok) throw await errorFrom(response);

  const body = (await response.json()) as RawPledgePage;
  return { items: body.pledges ?? [], nextCursor: body.nextCursor ?? null };
}

/**
 * How many pages `findMyPledge` will read before giving up.
 *
 * Three, so seventy-two pledges. The list is newest first and the overwhelming majority of
 * lookups are for a pledge somebody just made or is being reminded about, which is on the
 * first page; the bound exists so that a deep link to an old pledge held by a very active
 * backer costs three requests rather than forty.
 */
const LOOKUP_PAGE_LIMIT = 3;

/**
 * The summary for one pledge, found by walking the caller's own list.
 *
 * <h2>This is a stopgap, and the alternative was worse</h2>
 *
 * `GET /v1/pledges/{id}` is the authority on a pledge and says nothing about its campaign
 * beyond an identifier (see the module comment). The pledge page needs the campaign's **name**
 * because a backer editing money must be able to see which campaign it goes to. (It first
 * existed for PL-10's cancel confirmation, which IDN-EXT-01, #35, withdrew.)
 *
 * So the page asks the one endpoint that knows, and asks it the only way it can be asked.
 * The proper fix is a campaign projection on `PledgeResponse`; until then this is bounded, it
 * is honest about being bounded, and **`null` is not a failure** — the page renders the pledge
 * without a campaign heading and still names the reward and the amount.
 * Refusing to show a pledge because its campaign could not be named would be a worse answer
 * than showing it.
 *
 * A refusal from the list propagates rather than being swallowed: a 401 here is somebody
 * whose session ended, and the page has to know that rather than render a pledge with a
 * missing title.
 */
export async function findMyPledge(
  pledgeId: string,
  signal?: AbortSignal,
): Promise<BackerPledgeSummary | null> {
  let cursor: string | null = null;

  for (let page = 0; page < LOOKUP_PAGE_LIMIT; page += 1) {
    const answer: Page<BackerPledgeSummary> = await listMyPledges(cursor, signal);

    const found = answer.items.find((summary) => summary.pledgeId === pledgeId);
    if (found !== undefined) return found;

    if (answer.nextCursor === null) return null;
    cursor = answer.nextCursor;
  }

  return null;
}

/** The public address of the campaign a pledge was made to. */
export function pledgeCampaignHref(project: BackerPledgeProject): string {
  return `/projects/${encodeURIComponent(project.creatorSlug)}/${encodeURIComponent(project.slug)}`;
}

/** This application's address for one pledge. */
export function pledgeHref(pledgeId: string): string {
  return `/pledges/${encodeURIComponent(pledgeId)}`;
}

/**
 * The twelve states of §6.2 as words a backer can read.
 *
 * Stated here rather than imported from `components/campaign-editor/EditorShell`, which holds
 * the sixteen **campaign** states: they are two different machines that happen to share four
 * spellings, and one table for both would be a table somebody eventually adds a campaign state
 * to and breaks a pledge screen with.
 *
 * The wording is the backer's rather than the schema's. `CANCELED_BY_PROJECT` is not a thing
 * anybody did to themselves, and "Cancelled by the creator" is what actually happened.
 */
export const PLEDGE_STATE_LABEL: Record<string, string> = {
  DRAFT: 'Not finished',
  CONFIRMED: 'Confirmed',
  EXPIRED: 'Expired',
  CANCELED_BY_BACKER: 'Cancelled by you',
  CANCELED_BY_PROJECT: 'Cancelled by the creator',
  CHARGE_PENDING: 'Payment in progress',
  CHARGE_FAILED: 'Payment failed',
  COLLECTED: 'Paid',
  DROPPED: 'Dropped',
  REFUNDED: 'Refunded',
  CHARGEBACK: 'Charged back',
  FULFILLED: 'Delivered',
};

/** A state this build has never heard of reads as itself rather than as an empty label. */
export function pledgeStateLabel(state: string): string {
  return PLEDGE_STATE_LABEL[state] ?? state;
}
