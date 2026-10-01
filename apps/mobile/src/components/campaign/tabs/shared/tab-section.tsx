import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useT } from '../../../../lib/i18n';
import {
  colors,
  font,
  fontSize,
  lineHeight,
  radius,
  readingMeasure,
  spacing,
  tracking,
} from '../../../../theme';
import { Pill } from '../../../ui';

/**
 * The pieces the Creator, FAQ and Updates tabs share (#155): the tab's H2, the one sentence a tab
 * says instead of its list (failed, or empty), and the surface-2 card a question or an update sits
 * in. One place, so the three tabs cannot drift apart into three heading sizes.
 *
 * <p>Every size here is a minimum or comes from the type scale: no text sits in a fixed-height box,
 * so Dynamic Type grows a card rather than clipping it.
 */

/**
 * A tab's H2 — the web's `text-xl font-medium tracking-[-0.02em]` (20pt, the `h3` step at phone
 * width), the same heading `CampaignRisks` draws. The space above it is the Campaign tab's 32
 * between the tab bar and the first block.
 */
export function TabHeading({ children, testID }: { readonly children: string; readonly testID?: string }) {
  return (
    <View style={styles.headingRow}>
      <Text accessibilityRole="header" style={styles.heading} testID={testID}>
        {children}
      </Text>
    </View>
  );
}

/**
 * The sentence a tab shows where its list would be — "could not be loaded" or "nothing yet" — in
 * the web's `text-sm text-white/64`. A failure carries "Try again", because the web's "Reload the
 * page" has no page to reload here; pull to refresh does the same, and the pill is the way to it
 * that a screen reader can find.
 */
export function TabNote({
  text,
  onRetry,
  retrying = false,
  testID,
}: {
  readonly text: string;
  readonly onRetry?: () => void;
  readonly retrying?: boolean;
  readonly testID?: string;
}) {
  const t = useT();
  return (
    <View style={styles.note} testID={testID}>
      <Text style={styles.noteText}>{text}</Text>
      {onRetry === undefined ? null : (
        <Pill
          label={t('common.tryAgain')}
          variant="ghost"
          size="sm"
          busy={retrying}
          onPress={onRetry}
        />
      )}
    </View>
  );
}

/**
 * The surface-2 card one entry sits in — the web's `rounded-lg border border-white/8 bg-surface-2
 * p-5`. `gap` is the space between its lines: 8 for a question and its answer, 12 for an update.
 */
export function EntryCard({
  children,
  gap,
  testID,
}: {
  readonly children: ReactNode;
  readonly gap: number;
  readonly testID?: string;
}) {
  return (
    <View style={[styles.card, { gap }]} testID={testID}>
      {children}
    </View>
  );
}

/** The styles an entry's own lines take: an H3, and long text with its line breaks kept. */
export const entryText = StyleSheet.create({
  /** The web's `text-base font-medium text-white`, as a heading a screen reader can jump to. */
  title: {
    ...font.medium,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
    letterSpacing: tracking.body,
    color: colors.textPrimary,
  },
  /**
   * The web's `text-[1.0625rem] leading-[1.75] whitespace-pre-line text-reading`, capped at the
   * reading measure. React Native keeps `\n` in a `Text`, which is `pre-line`; the text is drawn
   * as text, never as markup.
   */
  body: {
    ...font.regular,
    maxWidth: readingMeasure,
    fontSize: fontSize.reading,
    lineHeight: lineHeight.story,
    letterSpacing: tracking.reading,
    color: colors.textReading,
  },
});

const styles = StyleSheet.create({
  headingRow: { paddingTop: spacing[8] },
  heading: {
    ...font.medium,
    fontSize: fontSize.h3,
    lineHeight: lineHeight.h3,
    letterSpacing: tracking.h3,
    color: colors.textPrimary,
  },
  note: { alignItems: 'flex-start', gap: spacing[3], paddingTop: spacing[6] },
  noteText: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    color: colors.textSecondary,
  },
  card: {
    padding: spacing[5],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
});
