import { createContext, useContext, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * Semantic data table. See docs/ui-kit.md §7.15.
 *
 * It is a real `<table>`. A grid of divs loses row/column relationships, and a
 * screen-reader user then has no way to know which figure belongs to which
 * campaign — the one thing a table exists to say.
 *
 * NO ZEBRA STRIPING. In this system surface colour encodes STATE, not
 * decoration (§3 and §8.1): `--surface-2` is "ordinary", `--surface-3` is
 * "hover or nested", lime is "urgent". Alternating row fills would spend the
 * only signal the system has on a purely visual rhythm, and a genuinely
 * highlighted row would then be indistinguishable from every other odd row.
 * Rows are separated by `--divider` instead.
 *
 * ALIGNMENT. `align="right"` is for numeric columns only — amounts, counts,
 * percentages — so digits line up by place value and a column can be scanned
 * for magnitude. Text stays left.
 *
 * MONEY IS A STRING. Pass a pre-formatted, pre-rounded string
 * (`"£12,480.00"`), never a number. CLAUDE.md forbids floating point for money;
 * formatting happens where the `decimal.js` value lives, not in a cell.
 *
 * SORTING IS CONTROLLED. The caller owns `sort` and re-orders its own data.
 * The table renders state and reports intent; it never sorts rows itself,
 * because the rows on screen are usually one page of a server-side query.
 */

export interface TableSort {
  /** Matches the `sortKey` of a header cell. */
  key: string;
  direction: 'ascending' | 'descending';
}

interface TableSortContextValue {
  sort: TableSort | null;
  onSortChange?: (sort: TableSort) => void;
}

const TableSortContext = createContext<TableSortContextValue>({ sort: null });

export interface TableProps extends Omit<ComponentPropsWithoutRef<'table'>, 'children'> {
  /**
   * Visible caption. It is also the table's accessible name, so write it as a
   * description of the data ("Recent pledges"), not as a UI label ("Table").
   */
  caption?: string;
  /** Accessible name for the scroll region. Defaults to the caption. */
  scrollLabel?: string;
  /** Controlled sort state, or `null` when nothing is sorted. */
  sort?: TableSort | null;
  onSortChange?: (sort: TableSort) => void;
  /** Class for the scrolling wrapper rather than the table element. */
  containerClassName?: string;
  children?: ReactNode;
}

export function Table({
  caption,
  scrollLabel,
  sort = null,
  onSortChange,
  className,
  containerClassName,
  children,
  ...props
}: TableProps) {
  return (
    /**
     * The overflow lives on a NAMED, FOCUSABLE region. A `overflow-x-auto` div
     * with no `tabIndex` can only be scrolled by a pointer, which puts the
     * right-hand columns permanently out of reach of a keyboard user. The name
     * is what stops the extra tab stop from being an unexplained one.
     */
    <div
      role="region"
      aria-label={scrollLabel ?? caption ?? 'Data table'}
      tabIndex={0}
      className={cn(
        'w-full overflow-x-auto rounded-lg border border-fg/8 bg-surface-2',
        containerClassName,
      )}
    >
      <table
        className={cn('w-full border-collapse text-left text-sm', className)}
        {...props}
      >
        {caption && (
          <caption className="px-4 pt-4 pb-3 text-left text-sm text-fg-64">{caption}</caption>
        )}
        <TableSortContext.Provider value={{ sort, onSortChange }}>
          {children}
        </TableSortContext.Provider>
      </table>
    </div>
  );
}

export function TableHead({ className, ...props }: ComponentPropsWithoutRef<'thead'>) {
  return <thead className={cn('border-b border-fg/8', className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentPropsWithoutRef<'tbody'>) {
  return <tbody className={className} {...props} />;
}

export interface TableRowProps extends ComponentPropsWithoutRef<'tr'> {
  /** Highlights the row on hover. Off inside `TableHead`. */
  interactive?: boolean;
}

export function TableRow({ interactive = true, className, ...props }: TableRowProps) {
  return (
    <tr
      className={cn(
        'border-b border-fg/6 last:border-b-0',
        interactive && 'transition-colors duration-150 ease-in-out hover:bg-surface-3',
        className,
      )}
      {...props}
    />
  );
}

export interface TableHeaderCellProps extends ComponentPropsWithoutRef<'th'> {
  /** `right` for numeric columns only — see the file comment. */
  align?: 'left' | 'right';
  /** Makes the column sortable. Must match `TableSort.key`. */
  sortKey?: string;
}

export function TableHeaderCell({
  align = 'left',
  sortKey,
  className,
  children,
  ...props
}: TableHeaderCellProps) {
  const { sort, onSortChange } = useContext(TableSortContext);
  const sortable = sortKey !== undefined && onSortChange !== undefined;
  const current = sortable && sort && sort.key === sortKey ? sort.direction : null;

  // Unsorted sortable columns must still say `none`. Omitting aria-sort there
  // reads as "not sortable", which is a different and wrong statement.
  const ariaSort = sortable ? (current ?? 'none') : undefined;

  const Icon = current === 'ascending' ? ArrowUp : current === 'descending' ? ArrowDown : ChevronsUpDown;

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        'px-4 py-3 text-xs font-medium text-fg-64',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
      {...props}
    >
      {sortable ? (
        <button
          type="button"
          onClick={() =>
            onSortChange({
              key: sortKey,
              // A second click on the live column reverses it; any other click
              // starts that column ascending, which is what a first read wants.
              direction: current === 'ascending' ? 'descending' : 'ascending',
            })
          }
          className={cn(
            'inline-flex items-center gap-1.5 rounded-sm text-fg-64 transition-colors',
            'duration-150 ease-in-out hover:text-fg',
            align === 'right' && 'flex-row-reverse',
          )}
        >
          {children}
          <Icon aria-hidden="true" className={cn('size-3.5', !current && 'opacity-40')} />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export interface TableCellProps extends ComponentPropsWithoutRef<'td'> {
  /** `right` for numeric columns only — see the file comment. */
  align?: 'left' | 'right';
}

export function TableCell({ align = 'left', className, ...props }: TableCellProps) {
  return (
    <td
      className={cn(
        'px-4 py-3 text-fg',
        // Numerals only line up by place value when they are the same width.
        align === 'right' ? 'text-right tabular-nums' : 'text-left',
        className,
      )}
      {...props}
    />
  );
}
