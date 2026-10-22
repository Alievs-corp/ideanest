import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CollectionCampaigns } from '../../../../../components/collections/CollectionCampaigns';
import { CollectionHeader } from '../../../../../components/collections/CollectionHeader';
import { StructuredData } from '../../../../../components/seo/StructuredData';
import { collectionPath } from '../../../../../lib/collections/api';
import {
  collectionSocialDescription,
  resolveCollectionLanding,
} from '../../../../../lib/collections/landing';
import { collectionPageGraph } from '../../../../../lib/seo/structured-data/graphs';
import { graphContext, marketCopy } from '../../../../../lib/i18n/shell-copy.server';
import { MarketEmptyNotice } from '../../../../../components/shell/MarketEmptyNotice';
import { localeOrDefault } from '../../../../../lib/i18n/locale';
import {
  isFetchableImageUrl,
  privatePageMetadata,
  publicPageMetadata,
} from '../../../../../lib/seo/metadata';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  type CollectionCampaignsCopy,
  type CollectionHeaderCopy,
  collectionCampaignsCopyFrom,
  collectionHeaderCopyFrom,
} from '../../../../../lib/i18n/collection-copy';
import { type ProjectCardCopy, projectCardCopyFrom } from '../../../../../lib/i18n/card-copy';
import type { Locale } from '../../../../../lib/i18n/locale';

/**
 * `/collections/{slug}` — D-08's landing page, §4.13 WS-04. Issue #266.
 *
 * <h2>An indexable page per collection</h2>
 *
 * The URL is a path, not a query string, and that is the point twice over. A crawler cannot
 * operate a filter, and robots.txt disallows `/discover?` wholesale because the filters
 * compose into a combinatorial set of URLs over one corpus. But even a permitted filter would
 * not have been this page: what a collection is, is **an order somebody chose**, and there is
 * no parameter on `/v1/discover` that reproduces it.
 *
 * <h2>Everything that is not visible is a 404, and nothing here says which kind</h2>
 *
 * A slug that names nothing, a collection that has not been published, and one outside its own
 * window all reach `notFound()` through the same `null`. `CollectionController` argues it: a
 * 403 would confirm to anybody who guesses `/collections/spring-2027` that the platform is
 * preparing something under that name, which is a commercially interesting fact about its
 * plans. `lib/collections/landing.ts` holds the line and explains why a service that could not
 * be reached takes the same exit.
 *
 * `notFound()` rather than an empty page for the same reason `/categories/{category}` does: an
 * empty landing page for a slug that means nothing is a 200 that will be indexed, linked to,
 * and re-crawled forever.
 *
 * <h2>The metadata resolves the same collection the body does</h2>
 *
 * `generateMetadata` calls the same function the page does. Next dedupes the underlying
 * `fetch` within one request, so it is one round trip — and the two cannot disagree, which is
 * how a 404 body ends up under a real `<title>`, a canonical URL, and a social card for a page
 * nobody can open.
 *
 * <h2>The first page of campaigns is in the HTML</h2>
 *
 * The server render fetches page one and hands it to `CollectionCampaigns`, which appends
 * further pages in the browser and never re-requests the first. A crawler, a link unfurler and
 * a slow connection all get the campaigns rather than a skeleton; a reader who wants the rest
 * presses a button. `CollectionCampaigns` has the argument for paging here rather than handing
 * the reader off to the feed.
 */

interface RouteParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { locale, slug } = await params;
  const [landing, t] = await Promise.all([
    resolveCollectionLanding(slug),
    getTranslations('discovery.collections'),
  ]);

  /*
   * A collection that does not resolve gets the private shape — `noindex, nofollow`, no
   * canonical, no card. The page below answers 404 in the same case, and metadata describing a
   * page that is about to not exist would be a social preview for a URL nobody can open.
   */
  if (landing.kind === 'not-found') {
    return privatePageMetadata({ title: t('notFound') });
  }

  const { collection } = landing;
  const cover = collection.image;

  /*
   * The cover as the social card, when it is an address an unfurler can actually fetch. The
   * alt is the collection's title, which is the same approximation `projectPageMetadata`
   * makes for a campaign cover and for the same reason: there is no alternative text anywhere
   * in the projection, and a card with no `alt` at all is read out as a URL.
   */
  const image =
    cover !== null && isFetchableImageUrl(cover.url)
      ? { url: cover.url, width: cover.width, height: cover.height, alt: collection.title }
      : undefined;

  return publicPageMetadata({
    title: collection.title,
    /*
     * `t.raw`, not `t`. The fallback carries {title} and is filled by
     * `collectionSocialDescription` where the collection is known; asking next-intl to format
     * it here would be asking it for a value this call does not have, which it answers by
     * rendering the key's own path.
     */
    description: collectionSocialDescription(collection, String(t.raw('socialDescription'))),
    path: collectionPath(collection.slug),
    locale: localeOrDefault(locale),
    image,
  });
}


/**
 * The page's words and the language to write its dates in — #324.
 *
 * `getLocale` rather than `params`, for `graphContext`'s reason: `layout.tsx` has already
 * handed the segment to `setRequestLocale`, so this reads a value the router resolved and
 * leaves the render as static as it found it.
 */
async function pageContext(): Promise<{
  locale: Locale;
  header: CollectionHeaderCopy;
  campaigns: CollectionCampaignsCopy;
  card: ProjectCardCopy;
}> {
  const t = await getTranslations('discovery.collections');
  const common = await getTranslations('common');

  return {
    locale: localeOrDefault(await getLocale()),
    header: collectionHeaderCopyFrom(t, common),
    campaigns: collectionCampaignsCopyFrom(t),
    card: projectCardCopyFrom(await getTranslations('discovery.card'), common),
  };
}

export default async function CollectionPage({ params }: RouteParams) {
  const { slug } = await params;
  const { locale, header, campaigns: campaignsCopy, card } = await pageContext();
  const landing = await resolveCollectionLanding(slug);

  if (landing.kind === 'not-found') notFound();

  const { collection, campaigns, nextCursor } = landing;

  return (
    <>
      <StructuredData
        nodes={collectionPageGraph({
          title: collection.title,
          path: collectionPath(collection.slug),
          ...(await graphContext()),
        })}
      />

      <div className="mx-auto w-full max-w-[1400px] px-5 py-10 sm:px-6">
        <CollectionHeader collection={collection} locale={locale} copy={header} />

        <div className="mt-12">
          <CollectionCampaigns
            slug={collection.slug}
            title={collection.title}
            initial={campaigns}
            initialCursor={nextCursor}
            copy={campaignsCopy}
            locale={locale}
            cardCopy={card}
          />
          {campaigns.length === 0 && (
            <div className="mt-4">
              <MarketEmptyNotice copy={await marketCopy()} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
