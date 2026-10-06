import { StyleSheet, View } from 'react-native';
import { Glyphs } from '../../icons';
import { useT } from '../../lib/i18n';
import { colors, fontSize, lineHeight, radius, size, spacing } from '../../theme';
import { Body, Icon, Subheading } from '../../components/ui';

/**
 * "# campaigns are late on updates" — the web's `CreatorObligationSummary` (#156): a count and the
 * rule that makes it readable, on the profile's neutral surface. Nothing at all for a creator who
 * is up to date: a green "no late updates" panel would be the platform vouching for somebody.
 *
 * <p>An icon and words, never colour, and not lime: the person who has to act is the creator, not
 * the reader. Nothing animates in — it is a statement about a person's record.
 */
export function CreatorObligationSummary({
  lapsedCount,
  name,
}: {
  readonly lapsedCount: number;
  readonly name: string;
}) {
  const t = useT('profile.obligations');
  if (lapsedCount <= 0) return null;
  return (
    <View style={styles.card} testID="profile-obligations">
      <View style={styles.heading}>
        <Icon icon={Glyphs.Calendar} size={20} color={colors.textSecondary} />
        <Subheading accessibilityRole="header" style={styles.title}>
          {t('heading', { count: lapsedCount })}
        </Subheading>
      </View>
      <Body tone="reading" style={styles.text}>
        {t('body', { name, count: lapsedCount })}
      </Body>
      <Body style={styles.text}>{t('rule')}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing[2],
    padding: size.cardPaddingSmall,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  title: { flex: 1, fontSize: fontSize.base, lineHeight: lineHeight.body },
  text: { fontSize: fontSize.sm, lineHeight: lineHeight.small },
});
