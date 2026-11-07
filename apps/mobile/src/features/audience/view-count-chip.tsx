import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../components/ui';
import { Glyphs } from '../../icons';
import { useLocale } from '../../lib/locale';
import { colors, darkColors, font, fontSize, lineHeight, radius, spacing, tint } from '../../theme';
import { compactCount } from './compact-count';

/**
 * The eye and the campaign's view count at the bottom-left of a card's cover — #636, the web's
 * card chip. The count is every day's unique viewers added up (`viewCount`, the service's
 * `projects.view_count`).
 *
 * <p>Light words on the black/64 scrim, as the reward video's length chip: legible over any
 * cover, and over the placeholder when there is none, in both themes. Absent at zero — "0 views"
 * on a new campaign is a sentence against it, not a fact a backer needs.
 *
 * <p>Hidden from assistive technology: the card's single accessible element reads the count in
 * its facts (`common.card.views`), and a second stop on the picture would split the card in two.
 * It never takes a touch, so pressing it presses the card.
 *
 * <p>One line, always. The chip may take at most half the cover; at the largest font scales a
 * count that would not fit shrinks (`adjustsFontSizeToFit`) rather than wrapping or running past
 * the cover's edge. Compact figures keep it short to begin with: "15,3K", not "15.312".
 */
export function ViewCountChip({ count, testID = 'view-count-chip' }: { readonly count: number | undefined; readonly testID?: string }) {
  const locale = useLocale();
  if (count === undefined || !Number.isFinite(count) || count <= 0) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.chip}
      testID={testID}
    >
      <Icon icon={Glyphs.Eye} size={14} color={darkColors.textPrimary} />
      <Text style={styles.count} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {compactCount(count, locale)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: 'absolute',
    left: spacing[3],
    bottom: spacing[3],
    maxWidth: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    borderRadius: radius.full,
    backgroundColor: tint(colors.black, 0.64),
  },
  // The canvas's own light text: the scrim is dark on either theme.
  count: {
    ...font.medium,
    flexShrink: 1,
    fontSize: fontSize.caption,
    lineHeight: lineHeight.small,
    color: darkColors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
});
