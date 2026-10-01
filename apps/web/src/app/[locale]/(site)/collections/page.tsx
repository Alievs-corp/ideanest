import type { Metadata } from 'next';
import { CollectionIndex } from '../../../../components/collections/CollectionIndex';
import { StructuredData } from '../../../../components/seo/StructuredData';
import { fetchCollections } from '../../../../lib/api/server';
import { COLLECTIONS_PATH } from '../../../../lib/collections/api';
import { collectionsIndexGraph } from '../../../../lib/seo/structured-data/graphs';
import { graphContext } from '../../../../lib/i18n/shell-copy.server';
import { localeOrDefault } from '../../../../lib/i18n/locale';
import { publicPageMetadata } from '../../../../lib/seo/metadata';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  type CollectionIndexCopy,
  collectionIndexCopyFrom,
} from '../../../../lib/i18n/collection-copy';
import type { Locale } from '../../../../lib/i18n/locale';

/**
 * `/collections` — D-08's index, §4.13 WS-04. Issue #266.
 *
 * <h2>It is the only path to a collection</h2>
 *
 * §4.3 gives curated collections, themed collections and open calls one address each, and
 * before this page there was no link on the site that reached any of them. The `programme`
 * filter on `/v1/discover` narrows to an open call's members, but `@ideanest/discovery/filters`
 * does not expose it and robots.txt disallows `/discover?` wholesale in any case
 * (`lib/seo/indexability.ts`) — so a filter could never have been the answer. This page is the
 * crawl path, the header and footer's destination for curation, and the parent of every
 * collection landing page in the sitemap.
 *
 * <h2>The list is data, not code</h2>
 *
 * Nothing here holds a list of collections. The page renders whatever `GET /v1/collections`
 * answers, in the order a curator arranged, so a collection published by an administrator has
 * a card and a link the moment the read revalidates — sixty seconds, for the reason
 * `fetchCollections` gives.
 *
 * <h2>A static `metadata`, because there is nothing per-request to say</h2>
 *
 * The page takes no parameters and its title and description do not vary with what the service
 * answers. `generateMetadata` here would opt the route out of static metadata resolution to
 * produce the same three strings — `app/(site)/categories/page.tsx` makes the same call for the
 * same reason.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations('discovery.collections');

  /*
   * A function rather than a `const` since #123: the canonical and the `hreflang` cluster
   * are built from the route's own language. Reading `params` keeps the page static — it is
   * `searchParams` that would not.
   */
  return publicPageMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: COLLECTIONS_PATH,
    locale: localeOrDefault(locale),
  });
}


/**
 * The page's words and the language to write its dates in — #324.
 *
 * `getLocale` rather than `params`, for `graphContext`'s reason: `layout.tsx` has already
 * handed the segment to `setRequestLocale`, so this reads a value the router resolved and
 * leaves the render as static as it found it.
 */
async function indexContext(): Promise<{ locale: Locale; copy: CollectionIndexCopy }> {
  return {
    locale: localeOrDefault(await getLocale()),
    copy: collectionIndexCopyFrom(await getTranslations('discovery.collections')),
  };
}

export default async function CollectionsPage() {
  const { locale, copy } = await indexContext();
  const collections = await fetchCollections();

  return (
    <>
      <StructuredData nodes={collectionsIndexGraph(await graphContext())} />
      <CollectionIndex collections={collections} locale={locale} copy={copy} />
    </>
  );
}
