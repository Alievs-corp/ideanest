import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Card } from '../api/queries';
import { spacing } from '../theme';
import { FIRST_SCREENFUL, FadeUp } from './motion';
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
 *
 * <h2>Entry</h2>
 *
 * The first screenful of the first cards it is given rises in (`FadeUp`, staggered), once
 * ({@link useEntryGate}). Cards that arrive later — another page, a refetch — are simply there.
 */

/** A card's identity in a list: its id, or its address when the service sent none. */
export function cardKey(card: Card): string {
  return card.id ?? `${card.creatorSlug}/${card.slug}`;
}

/**
 * Which cards may rise in: the first {@link FIRST_SCREENFUL} of the first non-empty page a list
 * is given, each at most once in the list's life (`mobile-design` skill §6.5). A recycled or
 * remounted cell, an appended page and a refetch never animate.
 */
export interface EntryGate {
  readonly rises: (key: string) => boolean;
  readonly risen: (key: string) => void;
}

export function useEntryGate(cards: readonly Card[]): EntryGate {
  return useRowEntryGate(cards, cardKey);
}

/** {@link useEntryGate} for the rows of any list, each named by `keyOf`. */
export function useRowEntryGate<T>(items: readonly T[], keyOf: (item: T, index: number) => string): EntryGate {
  const first = useRef<ReadonlySet<string> | null>(null);
  if (first.current === null && items.length > 0) {
    first.current = new Set(items.slice(0, FIRST_SCREENFUL).map(keyOf));
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

/**
 * A card's entry rise, decided once when the cell mounts. The wrapper keeps one element type for
 * the cell's life, so a recycled cell is never remounted by it and never replays the rise.
 */
export function CardEntry({
  gate,
  entryKey,
  index,
  children,
}: {
  readonly gate: EntryGate;
  readonly entryKey: string;
  readonly index: number;
  readonly children: ReactNode;
}) {
  const [rise] = useState(() => (gate.rises(entryKey) ? index : FIRST_SCREENFUL));
  useEffect(() => {
    if (rise < FIRST_SCREENFUL) gate.risen(entryKey);
    // Once, for the cell's first item: whatever it renders later does not rise.
  }, []);
  return <FadeUp index={rise}>{children}</FadeUp>;
}

export interface CampaignColumnProps {
  readonly cards: readonly Card[];
  /** How many of the first covers load with high priority. */
  readonly priority?: number;
  readonly testID?: string;
}

export function CampaignColumn({ cards, priority = 0, testID }: CampaignColumnProps) {
  const gate = useEntryGate(cards);
  return (
    <View style={styles.column} testID={testID}>
      {cards.map((card, index) => {
        const key = cardKey(card);
        return (
          <CardEntry key={key} gate={gate} entryKey={key} index={index}>
            <ProjectCard card={card} priority={index < priority} />
          </CardEntry>
        );
      })}
    </View>
  );
}

/**
 * Placeholders for a column of cards, one busy accessible element named `label` — the web's
 * `DiscoverySkeleton`. Two by default: a phone shows one card and the top of the next, and every
 * placeholder below that is views mounted, while the page is still sliding in, that nobody sees.
 */
export function CampaignColumnSkeleton({
  label,
  count = 2,
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
