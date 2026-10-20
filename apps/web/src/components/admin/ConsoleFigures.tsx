import type { ReactNode } from 'react';

/**
 * The console's figure tiles: a term over a value, in a grid that reflows rather than wraps.
 *
 * <p>One shape for the front page and `/admin/analytics`. The analytics screen drew its seven
 * figures with the kit's `StatBlock`, which is a display-size number meant for a campaign page;
 * at 1280px a manat amount wrapped onto two lines and the row of tiles broke wherever the longest
 * one ended. The front page's tiles were already the right size, so both screens use them.
 *
 * <p><strong>A description list</strong>, because that is what a set of labelled figures is, and a
 * screen reader announces each value with its term. <strong>Two columns on a phone</strong>, at
 * `text-lg`: one column put eight figures in a stack taller than two screens, which is a
 * dashboard nobody takes in at a glance. A seven-digit amount at 375px breaks at the space before
 * its currency rather than inside the number, and `break-words` is the last resort for an
 * amount that still does not fit.
 *
 * <p>No kit imports, so the front page can use it without the barrel (see `ConsoleDashboard`).
 * MOTION: none.
 */
export function FigureGrid({
  children,
  className = '',
  label,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  /** An accessible name for the list, when the heading above it does not already give one. */
  readonly label?: string;
}) {
  return (
    <dl
      aria-label={label}
      className={`grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 sm:gap-y-5 ${className}`}
    >
      {children}
    </dl>
  );
}

/**
 * One figure. `note` sits inside the description, under the value: a description list's groups
 * may hold only terms and descriptions, and a paragraph between them would confuse a screen reader
 * about which term it belongs to.
 */
export function FigureTile({
  term,
  children,
  note,
}: {
  readonly term: string;
  /** The value, already formatted. A node, so a figure with no value can say so in words. */
  readonly children: ReactNode;
  readonly note?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-white/48">{term}</dt>
      <dd className="mt-1 break-words text-lg font-semibold tabular-nums text-white sm:text-2xl">
        {children}
        {note !== undefined && note !== null && note !== false && (
          <span className="mt-1 block text-xs font-normal text-white/48">{note}</span>
        )}
      </dd>
    </div>
  );
}

/** What a tile says in place of a value it does not have yet. */
export function NoFigure({ children }: { readonly children: ReactNode }) {
  return <span className="text-sm font-normal text-white/48 sm:text-base">{children}</span>;
}
