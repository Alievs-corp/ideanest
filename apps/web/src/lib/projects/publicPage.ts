import Decimal from 'decimal.js';
import type { ProjectPageResponse, PublicRewardListResponse } from '../api/server';
import type { Money } from '../money';
import { completionOf } from './completion';
import type { PublicProjectPreview } from '../seo/metadata';
import type { PublicRewardTier } from '../seo/structured-data/product';
import type { ProjectState } from './api';
import { readStoryDocument, type StoryDocument } from './story';

/**
 * The campaign page's view model — what §4.4's page actually renders.
 *
 * <h2>Why the generated type is not rendered directly</h2>
 *
 * `ProjectPageResponse` comes from the published contract, and every property on it is
 * optional: springdoc marks a field required only when it can prove it, and the service's
 * response records are plain Java records whose components are frequently nullable by
 * design. That is honest and it is not renderable — a page written against it would narrow
 * `title`, `slug`, `state` and fourteen others at every use, and the first component to
 * skip a check would print `undefined` into somebody's campaign.
 *
 * So the narrowing happens once, here, and produces a shape where the things a campaign
 * always has are not optional and the things it may genuinely lack are `null`. A response
 * missing one of the former is `null` overall rather than a partially built page — see
 * {@link readCampaignPage}.
 *
 * <h2>What is derived and what is read</h2>
 *
 * Nothing here invents a fact about a campaign. The two derived values — the completion
 * percentage and the days remaining — are arithmetic over fields the service sent, and both
 * are computed here rather than in a component so that the page and its structured data
 * cannot come to two answers about how funded a campaign is.
 *
 * **The percentage is a `Decimal`, never a number.** It is a ratio of two money values, and
 * §10.3's rule is about exactly this: the moment it becomes an IEEE 754 double it is a
 * percentage nobody can reproduce. `ProjectCard` reads the server's own `completionPercent`
 * the same way; this endpoint does not send one, so it is computed with the same library.
 */

/**
 * The states that have a campaign page — `PublicProjects.VISIBLE`, restated.
 *
 * <strong>This is deliberately NOT `isPubliclyVisible`, and the difference is not a
 * mistake in either of them.</strong> They answer two different questions and disagree
 * about exactly two states:
 *
 * <ul>
 *   <li><strong>`CANCELED` has a page and must not be described.</strong> Backers
 *       committed money to it and are owed the page that explains what happened;
 *       `isPubliclyVisible` refuses it because a social card is a presentation of a
 *       campaign to back, and this is not one.
 *   <li><strong>`SCHEDULED` is described and has no page here.</strong> Its public surface
 *       is the pre-launch route, which the service serves from a different endpoint; the
 *       campaign page 404s for it, because there is no campaign yet.
 * </ul>
 *
 * Two independent statements of one rule, checked against each other in a test, is the
 * arrangement the service already uses for the same list — `PublicProjects` and
 * `DiscoveryStatus` each write the nine down rather than deriving one from the other. The
 * alternative here is no statement at all, which would mean trusting a single service-side
 * check to be the only thing standing between a draft and the HTML.
 */
export const RENDERABLE_STATES: readonly ProjectState[] = [
  'PRELAUNCH',
  'LIVE',
  'CANCELED',
  'SUCCESSFUL',
  'UNSUCCESSFUL',
  'COLLECTING',
  'LATE_PLEDGE',
  'FULFILLING',
  'COMPLETED',
  // IDN-EXT-01 (#32): public like their siblings — two still take pledges, and a withdrawn
  // campaign is a successful one that owes its backers every reward.
  'CLOSING_WINDOW',
  'EXTENDED',
  'WITHDRAWN',
];

export interface CampaignCreator {
  readonly slug: string;
  readonly name: string;
  readonly avatarUrl: string | null;
}

/** A category or subcategory, already named in the reader's language by the service. */
export interface CampaignTaxon {
  readonly slug: string;
  readonly name: string;
}

/**
 * §5.1's decision and the numbers that produced it.
 *
 * Present only once the deadline has passed. It is deliberately not merged into
 * {@link CampaignPage.pledged}: V29's whole argument is that the live total keeps moving as
 * collections fail, so a closed campaign's page shows both — what it raised when it closed,
 * beside what has been collected since.
 */
export interface CampaignOutcome {
  readonly goal: Money | null;
  readonly pledged: Money | null;
  readonly backersCount: number;
  readonly finalisedAt: string;
}

