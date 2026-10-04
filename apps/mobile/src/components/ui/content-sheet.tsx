import { createContext, useContext, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../../theme';
import { CardTitle } from '../text';
import { useTabBarInset } from '../tab-bar';
import { SurfaceProvider, TONES } from './surface';

/**
 * The white content sheet a screen's main content sits in — `mobile-design` skill §2.
 *
 * <p>Not the modal {@link Sheet}: this one is part of the page. It spans the screen's width from
 * inside `Screen`'s gutter, takes `radius.xl` top corners and a decorative grabber, and runs on
 * to the bottom edge, under the floating tab bar, while padding its own content clear of the bar
 * and the home indicator. Everything inside reads in the white surface's tones.
 */

export interface ContentSheetProps {
  readonly title?: string;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/**
 * The bottom padding the sheet's scroll host already gives, which the sheet pulls back to reach the
 * edge. `Screen` publishes its own; a host without a provider is assumed to pad the safe-area inset
 * or the tab bar, whichever is larger.
 */
export const SheetHostPaddingContext = createContext<number | null>(null);

/** `Screen`'s side gutter, which the sheet bleeds through. */
const GUTTER = spacing[5];

export function ContentSheet({ title, actions, children, style, testID }: ContentSheetProps) {
  const insets = useContext(SafeAreaInsetsContext);
  const tail = Math.max(useTabBarInset(), insets?.bottom ?? 0);
  const host = useContext(SheetHostPaddingContext) ?? tail;
  const header = (title !== undefined && title !== '') || actions !== undefined;

  return (
    <View
      testID={testID}
      style={[styles.sheet, { marginBottom: -host, paddingBottom: Math.max(tail, host) + spacing[6] }, style]}
    >
      <View style={styles.grabber} accessible={false} importantForAccessibility="no" />
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
        <View style={styles.body}>{children}</View>
      </SurfaceProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flexGrow: 1,
    marginHorizontal: -GUTTER,
    paddingHorizontal: GUTTER,
    paddingTop: spacing[3],
    backgroundColor: colors.whiteSurface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  grabber: {
    alignSelf: 'center',
    width: spacing[8] + spacing[1],
    height: spacing[1],
    borderRadius: radius.full,
    backgroundColor: TONES.white.tertiary,
    marginBottom: spacing[4],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[4],
    marginBottom: spacing[4],
  },
  title: { flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  body: { gap: spacing[4] },
});
