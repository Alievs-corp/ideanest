import type { Metadata } from 'next';
import {
  OPERATOR_NAME,
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  displayPhone,
  supportMailto,
} from '@ideanest/messages/contact';
import { Link } from '../../../../i18n/navigation';
import { StaticPage } from '../../../../components/content/StaticPage';
import { localeOrDefault } from '../../../../lib/i18n/locale';
import { publicPageMetadata } from '../../../../lib/seo/metadata';
import { StructuredData } from '../../../../components/seo/StructuredData';
import { sitePageGraph } from '../../../../lib/seo/structured-data/graphs';
import { graphContext } from '../../../../lib/i18n/shell-copy.server';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations('static.support');

  return publicPageMetadata({
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: '/support',
    locale: localeOrDefault(locale),
  });
}

/**
 * The anchor the store listings point at for account deletion — issue #325.
 *
 * Google Play asks for a deletion URL a person can use **without signing in**, and
 * `/settings/privacy` is behind sign-in. `apps/mobile/store/README.md` gives Play
 * `https://ideyanest.com/<locale>/support#delete-account`, so this id is an address published
 * outside the repository: renaming it breaks a store listing, silently.
 */
const DELETE_ACCOUNT_ANCHOR = 'delete-account';

/**
 * `/support` — issue #325: the support URL the App Store and Google Play listings carry.
 *
 * <h2>What a store reviewer checks, and what a person needs</h2>
 *
 * Apple wants a support URL that leads to a way to contact the developer; Google wants an
 * account-deletion URL that works for somebody who can no longer sign in. Both are the same
 * reader as a backer with a question: somebody who wants a person, an address and a straight
 * answer. So the page is an address and a phone number first, the pages that already answer
 * most questions second, and the three ways to delete an account last, under an anchor.
 *
 * <h2>The contact details are not in this file</h2>
 *
 * They are `@ideanest/messages/contact`, beside the WhatsApp number, and they are what the
 * published privacy policy states in §2.2. The catalogue holds the sentences with a
 * placeholder, so the address is written once rather than four times.
 *
 * <h2>Deletion says what the privacy policy says</h2>
 *
 * §23 of the policy in force is the source for what is removed and what is kept: financial
 * records stay blocked for the statutory periods, pledges stand and still refund if the
 * campaign fails, a creator with obligations cannot be fully deleted. The thirty-day window is
 * the product's (`settings.panels.closure`, `AccountDeletionService`), and it is stated only
 * for closures made in the app or on the website, because those are the ones that schedule it.
 *
 * Static like its three neighbours: no fetch, no session, no client boundary, no motion
 * (`StaticPage` says why).
 */
/** See `about/page.tsx` — the same two shapes, named for the same reason. */
const INLINE_LINK = 'text-fg underline underline-offset-4';
const BOLD = (chunks: ReactNode) => <strong className="font-medium text-fg">{chunks}</strong>;

export default async function SupportPage() {
  const t = await getTranslations('static.support');

  const link = (href: string) => (chunks: ReactNode) => (
    <Link href={href} className={INLINE_LINK}>
      {chunks}
    </Link>
  );
  /* `mailto:` and `tel:` are somebody else's addresses, so a plain anchor, not the locale `Link`. */
  const external = (href: string) => (chunks: ReactNode) => (
    <a href={href} className={INLINE_LINK}>
      {chunks}
    </a>
  );
  const privacy = link('/legal/privacy-policy');

  return (
    <>
      <StructuredData nodes={sitePageGraph({ crumb: { name: t('metaTitle'), path: '/support' }, ...(await graphContext()) })} />
      <StaticPage title={t('title')} summary={t('summary')}>
        <h2>{t('contact.heading')}</h2>
        <p>{t('contact.intro')}</p>
        <ul>
          <li>
            {t.rich('contact.email', {
              b: BOLD,
              email: external(supportMailto()),
              address: SUPPORT_EMAIL,
            })}
          </li>
          <li>
            {t.rich('contact.phone', {
              b: BOLD,
              phone: external(`tel:${SUPPORT_PHONE}`),
              number: displayPhone(SUPPORT_PHONE),
            })}
          </li>
        </ul>
        <p>{t.rich('contact.operator', { operator: OPERATOR_NAME, privacy })}</p>

        <h2>{t('answers.heading')}</h2>
        <ul>
          <li>{t.rich('answers.howItWorks', { link: link('/how-it-works') })}</li>
          <li>{t.rich('answers.pricing', { link: link('/pricing') })}</li>
          <li>{t.rich('answers.trustSafety', { link: link('/trust-safety') })}</li>
          <li>{t.rich('answers.legal', { link: link('/legal') })}</li>
        </ul>

        <h2>{t('report.heading')}</h2>
        <p>{t.rich('report.body', { trustSafety: link('/trust-safety') })}</p>

        <h2 id={DELETE_ACCOUNT_ANCHOR} className="scroll-mt-24">
          {t('deletion.heading')}
        </h2>
        <p>{t('deletion.intro')}</p>
        <ul>
          <li>{t.rich('deletion.app', { b: BOLD })}</li>
          <li>{t.rich('deletion.web', { b: BOLD, privacy: link('/settings/privacy') })}</li>
          <li>
            {t.rich('deletion.email', {
              b: BOLD,
              email: external(supportMailto(t('deletion.subject'))),
              address: SUPPORT_EMAIL,
              subject: t('deletion.subject'),
            })}
          </li>
        </ul>
        <p>{t('deletion.grace')}</p>
        <p>{t.rich('deletion.removed', { b: BOLD })}</p>
        <p>{t('deletion.keptIntro')}</p>
        <ul>
          <li>{t.rich('deletion.records', { b: BOLD, privacy })}</li>
          <li>{t.rich('deletion.pledges', { b: BOLD })}</li>
          <li>{t.rich('deletion.rewards', { b: BOLD })}</li>
          <li>{t.rich('deletion.creators', { b: BOLD })}</li>
        </ul>
      </StaticPage>
    </>
  );
}
