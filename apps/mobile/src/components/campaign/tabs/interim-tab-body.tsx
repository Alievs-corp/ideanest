import { StyleSheet, Text, View } from 'react-native';
import { ExternalLink } from 'lucide-react-native';
import type { CampaignTabId } from '@ideanest/campaign/tabs';
import type { CampaignPage } from '../../../lib/campaign-page';
import { openCampaignTabOnWeb } from '../../../lib/campaign-actions';
import { useT } from '../../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, spacing } from '../../../theme';
import { Pill } from '../../ui';
import type { CampaignTabBody } from './contract';

/**
 * The body of a tab the app does not draw yet (#155): one card saying so, and a way to the same
 * tab on the campaign's web page. It replaces the old screen's fixed English paragraph about
 * comments, and it is what the Creator, FAQ, Updates and Comments tabs show until each one's own
 * change replaces its file — after which nothing imports this one.
 */
export function interimTabBody(campaign: CampaignPage, tab: CampaignTabId): CampaignTabBody {
  return {
    rows: [{ key: 'interim', render: () => <InterimTabBody campaign={campaign} tab={tab} /> }],
    footer: null,
    onEndReached: null,
    refresh: () => Promise.resolve(),
    loading: false,
  };
}

function InterimTabBody({
  campaign,
  tab,
}: {
  readonly campaign: CampaignPage;
  readonly tab: CampaignTabId;
}) {
  const t = useT('mobile.campaign.interim');
  const tTabs = useT('campaign.tabs');
  return (
    <View style={styles.card} testID={`interim-${tab}`}>
      <Text style={styles.body}>{t('body')}</Text>
      <Pill
        label={t('open')}
        accessibilityLabel={t('openLabel', { section: tTabs(tab) })}
        iconRight={ExternalLink}
        variant="outline"
        size="sm"
        onPress={() => void openCampaignTabOnWeb(campaign.creatorSlug, campaign.slug, tab)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing[3],
    marginTop: spacing[8],
    padding: spacing[5],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  body: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textReading,
  },
});
