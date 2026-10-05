import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LegalDocumentPage } from '../../../../../../../components/content/LegalDocumentPage';
import { LegalUnavailable } from '../../../../../../../components/content/LegalUnavailable';
import { archivedVersionOf, isLegalDocumentSlug, legalPath } from '@ideanest/legal/documents';
import { fetchArchivedLegalDocument } from '../../../../../../../lib/legal/server';
import { localeOrDefault } from '../../../../../../../lib/i18n/locale';
import { privatePageMetadata } from '../../../../../../../lib/seo/metadata';

/**
 * `/legal/{document}/v/{version}` — the archive. Issue #439.
 *
 * <h2>Why this route exists at all</h2>
 *
 * #439: "An archive matters more than it looks — somebody who accepted version 3 must be able to
 * read version 3, not only whatever is current." Without it, `document_acceptances` names a text
 * the person it is about cannot see, which makes the record evidence of nothing they could
 * check. V65 stores every version precisely so this address can exist, and the trigger that
 * makes a published version immutable is what makes it worth having.
 *
 * <h2>Not prerendered, and still not dynamic in the sense that matters</h2>
 *
 * There is no {@link generateStaticParams} here: the set of versions grows whenever somebody
 * publishes, and enumerating it would mean this route knowing how many there are at build time —
 * which is exactly the coupling that produces a deploy where version 5 is a 404. Next renders
 * the first request for a version and caches it; every subsequent reader gets the cached page.
 * The read still carries no credentials and no cookie, so nothing about it varies per reader.
 *
 * <h2>`noindex`, and that is the one place this differs from the current version</h2>
 *
 * An archived version is superseded text. A search engine that indexed both would rank whichever
 * had more links, and the address a reader arrives at from a search would be the terms that
 * stopped applying in March. `privatePageMetadata` is `noindex, nofollow` with no canonical —
 * the current version is the indexable one, and this page links to it in as many words.
 *
 * It stays perfectly reachable by anybody following a link from their own acceptance record,
 * which is who it is for.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; document: string; version: string }>;
}): Promise<Metadata> {
  const { document, version } = await params;
  if (!isLegalDocumentSlug(document) || archivedVersionOf(version) === null) notFound();

  const t = await getTranslations('legal');

  return privatePageMetadata({
    title: t('archive.metaTitle', { document: t(`documents.${document}.title`), version }),
  });
}

export default async function ArchivedLegalDocumentRoute({
  params,
}: {
  params: Promise<{ locale: string; document: string; version: string }>;
}) {
  const { locale: requested, document, version } = await params;
  if (!isLegalDocumentSlug(document)) notFound();

  const number = archivedVersionOf(version);
  if (number === null) notFound();

  const locale = localeOrDefault(requested);
  const archived = await fetchArchivedLegalDocument(document, number, locale);

  /*
   * A version that does not exist is a real 404 here, unlike an unpublished document on the
   * current-version route. The difference is what the address claims: `/legal/terms-of-use` is a
   * permanent address for a document §22.2 requires, whether or not it has been written, and
   * `/legal/terms-of-use/v/9` is a claim that a ninth version was published. If it was not, the
   * address is wrong and a crawler should stop asking for it.
   *
   * Only the service's own 404 says that, though — #147. A read that failed any other way is
   * the failure state: telling somebody holding an acceptance record for version 3 that version 3
   * does not exist, because the service was down, is the worst answer this route could give.
   */
  if (archived.state === 'unpublished') notFound();
  if (archived.state === 'unavailable') {
    return <LegalUnavailable retryHref={legalPath(document, number)} scope="document" />;
  }

  return (
    <LegalDocumentPage
      slug={document}
      locale={locale}
      document={archived.document}
      archivedVersion={number}
    />
  );
}

/**
 * An hour, matching the read beneath it and the service's own directive.
 *
 * Stated on the route as well as on the `fetch` because this route has no
 * {@link generateStaticParams}: without it, the first request for a version renders and the
 * result is held indefinitely, and a document corrected by a republication of the same number —
 * which V65 makes impossible, but a restore from backup does not — would be served from a cache
 * nothing invalidates.
 */
export const revalidate = 3600;
