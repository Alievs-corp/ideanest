import type { Metadata } from 'next';
import { Link } from '../../../../i18n/navigation';
import { AccountPageHeader } from '../../../../components/account/AccountPageHeader';
import { EmailChangePanel } from '../../../../components/settings/EmailChangePanel';
import { emailChangePanelCopy } from '../../../../lib/i18n/shell-copy.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';
import { getTranslations } from 'next-intl/server';

/**
 * The one class an inline link inside a page's introduction carries.
 *
 * Named rather than repeated because these sentences are now built by `t.rich`, where each
 * tag is a function and a class typed twice in two of them is a difference nobody sees until
 * one of the links is underlined and the other is not.
 */
const INLINE_LINK = 'text-fg underline underline-offset-4';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.pages.email');

  /*
   * A function rather than a `const` since #324: the tab title is the one piece of
   * this screen a reader sees before the page paints, and it followed the build
   * rather than the reader until the catalogue reached it.
   */
  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

/**
 * `/settings/email` — §4.1 A-12, issue #277.
 *
 * A shell around a client boundary, like the rest of the account area: the address is one
 * account's, behind a bearer token, and the only call on the page is a write. There is nothing
 * a server render could produce — and, for the same reason `SessionProvider` gives, nothing it
 * could read either: the refresh cookie is issued on `Path=/v1/auth`, so a request for this
 * page carries no session for `cookies()` to find.
 *
 * <h2>It is a page of its own rather than a section of `/settings/security`</h2>
 *
 * The security screen is two-factor authentication, which is something to set up once. This is
 * something to change when an address stops working, and the two are reached from different
 * moments. `/settings/password` is next door for the same reason and is linked from here,
 * because the two credentials are the pair somebody thinks about together — but they are not
 * one form: A-13 signs every session out and A-12 signs none out, and putting the two
 * submissions on one screen would put one warning over both.
 */
export default async function EmailSettingsPage() {
  const t = await getTranslations('settings.pages.email');

  return (
    <>
      <AccountPageHeader title={t('title')}>
        {t.rich('intro', {
          password: (chunks) => (
            <Link href="/settings/password" className={INLINE_LINK}>
              {chunks}
            </Link>
          ),
        })}
      </AccountPageHeader>

      <div className="mt-8">
        <EmailChangePanel copy={await emailChangePanelCopy()} />
      </div>
    </>
  );
}
