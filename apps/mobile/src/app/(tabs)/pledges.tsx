import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { formatMoney } from '@ideanest/money';
import { useLocale } from '../../lib/locale';
import { usePledges } from '../../api/queries';
import { Button } from '../../components/form';
import { EmptyState, ErrorState, Loading, OfflineNotice } from '../../components/states';
import { Body, CardTitle, Meta } from '../../components/text';
import { useT } from '../../lib/i18n';
import { readablePledgeState } from '../../lib/pledge-states';
import { useSession } from '../../lib/use-session';
import { colors, radius, size, spacing } from '../../theme';

/**
 * What somebody backed — the other list issue #115 promises offline.
 *
 * <h2>Why this one matters most without a connection</h2>
 *
 * A saved campaign is a bookmark. A pledge is a commitment somebody has already
 * made, and the moment they most want to check it — at a fulfilment desk, at a
 * border, on a train — is the moment they are least likely to have signal. The
 * amount and the reward tier are what they need, and both are in the cached
 * response.
 *
 * <h2>The state is shown in words as well as in colour</h2>
 *
 * A pledge that was cancelled and one that is collected are the same shape with
 * different consequences, and CLAUDE.md §2 forbids letting colour carry that on
 * its own.
 */

const styles = StyleSheet.create({
  content: { padding: size.cardGap },
  row: {
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: size.cardPaddingSmall,
    gap: spacing[2],
  },
  separator: { height: spacing[3] },
  amount: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3] },
});

export default function PledgesScreen() {
  const router = useRouter();
  const t = useT();
  const { signedIn } = useSession();
  const pledges = usePledges(signedIn);
  // Once per render of the screen, not once per row — and above the early return, so the
  // hooks run in the same order signed in and signed out.
  const locale = useLocale();

  if (!signedIn) {
    return (
      <EmptyState
        title={t('mobile.pledges.signedOutTitle')}
        detail={t('mobile.pledges.signedOutBody')}
        action={
          <Button label={t('shell.actions.signIn')} onPress={() => router.push('/sign-in')} />
        }
      />
    );
  }

  const items = pledges.data?.pledges ?? [];

  // The web's pledge-list sentences; only the offline one is the app's.
  if (items.length === 0) {
    if (pledges.isLoading) return <Loading label={t('account.pledges.list.loading')} />;
    if (pledges.isError) {
      return (
        <ErrorState
          title={t('account.pledges.list.failedTitle')}
          detail={t('mobile.offline.nothingCached')}
        />
      );
    }
    return (
      <EmptyState
        title={t('account.pledges.list.emptyTitle')}
        detail={t('account.pledges.list.emptyBody')}
      />
    );
  }

  return (
    <FlashList
      data={items}
      keyExtractor={(item) => item.pledgeId ?? ''}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={
        pledges.isError ? (
          <OfflineNotice detail={t('mobile.pledges.stale')} />
        ) : undefined
      }
      renderItem={({ item }) => (
        <View style={styles.row}>
          <CardTitle numberOfLines={2}>
            {item.project?.title ?? t('mobile.campaign.untitled')}
          </CardTitle>
          {item.rewardTitle == null ? null : <Body numberOfLines={1}>{item.rewardTitle}</Body>}
          <View style={styles.amount}>
            <Meta tone="secondary">{formatMoney(item.amounts?.total)}</Meta>
            <Meta>{readablePledgeState(item.state, locale)}</Meta>
          </View>
        </View>
      )}
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}
