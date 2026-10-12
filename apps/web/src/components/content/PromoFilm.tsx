import { MediaFrame } from '@ideanest/ui/server';
import type { Locale } from '@ideanest/messages/locale';
import { promoFilm } from '@ideanest/messages/promo-film';
import { getTranslations } from 'next-intl/server';

/**
 * The promo film on `/how-it-works` — issue #405.
 *
 * <h2>The browser's own player, and no JavaScript</h2>
 *
 * `CampaignVideoPlayer` is a client component because a campaign page swaps a cover photograph
 * for the player. Here there is nothing to swap: the poster is the film's own end card, so a
 * native `<video>` with `controls` does the whole job. The route stays a static server render
 * and its First Load JS budget does not move.
 *
 * <h2>Nothing downloads until somebody presses play</h2>
 *
 * `preload="none"` means the 50 MB file is not fetched for a reader who only scrolls past; the
 * poster is the only request. Nothing autoplays, so a reader who asked their system for reduced
 * motion sees a still picture until they choose otherwise, and sound never starts by surprise.
 */
export async function PromoFilm({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations('static.howItWorks.film');
  const film = promoFilm(locale);
  return (
    <figure className="mx-auto w-full max-w-[22rem]">
      <MediaFrame ratio={{ width: film.width, height: film.height }} radius="lg">
        <video
          controls
          playsInline
          preload="none"
          poster={film.posterUrl}
          aria-label={t('label')}
          width={film.width}
          height={film.height}
          className="absolute inset-0 size-full bg-surface-1 object-cover"
        >
          <source src={film.url} type="video/mp4" />
        </video>
      </MediaFrame>
      <figcaption className="mt-3 text-center text-sm text-white/64">
        {t('title')} · <span className="tabular-nums">{t('duration')}</span>
      </figcaption>
    </figure>
  );
}
