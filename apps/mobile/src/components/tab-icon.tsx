import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * The five tab glyphs — issue #150.
 *
 * The tab bar carries no labels, so the drawing is the whole of the control. They are
 * stroked outlines on a 24-unit grid, in the same line style the web's icons use, and
 * take their colour from the tab's tint so the active lime and the inactive tertiary
 * come from one place. The active glyph is drawn slightly heavier: colour alone must not
 * be the only signal of where somebody is (CLAUDE.md §2).
 */

export type TabIconName = 'home' | 'search' | 'saved' | 'pledges' | 'me';

const PATHS: Record<TabIconName, readonly string[]> = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V21h5v-6h4v6h5V9.5'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.3-4.3'],
  saved: ['M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1Z'],
  pledges: [
    'M12 20.5s-8-4.6-8-10.7A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 2.8c0 6.1-8 10.7-8 10.7Z',
  ],
  me: ['M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z', 'M4 21a8 8 0 0 1 16 0'],
};

export function TabIcon({
  name,
  color,
  focused,
  size = 26,
}: {
  readonly name: TabIconName;
  readonly color: ColorValue;
  readonly focused: boolean;
  readonly size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
      {PATHS[name].map((d) => (
        <Path
          key={d}
          d={d}
          stroke={color}
          strokeWidth={focused ? 2.4 : 1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}
