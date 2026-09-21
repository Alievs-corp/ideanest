import type { Metadata } from 'next';
import { Link } from '../../../../i18n/navigation';
import { AccountPageHeader } from '../../../../components/account/AccountPageHeader';
import { TwoFactorPanel } from '../../../../components/settings/TwoFactorPanel';
import { privatePageMetadata } from '../../../../lib/seo/metadata';
import { getTranslations } from 'next-intl/server';
import { twoFactorPanelCopy } from '../../../../lib/i18n/shell-copy.server';

/**
 * The one class an inline link inside a page's introduction carries.
 *
 * Named rather than repeated because these sentences are now built by `t.rich`, where each
 * tag is a function and a class typed twice in two of them is a difference nobody sees until
 * one of the links is underlined and the other is not.
 */
const INLINE_LINK = 'text-white underline underline-offset-4';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.pages.security');

  /*
   * A function rather than a `const` since #324: the tab title is the one piece of
   * this screen a reader sees before the page paints, and it followed the build
   * rather than the reader until the catalogue reached it.
   */
  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

/**
 * `/settings/security` — §4.1 A-07, issue #278.
 *
 * A shell around a client boundary, like the rest of the account area: the enrolment is one
 * account's, behind a bearer token, and every call on it is a write. There is nothing a server
 * render could produce.
 *
 * **Devices are next door rather than here.** A-09's session list is the other half of "who
 * can get into this account", and folding the two screens together was tempting. They are
 * kept apart because they answer different questions at different moments: the device list is
 * something to check, and this is something to set up once. The navigation puts them beside
 * each other, and this page links across.
 */
export default async function SecurityPage() {
  const [t, panel] = await Promise.all([
    getTranslations('settings.pages.security'),
    twoFactorPanelCopy(),
  ]);

  return (
    <>
      <AccountPageHeader title={t('title')}>
        {t.rich('intro', {
          devices: (chunks) => (
            <Link href="/settings/sessions" className={INLINE_LINK}>
              {chunks}
            </Link>
          ),
        })}
      </AccountPageHeader>

      <div className="mt-8">
        <TwoFactorPanel copy={panel} />
      </div>
    </>
  );
}
