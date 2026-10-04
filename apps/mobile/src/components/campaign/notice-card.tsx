import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { font, fontSize, lineHeight, readingMeasure, spacing } from '../../theme';
import { toneColor } from '../text';
import { Card, Icon, TONES, useSurface, type IconComponent } from '../ui';

/**
 * The raised block the page's notices share — the trust block, the update obligation and a closed
 * campaign's outcome (#155): a kit `Card`, so `surface2` on the canvas and `whiteMuted` inside the
 * white content sheet (`mobile-design` skill §2), never a border-only box. A bulk feature icon and
 * a header, then the sentences.
 *
 * <p>The card provides its own surface, so the lines below read it themselves: `NoticeText` and
 * `NoticeStrong` are legible on either fill without the caller knowing which it is in.
 */
export function NoticeCard({
  icon,
  iconColor,
  title,
  children,
  testID,
}: {
  readonly icon: IconComponent;
  /** A status hue for the icon (`success` for funded); the words beside it always say the same. */
  readonly iconColor?: string;
  readonly title: string;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  return (
    <Card style={styles.card} testID={testID}>
      <NoticeHeading icon={icon} iconColor={iconColor} title={title} />
      {children}
    </Card>
  );
}

function NoticeHeading({
  icon,
  iconColor,
  title,
}: {
  readonly icon: IconComponent;
  readonly iconColor: string | undefined;
  readonly title: string;
}) {
  const tone = TONES[useSurface()];
  return (
    <View style={styles.heading}>
      <Icon icon={icon} variant="bulk" size={20} color={iconColor ?? tone.secondary} />
      <Text accessibilityRole="header" style={[styles.title, { color: tone.primary }]}>
        {title}
      </Text>
    </View>
  );
}

/** A notice's sentence: `reading` for what it says, `aside` for the line after it. */
export function NoticeText({
  kind,
  children,
  testID,
}: {
  readonly kind: 'reading' | 'aside';
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  const surface = useSurface();
  return (
    <Text
      style={[
        styles.text,
        { color: toneColor(kind === 'reading' ? 'reading' : 'secondary', surface) },
      ]}
      testID={testID}
    >
      {children}
    </Text>
  );
}

/** The emphasised words inside a sentence — the amount, the deadline. */
export function NoticeStrong({ children }: { readonly children: ReactNode }) {
  return <Text style={[styles.strong, { color: TONES[useSurface()].primary }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: { gap: spacing[3] },
  heading: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  title: {
    ...font.medium,
    flexShrink: 1,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
  },
  text: {
    ...font.regular,
    maxWidth: readingMeasure,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
  },
  strong: { ...font.medium },
});
