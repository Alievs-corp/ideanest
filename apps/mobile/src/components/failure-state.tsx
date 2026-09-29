import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { useT } from '../lib/i18n';
import { colors, radius, size, spacing } from '../theme';
import { Body, CardTitle, Heading, Meta } from './text';

/**
 * The failure screen — issue #150. The app's counterpart of the web's `FailureState`.
 *
 * A centred column: heading, description, an optional reference line, and one
 * **white** pill for the way out. White rather than lime, as on the web: lime means
 * "act now" on a live surface, and a page that is not there is not one.
 */
export function FailureState({
  title,
  description,
  actionLabel,
  onAction,
  reference,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
  /** The `X-Trace-Id` of the failed response, when there was one. */
  readonly reference?: string | null;
  readonly children?: ReactNode;
}) {
  const t = useT('shell.failure.pages.error');
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Heading accessibilityRole="header" style={styles.centred}>
        {title}
      </Heading>
      <Body style={styles.centred}>{description}</Body>
      {reference ? <Meta selectable>
          {t('referenceLabel')}: {reference}
        </Meta> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        onPress={onAction}
        style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
      >
        <CardTitle tone="onWhite" accessibilityElementsHidden importantForAccessibility="no">
          {actionLabel}
        </CardTitle>
      </Pressable>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
    paddingHorizontal: size.cardPaddingLarge,
    backgroundColor: colors.surface1,
  },
  centred: { textAlign: 'center' },
  pill: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: size.cardPaddingLarge,
    borderRadius: radius.full,
    backgroundColor: colors.whiteSurface,
  },
  pillPressed: { backgroundColor: colors.whiteMuted },
});
