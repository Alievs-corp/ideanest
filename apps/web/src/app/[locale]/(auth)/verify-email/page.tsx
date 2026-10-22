import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { VerifyEmailView } from '../../../../components/auth/VerifyEmailView';
import { verifyEmailCopy } from '../../../../lib/i18n/shell-copy.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * `/verify-email` — §4.1 A-02, issue #270.
 *
 * <h2>This is the address the verification email points at</h2>
 *
 * The service issues the token and the message that carries it (`RegistrationService` publishes
 * `EmailVerificationRequested`); the link in that message resolves against
 * `ideanest.notification.email.base-url`, which is this application's origin. So the contract
 * between the two halves is this path and the name of one query parameter, `token`, and it is
 * written down in `apps/web/README.md`'s route table as well as here.
 *
 * <h2>The `Suspense` boundary is required</h2>
 *
 * `VerifyEmailView` reads the token with `useSearchParams`. Without a boundary Next refuses to
 * statically render the route, and this one is worth rendering statically: it is a shell whose
 * only dynamic input arrives in the browser's own URL.
 *
 * `noindex` for the reason the sign-in page gives, and with one more of its own — the URL
 * carries a single-use credential, and nothing that carries a credential should be in an
 * index.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.verifyEmail');
  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function VerifyEmailPage() {
  const t = await getTranslations('auth');

  return (
    <Suspense fallback={<p className="text-fg-40">{t('checkingLink')}</p>}>
      <VerifyEmailView copy={await verifyEmailCopy()} />
    </Suspense>
  );
}
