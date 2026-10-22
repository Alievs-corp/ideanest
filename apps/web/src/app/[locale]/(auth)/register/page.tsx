import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { RegisterForm } from '../../../../components/auth/RegisterForm';
import { registerCopy } from '../../../../lib/i18n/shell-copy.server';
import { privatePageMetadata } from '../../../../lib/seo/metadata';

/**
 * `/register` — §4.1 A-01, issue #269.
 *
 * <h2>The heading is inside the form, and that is not an oversight</h2>
 *
 * Registration has two screens at one URL: the form, and the "check your email" state that
 * replaces it once the service has accepted. The second is not a different page — nothing has
 * been navigated to, and reloading would put somebody back on a form for an account that now
 * exists — so it is a state rather than a route. Which of the two headings is correct is
 * therefore something only the form knows, and a heading rendered here would be the wrong one
 * half the time, sitting above the right one.
 *
 * <h2>The `Suspense` boundary</h2>
 *
 * `RegisterForm` reads `?next=` with `useSearchParams` so it can hand the same return path on
 * to the sign-in link. A component that does so must sit under a boundary, or Next refuses to
 * statically render the route.
 *
 * `noindex` for the reason the sign-in page gives.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.register');
  return privatePageMetadata({ title: t('metaTitle'), description: t('metaDescription') });
}

export default async function RegisterPage() {
  const t = await getTranslations('auth');

  return (
    <Suspense fallback={<p className="text-fg-40">{t('loadingForm')}</p>}>
      <RegisterForm copy={await registerCopy()} />
    </Suspense>
  );
}
