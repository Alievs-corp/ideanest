import { interimTabBody } from './interim-tab-body';
import { INACTIVE_TAB, type CampaignTabBody, type CampaignTabContext } from './contract';

/**
 * The Updates tab (#155) — `useUpdatesTab`, consumed by `campaign-screen.tsx` as the body of the
 * page's list when `?tab=updates`. The contract is `./contract.ts`.
 *
 * <p>What the tab is to become — the web's `CampaignUpdates`, appending rather than replacing:
 * the heading `campaign.updates.heading`, then one card per update — the eyebrow
 * `campaign.updates.number` with the service's `number` (never an index), the day in the device's
 * zone (`formatDay` in `lib/i18n.tsx`), a warning tag with Lock and `updates.backersOnly` for
 * `BACKERS_ONLY`, an H3 title and the body with line breaks kept. Pages of twenty
 * (`UPDATE_PAGE_SIZE`, `readUpdatePage`) by numeric cursor, one infinite query under
 * `queryKeys.projectUpdates`; `onEndReached` appends the next page, the footer carries the
 * "Older updates" pill as the accessible way to it and `updates.noOlder` at the end of a paged
 * list. A failed read is `campaign.updates.failed`; none at all is `campaign.updates.none`.
 *
 * <p>Until then the body is the interim card: this tab on the campaign's web page.
 */
export function useUpdatesTab(context: CampaignTabContext): CampaignTabBody {
  if (!context.active) return INACTIVE_TAB;
  return interimTabBody(context.campaign, 'updates');
}
