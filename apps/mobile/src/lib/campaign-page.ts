import type Decimal from 'decimal.js';
import type { Money } from '@ideanest/money';
import { completionOf } from '@ideanest/campaign/completion';
import { daysLeftOf } from '@ideanest/campaign/days-left';
import { isRenderableState, type ProjectState } from '@ideanest/campaign/states';
import { readStoryDocument, type StoryDocument } from '@ideanest/campaign/story';
import type { ProjectPage, PublicRewards } from '../api/queries';

/**
 * The campaign page as the screen draws it — #155. The app's half of the web's `readCampaignPage`
 * and `tiersOf` (`apps/web/src/lib/projects/publicPage.ts`).
 *
 * <h2>Why this file is the app's and its rules are not</h2>
 *
 * What a campaign page *is* — which states have one, how many days are left, the funded percent,
 * whether a story is valid — is `@ideanest/campaign`'s, and every one of those answers is asked of
 * it here rather than worked out again. What stays local is the narrowing of the generated
 * response type, field by field, into a model with no optional fields: the web narrows its own
 * server type the same way, and the two response types are not the same TypeScript type.
 *
 * <h2>`null` means not found</h2>
 *
 * A response this page cannot draw — no id, no title, no creator, no pledged figure, or a state
 * outside `RENDERABLE_STATES` (a draft, a submitted campaign) — is the not-found screen, as it is
 * a 404 on the web. A campaign with no creator cannot happen (`projects.creator_id` is NOT NULL)
 * and a byline with nobody in it would be worse than saying the page is not there.
 */

export interface CampaignCreator {
  readonly slug: string;
  readonly name: string;
  readonly avatarUrl: string | null;
}

export interface CampaignTaxon {
  readonly slug: string;
  readonly name: string;
}

export interface CampaignOutcome {
  readonly goal: Money | null;
  readonly pledged: Money | null;
  readonly backersCount: number;
  readonly finalisedAt: string;
}

export interface CampaignCover {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export interface CampaignPage {
  readonly id: string;
  readonly slug: string;
  /** The creator slug the route was opened with — the share link and the web URLs use it. */
  readonly creatorSlug: string;
  readonly state: ProjectState;
  readonly title: string;
  readonly blurb: string | null;
  readonly creator: CampaignCreator;
  readonly category: CampaignTaxon | null;
  readonly coverImage: CampaignCover | null;
  readonly goal: Money | null;
  readonly pledged: Money;
  readonly backersCount: number;
  readonly deadline: string | null;
  /** The version-1 document, or `null` when absent or invalid — no story section either way. */
  readonly story: StoryDocument | null;
  readonly risks: string | null;
  readonly outcome: CampaignOutcome | null;
  /** The funded percent from the page's figures, rounded down; `null` without a goal. */
  readonly completionPercent: Decimal | null;
  /** Whole days to the deadline, floored at zero; `null` without one. Not in the response. */
  readonly daysLeft: number | null;
}

/** A reward tier the page can draw: a price, a title, and how many are left (`null`: no limit). */
export interface RewardTier {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly price: Money;
  readonly remainingQuantity: number | null;
}

/**
 * The page, or `null` for the not-found screen. `now` is a parameter for the reason the web's
 * is: a test has to be able to ask what the page says on the last day of a campaign.
 */
export function readCampaignPage(
  response: ProjectPage | null | undefined,
  creatorSlug: string,
  now: Date = new Date(),
): CampaignPage | null {
  if (response === null || response === undefined) return null;

  const { id, slug, state, title } = response;
  if (typeof id !== 'string' || typeof slug !== 'string' || typeof state !== 'string') return null;
  if (typeof title !== 'string' || title.trim() === '') return null;
  if (!isRenderableState(state)) return null;

  const creator = readCreator(response.creator);
  const pledged = readMoney(response.pledged);
  if (creator === null || pledged === null) return null;

  const goal = readMoney(response.goal);
  const deadline = text(response.deadline);

  return {
    id,
    slug,
    creatorSlug,
    state,
    title,
    blurb: text(response.blurb),
    creator,
    category: readTaxon(response.category),
    coverImage: readCover(response.coverImage),
    goal,
    pledged,
    backersCount: typeof response.backersCount === 'number' ? response.backersCount : 0,
    deadline,
    story: readStoryDocument(response.story),
    risks: text(response.risks),
    outcome: readOutcome(response.outcome),
    completionPercent: completionOf(pledged, goal),
    daysLeft: daysLeftOf(deadline, now),
  };
}

/**
 * The tiers, in the service's order, each one narrowed. A row without an id, a title or a price
 * is dropped rather than drawn half-empty — the web's `tiersOf`, rule for rule.
 */
export function tiersOf(rewards: PublicRewards | null | undefined): readonly RewardTier[] {
  const list = rewards?.rewards;
  if (!Array.isArray(list)) return [];

  const tiers: RewardTier[] = [];
  for (const reward of list) {
    const price = readMoney(reward.price);
    if (typeof reward.id !== 'string' || typeof reward.title !== 'string' || price === null) {
      continue;
    }
    tiers.push({
      id: reward.id,
      title: reward.title,
      description: text(reward.description),
      price,
      // Absent and null both mean unlimited; zero is a tier that is shown and cannot be taken.
      remainingQuantity:
        typeof reward.remainingQuantity === 'number' ? reward.remainingQuantity : null,
    });
  }
  return tiers;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readMoney(value: unknown): Money | null {
  if (value === null || typeof value !== 'object') return null;
  const { amount, currency } = value as Record<string, unknown>;
  if (typeof amount !== 'string' || typeof currency !== 'string') return null;
  return { amount, currency };
}

function readCreator(value: unknown): CampaignCreator | null {
  if (value === null || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const slug = text(source['slug']);
  const name = text(source['name']);
  if (slug === null || name === null) return null;
  return { slug, name, avatarUrl: text(source['avatarUrl']) };
}

function readTaxon(value: unknown): CampaignTaxon | null {
  if (value === null || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const slug = text(source['slug']);
  if (slug === null) return null;
  // A taxon with no translation in any language is still a readable handle.
  return { slug, name: text(source['name']) ?? slug };
}

function readCover(value: unknown): CampaignCover | null {
  if (value === null || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const url = text(source['url']);
  const { width, height } = source;
  if (url === null || typeof width !== 'number' || typeof height !== 'number') return null;
  if (width <= 0 || height <= 0) return null;
  return { url, width, height };
}

function readOutcome(value: unknown): CampaignOutcome | null {
  if (value === null || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const finalisedAt = text(source['finalisedAt']);
  // The service writes the four columns together, so the instant answers for the rest.
  if (finalisedAt === null) return null;
  return {
    goal: readMoney(source['goal']),
    pledged: readMoney(source['pledged']),
    backersCount: typeof source['backersCount'] === 'number' ? source['backersCount'] : 0,
    finalisedAt,
  };
}
