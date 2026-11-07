import { Eye } from 'lucide-react';
import { numberFormat } from '../../lib/i18n/formats';
import type { Locale } from '../../lib/i18n/locale';
import { pluralise, type PluralForms } from '../../lib/i18n/plurals';

/**
 * How many people have opened this campaign, on its cover — #634.
 *
 * <h2>The number</h2>
 *
 * `viewCount` is the campaign's all-time count of daily unique viewers (`projects.view_count`):
 * a person who opens it on three days counts three times, the same person refreshing it all
 * afternoon counts once. It is drawn compact — `1,2K`, `3,4 тыс.` — because the chip sits on a
 * photograph and has room for four characters, not seven. The exact figure is in its accessible
 * name. Nothing is drawn at zero: "0 views" on a campaign launched an hour ago is a verdict
 * nobody has earned yet.
 *
 * `numberFormat` rather than `new Intl.NumberFormat`: it is #403's Azerbaijani bypass, which
 * also keeps the server render and a browser with thinner locale data from drawing two different
 * strings for one number.
 *
 * <h2>White on a black scrim</h2>
 *
 * The one place `text-white` is right (docs/ui-kit.md §11.2: text over a photo or a
 * `bg-black/*` scrim). A cover can be any colour; black at 60% under white text keeps the pair
 * above 4.5:1 even on a white photograph. Neither the theme nor the card's accent moves it.
 *
 * <h2>It is not in the way</h2>
 *
 * `pointer-events-none`, so a press on it lands on the card's stretched link like a press
 * anywhere else on the cover. Drawn after the cover and the video preview, so it stays above
 * both, and outside the zoom's transform, so it does not lean with the picture. It never moves,
 * so it has nothing to ask `prefers-reduced-motion`.
 *
 * `role="img"` with the sentence as its name: a `<span>` cannot be named, and an image of an
 * eye and a number is what it is. The icon and the compact figure inside it are not read.
 */

export interface CardViewCountProps {
  readonly count: number | null | undefined;
  /** `common.card.views`, carrying `{count}`. */
  readonly label: PluralForms;
  readonly locale: Locale;
}

export function formatCompactCount(count: number, locale: Locale): string {
  return numberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }, 'compact').format(count);
}

export function CardViewCount({ count, label, locale }: CardViewCountProps) {
  if (count == null || !Number.isFinite(count) || count <= 0) return null;

  return (
    <span
      role="img"
      aria-label={pluralise(locale, label, count)}
      className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums lg:text-xs"
    >
      <Eye aria-hidden="true" className="size-3 lg:size-3.5" />
      <span aria-hidden="true">{formatCompactCount(count, locale)}</span>
    </span>
  );
}
