import { useCallback, useContext } from 'react';
import { FlashList } from '@shopify/flash-list';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { Card } from '../api/queries';
import { colors, size, spacing } from '../theme';
import { CardEntry, cardKey, useEntryGate } from './campaign-column';
import { ProjectCard } from './project-card';
import { useTabBarInset } from './tab-bar';
import { SkeletonCard, SkeletonGroup, haptics } from './ui';

/**
 * A virtualised list of campaigns — §4.3. **Long lists never crawl.**
 *
 * <h2>Why FlashList and not FlatList</h2>
 *
 * §14.3 names it, and the reason is what a discovery feed is: a list of cards
 * with an image, of unbounded length, that somebody flicks through fast.
 * `FlatList` keeps every rendered row mounted and recycles nothing, so the
 * fiftieth flick is measurably worse than the first on a mid-range Android
 * phone — which is most of this market.
 *
 * <h2>The first screenful rises, once</h2>
 *
 * The `mobile-design` skill §6.5 allows an entry rise on the first screenful only,
 * never on rows a feed appends. FlashList RECYCLES rows, so the decision is made
 * once per cell when it mounts (`CardEntry`) and once per card for the list's
 * life (`useEntryGate`): a recycled row, a remounted row scrolled back to, the
 * next page and a refetch never animate.
 *
 * <h2>The bottom edge</h2>
 *
 * The list is its own scroll container, so it pads its end itself: clear of the
 * home indicator, and of the floating tab bar's footprint (`useTabBarInset()`)
 * when a tab screen draws it — zero on the stack routes that do today.
 *
 * <h2>Pull to refresh</h2>
 *
 * The kit's refresh, as `Screen` draws it (issue #151): the spinner in the text
 * tokens on surface-3 rather than lime — a refresh is not the one urgent thing on
 * the screen — and §7's refresh haptic as the pull lands.
 */

export interface CampaignListProps {
  readonly cards: readonly Card[];
  readonly onEndReached?: () => void;
  readonly onRefresh?: () => void;
  readonly refreshing?: boolean;
  /** Rendered above the first card — a search field, a filter row, a notice. */
  readonly header?: React.ReactElement;
  /** Rendered when `cards` is empty. */
  readonly empty?: React.ReactElement;
  /** Rendered after the last card — "Show more", the end of the feed, a next-page error. */
  readonly footer?: React.ReactElement;
  readonly testID?: string;
}

const styles = StyleSheet.create({
  content: { padding: size.cardGap, gap: size.cardGap },
  separator: { height: spacing[4] },
  placeholders: { gap: spacing[4] },
});

/** How many covers at the top of a feed are fetched first: the ones on screen when it opens. */
const PRIORITY_COVERS = 3;

export function CampaignList({
  cards,
  onEndReached,
  onRefresh,
  refreshing = false,
  header,
  empty,
  footer,
  testID,
}: CampaignListProps) {
  const gate = useEntryGate(cards);
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  const tabInset = useTabBarInset();

  /* Stable for the list's life (the gate never changes), so FlashList keeps its recycling. */
  const renderCard = useCallback(
    ({ item, index }: { item: Card; index: number }) => {
      const key = cardKey(item);
      return (
        <CardEntry gate={gate} entryKey={key} index={index}>
          <ProjectCard card={item} priority={index < PRIORITY_COVERS} />
        </CardEntry>
      );
    },
    [gate],
  );

  return (
    <FlashList
      testID={testID}
      data={cards as Card[]}
      renderItem={renderCard}
      /*
       * The campaign id, not the array position. A keyExtractor that returns the
       * index defeats recycling entirely -- every card is a new identity on
       * every page append, and the list re-renders from the top.
       */
      keyExtractor={(item) => item.id ?? ''}
      contentContainerStyle={{
        ...styles.content,
        paddingBottom: Math.max(bottomInset + size.cardGap, tabInset),
      }}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
      onEndReached={onEndReached}
      /*
       * Half a screen rather than the default. A funding feed is read fast, and
       * fetching only when the last card is already visible is what makes a
       * spinner appear at the bottom instead of the next page.
       */
      onEndReachedThreshold={0.5}
      refreshControl={
        onRefresh === undefined ? undefined : (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              haptics.refresh();
              onRefresh();
            }}
            tintColor={colors.textSecondary}
            colors={[colors.textPrimary]}
            progressBackgroundColor={colors.surface3}
          />
        )
      }
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

/** How many card placeholders stand in for the first page: about one screenful. */
const PLACEHOLDERS = 3;

/**
 * The list before its first page — the kit's card-shaped placeholders in the list's own padding and
 * spacing, so nothing moves when the cards replace them (issue #151; it replaces the spinner that
 * the old `Loading` state drew).
 *
 * <p>One accessible element, named by `label` and busy, as `SkeletonGroup` makes it: the wait is
 * one announcement ("Loading projects"), not three grey cards.
 */
export function CampaignListSkeleton({ label }: { readonly label: string }) {
  return (
    <View style={styles.content}>
      <SkeletonGroup label={label}>
        <View style={styles.placeholders}>
          {Array.from({ length: PLACEHOLDERS }, (_, index) => (
            <SkeletonCard key={index} />
          ))}
        </View>
      </SkeletonGroup>
    </View>
  );
}
