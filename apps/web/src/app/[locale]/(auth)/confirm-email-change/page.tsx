import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { EmailChangeConfirmView } from '../../../../components/auth/EmailChangeConfirmView';
import { emailChangeCopy } from '../../../../lib/i18n/shell-copy.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * `/confirm-email-change` — §4.1 A-12, issue #277.
 *
 * <h2>Why an address-change screen is in `app/(auth)` and not in `/settings`</h2>
 *
 * `POST /v1/auth/confirm-email-change` is unauthenticated, and `CredentialController` gives the
 * reason: "the person following it is reading the new mailbox, which is the one place they are
 * least likely to be signed in". A landing page behind the session guard would send that person
 * to a sign-in form — and the address they would sign in with is the old one, because the
 * account has not moved yet. So the route sits beside `/verify-email`, which solved the
 * identical problem for A-02, and inherits its frame, its `noindex` and its `robots.txt`
 * disallow.
 *
 * **The name is deliberately not `/verify-email-change`.** Two paths a segment apart, one
 * proving a new account's address and the other moving an existing account to a new one, is a
 * pair somebody eventually reads the wrong way round in a log or an email template. It matches
 * the endpoint it posts to instead.
 *
 * <h2>The `Suspense` boundary is required</h2>
 *
 * `EmailChangeConfirmView` reads the token with `useSearchParams`, and a component that does so
 * must sit under a boundary or Next refuses to statically render the route. The fallback is the
 * same sentence the component's own "confirming" state shows, so the two do not read as
 * different screens.
 *
 * <h2>`noindex`</h2>
 *
 * For `/verify-email`'s two reasons: there is nothing here to index, and the URL carries a
 * single-use credential, which is the one thing that must never reach an index.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.emailChange');
  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function ConfirmEmailChangePage() {
  const t = await getTranslations('auth');

  return (
    <Suspense fallback={<p className="text-fg-40">{t('checkingLink')}</p>}>
      <EmailChangeConfirmView copy={await emailChangeCopy()} />
    </Suspense>
  );
}
