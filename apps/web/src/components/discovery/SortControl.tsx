'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn, useDismiss } from '@ideanest/ui';
import { isSort, labelOf, sortsFor, type DiscoverySort } from '../../lib/discovery/vocabulary';
import type { FeedCopy } from '../../lib/i18n/feed-copy';

/**
 * The order the feed comes back in.
 *
 * A DISCLOSURE PANEL, drawn like the header's language control (`LanguageSwitcher`): a
 * button naming the current order, and a small panel of rows with a check on the one in
 * force. It is a button with `aria-expanded` revealing ordinary buttons rather than an ARIA
 * listbox, for the reason `LanguageSwitcher` gives: it behaves the way the browser already
 * behaves, and Escape and a press outside close it.
 *
 * NOT SEVEN OPTIONS. §4.3 lists seven orders and the service declares all of
 * them, but `relevance` (#44) and `near_me` (#47) are refused by every
 * implementation that exists — asking for one is answered
 * `400 DISCOVERY_OPTION_UNSUPPORTED` naming the issue. Offering an order that
 * empties the page is worse than not offering it.
 *
 * `best_match` IS OFFERED ONLY WHEN THERE IS SOMETHING TO MATCH, and it is
 * selected by default when there is. This control must not lie about the order
 * the reader is looking at, and there are two ways it could:
 *
 *   - by showing "Newest" on a searched feed. An unstated sort resolves to
 *     `best_match` server-side whenever `q` is present, so the feed under a
 *     control reading "Newest" would be ranked by match quality. `parseFilters`
 *     resolves it the same way, which is why `sort` arrives here already
 *     correct.
 *   - by offering "Best match" on an unsearched one. `best_match` with nothing
 *     to rank resolves straight back to `newest`, so the option would appear to
 *     be selectable and then do nothing at all.
 *
 * NO PLACEHOLDER. There is always an order in force, so "nothing chosen yet" is
 * not a state this control can be in and a disabled empty option would be a lie
 * about that.
 */

export interface SortControlProps {
  sort: DiscoverySort;
  /** Whether the feed is a search. Decides whether `best_match` is offered. */
  hasQuery: boolean;
  onChange: (sort: DiscoverySort) => void;
  /** The control's label and the six words. `discovery.filters.sort` names the orders. */
  copy: FeedCopy;
}

const ROW = [
  'flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2.5 text-left text-sm',
  'transition-colors duration-150 ease-in-out hover:bg-surface-3 hover:text-white',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]',
].join(' ');

export function SortControl({ sort, hasQuery, onChange, copy }: SortControlProps) {
  const options = sortsFor(hasQuery);
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const uid = useId();
  const triggerId = `${uid}-sort`;
  const panelId = `${uid}-sorts`;

  const close = useCallback(() => setOpen(false), []);
  useDismiss({ open, onDismiss: close });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const node = container.current;
      if (node !== null && event.target instanceof Node && !node.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div ref={container} className="relative w-full sm:w-56">
      <span id={`${triggerId}-label`} className="mb-1.5 block text-[13px] text-white/64">
        {copy.sortLabel}
      </span>
      <button
        type="button"
        id={triggerId}
        aria-expanded={open}
        aria-controls={panelId}
        aria-labelledby={`${triggerId}-label ${triggerId}`}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-3 rounded-full bg-surface-3 px-4 text-sm text-white',
          'transition-colors duration-150 ease-in-out hover:bg-surface-4',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]',
          open && 'bg-surface-4',
        )}
      >
        <span>{labelOf(copy.filters.sort, sort)}</span>
        <ChevronDown aria-hidden="true" className="size-4 text-white/64" />
      </button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-labelledby={`${triggerId}-label`}
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-full min-w-[200px] rounded-md border border-white/8 bg-surface-2 p-2 shadow-[var(--shadow-panel)]"
        >
          {options.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === sort}
              className={ROW}
              onClick={() => {
                // The vocabulary is closed and the service refuses anything outside it.
                if (isSort(option)) onChange(option);
                setOpen(false);
              }}
            >
              <span>{labelOf(copy.filters.sort, option)}</span>
              {option === sort && <Check aria-hidden="true" className="size-4 text-[var(--lime-500)]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
