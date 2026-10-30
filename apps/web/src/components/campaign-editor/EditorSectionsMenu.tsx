'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from '@ideanest/ui';
import { useDismiss, useScrollLock } from '@ideanest/ui/use-dismiss';
import { useFocusTrap } from '@ideanest/ui/use-focus-trap';
import type { EditorChromeCopy } from '@ideanest/campaign-editor/copy';
import { EDITOR_TABS, editorTabHref, type EditorTabKey } from '@ideanest/campaign-editor/tabs';
import { Link } from '../../i18n/navigation';

/**
 * The editor's sections below `md`: one button naming the section being edited, and a panel
 * listing all of them.
 *
 * <p>The row of pills above it does not fit a phone. Six sections at 13px are wider than a
 * 390px screen in every language, so the row scrolled sideways: the reader saw four and a
 * half names, cut mid-word, and the review section — the one that says whether the campaign
 * can be submitted — was off the edge with nothing saying it was there. #602 found the same
 * row in the account area and gave it this shape; the editor follows, so a section list on a
 * narrow screen works one way across the product.
 *
 * <p>The button says where the creator is and how far along the list that is ("Story 3/6"),
 * so the panel only has to be opened to move. The panel is the account drawer's contract,
 * docs/ui-kit.md §7.14: focus moves in, Tab is trapped, the page does not scroll, Escape, the
 * backdrop and the close button close it, focus returns to the button, and a navigation
 * closes it too.
 *
 * <p>MOTION: none. docs/motion-system.md §5 gives the campaign editor "none — autosave
 * indicator only"; the panel appears and disappears in one frame.
 */
export interface EditorSectionsMenuProps {
  readonly projectId: string;
  readonly copy: EditorChromeCopy;
  readonly active: EditorTabKey;
}

export function EditorSectionsMenu({ projectId, copy, active }: EditorSectionsMenuProps) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useDismiss({ open, onDismiss: close });
  useScrollLock(open);
  useFocusTrap(open, panel);

  /* A section is a route, so this is remounted on navigation; the reset covers a same-route tap. */
  useEffect(() => setOpen(false), [active]);

  /* From `md` the panel is hidden by CSS, and an open one would leave the page scroll-locked. */
  useEffect(() => {
    if (!open || typeof window.matchMedia !== 'function') return;
    const wide = window.matchMedia('(min-width: 48rem)');
    const closeWhenWide = () => {
      if (wide.matches) setOpen(false);
    };
    closeWhenWide();
    wide.addEventListener('change', closeWhenWide);
    return () => wide.removeEventListener('change', closeWhenWide);
  }, [open]);

  const position = EDITOR_TABS.findIndex((tab) => tab.key === active) + 1;

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="flex h-11 w-full items-center gap-3 rounded-full border border-fg/8 bg-surface-2 pr-4 pl-5 text-left text-[15px] font-medium text-fg transition-colors duration-150 ease-in-out hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
      >
        <span className="sr-only">{`${copy.sectionsOpen}:`}</span>{' '}
        <span className="min-w-0 flex-1 truncate">{copy.tabs[active]}</span>
        {/* The count is a glance, not a sentence; the name already said which one this is. */}
        <span aria-hidden="true" className="shrink-0 text-[13px] font-normal text-fg-40 tabular-nums">
          {`${position}/${EDITOR_TABS.length}`}
        </span>
        <ChevronDown aria-hidden="true" className="size-[18px] shrink-0 text-fg-64" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60]">
          {/* Duplicated by the close button and by Escape, so it is never the only way out. */}
          <div aria-hidden="true" onClick={close} className="absolute inset-0 bg-black/60" />

          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={copy.sectionsLabel}
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col border-r border-fg/8 bg-surface-1 focus:outline-none"
          >
            <div className="flex items-center justify-between gap-3 border-b border-fg/8 px-4 py-3">
              <span className="text-sm font-semibold tracking-[-0.01em] text-fg">{copy.sectionsLabel}</span>
              <button type="button" aria-label={copy.sectionsClose} onClick={close} className={ROUND_BUTTON}>
                <X aria-hidden="true" className="size-[18px]" />
              </button>
            </div>

            <nav aria-label={copy.sectionsLabel} className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
              <ol className="flex flex-col gap-1">
                {EDITOR_TABS.map((tab, index) => {
                  const current = tab.key === active;
                  const number = (
                    <span aria-hidden="true" className="w-5 shrink-0 text-[13px] text-fg-40 tabular-nums">
                      {index + 1}
                    </span>
                  );

                  if (!tab.available) {
                    /* Focusable and announced as unavailable, for the reason `EditorShell` gives. */
                    return (
                      <li key={tab.key}>
                        <button type="button" aria-disabled="true" className={cn(ROW, 'cursor-default text-fg-64')}>
                          {number}
                          <span className="min-w-0 flex-1">{copy.tabs[tab.key]}</span>
                          <span aria-hidden="true" className="text-[13px] text-fg-40">
                            {copy.soon}
                          </span>
                          <span className="sr-only">{copy.notAvailable}</span>
                        </button>
                      </li>
                    );
                  }

                  return (
                    <li key={tab.key}>
                      <Link
                        href={editorTabHref(projectId, tab)}
                        aria-current={current ? 'page' : undefined}
                        onClick={close}
                        className={cn(
                          ROW,
                          // The section being edited, in the surface the pill row gives it; the
                          // check says so for somebody who cannot tell the surfaces apart.
                          current ? 'bg-surface-3 text-fg' : 'text-fg-64 hover:bg-surface-2 hover:text-fg',
                        )}
                      >
                        {number}
                        <span className="min-w-0 flex-1">{copy.tabs[tab.key]}</span>
                        {current && <Check aria-hidden="true" className="size-[18px] shrink-0" />}
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}

const ROW =
  'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] font-medium transition-colors duration-150 ease-in-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]';

const ROUND_BUTTON =
  'inline-grid size-10 shrink-0 place-items-center rounded-full bg-surface-3 text-fg transition-colors duration-150 ease-in-out hover:bg-surface-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]';
