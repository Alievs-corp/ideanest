import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Glyphs } from '../../icons';
import { labelOf, sortsFor, type DiscoverySort } from '@ideanest/discovery/vocabulary';
import { useFilterVocabulary } from '../../lib/discovery';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, size, spacing } from '../../theme';
import { Icon, Radio, RadioGroup, Sheet, useFocusRing } from '../ui';

/**
 * The feed's order — the web's `SortControl` (issue #153), as a row that opens a sheet of radios.
 *
 * The row always says what is in force — "Sort by: Newest" — and the sheet lists exactly
 * `sortsFor(hasQuery)`: Best match only while there is a query, because without text it has
 * nothing to rank and the service resolves it back to Newest. The contract's `relevance` and
 * `near_me` are not offered (#44, #47); a control that cannot work is a promise broken on first
 * use. A choice applies and closes the sheet: six options are one decision, not a form.
 */

export interface SortControlProps {
  readonly sort: DiscoverySort;
  readonly hasQuery: boolean;
  readonly onChange: (sort: DiscoverySort) => void;
}

export function SortControl({ sort, hasQuery, onChange }: SortControlProps) {
  const t = useT('discovery.feed');
  const vocabulary = useFilterVocabulary();
  const [open, setOpen] = useState(false);
  const opener = useRef<View>(null);
  const { ring, onFocus, onBlur } = useFocusRing();
  const current = labelOf(vocabulary.sort, sort);

  return (
    <>
      <Pressable
        ref={opener}
        accessibilityRole="button"
        accessibilityLabel={`${t('sortLabel')}: ${current}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        onFocus={onFocus}
        onBlur={onBlur}
        style={({ pressed }) => [styles.row, pressed && styles.pressed, ring]}
        testID="sort-control"
      >
        <Text style={styles.label} numberOfLines={1}>
          {t('sortLabel')}: <Text style={styles.value}>{current}</Text>
        </Text>
        <Icon icon={Glyphs.ArrowDown2} size={16} color={colors.textTertiary} />
      </Pressable>

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={t('sortLabel')}
        returnFocusTo={opener}
      >
        <RadioGroup
          value={sort}
          label={t('sortLabel')}
          onChange={(value) => {
            setOpen(false);
            if (value !== sort) onChange(value as DiscoverySort);
          }}
        >
          {sortsFor(hasQuery).map((value) => (
            <Radio key={value} value={value} label={labelOf(vocabulary.sort, value)} />
          ))}
        </RadioGroup>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    minHeight: size.touchTarget,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  pressed: { backgroundColor: colors.surface3 },
  label: {
    ...font.regular,
    flexShrink: 1,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
  },
  value: { ...font.medium, color: colors.textPrimary },
});
