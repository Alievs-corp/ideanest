import { createContext, useContext, type ReactNode } from 'react';
import { accent, colors, darkColors, tint } from '../../theme';

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
/**
 * `dark` is the canvas, and follows the theme: on the light theme its tones are dark ink. `night` is
 * a surface that is dark in both themes — the black plan card — and keeps the dark set's tones
 * (docs/ui-kit.md §11). On the dark theme the two are the same.
 */
export type Surface = 'dark' | 'night' | 'lime' | 'white' | 'accent';

/**
 * Every mobile accent names the same near-black text token (`theme.test.ts` holds them to it), so
 * one `accent` row serves the three accent cards (#277).
 */
const ON_ACCENT = accent.sun.text;

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
  night: {
    primary: darkColors.textPrimary,
    secondary: darkColors.textSecondary,
    tertiary: darkColors.textTertiary,
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
  accent: {
    primary: ON_ACCENT,
    secondary: tint(ON_ACCENT, 0.72),
    tertiary: tint(ON_ACCENT, 0.56),
  },
};

/**
 * Which raised-block skin a block takes where it sits: `white` inside a white sheet or panel, `dark`
 * everywhere else (a block placed on a lime or accent card is still a dark block).
 */
export type BlockSurface = 'dark' | 'white';

export function blockSurface(outer: Surface): BlockSurface {
  return outer === 'white' ? 'white' : 'dark';
}

/**
 * Raised blocks — `mobile-design` skill §2. On the canvas a block is `surface2` (pressed
 * `surface3`), never a border-only box; inside a white sheet it is `whiteMuted`, pressed a black/8
 * layer over the sheet. `placeholder` and `shimmer` are a loading block and its travelling band,
 * `track` a bar's empty track, and `badge` the soft circle behind a feature icon, on each.
 */
export const BLOCK: Record<
  BlockSurface,
  {
    readonly rest: string;
    readonly pressed: string;
    readonly placeholder: string;
    readonly shimmer: string;
    readonly track: string;
    readonly badge: string;
  }
> = {
  dark: {
    rest: colors.surface2,
    pressed: colors.surface3,
    placeholder: colors.surface3,
    shimmer: colors.surface4,
    track: colors.surface3,
    badge: colors.surface3,
  },
  white: {
    rest: colors.whiteMuted,
    pressed: tint(colors.black, 0.08),
    placeholder: colors.whiteMuted,
    shimmer: colors.whiteSurface,
    track: colors.whiteMuted,
    badge: colors.whiteSurface,
  },
};

/**
 * The focus ring's colour on a surface: lime on the dark surfaces, and near-black on lime and on
 * white — the same switch `theme.css` makes under `[data-on-lime]` and `[data-on-white]`, because
 * `packages/ui`'s contrast test measures lime on white below 3:1.
 */
/**
 * The block skin for `outer`, keeping a lime or accent card's blocks dark on the light theme too:
 * the card looks the same in both themes (docs/ui-kit.md §11), so a progress track on it stays the
 * dark track it was drawn with. On the dark theme this is `BLOCK[blockSurface(outer)]`.
 */
export function blockFor(outer: Surface): (typeof BLOCK)[BlockSurface] {
  if (outer === 'lime' || outer === 'accent' || outer === 'night') return ISLAND;
  return BLOCK[blockSurface(outer)];
}

const ISLAND: (typeof BLOCK)[BlockSurface] = {
  rest: darkColors.surface2,
  pressed: darkColors.surface3,
  placeholder: darkColors.surface3,
  shimmer: darkColors.surface4,
  track: darkColors.surface3,
  badge: darkColors.surface3,
};

export function focusRingColor(surface: Surface): string {
  return surface === 'dark' ? colors.focusRing : TONES[surface].primary;
}
