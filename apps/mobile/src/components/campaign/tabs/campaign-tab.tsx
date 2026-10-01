import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '../../../theme';
import { CampaignOutcomeNotice } from '../campaign-outcome-notice';
import { CampaignRisks } from '../campaign-risks';
import { CampaignStory } from '../campaign-story';
import { INACTIVE_TAB, type CampaignTabBody, type CampaignTabContext, type CampaignTabRow } from './contract';

/**
 * The Campaign tab (#155), the default — `useCampaignTab`, by the contract in `./contract.ts`.
 *
 * <p>Three rows, each only when there is something in it, in the web's order: how a closed
 * campaign ended (`CampaignOutcomeNotice`), the story (`CampaignStory`, when the document is a
 * valid version 1), and the risks (`CampaignRisks`). Everything comes with the page itself, so
 * there is nothing to load, nothing to page and nothing of its own to refresh — the page's
 * pull-to-refresh already rereads the campaign these rows are drawn from.
 */
export function useCampaignTab(context: CampaignTabContext): CampaignTabBody {
  if (!context.active) return INACTIVE_TAB;
  const { campaign } = context;

  const rows: CampaignTabRow[] = [];
  if (campaign.outcome !== null) {
    rows.push({ key: 'outcome', render: () => spaced(<CampaignOutcomeNotice campaign={campaign} />) });
  }
  if (campaign.story !== null) {
    const story = campaign.story;
    rows.push({
      key: 'story',
      render: () => spaced(<CampaignStory story={story} title={campaign.title} />),
    });
  }
  if (campaign.risks !== null) {
    const risks = campaign.risks;
    rows.push({ key: 'risks', render: () => spaced(<CampaignRisks risks={risks} />) });
  }

  return { rows, footer: null, onEndReached: null, refresh: () => Promise.resolve(), loading: false };
}

/** The web's `gap-8` between the tab's blocks, as the space above each. */
function spaced(block: ReactElement): ReactElement {
  return <View style={styles.block}>{block}</View>;
}

const styles = StyleSheet.create({
  block: { paddingTop: spacing[8] },
});
