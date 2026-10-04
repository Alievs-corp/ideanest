import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Glyphs } from '../../icons';
import { labelOf, sortsFor, type DiscoverySort } from '@ideanest/discovery/vocabulary';
import { useFilterVocabulary } from '../../lib/discovery';
import { useT } from '../../lib/i18n';
import { font, fontSize, lineHeight, radius, size, spacing } from '../../theme';
import {
  Icon,
  Radio,
  RadioGroup,
  Sheet,
  TONES,
  useFocusRing,
  usePressScale,
  useSurface,
} from '../ui';
import { BLOCK, blockSurface } from '../ui/surface';

/**
 * The feed's order — the web's `SortControl` (issue #153), as a pill that opens a sheet of radios.
 *
 * The pill always says what is in force — "Sort by: Newest" — and the sheet lists exactly
 * `sortsFor(hasQuery)`: Best match only while there is a query, because without text it has
 * nothing to rank and the service resolves it back to Newest. The contract's `relevance` and
 * `near_me` are not offered (#44, #47); a control that cannot work is a promise broken on first
 * use. A choice applies and closes the sheet: six options are one decision, not a form.
 *
 * <p>The opener is a raised pill (`mobile-design` skill §2) with the press give
 * (`usePressScale`); the ref stays on the `Pressable`, so focus returns to it when the sheet
 * closes.
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
  const press = usePressScale();
  const surface = useSurface();
  const tones = TONES[surface];
  const block = BLOCK[blockSurface(surface)];
  const current = labelOf(vocabulary.sort, sort);

  return (
    <>
      <Animated.View style={[styles.wrap, press.style]}>
        <Pressable
          ref={opener}
          accessibilityRole="button"
          accessibilityLabel={`${t('sortLabel')}: ${current}`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(true)}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          onFocus={onFocus}
          onBlur={onBlur}
          style={[
            styles.pill,
            { backgroundColor: press.pressed ? block.pressed : block.rest },
            ring,
          ]}
          testID="sort-control"
        >
          <Icon icon={Glyphs.Sort} size={18} color={tones.secondary} />
          <Text style={[styles.label, { color: tones.secondary }]} numberOfLines={1}>
            {t('sortLabel')}: <Text style={[styles.value, { color: tones.primary }]}>{current}</Text>
          </Text>
          <Icon icon={Glyphs.ArrowDown2} size={16} color={tones.tertiary} />
        </Pressable>
      </Animated.View>

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
  // Hugs the pill, so it scales about its own centre rather than the row's.
  wrap: { flexShrink: 1, alignSelf: 'flex-start' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: size.touchTarget,
    paddingHorizontal: spacing[4],
    borderRadius: radius.full,
  },
  label: {
    ...font.regular,
    flexShrink: 1,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
  },
  value: { ...font.medium },
});
