'use client';

import { ChipRow, Pill, RemovableChip } from '@ideanest/ui';
import type { ActiveFilter } from '@ideanest/discovery/filters';
import type { FeedCopy } from '../../lib/i18n/feed-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

/**
 * Everything currently narrowing the feed, as chips that remove themselves.
 *
 * WHY IT EXISTS BESIDE THE RAIL. The rail is long, and a filter ticked in a
 * group that has scrolled out of view is a filter the reader has forgotten they
 * applied — which is how "the platform has nothing" gets concluded from a feed
 * narrowed by four choices. The chip row is the whole active set in one line.
 *
 * THE ACCESSIBLE NAME SAYS WHAT REMOVING DOES. "Live", announced as a button,
 * is a control whose name is what it is about rather than what it does; a row
 * of them is unusable by ear. Each chip announces "Remove Status filter: Live",
 * which contains the visible text so speech input still reaches it by the word
 * on it (WCAG 2.5.3).
 *
 * WHITE, NOT LIME. An applied filter is where the reader is, not something to
 * hurry about (docs/ui-kit.md §7.3).
 */

export interface ActiveFiltersProps {
  filters: readonly ActiveFilter[];
  onRemove: (filter: ActiveFilter) => void;
  onClear: () => void;
  /** The row's own three sentences — see `lib/i18n/feed-copy.ts`. */
  copy: FeedCopy;
}

export function ActiveFilters({ filters, onRemove, onClear, copy }: ActiveFiltersProps) {
  if (filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ChipRow fadeEdge={false} aria-label={copy.appliedFilters} className="flex-wrap">
        {filters.map((filter) => (
          <RemovableChip
            key={filter.key}
            removeLabel={fillPlaceholders(copy.removeChip, {
              group: filter.group,
              label: filter.label,
            })}
            onClick={() => onRemove(filter)}
          >
            {filter.label}
          </RemovableChip>
        ))}
      </ChipRow>

      {/*
        Ghost, not lime and not white: "clear all" is a way out, never the thing
        the reader came to do, and a second white pill beside a row of white
        chips would compete with them.
      */}
      <Pill size="sm" variant="ghost" onClick={onClear}>
        {copy.clearAll}
      </Pill>
    </div>
  );
}
