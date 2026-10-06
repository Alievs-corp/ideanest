import { useCallback, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@ideanest/api-client';
import { CardEntry, type EntryGate } from '../../components/campaign-column';
import { FIRST_SCREENFUL } from '../../components/motion';
import {
  EmptyState,
  InlineAlert,
  Pill,
  SkeletonCard,
  SkeletonCrossfade,
  SkeletonGroup,
} from '../../components/ui';
import { Glyphs } from '../../icons';
import { useT } from '../../lib/i18n';
import { spacing } from '../../theme';
import type { ProfileList, ProfileListKind } from './api';
import { ProfileCampaignCard } from './profile-campaign-card';
import { SheetList } from './sheet-list';
import type { ProfileProjectCard } from './wire';

/**
 * One profile list — the web's `ProfileCampaignGrid` as a FlashList (#156). Created shows funding;
 * Backed withholds it (`ProfileCampaignCard`'s `funding`), decided here and nowhere else.
 *
 * <p>The next page is appended when the end is reached and by the visible "Show more" pill, which
 * stays as the accessible path and names its list ("Show more campaigns this person backed"). A
 * cursor is never asked for twice; a failed next page keeps every card already read and says why
 * under them. A first page that failed is not an empty list: it says it could not be loaded, with a
 * retry, while the tabs and the other list stay usable.
 *
 * <p>Motion: the first screenful of the first page rises in once (index < 8), only on the panel the
 * screen opened on; appended pages never animate. The skeleton crossfades into the content.
 */
export interface ProfileCampaignListProps {
  readonly kind: ProfileListKind;
  readonly list: ProfileList;
  /** The person's name, for the empty states. */
  readonly name: string;
  readonly header: ReactElement;
  /** Under the list, inside the sheet: the report link. */
  readonly foot: ReactNode;
  /** Whether the first screenful rises in (the panel the screen opened on). */
  readonly rises: boolean;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}

function cardKey(card: ProfileProjectCard): string {
  return card.id;
}

/** The first screenful of the first page, each card at most once in the list's life. */
function useEntryGate(items: readonly ProfileProjectCard[], rises: boolean): EntryGate {
  const first = useRef<ReadonlySet<string> | null>(null);
  if (first.current === null && items.length > 0) {
    first.current = rises ? new Set(items.slice(0, FIRST_SCREENFUL).map(cardKey)) : new Set();
  }
  const [gate] = useState<EntryGate>(() => {
    const done = new Set<string>();
    return {
      rises: (key) => first.current?.has(key) === true && !done.has(key),
      risen: (key) => {
        done.add(key);
      },
    };
  });
  return gate;
}

/** The service's own sentence for a refusal, else the catalogue's. */
export function nextPageMessage(
  cause: unknown,
  t: (key: 'refused' | 'unreachable') => string,
): string {
  if (cause instanceof ApiError) {
    const text = cause.problem?.detail ?? cause.problem?.title;
    return text === undefined || text === '' ? t('refused') : text;
  }
  return t('unreachable');
}

const PLACEHOLDERS = [0, 1, 2] as const;

export function ProfileCampaignList({
  kind,
  list,
  name,
  header,
  foot,
  rises,
  refreshing,
  onRefresh,
}: ProfileCampaignListProps) {
  const t = useT('profile.grid');
  const tAll = useT();
  const router = useRouter();
  const gate = useEntryGate(list.items, rises);
  const funding = kind === 'created' ? 'shown' : 'withheld';

  const open = useCallback(
    (card: ProfileProjectCard) =>
      router.push({
        pathname: '/projects/[creatorSlug]/[projectSlug]',
        params: { creatorSlug: card.creatorSlug, projectSlug: card.slug },
      }),
    [router],
  );

  const renderRow = useCallback(
    (card: ProfileProjectCard, index: number) => (
      <CardEntry gate={gate} entryKey={cardKey(card)} index={index}>
        <ProfileCampaignCard card={card} funding={funding} onOpen={open} priority={index < 3} />
      </CardEntry>
    ),
    [gate, funding, open],
  );

  let state: ReactNode = null;
  if (list.failed) {
    state = (
      <InlineAlert
        variant="danger"
        title={t('failedTitle')}
        description={tAll('mobile.profile.listFailedBody')}
        action={
          <Pill
            size="sm"
            variant="ghost"
            label={tAll('common.tryAgain')}
            busy={list.retrying}
            onPress={list.retry}
            testID={`profile-${kind}-retry`}
          />
        }
        testID={`profile-${kind}-failed`}
      />
    );
  } else if (!list.loading && list.items.length === 0) {
    state =
      kind === 'created' ? (
        <EmptyState
          icon={Glyphs.FolderOpen}
          title={t('createdEmptyTitle')}
          description={t('createdEmptyBody', { name })}
          testID="profile-created-empty"
        />
      ) : (
        <EmptyState
          icon={Glyphs.HeartTick}
          title={t('backedEmptyTitle')}
          description={t('backedEmptyBody', { name })}
          testID="profile-backed-empty"
        />
      );
  }

  const footer = (
    <View style={styles.footer}>
      <SkeletonCrossfade
        loading={list.loading}
        placeholder={
          <SkeletonGroup label={tAll('mobile.profile.loading')}>
            <View style={styles.placeholders}>
              {PLACEHOLDERS.map((row) => (
                <SkeletonCard key={row} />
              ))}
            </View>
          </SkeletonGroup>
        }
      >
        {state}
      </SkeletonCrossfade>

      {list.hasMore ? (
        <View style={styles.more}>
          <Pill
            label={list.fetchingMore ? t('loading') : t('showMore')}
            accessibilityLabel={kind === 'created' ? t('showMoreCreated') : t('showMoreBacked')}
            variant="outline"
            busy={list.fetchingMore}
            onPress={() => list.loadMore({ retry: true })}
            testID={`profile-${kind}-more`}
          />
        </View>
      ) : null}

      {list.moreError === null ? null : (
        <InlineAlert
          variant="danger"
          politeness="polite"
          title={t('nextFailedTitle')}
          description={nextPageMessage(list.moreError, (key) => t(key))}
          testID={`profile-${kind}-next-failed`}
        />
      )}

      {foot}
    </View>
  );

  return (
    <SheetList
      data={list.items}
      keyExtractor={cardKey}
      renderRow={renderRow}
      header={header}
      footer={footer}
      onEndReached={() => list.loadMore()}
      refreshing={refreshing}
      onRefresh={onRefresh}
      testID={`profile-list-${kind}`}
    />
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing[6] },
  placeholders: { gap: spacing[4] },
  more: { flexDirection: 'row' },
});
