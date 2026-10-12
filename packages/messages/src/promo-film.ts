import type { Locale } from './locale';

/**
 * Where the promo film is served from, for each interface language — issue #405.
 *
 * <h2>The bucket, not the repository</h2>
 *
 * The film is rendered by `apps/promo` and uploaded to the media bucket under `media/promo/`,
 * the one prefix its policy lets anyone read. A 50 MB binary in git would be paid for by every
 * clone for ever, and in the web image by every deploy.
 *
 * <h2>Three films, four languages</h2>
 *
 * The film exists in Azerbaijani, English and Russian. Turkish readers get the English cut:
 * the headlines are short and an English line is closer to them than an Azerbaijani one they
 * might misread as their own.
 *
 * <h2>The version is in the path</h2>
 *
 * A new render goes to a new `v<n>/` folder, so no browser or phone holding the old file in
 * its cache can keep showing it. Bump `PROMO_FILM_VERSION` with the upload.
 */
export const PROMO_FILM_BASE = 'https://ideyanest-media.fsn1.your-objectstorage.com/media/promo';
export const PROMO_FILM_VERSION = 2;

const CUT: Record<Locale, 'az' | 'en' | 'ru'> = { az: 'az', en: 'en', ru: 'ru', tr: 'en' };

export interface PromoFilm {
  /** 1080x1920, 16 Mbps H.264: for the web. */
  readonly url: string;
  /** 720x1280, 4 Mbps H.264: for phones, where it is a third of the size. */
  readonly mobileUrl: string;
  /** The last frame, the end card, as a JPEG. */
  readonly posterUrl: string;
  readonly width: 1080;
  readonly height: 1920;
  readonly durationMs: 30000;
}

export function promoFilm(locale: Locale): PromoFilm {
  const folder = `${PROMO_FILM_BASE}/v${PROMO_FILM_VERSION}`;
  const name = `spark-to-nest-9x16-${CUT[locale]}`;
  return {
    url: `${folder}/${name}.mp4`,
    mobileUrl: `${folder}/${name}-720.mp4`,
    posterUrl: `${folder}/${name}.jpg`,
    width: 1080,
    height: 1920,
    durationMs: 30000,
  };
}
