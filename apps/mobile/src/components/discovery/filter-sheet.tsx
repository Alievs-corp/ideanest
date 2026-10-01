import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { boundsAreOrdered, isValidBound } from '@ideanest/discovery/bounds';
import { countOf, type DiscoveryFacets, type ValueCount } from '@ideanest/discovery/facets';
import {
  toggleAmountBand,
  toggleCategory,
  toggleCompletion,
  toggleStatus,
  toggleSubcategory,
  toggleTag,
  withAmountRange,
  type DiscoveryFilters,
} from '@ideanest/discovery/filters';
import {
  AMOUNT_BANDS,
  COMPLETION_BANDS,
  STATUSES,
  labelOf,
} from '@ideanest/discovery/vocabulary';
import { fillPlaceholders } from '@ideanest/messages/placeholders';
import { useFilterVocabulary } from '../../lib/discovery';
import { useT } from '../../lib/i18n';
import { useLocale } from '../../lib/locale';
import { colors, font, fontSize, lineHeight, spacing } from '../../theme';
import { Caption } from '../text';
import { Checkbox, Field, Pill, Sheet, TextInput } from '../ui';

/**
 * The feed's filters in a bottom sheet — the web's `FilterRail` (issue #153).
 *
 * <h2>A sheet, and why</h2>
 *
 * On a phone the web draws all six groups above the results, which pushes the first campaign
 * several screens down. Here they live in a sheet the Filters button opens. The groups, their
 * order, the words, the counts and the rules are the web's: status, category with its
 * subcategories, completion, goal, amount raised, tags.
 *
 * <h2>Every box applies at once</h2>
 *
 * There is no Apply button except for the two custom ranges, whose digits are not a choice until
 * they are finished. Ticking a box changes the route's params, and the feed behind the sheet —
 * and the counts in it — update while it is open.
 *
 * <h2>The counts</h2>
 *
 * Each box shows its facet count on the right, which a screen reader hears as the box's value.
 * A count of zero on a box that is not ticked reads "None" and disables the box: choosing it
 * could only empty the feed. While the counts load, the space is blank rather than a zero that
 * would be a lie. When the counts fail, the category and tag lists are empty, as on the web.
 */

export interface FilterSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly filters: DiscoveryFilters;
  readonly facets: DiscoveryFacets | null;
  readonly onChange: (next: DiscoveryFilters) => void;
}