export interface CampaignPage {
  readonly id: string;
  readonly slug: string;
  readonly creatorSlug: string;
  readonly state: ProjectState;
  readonly title: string;
  readonly blurb: string | null;
  readonly creator: CampaignCreator;
  readonly category: CampaignTaxon | null;
  readonly subcategory: CampaignTaxon | null;
  readonly coverImage: { readonly url: string; readonly width: number; readonly height: number } | null;
  /** Absent on a pre-launch page — the one public state a campaign reaches before §5.3. */
  readonly goal: Money | null;
  readonly pledged: Money;
  readonly backersCount: number;
  readonly launchedAt: string | null;
  readonly deadline: string | null;
  /** The creator's document, validated by the same reader the editor uses. */
  readonly story: StoryDocument | null;
  readonly risks: string | null;
  readonly outcome: CampaignOutcome | null;
  /** `pledged / goal`, to two places, or `null` when there is no goal to be a share of. */
  readonly completionPercent: Decimal | null;
  /** Whole days until the deadline, floored at zero, or `null` when there is no deadline. */
  readonly daysLeft: number | null;
}

/**
 * The campaign, or `null` when the response is not one this page can render.
 *
 * Three ways to get `null`, and they are one answer on purpose:
 *
 *   - the response is missing something every campaign has;
 *   - its state is not one of {@link RENDERABLE_STATES};
 *   - it was `null` to begin with, because the service refused the read.
 *
 * The page turns all three into a 404. **Checking the state here as well as in the service
 * is the second lock on the same door**: the endpoint refuses a campaign the public may not
 * see, and this refuses one that arrives anyway. `projectPageMetadata` then applies the
 * narrower question of whether it may be *described*, which is a different list and a third
 * lock — see {@link RENDERABLE_STATES}. The cost is a line; the cost of the leak is a
 * creator's unannounced project in somebody's search results.
 *
 * @param now the instant `daysLeft` is measured against. Injected so a test can ask what a
 *     campaign looks like the day before it closes without waiting for that day
 */
export function readCampaignPage(
  response: ProjectPageResponse | null,
  creatorSlug: string,
  now: Date = new Date(),
): CampaignPage | null {
  const page = readCampaignFields(response, creatorSlug, now);
  if (page === null) return null;

  return RENDERABLE_STATES.includes(page.state) ? page : null;
}

/**
 * The same narrowing, without the question of who may see it — issue #399.
 *
 * <p><strong>The state check is the caller's, and there is exactly one caller that skips
 * it.</strong> `/admin/campaigns/[projectId]` is the staff preview a moderator opens from
 * the submission queue, and its whole purpose is to render a campaign the public cannot
 * see: a campaign in review is not public, which is what being in review means, so the
 * queue's only link to what it was asking about was a 404 by construction.
 *
 * <p>A parameter on {@link readCampaignPage} would have been the shorter change and the
 * wrong one. That function's own comment calls the state check "the second lock on the same
 * door", and a lock with an argument that opens it is one call site away from a draft in
 * somebody's search results. Two functions, one of which is named after the audience that
 * may use it, is what the service does for the identical problem — `PublicComments` answers
 * for strangers and `ModeratedContent` answers for staff, and neither can be mistaken for
 * the other.
 *
 * <p>What is <em>not</em> skipped is the narrowing. A response missing something every
 * campaign has is still `null` here, because a half-built preview is a decision taken
 * against a page that does not exist.
 */
export function readCampaignFields(
  response: ProjectPageResponse | null,
  creatorSlug: string,
  now: Date = new Date(),
): CampaignPage | null {
  if (response === null) return null;

  const { id, slug, state, title } = response;
  if (
    typeof id !== 'string' ||
    typeof slug !== 'string' ||
    typeof state !== 'string' ||
    typeof title !== 'string' ||
    title.trim() === ''
  ) {
    return null;
  }
  const creator = readCreator(response.creator);
  if (creator === null) return null;

  const pledged = readMoney(response.pledged);
  if (pledged === null) return null;

  const goal = readMoney(response.goal);
  const deadline = typeof response.deadline === 'string' ? response.deadline : null;

  return {
    id,
    slug,
    creatorSlug,
    state: state as ProjectState,
    title,
    blurb: text(response.blurb),
    creator,
    category: readTaxon(response.category),
    subcategory: readTaxon(response.subcategory),
    coverImage: readCoverImage(response.coverImage),
    goal,
    pledged,
    backersCount: typeof response.backersCount === 'number' ? response.backersCount : 0,
    launchedAt: typeof response.launchedAt === 'string' ? response.launchedAt : null,
    deadline,
    story: readStoryDocument(response.story),
    risks: text(response.risks),
    outcome: readOutcome(response.outcome),
    completionPercent: completionOf(pledged, goal),
    daysLeft: daysLeftOf(deadline, now),
  };
}

/**
 * The narrow projection the `<head>` is allowed to know about.
 *
 * The same shape `metadata-source.ts` produces from the pre-launch read, so
 * `projectPageMetadata` and `projectPageGraph` take this page's campaign without either of
 * them learning a second way to describe one.
 */
