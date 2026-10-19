import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlanChooser } from '../../../../components/plans/PlanChooser';
import { FeeDisclosure } from '../../../../components/fees/FeeDisclosure';
import { fetchFeeDisclosure } from '../../../../lib/fees/server';
import { fetchPlanCatalogue } from '../../../../lib/api/server';
import { localeOrDefault } from '../../../../lib/i18n/locale';
import { pricingCopy } from '../../../../lib/i18n/shell-copy.server';
import { publicPageMetadata } from '../../../../lib/seo/metadata';
import { StructuredData } from '../../../../components/seo/StructuredData';
import { sitePageGraph } from '../../../../lib/seo/structured-data/graphs';
import { graphContext } from '../../../../lib/i18n/shell-copy.server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations('pricing');

  return publicPageMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/pricing',
    locale: localeOrDefault(locale),
  });
}

/**
 * `/pricing` — what a creator pays to publish.
 *
 * <h2>Public, and indexed</h2>
 *
 * Unlike every other page about somebody's money on this platform, this one is for strangers:
 * a creator deciding whether to bring their campaign here reads it before they have an
 * account, and it is the page the marketing site links to. So `publicPageMetadata` rather than
 * `privatePageMetadata`, and the catalogue is read on the server where a shared cache can hold
 * it.
 *
 * <h2>`?from=submit&project=` is what a refused submission adds</h2>
 *
 * The campaign editor navigates here when a submission is refused for want of a plan, and the
 * two parameters are what let this page explain itself: a banner saying why the reader is
 * looking at a price list, and a link back to the campaign they were in the middle of.
 * Without them somebody arrives at a page of prices with no account of what they did to
 * deserve it.
 *
 * <p>`project` is passed to a link and to nothing else — it is never fetched, never trusted,
 * and a value naming a campaign that does not exist produces a link that 404s rather than
 * anything worse.
 *
 * <h2>Reading `searchParams` makes this route dynamic, and that is accepted</h2>
 *
 * The alternative is a static shell that reads the parameters in the client, which would mean
 * the banner appearing a frame after the page — on the one screen where the reader's first
 * question is "why am I here". The catalogue read behind it is still cached for an hour and
 * shared by everybody, so what is paid for is a render rather than a round trip.
 */
export default async function PricingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; project?: string }>;
}) {
  /*
   * §22.3's fee disclosure joins the plan catalogue — #439. A creator deciding whether to bring
   * a campaign here is reading this page to answer "what does it cost", and the subscription is
   * only half of that: the other half comes out of what their backers pledge. Two pages for one
   * question is how a creator ends up surprised by a payout.
   */
  const [{ locale }, query, t, copy, plans, fees] = await Promise.all([
    params,
    searchParams,
    getTranslations('pricing'),
    pricingCopy(),
    fetchPlanCatalogue(),
    fetchFeeDisclosure(),
  ]);

  return (
    <>
      <StructuredData nodes={sitePageGraph({ crumb: { name: t('metaTitle'), path: '/pricing' }, ...(await graphContext()) })} />
      <div className="mx-auto w-full max-w-[1100px] px-5 py-12 sm:px-8">
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">{t('title')}</h1>
        <p className="mt-3 max-w-[62ch] text-[15px] text-white/64">{t('intro')}</p>

        <div className="mt-10">
          {plans === null ? (
            /*
              The service refused or could not be reached. Said plainly rather than rendered as
              an empty catalogue, which would read as "this platform has no plans" — the one
              wrong answer on a page whose whole purpose is to say what the plans are.
            */
            <p className="text-sm text-white/64">{t('unavailable')}</p>
          ) : (
            <PlanChooser
              plans={plans}
              copy={copy}
              locale={localeOrDefault(locale)}
              fromProjectId={query.from === 'submit' ? query.project : undefined}
            />
          )}
        </div>

        <FeeDisclosure disclosure={fees} audience="creator" locale={localeOrDefault(locale)} />
      </div>
    </>
  );
}
