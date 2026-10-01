import { StyleSheet, Text, View } from 'react-native';
import { useT } from '../../../lib/i18n';
import { colors, font, fontSize, lineHeight, spacing } from '../../../theme';
import { InlineAlert, Pill } from '../../ui';
import { TabHeading, TabNote } from './shared/tab-section';
import { UpdateEntry } from './updates/update-entry';
import { useProjectUpdates, type ProjectUpdates } from './updates/use-project-updates';
import {
  INACTIVE_TAB,
  type CampaignTabBody,
  type CampaignTabContext,
  type CampaignTabRow,
} from './contract';

/**
 * The Updates tab (#155) — `useUpdatesTab`, consumed by `campaign-screen.tsx` as the body of the
 * page's list when `?tab=updates`. The contract is `./contract.ts`. The web's `CampaignUpdates`,
 * appending rather than replacing.
 *
 * <p>The heading `campaign.updates.heading`, then one row per update (`./updates/update-entry.tsx`).
 * Pages of twenty by numeric cursor (`./updates/use-project-updates.ts`), read only while the tab
 * is open and persisted with the page under `project`.
 *
 * <h2>Paging appends</h2>
 *
 * The web's "Older updates" is a link to the next server page, which replaces the list. Here the
 * page is one virtualised list, so the next twenty are appended to it: `onEndReached` asks for them
 * as the reader nears the end, and the footer carries a visible "Older updates" pill — the path a
 * screen reader or a switch user can take, since neither scrolls to trigger an end-reached. While
 * a page is on its way the pill says so, and while anything is being read it is disabled; the same
 * cursor is never asked for twice.
 * At the end of a list that has paged, "There are no older updates."; a list that fitted on one
 * page ends without a sentence, as on the web.
 *
 * <h2>Failure</h2>
 *
 * A first page that could not be read is `mobile.campaign.updates.failed` with "Try again" (the
 * web's `campaign.updates.failed` says "reload the page", which has no meaning here) — never the
 * #133 "has not posted an update yet" sentence, which is a claim about the creator. A next page
 * that failed keeps every card already loaded and puts its own notice, with "Try again", where the
 * pill was; the end of the list does not retry it on its own.
 */
export function useUpdatesTab(context: CampaignTabContext): CampaignTabBody {
  const t = useT('campaign.updates');
  const tMobile = useT('mobile.campaign.updates');
  const updates = useProjectUpdates(context.campaign.id, context.active);
  if (!context.active) return INACTIVE_TAB;

  const { refresh } = updates;
  if (updates.loading) {
    return { rows: [], footer: null, onEndReached: null, refresh, loading: true };
  }

  const rows: CampaignTabRow[] = [
    {
      key: 'heading',
      render: () => <TabHeading testID="updates-heading">{t('heading')}</TabHeading>,
    },
  ];

  if (updates.failed) {
    rows.push({
      key: 'failed',
      render: () => (
        <TabNote
          text={tMobile('failed')}
          onRetry={() => void updates.retry()}
          retrying={updates.busy}
          testID="updates-failed"
        />
      ),
    });
    return { rows, footer: null, onEndReached: null, refresh, loading: false };
  }

  if (updates.updates.length === 0 && updates.pageCount <= 1) {
    rows.push({ key: 'none', render: () => <TabNote text={t('none')} testID="updates-none" /> });
    return { rows, footer: null, onEndReached: null, refresh, loading: false };
  }

  for (const update of updates.updates) {
    // The service's number is the update's identity, as the web keys its list.
    rows.push({ key: `update-${update.number}`, render: () => <UpdateEntry update={update} /> });
  }

  return {
    rows,
    footer: <UpdatesFooter updates={updates} />,
    onEndReached: updates.hasMore && !updates.moreFailed ? () => updates.loadMore() : null,
    refresh,
    loading: false,
  };
}

/** After the last card: the next page's failure, "Older updates", the end, or nothing. */
function UpdatesFooter({ updates }: { readonly updates: ProjectUpdates }) {
  const t = useT();

  if (updates.moreFailed) {
    return (
      <View style={styles.footer}>
        <InlineAlert
          variant="danger"
          politeness="polite"
          description={t('mobile.campaign.updates.olderFailed')}
          action={
            <Pill
              label={t('common.tryAgain')}
              variant="ghost"
              size="sm"
              busy={updates.fetchingMore}
              onPress={() => updates.loadMore({ retry: true })}
            />
          }
          testID="updates-older-failed"
        />
      </View>
    );
  }

  if (updates.hasMore) {
    return (
      <View style={styles.footer}>
        <Pill
          label={
            updates.fetchingMore
              ? t('mobile.campaign.updates.loadingOlder')
              : t('campaign.updates.older')
          }
          variant="outline"
          disabled={updates.busy}
          onPress={() => updates.loadMore()}
          testID="updates-older"
        />
      </View>
    );
  }

  if (updates.pageCount > 1) {
    return (
      <View style={styles.footer}>
        <Text style={styles.end} testID="updates-no-older">
          {t('campaign.updates.noOlder')}
        </Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  footer: { paddingTop: spacing[6] },
  end: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
  },
});
