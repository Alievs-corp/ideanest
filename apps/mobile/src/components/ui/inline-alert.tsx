import { useEffect, useRef, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react-native';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, spacing } from '../../theme';
import { announce } from './announce';
import { Icon, type IconComponent } from './icon';
import { IconButton } from './icon-button';
import { SurfaceProvider } from './surface';

/**
 * A message attached to the thing it is about — the native `InlineAlert` (`docs/ui-kit.md` §7.15).
 *
 * <p>This is how the web says every error, every signed-out prompt and every explanation outside
 * the admin console, which has the only toasts; so it is also how the app says them, and no toast
 * is built (issue #151).
 *
 * <h2>Shape and colour</h2>
 *
 * Surface-2 with a 2pt left rule in the status colour — the shape §8.1 gives "payment failed", so a
 * failed pledge looks the same wherever it appears. **Success is `success`, never lime**: lime says
 * "act now", and a backer who reads it as "done" has been told the opposite of the truth.
 *
 * <p>Colour is never alone. Every variant pairs its hue with its own icon — `Info`, `CircleCheck`,
 * `TriangleAlert`, `CircleAlert`, the web's — and the words carry the message itself, so it reads
 * to somebody with a colour-vision deficiency and to a screen reader, which sees no colour at all.
 *
 * <h2>Only warning and danger interrupt</h2>
 *
 * The web gives those two `role="alert"`, which cuts into whatever a screen reader is saying, and
 * leaves `info` and `success` plain: interrupting somebody to say "saved" is a cost with no payoff,
 * and an alert that fires for everything stops being one. Natively that is **one mechanism per
 * platform**, so nothing is read twice:
 *
 * <ul>
 *   <li>Android: the alert is a live region — `assertive` for warning and danger, `polite` for info
 *       and success — which TalkBack reads when the alert appears and again when its words change
 *       (a second failure replacing the first). Nothing is announced by hand there: an
 *       `announceForAccessibility` on top of an assertive live region is the same sentence
 *       twice.</li>
 *   <li>iOS has no live regions, so a warning or danger alert's words go through `announce()`,
 *       assertively, when it appears and when they change — the moments the web's `role="alert"`
 *       speaks. Info and success are read where they sit.</li>
 * </ul>
 *
 * <p>`politeness` overrides the variant's default, for a warning that must look like one without
 * interrupting — the `Screen`'s offline notice, which the global offline banner has already
 * announced once and which would otherwise be said again on every screen mounted.
 *
 * <p>The alert resets the surface to dark for its contents: it is always surface-2, so an action
 * placed in it inside a lime card must still be drawn for the dark surface it actually sits on.
 */

export type InlineAlertVariant = 'info' | 'success' | 'warning' | 'danger';

const VARIANT: Record<InlineAlertVariant, { icon: IconComponent; colour: string }> = {
  info: { icon: Info, colour: colors.info },
  success: { icon: CircleCheck, colour: colors.success },
  warning: { icon: TriangleAlert, colour: colors.warning },
  danger: { icon: CircleAlert, colour: colors.danger },
};

export interface InlineAlertProps {
  readonly variant?: InlineAlertVariant;
  readonly title?: string;
  readonly description?: string;
  /** The one thing to do about it, when there is one — a pill or a link, below the words. */
  readonly action?: ReactNode;
  /** Shows the dismiss button. Omit for a message the reader must not lose. */
  readonly onDismiss?: () => void;
  /** The dismiss button's accessible name. Defaults to the catalogue's "Dismiss". */
  readonly dismissLabel?: string;
  /**
   * Whether the alert interrupts a screen reader. `assertive` for warning and danger and `polite`
   * otherwise, unless overridden.
   */
  readonly politeness?: 'assertive' | 'polite';
  readonly testID?: string;
}

export function InlineAlert({
  variant = 'info',
  title,
  description,
  action,
  onDismiss,
  dismissLabel,
  politeness,
  testID,
}: InlineAlertProps) {
  const t = useT('mobile.kitDisplay');
  const { icon, colour } = VARIANT[variant];
  const assertive =
    (politeness ?? (variant === 'warning' || variant === 'danger' ? 'assertive' : 'polite')) ===
    'assertive';
  const words = [title, description].filter((part) => part !== undefined && part !== '').join('. ');

  useAnnouncedOnArrival(assertive && Platform.OS === 'ios' ? words : '');

  return (
    <View
      accessibilityLiveRegion={assertive ? 'assertive' : 'polite'}
      style={[styles.alert, { borderLeftColor: colour }]}
      testID={testID}
    >
      <SurfaceProvider surface="dark">
        <View style={styles.icon}>
          <Icon icon={icon} size={16} color={colour} />
        </View>
        <View style={styles.words}>
          {title === undefined || title === '' ? null : (
            <Text style={[styles.text, styles.title]}>{title}</Text>
          )}
          {description === undefined || description === '' ? null : (
            <Text style={[styles.text, styles.description]}>{description}</Text>
          )}
          {action === undefined ? null : <View style={styles.action}>{action}</View>}
        </View>
        {onDismiss === undefined ? null : (
          <View style={styles.dismiss}>
            <IconButton
              icon={X}
              label={dismissLabel ?? t('dismiss')}
              onPress={onDismiss}
              variant="ghost"
              size="sm"
            />
          </View>
        )}
      </SurfaceProvider>
    </View>
  );
}

/**
 * Says `message` once, assertively, the first time it is non-empty for this alert — iOS's half of
 * `role="alert"` appearing. A re-render with the same words says nothing; new words (the alert
 * re-used for a different failure) are a new arrival and are said. Android passes an empty message:
 * its live region already speaks.
 */
function useAnnouncedOnArrival(message: string): void {
  const said = useRef('');
  useEffect(() => {
    if (message === '' || message === said.current) return;
    said.current = message;
    announce(message, { assertive: true });
  }, [message]);
}

const styles = StyleSheet.create({
  alert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.md,
    borderLeftWidth: 2,
    backgroundColor: colors.surface2,
  },
  // Centres the 16pt glyph on the first line of 14pt text.
  icon: { height: lineHeight.small, justifyContent: 'center' },
  words: { flex: 1, minWidth: 0, gap: spacing[1] },
  text: { fontSize: fontSize.sm, lineHeight: lineHeight.small },
  title: { ...font.medium, color: colors.textPrimary },
  description: { ...font.regular, color: colors.textSecondary },
  action: { marginTop: spacing[2], flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  // The 32pt button sits inside the padding the way the web's `-m-1` does.
  dismiss: { marginVertical: -spacing[2], marginRight: -spacing[2] },
});
