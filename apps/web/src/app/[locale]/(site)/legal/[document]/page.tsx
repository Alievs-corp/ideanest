import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LegalDocumentPage } from '../../../../../components/content/LegalDocumentPage';
import { LegalUnavailable } from '../../../../../components/content/LegalUnavailable';
import { isLegalDocumentSlug, LEGAL_DOCUMENTS, legalPath } from '../../../../../lib/legal/api';
import { fetchLegalDocument } from '../../../../../lib/legal/server';
import { localeOrDefault } from '../../../../../lib/i18n/locale';
import { publicPageMetadata } from '../../../../../lib/seo/metadata';

/**
 * `/legal/{document}` — §22.2's eight documents, in force. Issue #439.
 *
 * <h2>Static, in the sense this application means it</h2>
 *
 * #439: "these are the pages a stranger and a regulator read, they change a few times a year,
 * and rendering them per request would be a dynamic route for no reason. No client provider, no
 * cookie read."
 *
 * <strong>Every route in this application builds as `ƒ`</strong>, `/about` and `/trust-safety`
 * included — the locale proxy sees to that — so "static" here is not a claim about the build
 * output. It is a claim about what a render depends on, and that is the part that matters: this
 * page reads no cookie, no header and no `searchParams`, so every reader in a language gets the
 * same bytes and one render serves all of them. A page that read a session would be one no
 * shared cache could hold, which is what the requirement is really about.
 *
 * {@link generateStaticParams} names the eight addresses for the same reason the locale layout
 * names the four languages: without it, the first visitor to each pays for a render, and the
 * first visitor is usually a crawler. `lib/legal/server.ts` reads with `next.revalidate` and no
 * credentials, so the answer behind those renders is shared too.
 *
 * The copy comes from `getTranslations`, resolved on the server. **No `NextIntlClientProvider`**:
 * one in a shared layout added up to 27.4 KiB to every route in its group, and these pages have
 * no interactivity to hydrate for.
 *
 * <h2>Eight addresses, and an unknown one is a real 404</h2>
 *
 * The segment is narrowed against §22.2's closed set before anything else happens. A ninth
 * document is a change to that specification rather than a URL somebody can type, so
 * `/legal/anything-else` is `notFound()` — which is different from a document that exists and
 * has not been published yet, and that difference is the whole of `LegalDocumentPage`'s
 * not-published branch.
 *
 * <h2>Not published and not loaded are two pages — issue #147</h2>
 *
 * Only the service's 404 is "not published". A read that failed any other way renders
 * `LegalUnavailable`, the site's failure state: during the 2026-09-28 outage this address told
 * readers IdeaNest had no terms of use, which §22.2 requires it to have.
 *
 * <h2>Motion: none</h2>
 *
 * `StaticPage` records the reasoning for the three content pages and it holds harder here.
 * `FadeUp` lives behind `@ideanest/ui/motion`, which is 116 kB of animation runtime, and these
 * are routes whose entire content is text somebody is reading because they are worried.
 */

/**
 * The eight, prerendered.
 *
 * Locales are not enumerated here: `[locale]` is the segment above and the app's own
 * configuration decides which languages are built. Returning the cross product would be this
 * route re-deciding §21.1.
 */
export function generateStaticParams() {
  return LEGAL_DOCUMENTS.map((document) => ({ document }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; document: string }>;
}): Promise<Metadata> {
  const { locale, document } = await params;
  if (!isLegalDocumentSlug(document)) notFound();

  const t = await getTranslations('legal');

  /*
   * The title comes from the catalogue rather than from the fetched document, deliberately. A
   * document with nothing published still has a name — "Terms of use" is what this address is,
   * whether or not there are words behind it yet — and a `<title>` that fell back to a generic
   * string would make eight addresses look like one page to a crawler.
   */
  return publicPageMetadata({
    title: t(`documents.${document}.title`),
    description: t(`documents.${document}.summary`),
    path: legalPath(document),
    locale: localeOrDefault(locale),
  });
}

export default async function LegalDocumentRoute({
  params,
}: {
  params: Promise<{ locale: string; document: string }>;
}) {
  const { locale: requested, document } = await params;
  if (!isLegalDocumentSlug(document)) notFound();

  const locale = localeOrDefault(requested);
  const read = await fetchLegalDocument(document, locale);

  if (read.state === 'unavailable') {
    return <LegalUnavailable retryHref={legalPath(document)} scope="document" />;
  }

  return (
    <LegalDocumentPage
      slug={document}
      locale={locale}
      document={read.state === 'published' ? read.document : null}
    />
  );
}
