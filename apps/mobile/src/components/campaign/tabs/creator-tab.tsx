import { interimTabBody } from './interim-tab-body';
import { INACTIVE_TAB, type CampaignTabBody, type CampaignTabContext } from './contract';

/**
 * The Creator tab (#155) — `useCreatorTab`, consumed by `campaign-screen.tsx` as the body of the
 * page's list when `?tab=creator`. The contract is `./contract.ts`.
 *
 * <p>What the tab is to become — the web's `CreatorPanel`: the heading `campaign.creator.heading`,
 * a 56pt round avatar (the profile's, falling back to `campaign.creator.avatarUrl`), the name as a
 * link to `u/[slug]` once the profile has loaded, "Member since {day}", the bio, and up to six of
 * the creator's other campaigns (this one excluded; ask for seven), then "See everything {name}
 * has made". `GET /v1/users/{slug}` and `GET /v1/users/{slug}/projects?limit=7`, read only while
 * `context.active` (under `queryKeys.profile` / `queryKeys.profileProjects`, which are never
 * persisted). A refused profile falls back to the campaign's own name and avatar.
 *
 * <p>Until then the body is the interim card: this tab on the campaign's web page.
 */
export function useCreatorTab(context: CampaignTabContext): CampaignTabBody {
  if (!context.active) return INACTIVE_TAB;
  return interimTabBody(context.campaign, 'creator');
}
