import { createContext, useContext, type ReactNode } from 'react';
import { colors, tint } from '../../theme';

/**
 * Which surface a piece of text or an icon is sitting on — the native `data-on-lime`.
 *
 * <h2>Why this exists</h2>
 *
 * CLAUDE.md §2: "`text-white/64` is invisible on a lime card and on a white panel. Use the
 * `onLime` and `on-white` variants." The web enforces that with an attribute: a lime card carries
 * `data-on-lime`, and every descendant's colour switches under it. React Native has no cascade,
 * so the same decision travels down as context instead. A `Card` with `variant="active"` provides
 * `lime`, a `FloatingPanel` or a `Dialog` provides `white`, and a `Body` inside either asks for
 * `secondary` and gets the tone that is legible where it actually is.
 *
 * <p>Without it, the choice is made at every call site, which is where it goes wrong: the
 * sentence written for a dark card gets moved into a lime one and nobody reads the colour again.
 */
export type Surface = 'dark' | 'lime' | 'white';

/** The three tones a role asks for, relative to whichever surface is underneath. */
export type RelativeTone = 'primary' | 'secondary' | 'tertiary';

const SurfaceContext = createContext<Surface>('dark');

export function SurfaceProvider({ surface, children }: { surface: Surface; children: ReactNode }) {
  return <SurfaceContext.Provider value={surface}>{children}</SurfaceContext.Provider>;
}

export function useSurface(): Surface {
  return useContext(SurfaceContext);
}

/**
 * The colour of each relative tone, per surface.
 *
 * <p>The dark row is the token file's own. The lime and white rows are the opacities the web
 * reaches for most — `text-on-lime/72` and `/50`, `text-on-white/64` and `/50` — and
 * `src/theme/theme.test.ts` measures every cell against every surface of its row, so a new
 * opacity here has to pass the same contrast arithmetic the tokens do.
 */
export const TONES: Record<Surface, Record<RelativeTone, string>> = {
  dark: {
    primary: colors.textPrimary,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
  },
  lime: {
    primary: colors.textOnLime,
    secondary: tint(colors.textOnLime, 0.72),
    tertiary: tint(colors.textOnLime, 0.5),
  },
  white: {
    primary: colors.textOnWhite,
    secondary: tint(colors.textOnWhite, 0.64),
    // Not the web's occasional `/40`: on `--white-muted` that measures under 3:1.
    tertiary: tint(colors.textOnWhite, 0.5),
  },
};

/**
 * The focus ring's colour on a surface: lime on the dark surfaces, and near-black on lime and on
 * white — the same switch `theme.css` makes under `[data-on-lime]` and `[data-on-white]`, because
 * `packages/ui`'s contrast test measures lime on white below 3:1.
 */
export function focusRingColor(surface: Surface): string {
  return surface === 'dark' ? colors.lime500 : TONES[surface].primary;
}
