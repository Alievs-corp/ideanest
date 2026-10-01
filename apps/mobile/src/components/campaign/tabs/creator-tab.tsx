import { CreatorAbout, CreatorCampaigns } from './creator/creator-panel';
import { otherCampaigns, useCreatorProfile, useCreatorProjects } from './creator/creator-profile';
import {
  INACTIVE_TAB,
  type CampaignTabBody,
  type CampaignTabContext,
  type CampaignTabRow,
} from './contract';

/**
 * The Creator tab (#155) — `useCreatorTab`, consumed by `campaign-screen.tsx` as the body of the
 * page's list when `?tab=creator`. The contract is `./contract.ts`. The web's `CreatorPanel`.
 *
 * <p>`GET /v1/users/{slug}` and `GET /v1/users/{slug}/projects?limit=7`
 * (`./creator/creator-profile.ts`), asked for only once the tab opens and never persisted. Two
 * rows (`./creator/creator-panel.tsx`): the heading, the avatar (the profile's, else the
 * campaign's), the name — a link to `u/[slug]` with ArrowUpRight only when the profile was read —
 * "Member since {day}" and the biography; then up to six of the creator's other campaigns, this
 * one left out, and "See everything {name} has made".
 *
 * <p>While the first answers are on their way the body is empty and `loading`, so the screen's
 * placeholder stands in rather than a name that turns into a link a moment later. A profile that
 * could not be read — refused, private or unreachable, which are one answer on purpose — is the
 * campaign's own name and avatar with no link. A campaigns list that could not be read is no
 * list. Nothing pages.
 */
export function useCreatorTab(context: CampaignTabContext): CampaignTabBody {
  const slug = context.campaign.creator.slug;
  const profile = useCreatorProfile(slug, context.active);
  const projects = useCreatorProjects(slug, context.active);
  if (!context.active) return INACTIVE_TAB;

  const refresh = () => Promise.allSettled([profile.refetch(), projects.refetch()]);
  if (profile.isPending || projects.isPending) {
    return { rows: [], footer: null, onEndReached: null, refresh, loading: true };
  }

  const { campaign } = context;
  const read = profile.data ?? null;
  const others = otherCampaigns(projects.data ?? [], campaign.id);

  const rows: CampaignTabRow[] = [
    { key: 'about', render: () => <CreatorAbout creator={campaign.creator} profile={read} /> },
  ];
  if (others.length > 0) {
    rows.push({
      key: 'others',
      render: () => <CreatorCampaigns projects={others} profile={read} />,
    });
  }

  return { rows, footer: null, onEndReached: null, refresh, loading: false };
}
