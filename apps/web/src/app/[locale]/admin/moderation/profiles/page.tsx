import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ModerationQueue } from '../../../../../components/moderation/ModerationQueue';
import { moderationQueueCopy } from '../../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../../lib/seo/metadata';

/**
 * §4.11's AD-09: the complaints filed against a person — issue #298.
 *
 * <h2>A screen of its own, rather than a chip on the queue</h2>
 *
 * There was already a chip that narrowed the main queue to accounts, and it was not this.
 * It filtered the page the browser happened to be holding, so "three reports about
 * accounts" meant three in the twenty-five loaded — and the cursor those twenty-five came
 * with had already moved past everything the filter dropped. There was no way to ask for the
 * rest. #298 made the narrowing a query parameter, which is what turns a filtered view into
 * a queue: this page reads accounts, pages through accounts, and empties when the account
 * reports are done.
 *
 * <h2>Why a complaint about a person is not a complaint about a campaign</h2>
 *
 * The decisions available are the same two — uphold, dismiss — and the consequences are not.
 * A campaign can be suspended and its funding stops; an account can be banned and every
 * session it holds is revoked, which signs somebody out of a platform they may have money
 * on. Those decisions are taken on `/admin/users` and never here: deciding a report records
 * a judgement about the complaint and does not act on what was reported, which AD-02 says in
 * its own note and which this screen repeats because it is the thing moderators get wrong.
 *
 * <h2>The route sits beside a dynamic segment, and that is safe</h2>
 *
 * `/admin/moderation/[reportId]` is the decision detail (#296). Next resolves a static
 * segment before a dynamic one, so `profiles` reaches this page; and a report identifier is
 * a UUID, so there is no identifier this page could be shadowing.
 *
 * `privatePageMetadata` for the reason every console route gives, and one of its own: the
 * queue quotes what one person wrote about another.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.moderationProfiles');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function ProfileModerationPage() {
  const t = await getTranslations('admin.pages.moderationProfiles');

  return (
    <div className="max-w-[880px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-white/64">{t('intro')}</p>

      <div className="mt-8">
        <ModerationQueue pinnedTarget="USER" detailHrefBase="/admin/moderation" copy={await moderationQueueCopy()} />
      </div>
    </div>
  );
}
