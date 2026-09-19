'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from '../../i18n/navigation';
import { Search } from 'lucide-react';
import { cn } from '@ideanest/ui';
import { searchHref } from '../../lib/search/query';
import type { ShellCopy } from '../../lib/i18n/shell-copy';

/**
 * The search entry — §4.13 WS-01's field in the header, WS-03's in the drawer, and the one at
 * the top of WS-06's results page.
 *
 * <h2>A form that navigates, not a combobox</h2>
 *
 * `/discover` already has a combobox with live suggestions (`SearchBox`, issue #46) and this
 * is deliberately not a second one. Three reasons, and the third is what settles it:
 *
 *   1. **It is on every page.** A suggestion request per keystroke, from the header, on every
 *      route in the application, is a load profile nobody asked for — and `SearchController`
 *      rate-limits suggestions separately for exactly that reason.
 *   2. **The popup would open over page content.** In the header it would cover whatever the
 *      reader is looking at, at the top of every screen, and §8.6's rule is that chrome does
 *      not compete with content.
 *   3. **It costs nothing to type and press Enter.** The refinement surface is one navigation
 *      away and is better at refining than a 240-pixel box in a header.
 *
 * So this is a plain form: type, submit, land on `/search?q=…` with the results already in
 * the HTML. The rich version stays on discovery, where a reader is refining rather than
 * starting.
 *
 * <h2>Motion</h2>
 *
 * None. The shell's budget is §4.7's collapse and nothing else, and docs/motion-system.md
 * §5.1 gives a search box "none — the popup appears and disappears" even on the surface that
 * has one. What changes on focus is a border colour, at 150ms.
 */

export interface SearchFieldProps {
  /**
   * The words it draws, resolved on the server — `lib/i18n/shell-copy.ts` explains why every
   * word in the shell arrives as a prop rather than through `useTranslations`.
   *
   * This component is in the header, in the drawer and at the top of `/search`. The first two
   * are handed `ShellCopy` already; the third is a server component and calls `shellCopy()`.
   */
  readonly copy: ShellCopy['search'];
  readonly className?: string;
  /** The drawer and the results page render it full-width; the header does not. */
  readonly fullWidth?: boolean;
  /**
   * What the box holds when the page opens — the phrase the results below it answer.
   *
   * It re-seeds when this changes, so the back button and a link opened fresh both leave the
   * box holding what is actually on screen. It is NOT held in sync on every keystroke: what
   * is typed is a draft, and what is in the URL is the search, exactly as `SearchBox` argues
   * for the same pair.
   */
  readonly initialQuery?: string;
  /** Called after a submitted search navigates — the drawer closes itself with it. */
  readonly onNavigate?: () => void;
}

export function SearchField({
  copy,
  className,
  fullWidth = false,
  initialQuery = '',
  onNavigate,
}: SearchFieldProps) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialQuery);

  useEffect(() => {
    setDraft(initialQuery);
  }, [initialQuery]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    /*
     * An empty box still navigates. A control that silently ignores a press is a control the
     * reader presses again harder; `/search` with nothing to search for is a page that says
     * so, and it carries the box to say it in.
     */
    router.push(searchHref(draft));
    onNavigate?.();
  }

  return (
    <form
      role="search"
      aria-label={copy.label}
      onSubmit={submit}
      className={cn(fullWidth ? 'w-full' : 'w-[240px]', className)}
    >
      <label className="relative block">
        <span className="sr-only">{copy.label}</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-white/40"
        />
        <input
          type="search"
          name="q"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={copy.label}
          className={cn(
            'h-10 w-full rounded-full border border-white/8 bg-surface-3 pl-10 pr-4',
            'text-sm text-white placeholder:text-white/40',
            'transition-colors duration-150 ease-in-out hover:border-white/16 focus:border-white/16',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]',
          )}
        />
      </label>
    </form>
  );
}
