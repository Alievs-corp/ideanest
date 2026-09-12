'use client';

import { Link } from '../../i18n/navigation';
import { usePathname } from '../../i18n/navigation';
import { Bell } from 'lucide-react';
import { TopBar, cn } from '@ideanest/ui';
import { useSession } from '../session/SessionProvider';
import { AccountMenu } from './AccountMenu';
import { LanguageSwitcher } from './LanguageSwitcher';
import { SearchField } from '../search/SearchField';
import { MobileNavDrawer } from './MobileNavDrawer';
import { isCurrent } from './navigation';
import type { ShellCopy } from '../../lib/i18n/shell-copy';

/**
 * The global header — §4.13 WS-01, docs/ui-kit.md §8.6, docs/motion-system.md §4.7.
 *
 * <h2>`TopBar` is finally used</h2>
 *
 * `packages/ui` has shipped `layout/TopBar` since the kit was built and nothing imported it,
 * which is issue #260's first line. It owns the collapse — the pill narrowing to 445px,
 * taking `--white-surface`, and the padding tightening, all on one 300ms curve — and this
 * component owns what goes in its three slots.
 *
 * **The header never takes a surface; the pill does.** That is §2.5 applied to navigation
 * and §8.6 states it: white is what floats above the system, and a header that took
 * `--surface-2` would read as a second page ground stacked on the first. Nothing here sets a
 * background.
 *
 * <h2>One lime element, and only when signed out</h2>
 *
 * §8.6: the header's only lime element is the primary action a signed-out visitor is being
 * asked to take, and there is at most one. That is Register. A signed-in reader is not being
 * asked to do anything, so their actions — start a campaign, notifications, the account menu
 * — are white, ghost and neutral. §2.5's last line is the reason a second lime link is not
 * available here even though there is room for one: the pill beside it is already white, and
 * lime next to it says "this is happening now" about something that is not.
 *
 * <h2>Why the navigation links are not `TopBarLink`</h2>
 *
 * `TopBarLink` renders a bare `<a>`, which is a full document load for an internal route:
 * every navigation would discard the router, refetch the shell, and re-run the session
 * bootstrap. These are `next/link` with the same treatment applied — inheriting the bar's
 * current text colour, which is what makes them legible both on the dark ground at rest and
 * on the white pill once collapsed.
 *
 * <h2>The signed-in and signed-out states, and the third one</h2>
 *
 * `SessionProvider` answers `unknown` until the bootstrap resolves, and this renders neither
 * pair while it does. Guessing would mean showing Sign in and Register to a signed-in reader
 * on every page load and then swapping them — a flash that reads as the site logging them
 * out. What holds the space is the same width as the widest of the two, so nothing moves
 * when the answer arrives, and it is `aria-hidden` because "we do not know yet" is not
 * something to announce.
 */

/**
 * The bar's own link treatment — §8.6's navigation row.
 *
 * Colour is INHERITED rather than set. `TopBar` puts `text-white` on the pill at rest and
 * `text-on-white` on it once collapsed, so a link that named its own colour would be
 * invisible in one of the two states — which is exactly the `text-white/64` failure
 * CLAUDE.md §2 warns about. Opacity carries the resting state instead, and hover restores
 * it, at 150ms: chrome that moves is chrome being noticed.
 */
const NAV_LINK = [
  'text-sm font-medium tracking-[-0.01em] whitespace-nowrap',
  'transition-opacity duration-150 ease-in-out hover:opacity-100',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)] rounded-sm',
].join(' ');

export interface SiteHeaderProps {
  /**
   * Every word this header and its two client children draw, resolved on the server by
   * `SiteShell`. `lib/i18n/shell-copy.ts` explains why the copy arrives as a prop rather
   * than through `useTranslations`: the provider that hook needs would sit above every route
   * on the site, and this repository has measured that at up to 27.4 KiB per route.
   */
  readonly copy: ShellCopy;
}

