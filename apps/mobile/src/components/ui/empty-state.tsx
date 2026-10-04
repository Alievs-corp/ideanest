import { useEffect, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Glyphs } from '../../icons';
import { useT } from '../../lib/i18n';
import { colors, font, fontSize, lineHeight, radius, spacing, tint, tracking } from '../../theme';
import { announce } from './announce';
import { Icon, type IconComponent } from './icon';
import { Pill } from './pill';
import { BLOCK, SurfaceProvider, TONES, blockSurface, useSurface } from './surface';

/**
 * What a list shows when it has nothing to show, and when it could not find out — the native
 * `EmptyState` (`docs/ui-kit.md` §7.15) and its sibling `ErrorState`.
 *
 * <h2>Two empty variants, because the way out differs</h2>
 *
 * `empty` — nothing exists yet, and the way out is to make something. `filtered` — things exist
 * and this query matched none of them, and the way out is to clear the filter. One message for
 * both sends a creator to "New campaign" when all they did was mistype a search. The icon follows:
 * Iconsax `DirectInbox` and `SearchStatus`.
 *
 * <h2>The title is the message; the icon is decoration</h2>
 *
 * The title is a header (`accessibilityRole="header"`), so a screen-reader user moving by headings
 * lands on the sentence that explains the blank screen. The icon is hidden: "image, inbox" says
 * nothing about why the list is empty.
 *
 * <h2>Shape</h2>
 *
 * `mobile-design` skill §2 and §5: a raised block with generous spacing, a large **Bulk** Iconsax
 * glyph in a soft circular badge, the words, and the one action as a pill. On the dark canvas the
 * block is `surface2`; inside a white sheet (`useSurface() === 'white'`) it is the sheet's
 * `whiteMuted` with on-white text, and a primary `Pill` in it inverts by itself.
 *
 * <p>No animation: an empty list is a dead end, and an error appears at once (skill §6.4).
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
      tone="danger"
      title={title}
      description={description}
      testID={testID}
    >
      <View style={styles.action}>
        <Pill label={t('common.tryAgain')} onPress={onRetry} busy={retrying} />
      </View>
      {traceId === undefined || traceId === null || traceId === '' ? null : (
        <Reference label={t('shell.failure.pages.error.referenceLabel')} traceId={traceId} />
      )}
    </StateCard>
  );
}

/** The trace id line, in the tones of the block it sits in. */
function Reference({ label, traceId }: { readonly label: string; readonly traceId: string }) {
  const tones = TONES[blockSurface(useSurface())];
  return (
    <Text selectable style={[styles.reference, styles.centred, { color: tones.tertiary }]}>
      {label}{' '}
      <Text selectable style={[styles.referenceId, { color: tones.secondary }]}>
        {traceId}
      </Text>
    </Text>
  );
}

function StateCard({
  icon,
  tone = 'neutral',
  title,
  description,
  testID,
  children,
}: {
  readonly icon: IconComponent;
  readonly tone?: 'neutral' | 'danger';
  readonly title: string;
  readonly description?: string;
  readonly testID?: string;
  readonly children?: ReactNode;
}) {
  const block = blockSurface(useSurface());
  const tones = TONES[block];
  const danger = tone === 'danger';
  return (
    <View style={[styles.card, { backgroundColor: BLOCK[block].rest }]} testID={testID}>
      <SurfaceProvider surface={block}>
        <View
          style={[
            styles.badge,
            { backgroundColor: danger ? tint(colors.danger, 0.12) : BLOCK[block].badge },
          ]}
        >
          <Icon
            icon={icon}
            variant="bulk"
            size={ICON_SIZE}
            color={danger ? colors.danger : tones.secondary}
          />
        </View>
        <View style={styles.words}>
          <Text
            accessibilityRole="header"
            style={[styles.title, styles.centred, { color: tones.primary }]}
          >
            {title}
          </Text>
          {description === undefined || description === '' ? null : (
            <Text style={[styles.description, styles.centred, { color: tones.secondary }]}>
              {description}
            </Text>
          )}
        </View>
        {children}
      </SurfaceProvider>
    </View>
  );
}

/** The feature glyph, and its badge at twice its size. */
const ICON_SIZE = 32;

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[10],
    borderRadius: radius.xl,
  },
  badge: {
    width: ICON_SIZE * 2,
    height: ICON_SIZE * 2,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  words: { alignItems: 'center', gap: spacing[2] },
  centred: { textAlign: 'center' },
  title: {
    ...font.semibold,
    fontSize: fontSize.lg,
    lineHeight: lineHeight.cardTitle,
    letterSpacing: tracking.cardTitle,
  },
  description: {
    ...font.regular,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.small,
    // The web's `max-w-[42ch]`: about 42 characters of Inter at 14pt.
    maxWidth: 42 * fontSize.sm * 0.55,
  },
  action: { marginTop: spacing[2], flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  reference: {
    ...font.regular,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.small,
    letterSpacing: tracking.tag,
  },
  // The platform's own fixed-width face, as the failure screen uses: a reader copying the id by
  // hand can tell 0 from O.
  referenceId: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontVariant: ['tabular-nums'],
  },
});
