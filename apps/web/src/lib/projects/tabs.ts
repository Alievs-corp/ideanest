import {
  CAMPAIGN_CURSOR_PARAM,
  CAMPAIGN_TAB_PARAM,
  CAMPAIGN_THREAD_PARAM,
  DEFAULT_CAMPAIGN_TAB,
  type CampaignTabId,
} from '@ideanest/campaign/tabs';

/**
 * The campaign page's tabs as web addresses.
 *
 * <p>The tab vocabulary — the ids, their order, the `tab`, `from` and `thread` parameter names,
 * and the readers that turn a query value into a tab or a cursor — is
 * `@ideanest/campaign/tabs` since #155, where the module comment argues why the tab is a query
 * parameter at all. The app reads the same parameter from a deep link. It is re-exported here
 * under the same names, so no caller changed.
 *
 * <p>What stays is the one thing only the web has: an `href` to a tab of a campaign page.
 */
export {
  CAMPAIGN_CURSOR_PARAM,
  CAMPAIGN_TAB_PARAM,
  CAMPAIGN_TABS,
  CAMPAIGN_THREAD_PARAM,
  DEFAULT_CAMPAIGN_TAB,
  campaignCursorFrom,
  campaignTabFrom,
  type CampaignTab,
  type CampaignTabId,
} from '@ideanest/campaign/tabs';

/**
 * The address of one tab of one campaign.
 *
 * The path is passed in rather than rebuilt here. `page.tsx` already owns `pathOf`, which is
 * what the canonical URL and the structured data's trail are built from, and a second
 * encoding of the same two slugs is a second chance for them to disagree about a creator
 * whose handle contains a character that needs escaping.
 */
export interface CampaignTabLocation {
  /** Where a paged tab starts reading. Opaque; carried from the service's `nextCursor`. */
  readonly cursor?: string | null | undefined;
  /** Which conversation to open in full. Comments tab only. */
  readonly thread?: string | null | undefined;
}

export function campaignTabHref(
  path: string,
  tab: CampaignTabId,
  location: CampaignTabLocation = {},
): string {
  const parameters = new URLSearchParams();
  if (tab !== DEFAULT_CAMPAIGN_TAB) parameters.set(CAMPAIGN_TAB_PARAM, tab);
  if (location.thread != null && location.thread !== '') {
    parameters.set(CAMPAIGN_THREAD_PARAM, location.thread);
  }
  if (location.cursor != null && location.cursor !== '') {
    parameters.set(CAMPAIGN_CURSOR_PARAM, location.cursor);
  }

  const query = parameters.toString();
  return query === '' ? path : `${path}?${query}`;
}
