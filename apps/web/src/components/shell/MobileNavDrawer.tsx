'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from '../../i18n/navigation';
import { useLocale, usePathname } from '../../i18n/navigation';
import { Menu, X } from 'lucide-react';
import { cn, useDismiss, useFocusTrap, useScrollLock } from '@ideanest/ui';
import { useSession } from '../session/SessionProvider';
import { LanguageLinks } from './LanguageSwitcher';
import { SearchField } from '../search/SearchField';
import { isCurrent } from './navigation';
import type { ShellCopy } from '../../lib/i18n/shell-copy';

/**
 * Off-canvas navigation and search below the layout's breakpoint — §4.13 WS-03.
 *
 * <h2>Why it is not `Drawer`</h2>
 *
 * The kit has one, and it is behind `@ideanest/ui/motion` because it animates with `motion`.
 * This component is in the shell, which is on every route in the site, so importing it would
 * put the whole 116 kB animation runtime into the first load of every page — the regression
 * `packages/ui/src/motion.ts` exists to describe and undo. A header is the last place to
 * spend that.
 *
 * What is reused instead is everything about `Drawer` that is not the animation, from the
 * root barrel, which costs nothing: `useFocusTrap` for the tab cycle, `useDismiss` for
 * Escape, `useScrollLock` so the page behind does not scroll under the panel. Those are the
 * parts that are hard to get right and easy to get wrong.
 *
 * The entry itself is a CSS transition on `transform`, which is what §4.11.1 specifies for a
 * drawer anyway — "a drawer slides with `translate`; animating `right` or `width` relayouts
 * a fixed full-height panel on every frame" — at the 200ms that table gives, and it collapses
 * to nothing under `prefers-reduced-motion` through the global rule in the token file.
 *
 * <h2>Focus, in the order it actually happens</h2>
 *
 * Opening moves focus into the panel and closing returns it to the button that opened it. A
 * drawer that leaves focus behind on the page is a drawer a keyboard user cannot reach and
 * then cannot escape from; one that drops focus to `<body>` on close puts them back at the
 * top of the document, which is worse than where they started.
 *
 * <h2>It exists in the DOM only while it is open</h2>
 *
 * Not hidden with a class. Every link inside it is a tab stop, and a permanently mounted
 * panel with `opacity: 0` would put nine of them in the tab order of every page on the site
 * for anybody who never opens it.
 */

export interface MobileNavDrawerProps {
  /** The shell's words, resolved on the server. See `lib/i18n/shell-copy.ts`. */
  readonly copy: ShellCopy;
}

