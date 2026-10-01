import { StyleSheet, View } from 'react-native';
import type { Card } from '../api/queries';
import { spacing } from '../theme';
import { ProjectCard } from './project-card';
import { SkeletonCard, SkeletonGroup } from './ui';

/**
 * A short, fixed run of campaigns in one column — the web's `components/browse/CampaignGrid.tsx`
 * at phone width (issue #153).
 *
 * <h2>Not virtualised, on purpose</h2>
 *
 * Home's rails hold at most six cards and Search's first page at most twenty-four, and both sit
 * inside a screen that already scrolls. A FlashList inside a ScrollView measures itself to its
 * full height and recycles nothing anyway, and nesting the two is the warning React Native prints
 * at every render. `CampaignList` stays the virtualised list for the open-ended feed.
 *
 * <h2>Priority</h2>
 *
 * The first `priority` covers are fetched first — three on a rail that opens the screen, none on
 * one further down — so the covers a reader sees first are not queued behind the ones they will
 * scroll to.
 */

export interface CampaignColumnProps {
  readonly cards: readonly Card[];
  /** How many of the first covers load with high priority. */
  readonly priority?: number;
  readonly testID?: string;
}

export function CampaignColumn({ cards, priority = 0, testID }: CampaignColumnProps) {
  return (
    <View style={styles.column} testID={testID}>
      {cards.map((card, index) => (
        <ProjectCard key={card.id ?? `${card.creatorSlug}/${card.slug}`} card={card} priority={index < priority} />
      ))}
    </View>
  );
}

/**
 * Placeholders for a column of cards, one busy accessible element named `label` — the web's
 * `DiscoverySkeleton`. Six by default, the feed's; a home rail asks for two.
 */
export function CampaignColumnSkeleton({
  label,
  count = 6,
}: {
  readonly label: string;
  readonly count?: number;
}) {
  return (
    <SkeletonGroup label={label}>
      <View style={styles.column}>
        {Array.from({ length: count }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </View>
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  column: { gap: spacing[4] },
});