export function FilterSheet({ visible, onClose, filters, facets, onChange }: FilterSheetProps) {
  const t = useT('discovery.feed');
  const vocabulary = useFilterVocabulary();
  const none = t('none');

  /** A count for a fixed vocabulary's value, or null while the panel has none. */
  const countFor = (source: readonly ValueCount[] | undefined, value: string): number | null =>
    facets === null ? null : countOf(source, value);

  const tags = facets?.tags ?? [];

  return (
    <Sheet visible={visible} onClose={onClose} title={t('railLabel')} testID="filter-sheet">
      <Group legend={vocabulary.groups.status} first>
        {STATUSES.map((status) => (
          <FacetCheckbox
            key={status}
            label={labelOf(vocabulary.status, status)}
            count={countFor(facets?.status, status)}
            none={none}
            checked={filters.statuses.includes(status)}
            onToggle={() => onChange(toggleStatus(filters, status))}
          />
        ))}
      </Group>

      <Group legend={vocabulary.groups.category}>
        {(facets?.categories ?? []).map((category) => {
          const chosen = filters.categories.includes(category.slug);
          // A ticked subcategory keeps its list open even when its parent is not ticked.
          const childChosen = category.subcategories.some((sub) =>
            filters.subcategories.includes(sub.slug),
          );
          return (
            <View key={category.slug}>
              <FacetCheckbox
                label={category.name}
                count={category.count}
                none={none}
                checked={chosen}
                onToggle={() => onChange(toggleCategory(filters, category.slug))}
              />
              {(chosen || childChosen) && category.subcategories.length > 0 ? (
                <View
                  style={styles.nested}
                  accessibilityLabel={fillPlaceholders(String(t.raw('subcategoriesOf')), {
                    category: category.name,
                  })}
                  testID={`subcategories-${category.slug}`}
                >
                  {category.subcategories.map((subcategory) => (
                    <FacetCheckbox
                      key={subcategory.slug}
                      label={subcategory.name}
                      count={subcategory.count}
                      none={none}
                      checked={filters.subcategories.includes(subcategory.slug)}
                      onToggle={() => onChange(toggleSubcategory(filters, subcategory.slug))}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </Group>

      <Group legend={vocabulary.groups.completion}>
        {COMPLETION_BANDS.map((band) => (
          <FacetCheckbox
            key={band}
            label={labelOf(vocabulary.completion, band)}
            count={countFor(facets?.completion, band)}
            none={none}
            checked={filters.completion.includes(band)}
            onToggle={() => onChange(toggleCompletion(filters, band))}
          />
        ))}
      </Group>

      {(['goal', 'raised'] as const).map((dimension) => {
        const legend = vocabulary.groups[dimension];
        const source = dimension === 'goal' ? facets?.goalAmount : facets?.amountRaised;
        return (
          <Group key={dimension} legend={legend}>
            {AMOUNT_BANDS.map((band) => (
              <FacetCheckbox
                key={band}
                label={labelOf(vocabulary.amount, band)}
                count={countFor(source, band)}
                none={none}
                checked={filters[dimension].bands.includes(band)}
                onToggle={() => onChange(toggleAmountBand(filters, dimension, band))}
              />
            ))}
            <RangeFields
              dimension={dimension}
              legend={legend}
              min={filters[dimension].min}
              max={filters[dimension].max}
              onApply={(range) => onChange(withAmountRange(filters, dimension, range))}
            />
          </Group>
        );
      })}

      <Group legend={vocabulary.groups.tags}>
        {/*
          A free vocabulary, so only tags with campaigns behind them are listed. Several tags mean
          every one of them, the one dimension where adding a value narrows, and the hint says so.
        */}
        {tags.length === 0 ? (
          <Caption tone="tertiary">{t('noTags')}</Caption>
        ) : (
          <>
            <Caption>{t('tagsHint')}</Caption>
            {tags.map((tag) => (
              <FacetCheckbox
                key={tag.slug}
                label={tag.name}
                count={tag.count}
                none={none}
                checked={filters.tags.includes(tag.slug)}
                onToggle={() => onChange(toggleTag(filters, tag.slug))}
              />
            ))}
          </>
        )}
      </Group>
    </Sheet>
  );
}

function Group({
  legend,
  first = false,
  children,
}: {
  readonly legend: string;
  readonly first?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <View style={[styles.group, !first && styles.ruled]}>
      <Text accessibilityRole="header" style={styles.legend}>
        {legend}
      </Text>
      {children}
    </View>
  );
}

interface FacetCheckboxProps {
  readonly label: string;
  /** Null while the counts are loading or have failed: the space stays blank. */
  readonly count: number | null;
  readonly none: string;
  readonly checked: boolean;
  readonly onToggle: () => void;
}

/** A box with its count. Zero and unticked is "None", and disabled. */
function FacetCheckbox({ label, count, none, checked, onToggle }: FacetCheckboxProps) {
  const unavailable = count === 0 && !checked;
  return (
    <Checkbox
      label={label}
      checked={checked}
      disabled={unavailable}
      onChange={onToggle}
      count={count === null ? '' : count === 0 ? none : String(count)}
    />
  );
}

interface RangeFieldsProps {
  readonly dimension: 'goal' | 'raised';
  readonly legend: string;
  readonly min: string | null;
  readonly max: string | null;
  readonly onApply: (range: { min: string | null; max: string | null }) => void;
}

/**
 * The custom money range: two decimal fields and an Apply pill — the web's `RangeFields`.
 *
 * The bounds are money and never become numbers: `isValidBound` and `boundsAreOrdered` read them
 * with `decimal.js`, and the digits typed are what is sent. The labels name their dimension, so
 * two "Lowest" fields on one sheet are not two controls with the same name.
 */
export function RangeFields({ dimension, legend, min, max, onApply }: RangeFieldsProps) {
  const t = useT('discovery.feed');
  const locale = useLocale();
  const [from, setFrom] = useState(min ?? '');
  const [to, setTo] = useState(max ?? '');
  const [error, setError] = useState<string | null>(null);

  // A range removed by its chip comes back out of the fields too.
  useEffect(() => setFrom(min ?? ''), [min]);
  useEffect(() => setTo(max ?? ''), [max]);

  const named = { dimension: legend.toLocaleLowerCase(locale) };

  function apply(): void {
    const lower = from.trim() === '' ? null : from.trim();
    const upper = to.trim() === '' ? null : to.trim();
    if (!isValidBound(lower) || !isValidBound(upper)) {
      setError(t('rangeInvalid'));
      return;
    }
    if (!boundsAreOrdered(lower, upper)) {
      setError(t('rangeUnordered'));
      return;
    }
    setError(null);
    onApply({ min: lower, max: upper });
  }

  return (
    <View style={styles.range} testID={`range-${dimension}`}>
      <Caption>{t('customRange')}</Caption>
      <View style={styles.bounds}>
        <View style={styles.bound}>
          <Field label={fillPlaceholders(String(t.raw('lowest')), named)}>
            <TextInput
              value={from}
              onChangeText={setFrom}
              keyboardType="decimal-pad"
              autoComplete="off"
              invalid={error !== null}
            />
          </Field>
        </View>
        <View style={styles.bound}>
          <Field label={fillPlaceholders(String(t.raw('highest')), named)}>
            <TextInput
              value={to}
              onChangeText={setTo}
              keyboardType="decimal-pad"
              autoComplete="off"
              invalid={error !== null}
            />
          </Field>
        </View>
      </View>
      {error === null ? null : (
        // Announced when it appears, not only coloured: a red border says nothing to a screen reader.
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>
          {error}
        </Text>
      )}
      <View style={styles.apply}>
        <Pill
          label={t('applyRange')}
          accessibilityLabel={fillPlaceholders(String(t.raw('applyRangeLabel')), named)}
          variant="ghost"
          size="sm"
          onPress={apply}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing[1], paddingBottom: spacing[5] },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing[5],
  },
  legend: {
    ...font.medium,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textPrimary,
    marginBottom: spacing[2],
  },
  nested: {
    marginLeft: spacing[8],
    paddingLeft: spacing[4],
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  range: { gap: spacing[3], marginTop: spacing[4] },
  bounds: { flexDirection: 'row', gap: spacing[3] },
  bound: { flex: 1 },
  error: {
    ...font.regular,
    fontSize: fontSize.caption,
    lineHeight: lineHeight.small,
    color: colors.danger,
  },
  apply: { alignItems: 'flex-start' },
});
