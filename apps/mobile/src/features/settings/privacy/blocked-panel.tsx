import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { queryKeys } from '../../../api/queries';
import {
  Avatar,
  Body,
  CardTitle,
  InlineAlert,
  Meta,
  Pill,
  PressableScale,
  Skeleton,
  SkeletonGroup,
} from '../../../components/ui';
import { unblockAccount, useBlockedList, type BlockedAccount } from '../../../lib/blocks';
import { useOnline } from '../../../lib/connectivity';
import { useT } from '../../../lib/i18n';
import { useLocale } from '../../../lib/locale';
import { spacing } from '../../../theme';
import { relativeTime } from '../sessions/relative-time';
import { SettingsCard } from '../settings-page';

/**
 * The accounts this reader blocked, with Unblock — §4.9's C-08, issue #324, the web's
 * `BlockedAccountsPanel`.
 *
 * <p>Second on the screen, after the visibility switch and before the export and the closure,
 * which stay together: the switch says who can see you, this says whom you no longer see. The
 * card says what a block does before the list, because somebody reading it is deciding whether
 * to keep each row.
 *
 * <p>Each row's name opens the profile; Unblock takes the row away at once and puts it back, with
 * a sentence, when the service refuses. A successful unblock re-reads the ids the Comments tab
 * hides by, so that account's comments come back. Offline the buttons are disabled and say why.
 */
export function BlockedPanel() {
  const t = useT('blocking.list');
  const tAll = useT();
  const locale = useLocale();
  const online = useOnline();
  const router = useRouter();
  const client = useQueryClient();
  const list = useBlockedList(true);

  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [failure, setFailure] = useState<string | null>(null);

  const rows = (list.data?.pages ?? []).flatMap((page) => page.items).filter((row) => !removed.has(row.userId));

  const unblock = async (account: BlockedAccount) => {
    if (!online) return;
    setFailure(null);
    setRemoved((previous) => new Set(previous).add(account.userId));
    try {
      await unblockAccount(account.userId);
      void client.invalidateQueries({ queryKey: queryKeys.blockedIds() });
      void client.invalidateQueries({ queryKey: queryKeys.profile(account.slug) });
    } catch {
      setRemoved((previous) => {
        const next = new Set(previous);
        next.delete(account.userId);
        return next;
      });
      setFailure(fillPlaceholders(String(tAll.raw('blocking.list.unblockFailedBody')), { name: account.name }));
    }
  };

  return (
    <SettingsCard title={t('title')} intro={t('intro')} testID="privacy-blocked">
      {failure === null ? null : (
        <InlineAlert
          variant="danger"
          title={t('unblockFailedTitle')}
          description={failure}
          onDismiss={() => setFailure(null)}
          testID="privacy-blocked-failed"
        />
      )}
      {list.data === undefined ? (
        list.isError ? (
          <InlineAlert
            variant="danger"
            title={t('failedTitle')}
            action={
              <Pill
                label={tAll('common.tryAgain')}
                variant="ghost"
                size="sm"
                disabled={!online}
                onPress={() => void list.refetch()}
              />
            }
            testID="privacy-blocked-load-failed"
          />
        ) : (
          <SkeletonGroup label={t('loading')} testID="privacy-blocked-loading">
            <View style={styles.rows}>
              <Skeleton height={48} />
              <Skeleton height={48} />
            </View>
          </SkeletonGroup>
        )
      ) : rows.length === 0 ? (
        <View style={styles.empty} testID="privacy-blocked-empty">
          <CardTitle>{t('emptyTitle')}</CardTitle>
          <Body tone="secondary">{t('emptyBody')}</Body>
        </View>
      ) : (
        <View style={styles.rows}>
          {rows.map((account) => {
            const meta =
              account.blockedAt === ''
                ? null
                : fillPlaceholders(String(tAll.raw('blocking.list.meta')), {
                    time: relativeTime(account.blockedAt, new Date(), locale),
                  });
            return (
              <View key={account.userId} style={styles.row} testID={`blocked-row-${account.userId}`}>
                <PressableScale
                  accessibilityRole="link"
                  accessibilityLabel={meta === null ? account.name : `${account.name}, ${meta}`}
                  onPress={() => router.push({ pathname: '/u/[slug]', params: { slug: account.slug } })}
                  style={styles.identityReach}
                  contentStyle={styles.identity}
                >
                  {/* Decorative: the name is written beside it. */}
                  <Avatar name={account.name} src={account.avatarUrl} size="md" decorative />
                  <View style={styles.text}>
                    <CardTitle>{account.name}</CardTitle>
                    {meta === null ? null : <Meta>{meta}</Meta>}
                  </View>
                </PressableScale>
                <Pill
                  label={t('unblock')}
                  accessibilityLabel={fillPlaceholders(String(tAll.raw('blocking.list.unblockLabel')), {
                    name: account.name,
                  })}
                  variant="ghost"
                  size="sm"
                  disabled={!online}
                  accessibilityHint={online ? undefined : tAll('mobile.blocking.offline')}
                  onPress={() => void unblock(account)}
                  testID={`unblock-${account.userId}`}
                />
              </View>
            );
          })}
          {list.hasNextPage ? (
            <View style={styles.start}>
              <Pill
                label={list.isFetchingNextPage ? tAll('common.list.loadingMore') : tAll('common.list.showMore')}
                variant="outline"
                size="sm"
                busy={list.isFetchingNextPage}
                disabled={!online}
                onPress={() => void list.fetchNextPage()}
                testID="privacy-blocked-more"
              />
            </View>
          ) : null}
          {list.isFetchNextPageError ? (
            <InlineAlert variant="danger" description={tAll('common.list.nextPageFailed')} />
          ) : null}
        </View>
      )}
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  rows: { gap: spacing[4] },
  row: { gap: spacing[2] },
  identityReach: { alignSelf: 'stretch' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  text: { flex: 1, gap: spacing[1] },
  empty: { gap: spacing[1] },
  start: { alignItems: 'flex-start' },
});
