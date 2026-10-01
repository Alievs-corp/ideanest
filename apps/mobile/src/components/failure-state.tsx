import { useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useT } from '../lib/i18n';
import { colors, radius, size, spacing } from '../theme';
import { Body, Heading, Meta } from './text';
import { Pill } from './ui';
import { WhatsAppSheet } from './whatsapp-sheet';

/**
 * The failure screen — issue #150. The app's counterpart of the web's `FailureState`.
 *
 * A centred column: heading, description, an optional reference line, and one
 * **white** pill for the way out — the kit's `Pill`, `primary`, large. White rather than lime,
 * as on the web: lime means "act now" on a live surface, and a page that is not there is not one.
 *
 * <p>Below it, "Message us on WhatsApp" as a quiet text link. A reader stuck on a failure is
 * the reader most likely to want a person, and the web's floating button — which is how they
 * would reach one there — is not in the app.
 */
export function FailureState({
  title,
  description,
  note,
  actionLabel,
  onAction,
  reference,
  busy = false,
  children,
  testID,
}: {
  readonly title: string;
  readonly description: string;
  /** A second, quieter line under the description (maintenance's announced end). */
  readonly note?: string | null;
  readonly actionLabel: string;
  readonly onAction: () => void;
  /** The `X-Trace-Id` of the failed response, when there was one. */
  readonly reference?: string | null;
  /**
   * The action is running (maintenance's "Try again" asking the service). The pill says so to a
   * screen reader (`busy`), shows a spinner beside its label, and ignores presses until it is done.
   */
  readonly busy?: boolean;
  readonly children?: ReactNode;
  readonly testID?: string;
}) {
  const t = useT('shell.failure.pages.error');
  const tWhatsApp = useT('shell.whatsapp');
  const [contacting, setContacting] = useState(false);
  return (
    <ScrollView contentContainerStyle={styles.screen} testID={testID}>
      <Heading accessibilityRole="header" style={styles.centred}>
        {title}
      </Heading>
      <Body style={styles.centred}>{description}</Body>
      {note ? (
        <Body tone="secondary" style={styles.centred}>
          {note}
        </Body>
      ) : null}
      {/*
        The web's digest line, word for word: label, the id in a fixed-width face so a reader
        copying it by hand can tell 0 from O, and the hint saying why it is worth quoting.
        Selectable, so it can be long-pressed and pasted into a message.
      */}
      {reference ? (
        <Meta selectable style={styles.centred}>
          {t('referenceLabel')}{' '}
          <Meta selectable tone="secondary" style={styles.reference}>
            {reference}
          </Meta>
          {'. '}
          {t('referenceHint')}
        </Meta>
      ) : null}
      <Pill label={actionLabel} onPress={onAction} busy={busy} size="lg" />
      {children}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tWhatsApp('open')}
        onPress={() => setContacting(true)}
        style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
      >
        <Body
          tone="secondary"
          style={styles.linkText}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {tWhatsApp('open')}
        </Body>
      </Pressable>
      <WhatsAppSheet visible={contacting} onClose={() => setContacting(false)} />
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
  // The platform's own fixed-width face: nothing to load, and present on every device.
  reference: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontVariant: ['tabular-nums'],
  },
  link: {
    minHeight: size.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    borderRadius: radius.full,
  },
  linkPressed: { backgroundColor: colors.surface3 },
  linkText: { textDecorationLine: 'underline' },
});
