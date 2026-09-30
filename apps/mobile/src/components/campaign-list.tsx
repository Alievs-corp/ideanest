import { useCallback } from 'react';
import { FlashList } from '@shopify/flash-list';
import { RefreshControl, StyleSheet, View } from 'react-native';
import type { Card } from '../api/queries';
import { colors, size, spacing } from '../theme';
import { FadeUp } from './motion';
import { ProjectCard } from './project-card';

/**
 * A virtualised list of campaigns — §4.3. **Capped stagger so long lists
 * never crawl.**
 *
 * <h2>Why FlashList and not FlatList</h2>
 *
 * §14.3 names it, and the reason is what a discovery feed is: a list of cards
 * with an image, of unbounded length, that somebody flicks through fast.
 * `FlatList` keeps every rendered row mounted and recycles nothing, so the
 * fiftieth flick is measurably worse than the first on a mid-range Android
 * phone — which is most of this market.
 *
 * <h2>The stagger cap, and why the index it uses is not the list index</h2>
 *
 * `docs/motion-system.md` §7 caps the entry delay at 300ms because the fiftieth
 * item must not wait two and a half seconds. That cap alone is not enough here,
 * and this is the part that is easy to get wrong: FlashList RECYCLES rows, so
 * item 200 is rendered into the component that held item 3, and an `entering`
 * animation keyed off the absolute index would replay — a card fading in halfway
 * down a list somebody is already reading.
 *
 * So the animation is applied only to the first screenful. Beyond
 * {@link ANIMATED_PREFIX} rows the cards are mounted plain, which is also §8's
 * "no animation in long lists" rule and the reason scrolling stays at frame
 * rate. The entry animation exists to make a screen arrive; it has nothing to
 * say about row 60.
 */

/**
 * How many rows fade in. About two screenfuls on a phone, which is what somebody
 * sees before their thumb moves.
 */
export const ANIMATED_PREFIX = 6;

export interface CampaignListProps {
  readonly cards: readonly Card[];
  readonly onEndReached?: () => void;
  readonly onRefresh?: () => void;
  readonly refreshing?: boolean;
  /** Rendered above the first card — a search field, a filter row, a notice. */
  readonly header?: React.ReactElement;
  /** Rendered when `cards` is empty. */
  readonly empty?: React.ReactElement;
}

const styles = StyleSheet.create({
  content: { padding: size.cardGap, gap: size.cardGap },
  separator: { height: spacing[4] },
});

export function CampaignList({
  cards,
  onEndReached,
  onRefresh,
  refreshing = false,
  header,
  empty,
}: CampaignListProps) {
  const renderItem = useCallback(
    ({ item, index }: { item: Card; index: number }) =>
      index < ANIMATED_PREFIX ? (
        <FadeUp index={index}>
          <ProjectCard card={item} />
        </FadeUp>
      ) : (
        <ProjectCard card={item} />
      ),
    [],
  );

  return (
    <FlashList
      data={cards as Card[]}
      renderItem={renderItem}
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
            onRefresh={onRefresh}
            tintColor={colors.lime500}
            colors={[colors.lime500]}
          />
        )
      }
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}
