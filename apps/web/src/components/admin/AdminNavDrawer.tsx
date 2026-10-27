'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useDismiss, useScrollLock } from '@ideanest/ui/use-dismiss';
import { useFocusTrap } from '@ideanest/ui/use-focus-trap';
import { Link, usePathname } from '../../i18n/navigation';
import type { AdminShellCopy } from '../../lib/i18n/admin-copy';
import { AdminNav } from './AdminNav';
import { ConsoleReader } from './ConsoleReader';

/**
 * The console's navigation below the breakpoint — a menu button in the bar and a panel.
 *
 * <h2>Why a drawer and not the row it replaces</h2>
 *
 * <p>The rail used to fold into a horizontal row above every screen on a phone: twenty-six
 * links in six groups, scrolled sideways, with the reader line and the way back to the site
 * wrapping beside the wordmark. A phone showed one group and the edge of the next, nothing
 * said there were five more, and the screen a moderator came for started half a viewport
 * down. Here the bar is one line — wordmark and a button — and the whole rail is one press
 * away, grouped and vertical, the way it reads on a desktop.
 *
 * <p>The reader line and "back to the site" move in with it. They are `hidden` in the bar
 * below the breakpoint because there is no room beside the wordmark for a sentence that
 * carries a name and four roles, and a sentence wrapped over three lines is a header taller
 * than the screen's own title.
 *
 * <h2>The breakpoint is `xl`, not the site's `lg`</h2>
 *
 * <p>Between 1024px and 1280px — a tablet held sideways, a small laptop — a permanent 15rem rail
 * left the screen beside it too narrow for a ledger table, and the reader could not put it
 * away. The drawer covers that range too; the rail is for screens wide enough to keep it.
 *
 * <h2>Why it is not the kit's `Drawer`, and not the site's `MobileNavDrawer`</h2>
 *
 * <p>`Drawer` animates, and docs/motion-system.md §5 gives the console none. `MobileNavDrawer`
 * slides for the same reason it is right for the site and wrong here. What is shared is
 * everything that is not motion — `useFocusTrap`, `useDismiss`, `useScrollLock` — and the
 * panel appears and disappears outright.
 *
 * <p>Those three come from their own subpaths, `@ideanest/ui/use-dismiss` and
 * `@ideanest/ui/use-focus-trap`, and not from the kit's root barrel `AdminArea` warns about.
 * The drawer is in the shell, so it is on every console route, and `/admin` and
 * `/admin/modules` load no barrel of their own: importing the hooks from the root put 70 KiB
 * and 47 KiB on those two pages for three hooks that import nothing but React.
 *
 * <h2>The focus contract — docs/ui-kit.md §7.14</h2>
 *
 * <p>Focus moves into the panel on open, Tab is trapped, the page behind does not scroll,
 * Escape and the backdrop close it, and focus returns to the menu button. A navigation is a
 * dismissal too: the shell does not unmount between routes, so the panel would otherwise stay
 * open over the screen the reader just chose.
 *
 * <p>It exists in the DOM only while it is open, so its links are not tab stops for anybody
 * who never opens it.
 */
export interface AdminNavDrawerProps {
  readonly copy: AdminShellCopy;
}

export function AdminNavDrawer({ copy }: AdminNavDrawerProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useDismiss({ open, onDismiss: close });
  useScrollLock(open);
  useFocusTrap(open, panel);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        aria-label={copy.openMenu}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`${ROUND_BUTTON} xl:hidden`}
      >
        <Menu aria-hidden="true" className="size-[18px]" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] xl:hidden">
          {/* Duplicated by the close button and by Escape, so it is never the only way out. */}
          <div aria-hidden="true" onClick={close} className="absolute inset-0 bg-black/60" />

          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={copy.navLabel}
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col border-r border-fg/8 bg-surface-1 focus:outline-none"
          >
            <div className="flex items-center justify-between gap-3 border-b border-fg/8 px-4 py-3">
              <span className="text-sm font-semibold tracking-[-0.01em] text-fg">
                {copy.console}
              </span>
              <button type="button" aria-label={copy.closeMenu} onClick={close} className={ROUND_BUTTON}>
                <X aria-hidden="true" className="size-[18px]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
              <div className="px-3 pb-4 text-xs empty:hidden [&>p]:text-xs">
                <ConsoleReader copy={copy} />
              </div>
              <AdminNav copy={copy} layout="drawer" />
            </div>

            <div className="border-t border-fg/8 px-3 py-3">
              <Link
                href="/"
                className="block rounded-lg px-3 py-2 text-sm text-fg-64 transition-colors duration-150 ease-in-out hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
              >
                {copy.backToSite}
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const ROUND_BUTTON =
  'inline-grid size-10 shrink-0 place-items-center rounded-full bg-surface-3 text-fg transition-colors duration-150 ease-in-out hover:bg-surface-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]';
