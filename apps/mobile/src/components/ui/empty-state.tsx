import { useEffect, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Glyphs } from '../../icons';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, spacing, tracking } from '../../theme';
import { announce } from './announce';
import { Icon, type IconComponent } from './icon';
import { Pill } from './pill';
import { SurfaceProvider } from './surface';

/**
 * What a list shows when it has nothing to show, and when it could not find out — the native
 * `EmptyState` (`docs/ui-kit.md` §7.15) and its sibling `ErrorState`.
 *
 * <h2>Two empty variants, because the way out differs</h2>
 *
 * `empty` — nothing exists yet, and the way out is to make something. `filtered` — things exist
 * and this query matched none of them, and the way out is to clear the filter. One message for
 * both sends a creator to "New campaign" when all they did was mistype a search. The icon follows:
 * `Inbox` and `SearchX`, the web's.
 *
 * <h2>The title is the message; the icon is decoration</h2>
 *
 * The title is a header (`accessibilityRole="header"`), so a screen-reader user moving by headings
 * lands on the sentence that explains the blank screen. The icon is hidden: "image, inbox" says
 * nothing about why the list is empty.
 *
 * <p>Restrained on purpose, as on the web: no illustration and no animation. An empty list is a
 * dead end, and a dead end that performs is worse than one that explains. Both states reset the
 * surface to dark for their contents, since the card is always surface-2.
 *
 * <p>These replaced the app's first `EmptyState` and `ErrorState` (`components/states.tsx`, deleted
 * when the screens moved here): the old error had no retry, which is why this one requires it.
 */

const EMPTY_ICON = { empty: Glyphs.DirectInbox, filtered: Glyphs.SearchStatus } as const;

export interface EmptyStateProps {
  readonly variant?: 'empty' | 'filtered';
  /** Overrides the variant's icon. Drawn decoratively. */
  readonly icon?: IconComponent;
  /** The sentence that explains the blank list. */
  readonly title: string;
  readonly description?: string;
  /**
   * The one thing to do about it, when there is one — "New campaign" for `empty`, "Clear filters"
   * for `filtered`. Optional, because most empty states have no answer on this screen.
   */
  readonly action?: ReactNode;
  readonly testID?: string;
}

export function EmptyState({
  variant = 'empty',
  icon,
  title,
  description,
  action,
  testID,
}: EmptyStateProps) {
  return (
    <StateCard
      icon={icon ?? EMPTY_ICON[variant]}
      iconColour={colors.textTertiary}
      title={title}
      description={description}
      testID={testID}
    >
      {action === undefined ? null : <View style={styles.action}>{action}</View>}
    </StateCard>
  );
}

export interface ErrorStateProps {
  readonly title: string;
  readonly description?: string;
  /**
   * Asks again. REQUIRED, at the type level: an error with no way to retry is a dead end the
   * reader can only leave by restarting the application — the old `ErrorState` had exactly that
   * gap (issue #151). The pill says the catalogue's "Try again".
   */
  readonly onRetry: () => void;
  /** The retry is running: the pill shows a spinner and refuses a second press. */
  readonly retrying?: boolean;
  /** The failed response's `X-Trace-Id`, printed as a reference to quote to support. */
  readonly traceId?: string | null;
  readonly testID?: string;
}

/**
 * The same card for a failure: a danger icon, the words, a white "Try again" pill — white, not
 * lime, because retrying is not the one urgent action on a screen (docs/ui-kit.md §7.2) — and the
 * reference line the web's failure pages print.
 *
 * <p>The title is announced once, assertively, when the state appears — the native half of the
 * web's `role="alert"`, since an error that replaces a list is otherwise silent to somebody who
 * cannot see the list go.
 */
export function ErrorState({
  title,
  description,
  onRetry,
  retrying = false,
  traceId,
  testID,
}: ErrorStateProps) {
  const t = useT();

  useEffect(() => {
    announce(title, { assertive: true });
  }, [title]);

  return (
    <StateCard
      icon={Glyphs.Warning2}
      iconColour={colors.danger}
      title={title}
      description={description}
      testID={testID}
    >
      <View style={styles.action}>
        <Pill label={t('common.tryAgain')} onPress={onRetry} busy={retrying} />
      </View>
      {traceId === undefined || traceId === null || traceId === '' ? null : (
        <Text selectable style={[styles.reference, styles.centred]}>
          {t('shell.failure.pages.error.referenceLabel')}{' '}
          <Text selectable style={styles.referenceId}>
            {traceId}
          </Text>
        </Text>
      )}
    </StateCard>
  );
}

function StateCard({
  icon,
  iconColour,
  title,
  description,
  testID,
  children,
}: {
  readonly icon: IconComponent;
  readonly iconColour: string;
  readonly title: string;
  readonly description?: string;
  readonly testID?: string;
  readonly children?: ReactNode;
}) {
  return (
    <View style={styles.card} testID={testID}>
      <SurfaceProvider surface="dark">
        <View style={styles.iconCircle}>
          <Icon icon={icon} variant="bulk" size={20} color={iconColour} />
        </View>
        <Text accessibilityRole="header" style={[styles.title, styles.centred]}>
          {title}
        </Text>
        {description === undefined || description === '' ? null : (
          <Text style={[styles.description, styles.centred]}>{description}</Text>
        )}
        {children}
      </SurfaceProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[12],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface3,
  },
  centred: { textAlign: 'center' },
  title: {
    ...font.medium,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
    letterSpacing: fontSize.base * -0.02,
    color: colors.textPrimary,
  },
  description: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    // The web's `max-w-[42ch]`: about 42 characters of Inter at 14pt.
    maxWidth: 42 * fontSize.sm * 0.55,
    color: colors.textSecondary,
  },
  action: { marginTop: spacing[1], flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  reference: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
    letterSpacing: tracking.tag,
    color: colors.textTertiary,
  },
  // The platform's own fixed-width face, as the failure screen uses: a reader copying the id by
  // hand can tell 0 from O.
  referenceId: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontVariant: ['tabular-nums'],
    color: colors.textSecondary,
  },
});
