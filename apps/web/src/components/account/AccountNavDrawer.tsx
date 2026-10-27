'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useDismiss, useScrollLock } from '@ideanest/ui/use-dismiss';
import { useFocusTrap } from '@ideanest/ui/use-focus-trap';
import { usePathname } from '../../i18n/navigation';
import { isCurrentAccountLink } from '../../lib/account/navigation';
import { AccountNav, type AccountNavGroup } from './AccountNav';

/**
 * The account area's navigation below `xl` — a menu button above the content and a panel.
 *
 * <p>The same shape as the admin console's `AdminNavDrawer`, on purpose: one way to reach a
 * section list on a narrow screen across the product. The button names the page being read,
 * so the reader sees where they are without opening it.
 *
 * <p>No motion — docs/motion-system.md §5 gives account settings none. The focus contract is
 * docs/ui-kit.md §7.14: focus moves in, Tab is trapped, the page does not scroll, Escape and
 * the backdrop close it, focus returns to the button, and a navigation closes it too.
 */
export interface AccountNavDrawerProps {
  readonly label: string;
  readonly openLabel: string;
  readonly closeLabel: string;
  readonly groups: readonly AccountNavGroup[];
}

export function AccountNavDrawer({ label, openLabel, closeLabel, groups }: AccountNavDrawerProps) {
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

  /* At `xl` the panel is hidden by CSS, and an open one would leave the page scroll-locked. */
  useEffect(() => {
    if (!open || typeof window.matchMedia !== 'function') return;
    const wide = window.matchMedia('(min-width: 80rem)');
    const closeWhenWide = () => {
      if (wide.matches) setOpen(false);
    };
    closeWhenWide();
    wide.addEventListener('change', closeWhenWide);
    return () => wide.removeEventListener('change', closeWhenWide);
  }, [open]);

  const current = groups
    .flatMap((group) => group.links)
    .find((link) => isCurrentAccountLink(link.href, pathname));

  return (
    <div className="xl:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 max-w-full items-center gap-2.5 rounded-full bg-surface-3 pr-4 pl-3 text-sm text-fg transition-colors duration-150 ease-in-out hover:bg-surface-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        <Menu aria-hidden="true" className="size-[18px] shrink-0" />
        <span className="sr-only">{`${openLabel}:`}</span>{' '}
        <span className="truncate">{current?.label ?? label}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60]">
          {/* Duplicated by the close button and by Escape, so it is never the only way out. */}
          <div aria-hidden="true" onClick={close} className="absolute inset-0 bg-black/60" />

          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col border-r border-fg/8 bg-surface-1 focus:outline-none"
          >
            <div className="flex items-center justify-between gap-3 border-b border-fg/8 px-4 py-3">
              <span className="text-sm font-semibold tracking-[-0.01em] text-fg">{label}</span>
              <button type="button" aria-label={closeLabel} onClick={close} className={ROUND_BUTTON}>
                <X aria-hidden="true" className="size-[18px]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
              <AccountNav label={label} groups={groups} layout="drawer" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const ROUND_BUTTON =
  'inline-grid size-10 shrink-0 place-items-center rounded-full bg-surface-3 text-fg transition-colors duration-150 ease-in-out hover:bg-surface-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]';
