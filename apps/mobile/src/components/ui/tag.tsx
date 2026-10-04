import { StyleSheet, Text, View } from 'react-native';
import { colors, font, fontSize, radius, tint, tracking } from '../../theme';
import { Icon, type IconComponent } from './icon';
import { TONES, useSurface, type Surface } from './surface';

/**
 * A small label for a state, a source or a category — the native `Tag` (`docs/ui-kit.md` §7.5).
 *
 * <h2>Always words</h2>
 *
 * `label` is required and is what the tag says, because a tag is where colour most wants to carry
 * the meaning alone: a green chip beside a campaign reads as "fine" to somebody who can see green
 * and as nothing to somebody who cannot (CLAUDE.md §2). The hue is the reminder; the word is the
 * fact. An icon may sit beside the word, never instead of it.
 *
 * <h2>Tints derived from the token</h2>
 *
 * The web writes `bg-danger/12`. Here the same 12% comes from `tint(colors.danger, 0.12)`, which
 * reads the channels out of the token value, so a status tint follows its token the day the token
 * changes and no `rgba(...)` is ever typed by hand.
 *
 * <h2>The surface picks the neutral variant</h2>
 *
 * The web's `default` tag disappears inside a lime card — surface-3 on lime, white/64 on lime — and
 * the web relies on the caller remembering `onLime` there. React Native has the surface in context
 * already (`ui/surface.tsx`), so a tag that asks for `default` on a lime or white surface is drawn
 * as `onLime` or `onWhite`.
 *
 * <p>A status tag keeps its tint and its icon on lime and white, but not its coloured words: green,
 * orange, red and hot text measure about 1.8–2:1 on white and worse on lime, which is a tag nobody
 * can read. There the words take the surface's primary tone (near-black), the 12% tint still says
 * which status it is, and the word says what the status is — so the meaning never rests on a hue
 * that has stopped being legible.
 *
 * <h2>It hugs its word, and follows its parent's alignment</h2>
 *
 * The tag sits in a wrapper that takes whatever place the parent gives it, and hugs its word inside
 * that place — the arrangement `Pill` uses. An `alignSelf` on the tag itself would override a
 * parent's `alignItems: 'center'`, which is how a tag in a centred empty state ended up on the
 * left. `maxWidth: '100%'` and a shrinking label keep a long word inside a narrow column.
 */

export type TagVariant =
  'default' | 'onLime' | 'onWhite' | 'success' | 'warning' | 'danger' | 'hot' | 'urgent';

export interface TagProps {
  /** The visible text AND what a screen reader reads. Required: a tag is never colour alone. */
  readonly label: string;
  readonly variant?: TagVariant;
  /** A glyph before the word. Decorative, since the word already says it. */
  readonly icon?: IconComponent;
  readonly testID?: string;
}

/** Each variant on the dark surface it was designed for. */
const SKIN: Record<TagVariant, { background: string; text: string }> = {
  default: { background: colors.surface3, text: colors.textSecondary },
  onLime: { background: tint(colors.textOnLime, 0.1), text: TONES.lime.secondary },
  onWhite: { background: tint(colors.black, 0.06), text: TONES.white.secondary },
  success: { background: tint(colors.success, 0.12), text: colors.success },
  warning: { background: tint(colors.warning, 0.12), text: colors.warning },
  danger: { background: tint(colors.danger, 0.12), text: colors.danger },
  hot: { background: tint(colors.hot, 0.12), text: colors.hot },
  /*
   * "Act now": a lime FILL with near-black words — the one way lime may carry text (§2.3, §9.1).
   * The campaign card's last-48-hours countdown (#153), and nothing else on a card is lime.
   */
  urgent: { background: colors.lime500, text: colors.textOnLime },
};

/** The neutral variant that is legible on each surface. */
const NEUTRAL: Record<Surface, TagVariant> = {
  dark: 'default',
  lime: 'onLime',
  white: 'onWhite',
  accent: 'onWhite',
};

export function Tag({ label, variant = 'default', icon, testID }: TagProps) {
  const surface = useSurface();
  const resolved = variant === 'default' ? NEUTRAL[surface] : variant;
  const skin = SKIN[resolved];
  const status =
    resolved !== 'default' &&
    resolved !== 'onLime' &&
    resolved !== 'onWhite' &&
    resolved !== 'urgent';
  // On lime or white a status colour is illegible as text; the surface's own ink is not.
  const words = status && surface !== 'dark' ? TONES[surface].primary : skin.text;

  return (
    <View style={styles.hug}>
      <View style={[styles.tag, { backgroundColor: skin.background }]} testID={testID}>
        {icon === undefined ? null : <Icon icon={icon} size={12} color={skin.text} />}
        <Text style={[styles.label, { color: words }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hug: { alignItems: 'flex-start', maxWidth: '100%' },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    gap: 4,
    // A minimum rather than the web's fixed 26, with a little vertical padding: Dynamic Type grows
    // the word, and a fixed box would clip it or let it touch the edges.
    minHeight: 26,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  label: { ...font.medium, fontSize: fontSize.xs, letterSpacing: tracking.tag, flexShrink: 1 },
});
