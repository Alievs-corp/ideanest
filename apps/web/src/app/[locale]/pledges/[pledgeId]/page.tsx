import type { Metadata } from 'next';
import { AccountPageHeader } from '../../../../components/account/AccountPageHeader';
import { PledgeManager } from '../../../../components/pledges/PledgeManager';
import { privatePageMetadata } from '../../../../lib/seo/metadata';
import { checkoutCopy, pledgeManagerCopy } from '../../../../lib/i18n/shell-copy.server';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.pages.pledgeDetail');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

/**
 * `/pledges/{pledgeId}` — §4.5's PL-09 and PL-10. Issue #287.
 *
 * <h2>The identifier is not validated here</h2>
 *
 * It is handed straight to `GET /v1/pledges/{id}`, which answers 404 for an unknown identifier
 * **and** for one belonging to somebody else — deliberately indistinguishable, so the endpoint
 * cannot be used to ask whether a pledge exists. `/pledges/{id}/address` states the same rule
 * and it holds for the same reason: a client that pre-checked the shape could only reject
 * values the service already rejects, and would tempt the next reader into believing something
 * here had authorised the request.
 *
 * <h2>A client boundary, and no server render</h2>
 *
 * Every field on this screen is somebody's own money, read with a bearer token only the browser
 * holds. There is nothing for a crawler and nothing to put in the initial HTML — which is also
 * why the metadata is `privatePageMetadata`: `noindex`, `nofollow`, and **no Open Graph block
 * at all**, so a pledge link pasted into a chat does not unfurl as a tidy IdeaNest card
 * implying the recipient could open it.
 *
 * <h2>It sits inside the account frame, like its sibling</h2>
 *
 * `app/pledges/layout.tsx` wraps everything under this prefix in `AccountArea`. Its comment
 * says no entry in `lib/account/navigation.ts` matches these paths, which was right when the
 * only screen here was one somebody is sent to from a survey. `/pledges` is now a destination,
 * and adding it to that navigation is a one-line change to a file this pull request does not
 * own — reported rather than made here.
 */
export default async function PledgePage({
  params,
}: {
  params: Promise<{ pledgeId: string }>;
}) {
  // Words, not data: the manager and the editor under it are client islands, so the route
  // resolves both vocabularies — this screen's own, and the checkout's, which the editor's
  // field, hints and refusals come from.
  const [{ pledgeId }, t, checkout, pledges] = await Promise.all([
    params,
    getTranslations('account.pages.pledgeDetail'),
    checkoutCopy(),
    pledgeManagerCopy(),
  ]);

  return (
    <>
      <AccountPageHeader title={t('title')}>{t('intro')}</AccountPageHeader>

      <div className="mt-8">
        <PledgeManager pledgeId={pledgeId} copy={checkout} pledges={pledges} />
      </div>
    </>
  );
}
