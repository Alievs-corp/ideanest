import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useT } from '../../../../lib/i18n';
import {
  font,
  fontSize,
  lineHeight,
  radius,
  readingMeasure,
  size,
  spacing,
  tracking,
} from '../../../../theme';
import { toneColor } from '../../../text';
import { Pill, SurfaceProvider, TONES, useSurface } from '../../../ui';
import { BLOCK, blockSurface } from '../../../ui/surface';

/**
 * The pieces the Creator, FAQ and Updates tabs share (#155): the tab's H2, the one sentence a tab
 * says instead of its list (failed, or empty), and the raised block a question or an update sits
 * in. One place, so the three tabs cannot drift apart into three heading sizes.
 *
 * <p>The tabs are drawn inside the campaign page's white content sheet (`mobile-design` skill §2),
 * so every colour here is read from the surface (`useSurface()`): on-white tones and `whiteMuted`
 * blocks in the sheet, the dark tones and `surface2` blocks anywhere else.
 *
 * <p>Every size here is a minimum or comes from the type scale: no text sits in a fixed-height box,
 * so Dynamic Type grows a card rather than clipping it.
 */

/**
 * A tab's H2 — the web's `text-xl font-medium tracking-[-0.02em]` (20pt, the `h3` step at phone
 * width), the same heading `CampaignRisks` draws. The space above it is the Campaign tab's 32
 * between the tab bar and the first block.
 */
export function TabHeading({
  children,
  testID,
}: {
  readonly children: string;
  readonly testID?: string;
}) {
  const tone = TONES[useSurface()];
  return (
    <View style={styles.headingRow}>
      <Text
        accessibilityRole="header"
        style={[styles.heading, { color: tone.primary }]}
        testID={testID}
      >
        {children}
      </Text>
    </View>
  );
}

/**
 * The sentence a tab shows where its list would be — "could not be loaded" or "nothing yet" — in
 * the surface's secondary tone. A failure carries "Try again", because the web's "Reload the page"
 * has no page to reload here; pull to refresh does the same, and the pill is the way to it that a
 * screen reader can find.
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
  const tone = TONES[useSurface()];
  return (
    <View style={styles.note} testID={testID}>
      <Text style={[styles.noteText, { color: tone.secondary }]}>{text}</Text>
      {onRetry === undefined ? null : (
        <Pill
          label={t('common.tryAgain')}
          variant="outline"
          size="sm"
          busy={retrying}
          onPress={onRetry}
        />
      )}
    </View>
  );
}

/**
 * The raised block one entry sits in: `whiteMuted` inside the sheet, `surface2` on the canvas,
 * never a border-only box. `gap` is the space between its lines: 8 for a question and its answer,
 * 12 for an update. Not a control — an entry has nothing to open — so it does not press.
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
  const block = blockSurface(useSurface());
  return (
    <View style={[styles.card, { gap, backgroundColor: BLOCK[block].rest }]} testID={testID}>
      <SurfaceProvider surface={block}>{children}</SurfaceProvider>
    </View>
  );
}

/** An entry's colours on the surface it is drawn on: its title, its long text, and its meta line. */
export function useEntryTones(): {
  readonly title: string;
  readonly body: string;
  readonly meta: string;
} {
  const surface = useSurface();
  return {
    title: TONES[surface].primary,
    body: toneColor('reading', surface),
    meta: TONES[surface].secondary,
  };
}

/**
 * The styles an entry's own lines take: an H3, and long text with its line breaks kept. Colourless:
 * the colour comes from {@link useEntryTones}, so it follows the surface.
 */
export const entryText = StyleSheet.create({
  /** The web's `text-base font-medium`, as a heading a screen reader can jump to. */
  title: {
    ...font.medium,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
    letterSpacing: tracking.body,
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
  },
});

const styles = StyleSheet.create({
  headingRow: { paddingTop: spacing[8] },
  heading: {
    ...font.medium,
    fontSize: fontSize.h3,
    lineHeight: lineHeight.h3,
    letterSpacing: tracking.h3,
  },
  note: { alignItems: 'flex-start', gap: spacing[3], paddingTop: spacing[6] },
  noteText: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
  },
  card: {
    padding: size.cardPaddingSmall,
    borderRadius: radius.xl,
  },
});
