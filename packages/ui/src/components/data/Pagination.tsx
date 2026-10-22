import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Page navigation for tables and result lists. See docs/ui-kit.md §7.15.
 *
 * It is navigation, so it is a `<nav>` with a name — a screen-reader user can
 * then jump to it by landmark instead of tabbing through the whole result set.
 *
 * THE ACTIVE PAGE IS WHITE, NOT LIME. Same reasoning as the filter chip
 * (§7.3): lime means *urgent*. Page 3 of 12 is not urgent, it is merely where
 * you are. Spending lime on it would make every list shout, and the one thing
 * on the screen that genuinely is urgent would stop being distinguishable.
 *
 * Boundary controls are DISABLED, NOT HIDDEN. A control that vanishes on the
 * first page moves the next-page button under the pointer that was about to
 * click it, and it removes the cue that a previous page exists at all.
 */

interface PageItem {
  type: 'page';
  page: number;
}

interface EllipsisItem {
  type: 'ellipsis';
  key: string;
}

type Item = PageItem | EllipsisItem;

/** First, last, and a window around the current page, with gaps collapsed. */
function buildItems(page: number, pageCount: number, siblings: number): Item[] {
  const wanted = new Set<number>([1, pageCount]);
  for (let p = page - siblings; p <= page + siblings; p += 1) {
    if (p >= 1 && p <= pageCount) wanted.add(p);
  }

  const items: Item[] = [];
  let previous = 0;
  for (const p of [...wanted].sort((a, b) => a - b)) {
    // A gap of exactly one page is shown rather than elided — an ellipsis
    // hiding a single number costs the same space and hides a target.
    if (previous !== 0 && p - previous > 1) {
      items.push({ type: 'ellipsis', key: `gap-${previous}` });
    }
    items.push({ type: 'page', page: p });
    previous = p;
  }
  return items;
}

export interface PaginationProps extends Omit<ComponentPropsWithoutRef<'nav'>, 'onChange'> {
  /** 1-based. Values outside the range are clamped rather than trusted. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Pages shown either side of the current one. */
  siblingCount?: number;
  /** Landmark name. Distinguish them when a screen has two paginators. */
  label?: string;
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  siblingCount = 1,
  label = 'Pagination',
  className,
  ...props
}: PaginationProps) {
  // Nothing to paginate. Rendering a single dead page number would only
  // suggest there is somewhere else to go.
  if (pageCount < 1) return null;

  const current = Math.min(Math.max(Math.round(page), 1), pageCount);
  const items = buildItems(current, pageCount, siblingCount);

  return (
    <nav aria-label={label} className={cn('flex items-center gap-1', className)} {...props}>
      {/*
        Legible to a screen reader without being a live region: the page change
        is a navigation, and the new content announces itself. A live region
        here would say "Page 4 of 12" on top of that, twice for one action.
      */}
      <span className="sr-only">
        Page {current} of {pageCount}
      </span>

      <PageStep
        label="Previous page"
        disabled={current <= 1}
        onClick={() => onPageChange(current - 1)}
        icon={<ChevronLeft aria-hidden="true" className="size-4" />}
      />

      {items.map((item) =>
        item.type === 'ellipsis' ? (
          // Decoration, not a page: it has no target, so it must not appear in
          // the accessibility tree as though it were skippable content.
          <span key={item.key} aria-hidden="true" className="px-1.5 text-fg-40">
            &hellip;
          </span>
        ) : (
          <button
            key={item.page}
            type="button"
            aria-label={`Page ${item.page}`}
            aria-current={item.page === current ? 'page' : undefined}
            onClick={() => onPageChange(item.page)}
            className={cn(
              'inline-flex h-9 min-w-9 items-center justify-center rounded-full px-2.5',
              'text-[13px] font-medium tabular-nums transition-colors duration-150 ease-in-out',
              item.page === current
                ? 'bg-inverse text-on-inverse'
                : 'text-fg-64 hover:bg-surface-3 hover:text-fg',
            )}
          >
            {item.page}
          </button>
        ),
      )}

      <PageStep
        label="Next page"
        disabled={current >= pageCount}
        onClick={() => onPageChange(current + 1)}
        icon={<ChevronRight aria-hidden="true" className="size-4" />}
      />
    </nav>
  );
}

function PageStep({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-full text-fg-64',
        'transition-colors duration-150 ease-in-out hover:bg-surface-3 hover:text-fg',
        // Kept in the tab order at the boundary would be a dead stop; disabled
        // states the boundary instead of hiding that it exists.
        'disabled:pointer-events-none disabled:text-fg-24',
      )}
    >
      {icon}
    </button>
  );
}
