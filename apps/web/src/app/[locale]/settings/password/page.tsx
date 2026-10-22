import type { Metadata } from 'next';
import { Link } from '../../../../i18n/navigation';
import { AccountPageHeader } from '../../../../components/account/AccountPageHeader';
import { PasswordChangePanel } from '../../../../components/settings/PasswordChangePanel';
import { passwordChangePanelCopy } from '../../../../lib/i18n/shell-copy.server';
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
  const t = await getTranslations('settings.pages.password');

  /*
   * A function rather than a `const` since #324: the tab title is the one piece of
   * this screen a reader sees before the page paints, and it followed the build
   * rather than the reader until the catalogue reached it.
   */
  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

/**
 * `/settings/password` — §4.1 A-13, issue #277.
 *
 * A shell around a client boundary, like the rest of the account area. The one call on it is a
 * write behind a bearer token, so there is nothing a server render could produce.
 *
 * <h2>It links to the reset rather than hiding it</h2>
 *
 * A-13 requires the current password, and there are two people who cannot supply one: somebody
 * who has forgotten it, and somebody who registered through Google or Apple and has never had
 * one — `AccountCredentialsService` refuses the second with the same `incorrect-password` as
 * the first, because an account with no credential row has nothing to confirm with.
 *
 * `/reset-password` is the documented way through for both. `PasswordResetService` says so in
 * as many words: an account with no password can still reset one, and that is "the documented
 * way back for a person who has lost access to the provider account they signed up with — the
 * alternative is an account that can never be reached again, which is a support ticket with no
 * answer". A page that offered only the form above would leave both of them stuck on a refusal
 * whose real remedy is one link away.
 *
 * The link is here, in the page's own standfirst, rather than inside the panel: it is an
 * alternative to the whole form and not a footnote to one of its fields.
 */
export default async function PasswordSettingsPage() {
  const t = await getTranslations('settings.pages.password');

  return (
    <>
      <AccountPageHeader title={t('title')}>
        {t.rich('intro', {
          reset: (chunks) => (
            <Link href="/reset-password" className={INLINE_LINK}>
              {chunks}
            </Link>
          ),
        })}
      </AccountPageHeader>

      <div className="mt-8">
        <PasswordChangePanel copy={await passwordChangePanelCopy()} />
      </div>
    </>
  );
}
