import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountPageHeader } from '../../../../components/account/AccountPageHeader';
import { StudentVerificationPanel } from '../../../../components/account/StudentVerificationPanel';
import { privatePageMetadata } from '../../../../lib/seo/metadata';
import { studentVerificationCopy } from '../../../../lib/i18n/shell-copy.server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.pages.student');

  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

/**
 * `/account/student` — the student card check a student plan asks for, issue #655.
 *
 * <p>Under `/account` because it is something the account has, like a pledge or a saved campaign:
 * a standing that staff granted and that runs out. The pricing page sends a reader here from a
 * student plan's card, and this page sends an approved reader back.
 *
 * <p>`privatePageMetadata`: it names an institution and a card number, and is nobody's to index.
 */
export default async function StudentVerificationPage() {
  const t = await getTranslations('account.pages.student');

  return (
    <>
      <AccountPageHeader title={t('title')}>{t('intro')}</AccountPageHeader>

      <div className="mt-8">
        <StudentVerificationPanel copy={await studentVerificationCopy()} />
      </div>
    </>
  );
}
