import { interimTabBody } from './interim-tab-body';
import { INACTIVE_TAB, type CampaignTabBody, type CampaignTabContext } from './contract';

/**
 * The FAQ tab (#155) — `useFaqTab`, consumed by `campaign-screen.tsx` as the body of the page's
 * list when `?tab=faq`. The contract is `./contract.ts`.
 *
 * <p>What the tab is to become — the web's `CampaignFaqs`: the heading `campaign.faqs.heading`,
 * then a numbered list of surface-2 cards, each an H3 question and its answer with line breaks
 * kept, **all open** (no accordion). `GET /v1/projects/{projectId}/faqs` (at most fifty, unpaged:
 * no `onEndReached`), read through `@ideanest/campaign/faqs`'s `readFaqList` under
 * `queryKeys.projectFaqs`, which is persisted with the page. A failed read is
 * `campaign.faqs.failed`, an empty list `campaign.faqs.empty`.
 *
 * <p>Until then the body is the interim card: this tab on the campaign's web page.
 */
export function useFaqTab(context: CampaignTabContext): CampaignTabBody {
  if (!context.active) return INACTIVE_TAB;
  return interimTabBody(context.campaign, 'faq');
}
