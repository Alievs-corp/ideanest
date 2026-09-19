import type { Locale } from './locale';
import type { FailureCopy } from './shell-copy';

/**
 * The failure pages' shared words, in every language, small enough to ship to the browser —
 * issues #324 and #123.
 *
 * <h2>Why this file exists at all, and why the duplication is deliberate</h2>
 *
 * Every other surface in this application receives its copy as a prop from a server
 * component. Two cannot: `app/[locale]/error.tsx` and `app/[locale]/(site)/error.tsx`. Next
 * requires an error boundary to be a client component and renders it itself, so there is no
 * server parent to hand them anything.
 *
 * The library's answer is `NextIntlClientProvider` plus `useTranslations`, and it was tried
 * and **measured** rather than assumed. A provider in `[locale]/layout.tsx` carrying only the
 * `shell` namespace moved `/[locale]/about` from 571.3 KiB of First Load JS to 596.0 KiB —
 * **+24.7 KiB on every route on the site**, close to the 27.4 KiB `apps/web/README.md`
 * already records for the same mistake, and it put six authentication routes over budget. It
 * is paid by every page for the benefit of two that almost never render.
 *
 * So these eight strings are carried instead. Four languages of them cost well under a
 * kilobyte, they load with the error boundary rather than with the site, and nothing else in
 * the application imports this module.
 *
 * <h2>What stops it drifting from the catalogue</h2>
 *
 * `failure-copy.client.test.ts` asserts this file against `messages/*.json`, key by key and
 * language by language. Editing the catalogue without editing this file fails the suite, and
 * so does the reverse. The duplication is real; the drift is what would have been the defect,
 * and it is the thing that is prevented rather than the copy.
 *
 * If a third client-only surface ever needs the catalogue, do not extend this file — measure
 * the provider again against whatever the bundle looks like then, and write the number down.
 */
const FAILURE_COPY: Record<Locale, FailureCopy> = {
  az: {
    elsewhere: 'IdeaNest-in digər səhifələri',
    links: { browse: 'Kampaniyalara baxın', categories: 'Kateqoriyalar', search: 'Axtarış' },
  },
  en: {
    elsewhere: 'Elsewhere on IdeaNest',
    links: { browse: 'Browse campaigns', categories: 'Categories', search: 'Search' },
  },
  ru: {
    elsewhere: 'Другие разделы IdeaNest',
    links: { browse: 'Смотреть кампании', categories: 'Категории', search: 'Поиск' },
  },
  tr: {
    elsewhere: "IdeaNest'teki diğer sayfalar",
    links: { browse: 'Kampanyalara göz atın', categories: 'Kategoriler', search: 'Arama' },
  },
};

/** "Skip to content", for the same two boundaries and for the same reason. */
const SKIP_TO_CONTENT: Record<Locale, string> = {
  az: 'Məzmuna keç',
  en: 'Skip to content',
  ru: 'Перейти к содержимому',
  tr: 'İçeriğe geç',
};

/**
 * The error boundaries' own heading and body, carried for the same two surfaces.
 *
 * <p>`FailureCopy` above is the link rail every failure page shares, and it is asserted to
 * hold exactly those keys. These are the words only an error boundary draws — the heading, the
 * sentence under it, the digest line and the retry button — and they are here rather than in a
 * prop for the reason this file exists: Next renders these two components itself, so there is
 * no server parent to hand them anything, and the provider that would let them look the words
 * up was measured at +24.7 KiB on every route on the site.
 *
 * <p>`failure-copy.client.test.ts` asserts every one of them against `shell.failure.pages.error`
 * in all four catalogues, so this cannot drift from the language the rest of the page is in.
 */
export interface ErrorPageCopy {
  readonly title: string;
  readonly description: string;
  /** Precedes the digest. Never a sentence: the digest is what follows it. */
  readonly referenceLabel: string;
  readonly referenceHint: string;
  readonly retry: string;
}

const ERROR_PAGE_COPY: Record<Locale, ErrorPageCopy> = {
  az: {
    title: 'Bizim tərəfdə nəsə səhv getdi',
    description:
      'Bu səhifə göstərilə bilmədi. Bu, adətən müvəqqətidir — hər şeydən əvvəl bir dəfə yenidən cəhd etməyə dəyər.',
    referenceLabel: 'İstinad',
    referenceHint: 'Onu bizə bildirsəniz, jurnalda dəqiq nasazlığı tapa bilərik.',
    retry: 'Yenidən cəhd edin',
  },
  en: {
    title: 'Something went wrong on our side',
    description:
      'This page could not be rendered. It is usually temporary — trying again is worth one press before anything else.',
    referenceLabel: 'Reference',
    referenceHint: 'Quoting it lets us find the exact failure in the log.',
    retry: 'Try again',
  },
  ru: {
    title: 'Что-то пошло не так на нашей стороне',
    description:
      'Эту страницу не удалось отрисовать. Обычно это временно — прежде всего стоит один раз попробовать ещё раз.',
    referenceLabel: 'Код',
    referenceHint: 'Если вы его назовёте, мы найдём в журнале точную ошибку.',
    retry: 'Попробуйте ещё раз',
  },
  tr: {
    title: 'Bizim tarafta bir şeyler ters gitti',
    description:
      'Bu sayfa oluşturulamadı. Bu genellikle geçicidir — her şeyden önce bir kez tekrar denemeye değer.',
    referenceLabel: 'Referans',
    referenceHint: 'Bunu bize bildirirseniz, kayıtlarda tam hatayı bulabiliriz.',
    retry: 'Tekrar deneyin',
  },
};

export function failureCopyOf(locale: Locale): FailureCopy {
  return FAILURE_COPY[locale];
}

export function skipToContentOf(locale: Locale): string {
  return SKIP_TO_CONTENT[locale];
}

export function errorPageCopyOf(locale: Locale): ErrorPageCopy {
  return ERROR_PAGE_COPY[locale];
}
