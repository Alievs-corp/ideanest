import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountDetail } from '../../../../../components/admin/AccountDetail';
import { accountDetailCopy } from '../../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../../lib/seo/metadata';

/**
 * One account: its standing, its campaigns, and what it has backed — issue #404.
 *
 * <p><strong>The screen the console did not have.</strong> `/admin/users` offered one control
 * per row — suspend — and the row's own copy said that suspending "changes nothing about the
 * campaigns they created or the pledges they made". That is exactly the context a moderator
 * needs in order to decide, and there was no user detail screen anywhere in the console to
 * see it: no link, no history, nothing. The decision was taken on a name and an address.
 *
 * <p><strong>The heading does not name the person.</strong> Resolving it would mean reading
 * an audited, staff-only endpoint on the server, and the console has no server-side session
 * to read it with — the access token lives in the browser (`lib/api/client.ts`). So the page
 * is titled by what it is and the panel says who it is about, which is the arrangement
 * `/admin/campaigns/[projectId]` and `/admin/moderation/[reportId]` both use.
 *
 * <p>There is a second reason here that those two do not have: this title would be somebody's
 * name, and a browser tab, a history entry and a shared screenshot are three places it would
 * then appear outside the console.
 *
 * <p>`privatePageMetadata` for the reason every console route gives. <strong>THE ROUTE IS NOT
 * A GATE</strong> — the service refuses a caller who is not staff and this screen renders that
 * refusal; a check here would be a second, weaker copy of one the service already makes
 * correctly.
 *
 * <p>`[userId]` sits beside no static siblings under `/admin/users`, so nothing shadows it —
 * worth stating because `/admin/curation/[slug]` does have three and had to say so.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.accountDetail');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function AccountDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly userId: string }>;
}) {
  const { userId } = await params;

  const t = await getTranslations('admin.pages.accountDetail');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">
        {t('title')}
      </h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <AccountDetail userId={userId} copy={await accountDetailCopy()} />
      </div>
    </div>
  );
}
