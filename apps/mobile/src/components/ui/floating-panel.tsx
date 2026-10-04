import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, shadow, size as measure, spacing } from '../../theme';
import { CardTitle } from '../text';
import { SurfaceProvider } from './surface';

/**
 * A white surface above the system — the native `FloatingPanel` (`docs/ui-kit.md` §7.9), the
 * checkout's pledge summary.
 *
 * <p>In the `mobile-design` skill's white-sheet language (§2, issue #282): the sheet's
 * `whiteSurface` and `radius.xl`, its `spacing[5]` gutters and its near-black title, so a panel on
 * the canvas and a `Sheet` over it read as the same material. It is placed, not presented: no
 * grabber, no scrim and no motion of its own — a screen that wants it to arrive uses `FadeUp`.
 *
 * <p>The one place a shadow is used, because it is the one thing genuinely elevated: a dark shadow
 * under a dark card draws nothing (§3). `shadow.float` is the token's own CSS string, which React
 * Native's `boxShadow` reads as the web does, so there is no second spelling of it here.
 *
 * <p>Text inside is near-black. The panel wraps everything — title, actions and body — in
 * `SurfaceProvider surface="white"`, so a `Body` in it is on-white/64 and an `IconButton` in its
 * actions is drawn for white, where the web asks each call site to remember `text-on-white/64`.
 *
 * <p>The shadow is on an outer view and the clip on an inner one: a view that clips its children
 * is not where a shadow meant to fall outside it should be drawn.
 */

export interface FloatingPanelProps {
  /** The 18pt title, announced as a heading. */
  readonly title?: string;
  /** The right side of the header row, usually icon buttons. */
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

export function FloatingPanel({ title, actions, children, style, testID }: FloatingPanelProps) {
  const header = (title !== undefined && title !== '') || actions !== undefined;

  return (
    <View style={[styles.panel, style]} testID={testID}>
      <View style={styles.clip}>
        <SurfaceProvider surface="white">
          {header ? (
            <View style={styles.header}>
              {title === undefined || title === '' ? (
                <View />
              ) : (
                <CardTitle accessibilityRole="header" style={styles.title}>
                  {title}
                </CardTitle>
              )}
              {actions === undefined ? null : <View style={styles.actions}>{actions}</View>}
            </View>
          ) : null}
          <View style={[styles.body, !header && styles.bodyAlone]}>{children}</View>
        </SurfaceProvider>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: radius.xl,
    backgroundColor: colors.whiteSurface,
    boxShadow: shadow.float,
  },
  clip: { borderRadius: radius.xl, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[4],
    paddingHorizontal: measure.cardPaddingSmall,
    paddingTop: measure.cardPaddingSmall,
    paddingBottom: spacing[3],
  },
  title: { flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  body: { paddingHorizontal: measure.cardPaddingSmall, paddingBottom: measure.cardPaddingSmall },
  bodyAlone: { paddingTop: measure.cardPaddingSmall },
});
