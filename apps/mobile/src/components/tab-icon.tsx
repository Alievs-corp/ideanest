import { Glyphs, type IconGlyph } from '../icons';
import { Icon } from './ui/icon';

/**
 * The tab and header glyphs — Iconsax (issue #274, `mobile-design` skill §3.1 and §5).
 *
 * The tab bar carries no labels, so the drawing is the whole of the control. The active tab
 * takes the Bold drawing and the rest the Linear one: a change of shape as well as of colour,
 * because colour alone must not be the only signal of where somebody is (CLAUDE.md §2).
 */

export type TabIconName = 'home' | 'search' | 'saved' | 'pledges' | 'me' | 'bell';

const GLYPHS: Record<TabIconName, IconGlyph> = {
  home: Glyphs.Home,
  search: Glyphs.SearchNormal1,
  saved: Glyphs.Archive,
  pledges: Glyphs.Heart,
  bell: Glyphs.Notification,
  me: Glyphs.User,
};

export function TabIcon({
  name,
  color,
  focused,
  size = 26,
}: {
  readonly name: TabIconName;
  readonly color: string;
  readonly focused: boolean;
  readonly size?: number;
}) {
  return <Icon icon={GLYPHS[name]} variant={focused ? 'bold' : 'linear'} color={color} size={size} />;
}
