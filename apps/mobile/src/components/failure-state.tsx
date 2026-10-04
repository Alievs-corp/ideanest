import { useContext, useState, type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Glyphs } from '../icons';
import { useT } from '../lib/i18n';
import { colors, radius, size, spacing } from '../theme';
import { useTabBarInset } from './tab-bar';
import { Body, Heading, Meta } from './text';
import { Icon, Pill, PressableScale, useFocusRing, type IconComponent } from './ui';
import { WhatsAppSheet } from './whatsapp-sheet';

/**
 * The failure screen — issue #150. The app's counterpart of the web's `FailureState`.
 *
 * A centred column: a Bulk icon on a raised disc (`mobile-design` skill §5), heading, description,
 * an optional reference line, and one **white** pill for the way out — the kit's `Pill`, `primary`,
 * large. White rather than lime, as on the web: lime means "act now" on a live surface, and a page
 * that is not there is not one. Nothing animates in: a failure is shown at once.
 *
 * <p>Below it, "Message us on WhatsApp" as a quiet text link. A reader stuck on a failure is
 * the reader most likely to want a person, and the web's floating button — which is how they
 * would reach one there — is not in the app.
 *
 * <p>Safe areas: the column clears the home indicator and, under a tab, the floating tab bar
 * (`useTabBarInset()`), and the side insets in landscape. The top inset is taken only with
 * `safeTop`, for a screen with no header above it.
 */
export function FailureState({
  title,
  description,
  note,
  actionLabel,
  onAction,
  reference,
  busy = false,
  icon = Glyphs.Warning2,
  safeTop = false,
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
  /** The Bulk glyph over the heading. Decorative: the heading says what happened. */
  readonly icon?: IconComponent;
  /** Pad below the status bar: the screen has no header above it. */
  readonly safeTop?: boolean;
  readonly children?: ReactNode;
  readonly testID?: string;
}) {
  const t = useT('shell.failure.pages.error');
  const tWhatsApp = useT('shell.whatsapp');
  const [contacting, setContacting] = useState(false);
  const insets = useContext(SafeAreaInsetsContext);
  const tabInset = useTabBarInset();
  const ring = useFocusRing();

  const padding = {
    paddingTop: (safeTop ? (insets?.top ?? 0) : 0) + spacing[6],
    paddingBottom: Math.max(insets?.bottom ?? 0, tabInset) + spacing[6],
    paddingLeft: size.cardPaddingLarge + (insets?.left ?? 0),
    paddingRight: size.cardPaddingLarge + (insets?.right ?? 0),
  };

  return (
    <ScrollView style={styles.fill} contentContainerStyle={[styles.screen, padding]} testID={testID}>
      <View style={styles.disc}>
        <Icon icon={icon} variant="bulk" size={32} color={colors.textPrimary} />
      </View>
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
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={tWhatsApp('open')}
        onPress={() => setContacting(true)}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        contentStyle={({ pressed }) => [styles.link, pressed && styles.linkPressed, ring.ring]}
      >
        <Body
          tone="secondary"
          style={styles.linkText}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {tWhatsApp('open')}
        </Body>
      </PressableScale>
      <WhatsAppSheet visible={contacting} onClose={() => setContacting(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surface1 },
  screen: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
    backgroundColor: colors.surface1,
  },
  disc: {
    width: spacing[16],
    height: spacing[16],
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
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