export function MobileNavDrawer({ copy }: MobileNavDrawerProps) {
  const pathname = usePathname();
  const locale = useLocale();
  const languageHeadingId = useId();
  const { status, session, signOut } = useSession();

  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useDismiss({ open, onDismiss: close });
  useScrollLock(open);
  /*
   * `useFocusTrap` moves focus into the panel on open AND returns it to whatever was focused
   * before on close — the trigger, on every path out: Escape, the close button, the
   * backdrop, or a link. Nothing further is needed here, and a second restore of our own
   * would fight it.
   */
  useFocusTrap(open, panel);

  // A navigation is a dismissal: the shell does not unmount between routes, so the panel
  // would otherwise stay open over the page the reader just chose.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        aria-label={copy.drawer.open}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="inline-grid size-10 place-items-center rounded-full bg-surface-3 text-white transition-colors duration-150 ease-in-out hover:bg-surface-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)] md:hidden"
      >
        <Menu aria-hidden="true" className="size-[18px]" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] md:hidden">
          {/*
            The backdrop fades and the panel slides — §4.11's rule, the same timing at a
            different distance. It is `aria-hidden` and the dismissal it carries is
            duplicated by the close button and by Escape, so nothing here is the only way
            out.
          */}
          <div
            aria-hidden="true"
            onClick={close}
            className="absolute inset-0 bg-black/60 motion-safe:animate-[nav-backdrop_200ms_ease-out]"
          />

          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={copy.drawer.label}
            /* Focusable but not a tab stop, so a panel takes focus itself when it has no
               control to hand it to. `useFocusTrap` relies on this. */
            tabIndex={-1}
            className={cn(
              'absolute inset-y-0 right-0 flex w-[min(20rem,88vw)] flex-col',
              'border-l border-white/8 bg-surface-1',
              'motion-safe:animate-[nav-panel_200ms_ease-out]',
            )}
          >
            <div className="flex items-center justify-between px-5 py-5">
              <span className="text-lg font-semibold tracking-[-0.03em] text-white">IdeaNest</span>
              <button
                type="button"
                aria-label={copy.drawer.close}
                onClick={close}
                className="inline-grid size-10 place-items-center rounded-full bg-surface-3 text-white transition-colors duration-150 ease-in-out hover:bg-surface-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
              >
                <X aria-hidden="true" className="size-[18px]" />
              </button>
            </div>

            <div className="px-5 pb-2">
              {/*
                WS-03 carries the header's search as well as its navigation, and this is the
                only place a phone gets one: `SearchField` is `hidden lg:block` in the bar,
                because a 240-pixel field does not fit beside a wordmark on a 360-pixel
                screen.
              */}
              <SearchField copy={copy.search} fullWidth onNavigate={close} />
            </div>

            <nav aria-label={copy.nav.label} className="flex-1 overflow-y-auto px-3 py-4">
              <ul className="list-none">
                {copy.nav.links.map((link) => {
                  const current = isCurrent(link.href, pathname);
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        aria-current={current ? 'page' : undefined}
                        className={cn(
                          'block rounded-sm px-3 py-3 text-base font-medium transition-colors duration-150 ease-in-out',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]',
                          current ? 'bg-surface-3 text-white' : 'text-white/64 hover:text-white',
                        )}
                      >
                        {link.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-4 border-t border-white/6 pt-4">
                {status === 'signed-in' && session !== null && (
                  <ul className="list-none">
                    {/* The same rows as `AccountMenu`, for the same reasons. */}
                    <li>
                      <Link href="/account/campaigns" className={DRAWER_ROW}>
                        {copy.actions.myCampaigns}
                      </Link>
                    </li>
                    <li>
                      <Link href="/projects/new" className={DRAWER_ROW}>
                        {copy.actions.startCampaign}
                      </Link>
                    </li>
                    <li>
                      <Link
                        href={`/u/${encodeURIComponent(session.slug)}`}
                        className={DRAWER_ROW}
                      >
                        {copy.actions.profile}
                      </Link>
                    </li>
                    <li>
                      <Link href="/notifications" className={DRAWER_ROW}>
                        {copy.actions.notifications}
                      </Link>
                    </li>
                    <li>
                      <Link href="/settings" className={DRAWER_ROW}>
                        {copy.actions.settings}
                      </Link>
                    </li>
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          void signOut();
                        }}
                        className={cn(DRAWER_ROW, 'w-full text-left')}
                      >
                        {copy.actions.signOut}
                      </button>
                    </li>
                  </ul>
                )}

                {status === 'signed-out' && (
                  <div className="flex flex-col gap-3 px-3">
                    {/*
                      The one lime element, here as in the bar (§8.6). Register is what a
                      signed-out visitor is being asked to do; Sign in is the quieter of the
                      pair because most people reaching for it already know where it is.
                    */}
                    <Link
                      href="/register"
                      data-on-lime=""
                      className="inline-flex h-11 items-center justify-center rounded-full bg-lime-500 text-sm font-medium text-on-lime transition-colors duration-150 ease-in-out hover:bg-lime-400"
                    >
                      {copy.actions.register}
                    </Link>
                    <Link
                      href="/sign-in"
                      className="inline-flex h-11 items-center justify-center rounded-full border border-white/16 text-sm font-medium text-white transition-colors duration-150 ease-in-out hover:bg-surface-3"
                    >
                      {copy.actions.signIn}
                    </Link>
                  </div>
                )}
              </div>

              {/*
                THE LANGUAGE, FLAT. The header's globe is `hidden sm:block` because the action
                row at 390px cannot hold it, so below that width this is the way out of a
                language somebody cannot read — and the footer, which is a scroll away.
                A disclosure inside the drawer would be a panel inside a panel; the drawer is
                already a list of links, so these are four more.
              */}
              <div className="mt-4 border-t border-white/6 pt-4">
                <p id={languageHeadingId} className="px-3 pb-1 text-xs text-white/40">
                  {copy.language.label}
                </p>
                <div aria-labelledby={languageHeadingId} role="group">
                  <LanguageLinks current={locale} path={pathname} onChosen={close} />
                </div>
              </div>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

const DRAWER_ROW =
  'block rounded-sm px-3 py-3 text-base text-white/64 transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]';
