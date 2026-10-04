import { Glyphs, type IconGlyph } from '../icons';
import { Icon } from './ui/icon';

/**
 * The tab and header glyphs — Iconsax (issues #274 and #276, `mobile-design` skill §3.1 and §5).
 *
 * The tab bar carries no labels, so the drawing is the whole of the control. `TAB_GLYPHS` is keyed
 * by route name for the floating bar, which draws the Bold glyph on the active tab and the Linear
 * one on the rest. The header's bell is a Linear glyph beside its own name.
 */

export const TAB_GLYPHS = {
  index: Glyphs.Home,
  search: Glyphs.SearchNormal1,
  pledges: Glyphs.Heart,
  me: Glyphs.User,
} as const satisfies Record<string, IconGlyph>;

export type TabIconName = 'bell';

const GLYPHS: Record<TabIconName, IconGlyph> = {
  bell: Glyphs.Notification,
};

export function TabIcon({
  name,
  color,
  size = 24,
}: {
  readonly name: TabIconName;
  readonly color: string;
  readonly size?: number;
}) {
  return <Icon icon={GLYPHS[name]} variant="linear" color={color} size={size} />;
}