export function previewOf(page: CampaignPage): PublicProjectPreview {
  return {
    id: page.id,
    slug: page.slug,
    state: page.state,
    title: page.title,
    blurb: page.blurb,
    coverImage: page.coverImage,
  };
}

/**
 * The reward tiers, as the structured data describes them.
 *
 * Add-ons are deliberately left out. `rewardProductNodes` emits one `Product` per tier with
 * an `Offer`, and an add-on is something bought alongside a pledge rather than a thing a
 * backer chooses between — listing both would tell a search engine the campaign sells twice
 * as many distinct products as it does.
 */
export function tiersOf(rewards: PublicRewardListResponse | null): readonly PublicRewardTier[] {
  const list = rewards?.rewards;
  if (!Array.isArray(list)) return [];

  const tiers: PublicRewardTier[] = [];
  for (const reward of list) {
    const price = readMoney(reward?.price);
    if (typeof reward?.id !== 'string' || typeof reward.title !== 'string' || price === null) {
      continue;
    }
    tiers.push({
      id: reward.id,
      title: reward.title,
      description: text(reward.description),
      price,
      // Absent and null both mean unlimited, which is the common case; zero is a tier that
      // is shown and cannot be taken (PL-01) and is not the same thing.
      remainingQuantity: typeof reward.remainingQuantity === 'number' ? reward.remainingQuantity : null,
      imageUrl: null,
    });
  }
  return tiers;
}

/* -------------------------------------------------------------------------
 * Reading one field
 * ---------------------------------------------------------------------- */

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * `{"amount": "599.00", "currency": "AZN"}`, or null.
 *
 * The amount stays the string it arrived as. Nothing here parses it into a number, and
 * `formatMoney` and `Decimal` are the only things that ever read it.
 */
function readMoney(value: unknown): Money | null {
  if (value === null || typeof value !== 'object') return null;

  const source = value as Record<string, unknown>;
  const amount = source['amount'];
  const currency = source['currency'];
  if (typeof amount !== 'string' || typeof currency !== 'string') return null;

  return { amount, currency };
}

function readCreator(value: unknown): CampaignCreator | null {
  if (value === null || typeof value !== 'object') return null;

  const source = value as Record<string, unknown>;
  const slug = text(source['slug']);
  const name = text(source['name']);
  // A campaign always has a creator — `projects.creator_id` is NOT NULL with no ON DELETE,
  // and §17.4 anonymises a departing account in place — so a response without one is a
  // response this page should not render rather than one with a blank byline.
  if (slug === null || name === null) return null;

  return { slug, name, avatarUrl: text(source['avatarUrl']) };
}

function readTaxon(value: unknown): CampaignTaxon | null {
  if (value === null || typeof value !== 'object') return null;

  const source = value as Record<string, unknown>;
  const slug = text(source['slug']);
  if (slug === null) return null;

  // The name falls back to the slug, which is the last step of the same chain the service
  // walks: a taxon with no translation in any language is still a readable handle rather
  // than an empty breadcrumb.
  return { slug, name: text(source['name']) ?? slug };
}

function readCoverImage(value: unknown): CampaignPage['coverImage'] {
  if (value === null || typeof value !== 'object') return null;

  const source = value as Record<string, unknown>;
  const url = text(source['url']);
  const { width, height } = source;
  // The three columns are written together or not at all, and the dimensions are what let
  // the layout reserve the box before the photograph decodes.
  if (url === null || typeof width !== 'number' || typeof height !== 'number') return null;
  if (width <= 0 || height <= 0) return null;

  return { url, width, height };
}

function readOutcome(value: unknown): CampaignOutcome | null {
  if (value === null || typeof value !== 'object') return null;

  const source = value as Record<string, unknown>;
  const finalisedAt = text(source['finalisedAt']);
  // V29 writes the four columns together, so the instant answers for the rest.
  if (finalisedAt === null) return null;

  return {
    goal: readMoney(source['goal']),
    pledged: readMoney(source['pledged']),
    backersCount: typeof source['backersCount'] === 'number' ? (source['backersCount'] as number) : 0,
    finalisedAt,
  };
}

/* -------------------------------------------------------------------------
 * The two derived values
 * ---------------------------------------------------------------------- */


/**
 * Whole days from now until the deadline, floored at zero.
 *
 * Floored rather than allowed to go negative: a campaign that closed a fortnight ago has no
 * days left, and a negative countdown is a number nobody has a sentence for. Whether a zero
 * means "last day" or "closed" is the state's to say, which is why this returns the number
 * and the component decides the words — the same split `ProjectCard` makes.
 */
function daysLeftOf(deadline: string | null, now: Date): number | null {
  if (deadline === null) return null;

  const closesAt = Date.parse(deadline);
  if (Number.isNaN(closesAt)) return null;

  const millis = closesAt - now.getTime();
  return millis <= 0 ? 0 : Math.floor(millis / 86_400_000);
}
