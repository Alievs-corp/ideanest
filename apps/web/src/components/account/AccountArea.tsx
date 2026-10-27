import type { ReactNode } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { SiteShell } from '../shell/SiteShell';
import { ACCOUNT_GROUPS } from '../../lib/account/navigation';
import { AccountNav, type AccountNavGroup } from './AccountNav';
import { AccountNavDrawer } from './AccountNavDrawer';

/**
 * The frame every account screen renders inside — §4.2 and §4.13 WS-01, issue #275.
 *
 * <h2>It takes the site shell, and the authentication screens do not</h2>
 *
 * `app/(auth)` uses `MinimalShell` because a sign-in page is a screen with one job and the
 * header's job is to offer eleven others. **The account area is the opposite case.** Somebody
 * managing their notifications is already signed in, is not mid-transaction, and the most
 * likely next thing they want is a campaign — so taking the navigation away would be taking
 * away the way out. `apps/web/README.md`'s route table records the move.
 *
 * <h2>The navigation is beside the content, not above it</h2>
 *
 * docs/ui-kit.md §6.3 puts a rail on the left of a working surface, and this is one: thirteen
 * destinations somebody moves between, several times, in one sitting. Above the content it
 * would push the page down on every screen and would compete with the site header a few
 * pixels above it.
 *
 * <h2>No second `<main>`</h2>
 *
 * `SiteShell` owns the only one on the page, and the screens under this used to declare their
 * own — `/settings/sessions` and `/settings/notifications` both did, because they had no
 * shell to be inside. Two `<main>` elements is not a duplicated landmark so much as an
 * ambiguous one: assistive technology offers "jump to main" and there is now more than one
 * answer. Both pages were changed in the same pull request that gave them this frame.
 *
 * <h2>It is the translation boundary — §21.1, issue #324</h2>
 *
 * Two things happen on this frame and nowhere else, because this is the only element every
 * account screen is inside and the only one whose subtree is exactly the translated half of
 * the site.
 *
 * **THE NAVIGATION'S WORDS ARE RESOLVED HERE, ON THE SERVER, AND GO DOWN AS PLAIN STRINGS.**
 * `AccountNav` is a client boundary — it needs `usePathname` to mark one entry
 * `aria-current="page"` — and the first version of this file answered that by wrapping it in
 * `NextIntlClientProvider` so it could call `useTranslations` itself. It worked, and it cost
 * more than it bought: the provider puts next-intl's **client** runtime plus the serialised
 * `account` namespace into the First Load JS of every route in the area, whether or not that
 * route draws anything else from the catalogue. Sixteen budgets broke on it at once —
 * `/settings/sessions` by 27.4 KiB, `/settings/notifications` by 23.5, `/settings/email` by
 * 16.4, `/settings` and `/account` by 11.1 each, `/settings/profile` by 7.7 — and
 * `apps/web/performance/README.md` asks what the kilobytes bought. A navigation bar's labels
 * are not an answer to that question.
 *
 * `getTranslations('account')` reads the same catalogue `i18n/request.ts` negotiated for this
 * render, on the server, where it is already open and costs the browser nothing. Sixteen
 * strings cross the boundary instead of the machinery for looking sixteen strings up, and the
 * result is identical in every language. `app/settings/language/page.tsx` and
 * `components/settings/LanguagePanel.tsx` make the same trade a screen deeper, and there is
 * now no `NextIntlClientProvider` anywhere in this subtree: nothing under this frame calls
 * `useTranslations`, and anything that starts to should be given props rather than a provider.
 *
 * **`lang` ON THIS `<div>`, AND WHY IT SURVIVED #123.** This paragraph used to say the
 * attribute was an override: `app/layout.tsx` hard-coded `lang="en"` because reading a locale
 * there would have made every cached public route dynamic, so the document said English and
 * this subtree corrected it. That is no longer the arrangement. The language is a path
 * segment, `app/[locale]/layout.tsx` renders `<html lang={locale}>` from it, and the shell
 * around this `<div>` is drawn from the catalogue rather than from English literals.
 *
 * So the attribute now restates what the document already says instead of contradicting it,
 * and it is kept rather than deleted because it is a claim this component can make about
 * itself: the frame declares the language of the copy it resolved, whatever it is mounted
 * inside. Nesting a matching `lang` is inert in every user agent — an override that agrees
 * with its parent changes nothing — so the cost is one attribute and the benefit is that the
 * claim does not depend on a layout two directories up.
 */
export interface AccountAreaProps {
  readonly children: ReactNode;
}

export async function AccountArea({ children }: AccountAreaProps) {
  const locale = await getLocale();
  const t = await getTranslations('account');

  /*
   * The keys live in `lib/account/navigation.ts` and the sentences live in `messages/*.json`;
   * this is the one place they meet. Mapping here rather than inside `AccountNav` is what
   * keeps the catalogue on the server — see the docblock above.
   */
  const groups: readonly AccountNavGroup[] = ACCOUNT_GROUPS.map((group) => ({
    heading: t(`groups.${group.headingKey}`),
    links: group.links.map((link) => ({
      href: link.href,
      label: t(`links.${link.key}.label`),
    })),
  }));

  return (
    <SiteShell>
      <div lang={locale} className="mx-auto w-full max-w-[1120px] px-5 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-col gap-6 xl:flex-row xl:gap-14">
          <AccountNavDrawer
            label={t('nav.label')}
            openLabel={t('nav.open')}
            closeLabel={t('nav.close')}
            groups={groups}
          />
          <div className="hidden xl:block xl:w-[15rem] xl:shrink-0">
            <AccountNav label={t('nav.label')} groups={groups} />
          </div>
          {/*
            `min-w-0` so a long tracking number or an unbroken address line scrolls inside
            its own container rather than widening the flex row and pushing the navigation
            off the side of the page.
          */}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </SiteShell>
  );
}
