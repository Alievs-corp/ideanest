import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { formatMoney } from '@ideanest/money';
import { currentLocale } from '../../lib/locale';
import { usePledges } from '../../api/queries';
import { Button } from '../../components/form';
import { EmptyState, ErrorState, Loading, OfflineNotice } from '../../components/states';
import { Body, CardTitle, Meta } from '../../components/text';
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
  const { signedIn } = useSession();
  const pledges = usePledges(signedIn);

  if (!signedIn) {
    return (
      <EmptyState
        title="Sign in to see your pledges"
        detail="Your pledges belong to your account, not to this phone."
        action={<Button label="Sign in" onPress={() => router.push('/sign-in')} />}
      />
    );
  }

  const items = pledges.data?.pledges ?? [];
  // Once per render of the screen, not once per row.
  const locale = currentLocale();

  if (items.length === 0) {
    if (pledges.isLoading) return <Loading label="Loading your pledges" />;
    if (pledges.isError) {
      return (
        <ErrorState
          title="Could not load your pledges"
          detail="Nothing was cached on this device yet, so there is nothing to show offline."
        />
      );
    }
    return (
      <EmptyState
        title="No pledges yet"
        detail="When you back a campaign it appears here, readable with or without a connection."
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
          <OfflineNotice detail="Showing pledges saved on this device. They may be out of date." />
        ) : undefined
      }
      renderItem={({ item }) => (
        <View style={styles.row}>
          <CardTitle numberOfLines={2}>{item.project?.title ?? 'Campaign'}</CardTitle>
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
