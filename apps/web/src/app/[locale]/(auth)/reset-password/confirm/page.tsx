import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { PasswordResetConfirmForm } from '../../../../../components/auth/PasswordResetConfirmForm';
import { passwordResetConfirmCopy } from '../../../../../lib/i18n/shell-copy.server';
import { privatePageMetadata } from '../../../../../lib/seo/metadata';

/**
 * `/reset-password/confirm` — §4.1 A-06, issue #271.
 *
 * <h2>This is the address the reset email points at</h2>
 *
 * The service issues the token and the message that carries it (`PasswordResetService`
 * publishes `PasswordResetRequested`); the link in that message resolves against
 * `ideanest.notification.email.base-url`, which is this application's origin. So the contract
 * between the two halves is this path and the name of one query parameter, `token` — the same
 * arrangement `/verify-email` documents, written the same way so that a reader of one finds the
 * other. `RESET_TOKEN_PARAM` is where the name lives in code.
 *
 * **A child of `/reset-password` rather than a route of its own**, because it is the second
 * half of one capability and the pair reads as one in every listing that shows paths. Somebody
 * whose link has died is sent one segment up, which is where a new one is asked for.
 *
 * <h2>The `Suspense` boundary is required</h2>
 *
 * `PasswordResetConfirmForm` reads the token with `useSearchParams`. Without a boundary Next
 * refuses to statically render the route, and this one is worth rendering statically: it is a
 * shell whose only dynamic input arrives in the browser's own URL.
 *
 * <h2>`noindex`, and this route needs it more than its neighbours</h2>
 *
 * The URL carries a single-use credential that sets a password. Nothing carrying a credential
 * belongs in an index, and `lib/seo/indexability.ts` disallows the path as well — the same
 * pair of locks `/verify-email` is given, for a token with more behind it.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.resetConfirm');
  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function ResetPasswordConfirmPage() {
  const t = await getTranslations('auth');

  return (
    <Suspense fallback={<p className="text-fg-40">{t('checkingLink')}</p>}>
      <PasswordResetConfirmForm copy={await passwordResetConfirmCopy()} />
    </Suspense>
  );
}
