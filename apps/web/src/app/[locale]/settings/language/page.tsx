import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { AccountPageHeader } from '../../../../components/account/AccountPageHeader';
import { CurrencyPanel } from '../../../../components/settings/CurrencyPanel';
import { LanguagePanel } from '../../../../components/settings/LanguagePanel';
import { fetchExchangeRates } from '../../../../lib/api/server';
import { DEFAULT_CURRENCY } from '@ideanest/money';
import { localeOrDefault } from '../../../../lib/i18n/locale';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * The tab title in the reader's language — #462.
 *
 * This was the last `const` metadata under `/settings`, kept in English on the grounds that a
 * per-route metadata function was not worth it for one tab. Every sibling has had one since
 * #324, so the reason it gave for waiting is gone, and the prose guard
 * (`components/prose-literals.test.ts`) no longer lets an English title through.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.language');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

/**
 * `/settings/language` — §4.2's P-10, issue #280.
 *
 * <h2>A server component that reads the catalogue, wrapping a client component that writes</h2>
 *
 * The strings come from `getTranslations` here and go down as props. The alternative —
 * `useTranslations` inside the panel — needs a `NextIntlClientProvider` above it, and that
 * provider serialises a catalogue into the route's first load so the browser can look up nine
 * strings it could have been handed. `LanguagePanel` explains the same trade from its side.
 *
 * `getLocale()` is the language this render is actually in, negotiated from the cookie by
 * `src/i18n/request.ts`. It is passed down so the control opens on the language the reader is
 * looking at rather than on a guess, and so it is a **server** value: reading the cookie inside
 * the client component would answer `null` on the server and the real cookie on hydration,
 * which is a mismatch for everybody whose language is not the default.
 *
 * It is run through `localeOrDefault` on the way past. next-intl types its locale as a plain
 * string, and the four tags are the vocabulary `lib/i18n/locale.ts` owns — narrowing at the
 * boundary is what stops a value the catalogue happened to accept from reaching a `<select>`
 * whose options cannot express it.
 *
 * <h2>Dynamic, and already paid for</h2>
 *
 * Reading a cookie makes this render dynamic. `src/i18n/request.ts` argues at length that this
 * is free on `/settings/*`, which is behind authentication and rendered per person already, and
 * expensive on the cached public routes — which is why the catalogue covers this half of the
 * application and not that one.
 *
 * <h2>It is a page rather than a section of `/settings`</h2>
 *
 * §4.2 lists P-10 beside the notification preferences, and they are not one screen: the
 * notification grid is a matrix of channels a person tunes over time, and this is one choice
 * made once. Putting them together would also mean one Save over two unrelated writes — a
 * language that failed to save because a notification row did.
 */
export default async function LanguageSettingsPage() {
  const t = await getTranslations('settings.language');
  const currency = await getTranslations('settings.currency');
  const common = await getTranslations('common');
  const locale = localeOrDefault(await getLocale());

  /*
   * READ ON THE SERVER, AND IT COSTS THIS ROUTE NOTHING — #327.
   *
   * `/v1/exchange-rates` is public and marked `public, max-age=600`, so Next holds one copy
   * for everybody rather than one per reader. Fetching it in the browser instead would spend
   * a round trip after hydration to draw a `<select>` whose options were known before the
   * first byte.
   *
   * `null` is the service being unreachable and an empty list is the platform having nothing
   * to offer, and both come to the same thing here: one currency, which `CurrencyPanel` draws
   * as a sentence rather than as a control that cannot be used.
   */
  const rates = await fetchExchangeRates();
  const baseCurrency = rates?.base ?? DEFAULT_CURRENCY;
  const currencies = [baseCurrency, ...(rates?.rates ?? []).map((rate) => rate.currency)];

  return (
    <>
      <AccountPageHeader title={t('title')}>{t('intro')}</AccountPageHeader>

      <div className="mt-8">
        <h2 className="text-lg font-medium tracking-[-0.02em] text-white">
          {t('languageHeading')}
        </h2>

        <div className="mt-4">
          <LanguagePanel
            serverLocale={locale}
            copy={{
              fieldLabel: t('fieldLabel'),
              fieldHint: t('fieldHint'),
              save: t('save'),
              saving: common('saving'),
              saved: t('saved'),
              failed: t('failed'),
            }}
          />
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-medium tracking-[-0.02em] text-white">{currency('title')}</h2>
        <p className="mt-2 max-w-[62ch] text-sm text-white/64">{currency('intro')}</p>

        <div className="mt-4">
          <CurrencyPanel
            currencies={currencies}
            baseCurrency={baseCurrency}
            copy={{
              fieldLabel: currency('fieldLabel'),
              fieldHint: currency('fieldHint'),
              save: currency('save'),
              saving: common('saving'),
              saved: currency('saved'),
              failed: currency('failed'),
              unavailable: currency('unavailable'),
            }}
          />
        </div>
      </div>
    </>
  );
}