export function SiteHeader({ copy }: SiteHeaderProps) {
  const pathname = usePathname();
  const { status, session, signOut } = useSession();

  return (
    <TopBar
      logo={
        <Link
          href="/"
          className="shrink-0 rounded-sm text-lg font-semibold tracking-[-0.03em] text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
        >
          IdeaNest
        </Link>
      }
      nav={
        /*
         * `hidden md:flex` on the list rather than on `TopBar`'s slot: the slot is what
         * carries the collapsing pill, and hiding it outright below the breakpoint would
         * remove the element §4.7 animates. Below `md` the same links are in the drawer
         * (WS-03), which is the one navigation on screen at that size.
         */
        <ul aria-label={copy.nav.label} className="hidden list-none items-center gap-8 md:flex">
          {copy.nav.links.map((link) => {
            const current = isCurrent(link.href, pathname);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={current ? 'page' : undefined}
                  className={cn(NAV_LINK, current ? 'opacity-100 underline underline-offset-8' : 'opacity-80')}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      }
      actions={
        <>
          <SearchField className="hidden lg:block" />

          {/*
            THE LANGUAGE CONTROL IS HERE AND NOT ONLY IN THE FOOTER. Somebody who landed in a
            language they cannot read does not scroll to the bottom of a page to look for a
            way out of it — and until this, the footer was the only way out that did not need
            an account. It is drawn for every visitor, signed in or not, and before the pair
            that changes with the session so that its position does not move when the
            bootstrap answers.

            NOT BELOW `sm`. Measured at 390px the globe pushed the register pill past the
            edge and took the drawer's own button with it, and the row has no slack to give:
            §8.6 spends the shell's one lime element on that pill. The drawer carries the
            four languages flat at those widths, which is where a phone's navigation already
            is.
          */}
          <LanguageSwitcher label={copy.language.label} className="hidden sm:block" />

          {status === 'signed-in' && session !== null && (
            <>
              <Link
                href="/notifications"
                aria-label={copy.actions.notifications}
                title={copy.actions.notifications}
                className="inline-grid size-10 place-items-center rounded-full bg-surface-3 text-white transition-colors duration-150 ease-in-out hover:bg-surface-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
              >
                <Bell aria-hidden="true" className="size-[18px]" />
              </Link>
              <AccountMenu session={session} onSignOut={signOut} copy={copy.actions} />
            </>
          )}

          {status === 'signed-out' && (
            <>
              <Link
                href="/sign-in"
                className="hidden h-10 items-center rounded-full px-4 text-sm font-medium text-white transition-colors duration-150 ease-in-out hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)] sm:inline-flex"
              >
                {copy.actions.signIn}
              </Link>
              {/*
                The one lime element in the shell (§8.6). A LINK STYLED AS THE ACCENT PILL
                rather than `Pill` itself, because `Pill` is a `<button>` and a navigation
                target that is a button is one the browser cannot open in a new tab, cannot
                middle-click, and does not announce as a link. `data-on-lime` is carried so
                §9.3's focus ring flips to near-black — a lime ring on a lime surface is
                invisible.
              */}
              <Link
                href="/register"
                data-on-lime=""
                className="inline-flex h-10 items-center rounded-full bg-lime-500 px-[18px] text-sm font-medium text-on-lime transition-colors duration-150 ease-in-out hover:bg-lime-400 active:bg-lime-600"
              >
                {copy.actions.register}
              </Link>
            </>
          )}

          {status === 'unknown' && (
            /*
              The placeholder. It holds the width of the signed-out pair so the row does not
              reflow when the bootstrap answers, and it announces nothing: "we do not know
              who you are yet" is not a fact worth interrupting a screen reader with.
            */
            <div aria-hidden="true" className="h-10 w-[132px] sm:w-[190px]" />
          )}

          <MobileNavDrawer copy={copy} />
        </>
      }
    />
  );
}
