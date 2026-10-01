import { FlashList } from '@shopify/flash-list';
import { RefreshControl, StyleSheet, View } from 'react-native';
import type { Card } from '../api/queries';
import { colors, size, spacing } from '../theme';
import { ProjectCard } from './project-card';
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
 * <h2>No card animates</h2>
 *
 * The list used to fade its first six cards up on a capped stagger. It no longer
 * animates any: `docs/motion-system.md` §5.1 forbids an entry animation on
 * campaign cards outright ("§8: no animation in long lists"), and calls the card
 * stagger "the one people reach for here and the one to refuse" — a feed that
 * grows as somebody scrolls is a page that never settles, and it costs exactly
 * where discovery's budget says speed outranks everything. It was also the part
 * that was easy to get wrong: FlashList RECYCLES rows, so an `entering`
 * animation replays on a recycled row halfway down a list somebody is reading.
 * What still moves on a card is its progress bar, §5.1's one exception.
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
  /** The list's accessible name, when its heading is not enough — a collection's campaigns. */
  readonly label?: string;
  readonly testID?: string;
}

const styles = StyleSheet.create({
  content: { padding: size.cardGap, gap: size.cardGap },
  separator: { height: spacing[4] },
  placeholders: { gap: spacing[4] },
});

export function CampaignList({
  cards,
  onEndReached,
  onRefresh,
  refreshing = false,
  header,
  empty,
  footer,
  label,
  testID,
}: CampaignListProps) {
  return (
    <FlashList
      accessibilityLabel={label}
      testID={testID}
      data={cards as Card[]}
      renderItem={renderCard}
      /*
       * The campaign id, not the array position. A keyExtractor that returns the
       * index defeats recycling entirely -- every card is a new identity on
       * every page append, and the list re-renders from the top.
       */
      keyExtractor={(item) => item.id ?? ''}
      contentContainerStyle={styles.content}
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

/** How many covers at the top of a feed are fetched first: the ones on screen when it opens. */
const PRIORITY_COVERS = 3;

/** Module-level, so FlashList gets the same function on every render and keeps its recycling. */
function renderCard({ item, index }: { item: Card; index: number }) {
  return <ProjectCard card={item} priority={index < PRIORITY_COVERS} />;
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
