import { StyleSheet, View } from 'react-native';
import type { ActiveFilter } from '@ideanest/discovery/filters';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { useT } from '../../lib/i18n';
import { spacing } from '../../theme';
import { Pill, RemovableChip } from '../ui';

/**
 * What is narrowing the feed, one removable chip per choice — the web's `ActiveFilters`
 * (issue #153).
 *
 * The chips wrap rather than scroll sideways, so every filter in force is visible at once. Each
 * X is named "Remove {group} filter: {label}", because "Remove Live" alone does not say which
 * control it came from. "Clear all filters" ends the row and keeps the query and the sort, as
 * `clearFilters` does. Nothing is drawn when nothing is applied.
 */

export interface ActiveFiltersProps {
  readonly filters: readonly ActiveFilter[];
  readonly onRemove: (filter: ActiveFilter) => void;
  readonly onClear: () => void;
}

export function ActiveFilters({ filters, onRemove, onClear }: ActiveFiltersProps) {
  const t = useT('discovery.feed');
  if (filters.length === 0) return null;

  const template = String(t.raw('removeChip'));

  return (
    <View
      style={styles.row}
      accessibilityLabel={t('appliedFilters')}
      testID="active-filters"
    >
      {filters.map((filter) => (
        <RemovableChip
          key={filter.key}
          label={filter.label}
          removeLabel={fillPlaceholders(template, { group: filter.group, label: filter.label })}
          onRemove={() => onRemove(filter)}
        />
      ))}
      <Pill label={t('clearAll')} variant="ghost" size="sm" onPress={onClear} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[2] },
});
