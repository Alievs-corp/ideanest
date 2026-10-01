import { StyleSheet, View } from 'react-native';
import { useT } from '../../lib/i18n';
import { spacing } from '../../theme';
import { Skeleton, SkeletonGroup } from '../ui';

/**
 * The campaign page before its first answer (#155): its own shape, block for block, so nothing
 * moves when the page replaces it — the 16:9 cover, the tag row, the title and blurb lines, the bar
 * and its figures, the Back pill and the trust card.
 *
 * <p>One accessible element ("Loading this campaign", busy), as `SkeletonGroup` makes every
 * placeholder: the wait is one announcement, not a dozen grey shapes.
 */
export function CampaignSkeleton() {
  const t = useT('campaign.prelaunch');
  return (
    <SkeletonGroup label={t('loading')} testID="campaign-loading">
      <View style={styles.page}>
        <Skeleton aspectRatio={16 / 9} radius="lg" />
        <View style={styles.tags}>
          <Skeleton height={26} width={88} radius="sm" />
          <Skeleton height={26} width={64} radius="sm" />
        </View>
        <View style={styles.lines}>
          <Skeleton height={32} width="85%" />
          <Skeleton height={16} width="95%" />
          <Skeleton height={16} width="60%" />
        </View>
        <View style={styles.lines}>
          <Skeleton height={8} radius="lg" />
          <View style={styles.figures}>
            <Skeleton height={30} width={96} />
            <Skeleton height={30} width={56} />
            <Skeleton height={30} width={56} />
          </View>
        </View>
        <Skeleton height={48} radius="lg" />
        <Skeleton height={136} radius="lg" />
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  page: { gap: spacing[5], paddingTop: spacing[4] },
  tags: { flexDirection: 'row', gap: spacing[2] },
  lines: { gap: spacing[2] },
  figures: { flexDirection: 'row', gap: spacing[6] },
});
