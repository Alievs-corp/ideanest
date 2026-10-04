import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Body, Caption, Eyebrow, Icon, PressableScale, TONES, useSurface } from '../../components/ui';
import { BLOCK, blockSurface } from '../../components/ui/surface';
import { Glyphs, type IconGlyph } from '../../icons';
import { font, radius, size, spacing } from '../../theme';

/**
 * The grouped navigation rows of the Me hub and the settings list — `mobile-design` skill §2.
 *
 * <p>A group is one raised block (`whiteMuted` in a white sheet, `surface2` on the canvas) under
 * a small uppercase heading. A row is a {@link PressableScale}: a Bulk glyph in a round badge,
 * the label, and a trailing `ArrowRight2` — or `ExportSquare` for a row that leaves for the
 * browser, so the difference is a shape as well as a role.
 */

export function RowGroup({
  title,
  children,
  testID,
}: {
  /** Announced as a header. */
  readonly title?: string;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  const block = blockSurface(useSurface());
  return (
    <View style={styles.group} testID={testID}>
      {title === undefined ? null : (
        <Eyebrow accessibilityRole="header" style={styles.heading}>
          {title}
        </Eyebrow>
      )}
      <View style={[styles.block, { backgroundColor: BLOCK[block].rest }]}>{children}</View>
    </View>
  );
}

export interface NavRowProps {
  readonly label: string;
  readonly icon: IconGlyph;
  readonly onPress: () => void;
  /** `button` for a screen in the app, `link` for a page that opens in the browser. */
  readonly accessibilityRole?: 'button' | 'link';
  readonly accessibilityHint?: string;
  /** A second line under the label. */
  readonly detail?: string;
  /** Opens outside the app: the trailing glyph says so. */
  readonly external?: boolean;
  readonly testID?: string;
}

/** The badge behind a row's glyph: an `IconButton`'s 40pt circle. */
const BADGE = spacing[10];

export function NavRow({
  label,
  icon,
  onPress,
  accessibilityRole = 'button',
  accessibilityHint,
  detail,
  external = false,
  testID,
}: NavRowProps) {
  const surface = useSurface();
  const block = blockSurface(surface);
  return (
    <PressableScale
      accessibilityRole={accessibilityRole}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      testID={testID}
      contentStyle={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: BLOCK[block].pressed },
      ]}
    >
      <View style={[styles.badge, { backgroundColor: BLOCK[block].badge }]}>
        <Icon icon={icon} variant="bulk" size={20} color={TONES[surface].primary} />
      </View>
      <View style={styles.text} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Body tone="primary" style={styles.label} numberOfLines={2}>
          {label}
        </Body>
        {detail === undefined || detail === '' ? null : <Caption numberOfLines={1}>{detail}</Caption>}
      </View>
      <Icon
        icon={external ? Glyphs.ExportSquare : Glyphs.ArrowRight2}
        size={18}
        color={TONES[surface].tertiary}
      />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing[2] },
  heading: { paddingHorizontal: spacing[1] },
  block: { borderRadius: radius.lg, overflow: 'hidden', paddingVertical: spacing[1] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: size.touchTarget + spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  badge: {
    width: BADGE,
    height: BADGE,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: spacing[1] / 2 },
  label: { ...font.medium },
});
