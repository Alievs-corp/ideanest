import type { Metadata } from 'next';
import { Link } from '../../../../i18n/navigation';
import { AccountPageHeader } from '../../../../components/account/AccountPageHeader';
import { PreferencesPanel } from '../../../../components/notifications/PreferencesPanel';
import { privatePageMetadata } from '../../../../lib/seo/metadata';
import { getTranslations } from 'next-intl/server';
import { notificationPreferencesCopy } from '../../../../lib/i18n/shell-copy.server';

/**
 * The one class an inline link inside a page's introduction carries.
 *
 * Named rather than repeated because these sentences are now built by `t.rich`, where each
 * tag is a function and a class typed twice in two of them is a difference nobody sees until
 * one of the links is underlined and the other is not.
 */
const INLINE_LINK = 'text-fg underline underline-offset-4';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.pages.notifications');

  /*
   * A function rather than a `const` since #324: the tab title is the one piece of
   * this screen a reader sees before the page paints, and it followed the build
   * rather than the reader until the catalogue reached it.
   */
  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

/**
 * Per-category, per-channel delivery control — §4.10, and #89.
 *
 * A shell around a client boundary, like `/settings/sessions`: the settings are one
 * account's, behind a bearer token, and there is nothing a server render could produce.
 *
 * The page states the two things somebody has to know before they touch a control — that a
 * digest is once a day rather than never, and that in-app delivery is what fills the inbox
 * — because both are otherwise learned by turning something off and waiting to find out
 * what stopped arriving.
 *
 * **It lost its own `<main>` and its own page padding in #275**, for the reason
 * `/settings/sessions` states: the account area's layout owns both, and `SiteShell` owns the
 * single `<main>` on the page.
 */
export default async function NotificationSettingsPage() {
  const t = await getTranslations('settings.pages.notifications');

  return (
    <>
      <AccountPageHeader title={t('title')}>
        {t.rich('intro', {
          b: (chunks) => <strong>{chunks}</strong>,
          inbox: (chunks) => (
            <Link href="/notifications" className={INLINE_LINK}>
              {chunks}
            </Link>
          ),
        })}
      </AccountPageHeader>

      <div className="mt-8">
        <PreferencesPanel copy={await notificationPreferencesCopy()} />
      </div>
    </>
  );
}
