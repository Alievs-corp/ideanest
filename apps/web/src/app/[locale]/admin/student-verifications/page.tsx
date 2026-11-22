import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { StudentVerificationQueue } from '../../../../components/admin/StudentVerificationQueue';
import { studentVerificationQueueCopy } from '../../../../lib/i18n/admin/console.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * The student check's review queue — issue #655, AD-02's first screen of its own.
 *
 * <p>A student plan is sold only to an account whose student card and selfie a member of staff
 * approved. This is where that is decided: approve, reject with a reason, or revoke an approval
 * when abuse is found later. The service asks for the identity review's capability and audits every
 * decision and every document opened; THE ROUTE IS NOT A GATE, and this screen renders the
 * service's refusal rather than making a weaker copy of it.
 *
 * <p>`privatePageMetadata`: it shows people's faces and student cards.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.pages.studentVerifications');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function StudentVerificationsPage() {
  const t = await getTranslations('admin.pages.studentVerifications');

  return (
    <div className="max-w-[920px]">
      <h1 className="text-xl font-semibold tracking-[-0.03em] text-fg sm:text-2xl lg:text-3xl">{t('title')}</h1>
      <p className="mt-2 max-w-[62ch] text-sm text-fg-64">{t('intro')}</p>

      <div className="mt-8">
        <StudentVerificationQueue copy={await studentVerificationQueueCopy()} />
      </div>
    </div>
  );
}
