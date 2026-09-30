import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';
import { useT } from '../../lib/i18n';
import { colors, spacing } from '../../theme';
import { ErrorState } from './empty-state';
import { haptics } from './haptics';
import { InlineAlert } from './inline-alert';
import { MotionBudgetProvider, type MotionLevel } from './motion-budget';
import { AccentScopeProvider, Pill } from './pill';

/**
 * The standard screen scaffold — issue #151's native-only `Screen`.
 *
 * <h2>What every screen would otherwise do by hand</h2>
 *
 * <ul>
 *   <li><strong>Safe areas.</strong> The insets from `react-native-safe-area-context`, on the edges
 *       the screen owns. Left and right by default; a screen with no header adds `top`, and one
 *       with no tab bar under it adds `bottom` — a header and a tab bar already clear their own
 *       edge, and a second inset there is a gap.</li>
 *   <li><strong>20pt sides</strong>, `size.cardPaddingSmall`, the web's page gutter at phone
 *       width.</li>
 *   <li><strong>Pull to refresh</strong>, when `onRefresh` is given: a `RefreshControl` in token
 *       colours — white on surface-3, not lime: a refresh is not the one urgent thing on the
 *       screen — that fires `haptics.refresh()` — §7's one haptic for it — as the pull lands.</li>
 *   <li><strong>One accent per screen.</strong> The content sits in an `AccentScopeProvider`, the
 *       scope `Pill`'s two-accent warning counts in, so a stack that keeps the last screen mounted
 *       does not count both screens' accents together.</li>
 *   <li><strong>The motion budget</strong>, when `motion` is given: the route declares its level
 *       once (`docs/motion-system.md` §5) and every animated primitive under it reads it.</li>
 * </ul>
 *
 * <h2>The order of the states is fixed here</h2>
 *
 * `components/states.tsx` documents the order and each screen used to re-derive it: **cached data
 * first, then the error, then the empty state** (§4.12 MB-04). A screen that shows "nothing here"
 * when it failed to find out, or a full-screen error over a list it still has, is the bug that rule
 * prevents. So the scaffold decides, from what it is told:
 *
 * <ol>
 *   <li>`offlineNotice`, the sentence saying the data is from the cache, on top;</li>
 *   <li>with content (`hasContent`), the content — a real list, even an old one, wins — and, when
 *       there is also an `error`, a compact danger alert above it with a retry, so a failed pull to
 *       refresh over cached data says so instead of failing silently;</li>
 *   <li>without content, the `error` as a full `ErrorState`, if there is one;</li>
 *   <li>otherwise the empty state.</li>
 * </ol>
 *
 * <p>Whether there is content is a prop the screen passes, not something counted from `children`:
 * a header, or a list component that renders nothing, is a child and is not content, and counting
 * it would hide the error and the empty state for ever.
 *
 * <h2>The offline notice is read, not announced</h2>
 *
 * It keeps the warning look — stripe, icon, words — because stale money is worth a glance. It does
 * not interrupt: the global offline banner (`components/offline-banner.tsx`) already announces the
 * connection dropping, once, and a screen that announced "these pledges are from your last visit"
 * assertively on every mount would say it again on every navigation. So it is polite — read where
 * it sits in the screen, and on Android re-read if its words change. `offlineNotice` is the
 * screen's own sentence about its own data, which only the screen knows.
 */

/** A failure, in words; the scaffold draws it full-screen or compact depending on the content. */
export interface ScreenError {
  readonly title: string;
  readonly description?: string;
  readonly onRetry: () => void;
  readonly retrying?: boolean;
  /** The failed response's `X-Trace-Id`, printed on the full-screen error. */
  readonly traceId?: string | null;
}

export interface ScreenProps {
  /** Whether the screen has content to show — cached or fresh. Decides which state is drawn. */
  readonly hasContent: boolean;
  /** The content, drawn when `hasContent`. */
  readonly children?: ReactNode;
  /** The sentence saying the content is from the cache. Drawn above everything else. */
  readonly offlineNotice?: string | null;
  /** The last request failed. Full-screen without content; a compact alert above it with. */
  readonly error?: ScreenError | null;
  /** Drawn when there is no content and no error — usually an `EmptyState`. */
  readonly empty?: ReactNode;
  /** Pull to refresh. Needs `scroll`: a screen that brings its own list gives it the control. */
  readonly onRefresh?: () => void;
  readonly refreshing?: boolean;
  /** The route's motion budget, `docs/motion-system.md` §5. Inherited when absent. */
  readonly motion?: MotionLevel;
  /** A scroll view (the default), or a plain view for a screen whose content is its own list. */
  readonly scroll?: boolean;
  /** The safe-area edges this screen owns. */
  readonly edges?: readonly Edge[];
  readonly testID?: string;
}

const SIDE = spacing[5];

export function Screen({
  hasContent,
  children,
  offlineNotice,
  error,
  empty,
  onRefresh,
  refreshing = false,
  motion,
  scroll = true,
  edges = ['left', 'right'],
  testID,
}: ScreenProps) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const owns = (edge: Edge) => edges.includes(edge);

  if (__DEV__ && onRefresh !== undefined && !scroll) {
    console.warn(
      'Screen: onRefresh needs scroll. A screen whose content is its own list gives that list ' +
        'the RefreshControl; this one draws none.',
    );
  }

  const padding = {
    paddingTop: owns('top') ? insets.top : 0,
    paddingBottom: owns('bottom') ? insets.bottom : 0,
    paddingLeft: SIDE + (owns('left') ? insets.left : 0),
    paddingRight: SIDE + (owns('right') ? insets.right : 0),
  };

  const failed = error !== undefined && error !== null;
  let state: ReactNode = null;
  if (hasContent) {
    state = (
      <>
        {failed ? (
          <InlineAlert
            variant="danger"
            title={error.title}
            description={error.description}
            action={
              <Pill
                label={t('common.tryAgain')}
                onPress={error.onRetry}
                busy={error.retrying}
                variant="ghost"
                size="sm"
              />
            }
          />
        ) : null}
        {children}
      </>
    );
  } else if (failed) {
    state = (
      <View style={styles.centred}>
        <ErrorState
          title={error.title}
          description={error.description}
          onRetry={error.onRetry}
          retrying={error.retrying}
          traceId={error.traceId}
        />
      </View>
    );
  } else if (empty !== undefined && empty !== null) {
    state = <View style={styles.centred}>{empty}</View>;
  }

  const body = (
    <>
      {offlineNotice === undefined || offlineNotice === null || offlineNotice === '' ? null : (
        <InlineAlert variant="warning" politeness="polite" description={offlineNotice} />
      )}
      {state}
    </>
  );

  const screen = scroll ? (
    <ScrollView
      testID={testID}
      style={styles.screen}
      contentContainerStyle={[styles.content, padding]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh === undefined ? undefined : (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              haptics.refresh();
              onRefresh();
            }}
            tintColor={colors.textSecondary}
            colors={[colors.textPrimary]}
            progressBackgroundColor={colors.surface3}
          />
        )
      }
    >
      {body}
    </ScrollView>
  ) : (
    <View testID={testID} style={[styles.screen, styles.content, padding]}>
      {body}
    </View>
  );

  return (
    <AccentScopeProvider>
      {motion === undefined ? (
        screen
      ) : (
        <MotionBudgetProvider level={motion}>{screen}</MotionBudgetProvider>
      )}
    </AccentScopeProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface1 },
  content: { flexGrow: 1, gap: spacing[4] },
  // An error or an empty state stands alone on the screen, so it sits in the middle of it.
  centred: { flexGrow: 1, justifyContent: 'center' },
});
