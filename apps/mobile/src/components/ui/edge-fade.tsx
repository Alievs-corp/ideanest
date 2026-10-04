import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors, spacing } from '../../theme';
import { useTabBarInset } from '../tab-bar';

/**
 * The fade at the foot of a scrolling list — issue #277, `mobile-design` skill §2.
 *
 * A list inside a sheet runs under the floating tab bar; instead of a hard cut, its last rows fade
 * into the surface behind them. `color` is that surface's token (`whiteSurface` in a sheet,
 * `surface1` on the canvas). The fade is as tall as the bar's footprint plus a gutter, so it ends
 * exactly where the bar begins to cover, and it never takes a touch.
 */

export interface EdgeFadeProps {
  /** The token colour of the surface the list scrolls over. */
  readonly color?: string;
  /** The fade's height. Defaults to the tab bar's footprint and a gutter, or a gutter alone. */
  readonly height?: number;
  readonly testID?: string;
}

export function EdgeFade({ color = colors.whiteSurface, height, testID }: EdgeFadeProps) {
  const tabInset = useTabBarInset();
  const id = `edge-fade-${useId().replace(/:/g, '')}`;
  const tall = height ?? tabInset + spacing[6];
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.fade, { height: tall }]}
      testID={testID}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0} />
            <Stop offset="1" stopColor={color} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
