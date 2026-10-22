import { PROMO_FILM_BASE } from './promo-film';

/**
 * Where the home hero's scene loops are served from — issue #490.
 *
 * The scene is rendered from `HeroSceneDrawing` (apps/web) into three silent 6.4 s H.264 loops
 * and uploaded to the media bucket beside the promo film, under the one prefix its policy lets
 * anyone read. The web plays all three by screen size; the app plays the square one.
 *
 * A new render goes to a new `v<n>/` folder and the files are cached for a year as immutable, so
 * bump `HERO_LOOP_VERSION` with the upload.
 *
 * The web's light theme (docs/ui-kit.md §11) plays a second set, `HERO_LOOP_LIGHT`, rendered from
 * the same drawing on the light ground (`render.mjs … light`). They sit in the same folder under
 * their own names, so adding them changed no file the dark set or the app already plays.
 */
export const HERO_LOOP_VERSION = 1;

const FOLDER = `${PROMO_FILM_BASE}/hero/v${HERO_LOOP_VERSION}`;

export interface HeroLoopCut {
  readonly url: string;
  /** The loop's first frame, as WebP: what shows before it plays and under reduced motion. */
  readonly posterUrl: string;
  readonly width: number;
  readonly height: number;
}

function cut(name: string, width: number, height: number): HeroLoopCut {
  return {
    url: `${FOLDER}/hero-scene-${name}.mp4`,
    posterUrl: `${FOLDER}/hero-scene-${name}.webp`,
    width,
    height,
  };
}

export const HERO_LOOP = {
  /** The web from 1280px. */
  desktop: cut('desktop', 1200, 1080),
  /** The web from 640px to 1280px. */
  tablet: cut('tablet', 960, 864),
  /** The web below 640px, and the app. */
  phone: cut('phone', 720, 720),
} as const;

/** The same three cuts on the light theme's ground. The web only; the app is dark. */
export const HERO_LOOP_LIGHT = {
  desktop: cut('desktop-light', 1200, 1080),
  tablet: cut('tablet-light', 960, 864),
  phone: cut('phone-light', 720, 720),
} as const;

/** One loop of the scene. */
export const HERO_LOOP_MS = 6400;
