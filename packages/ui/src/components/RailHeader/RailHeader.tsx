import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Section header for a horizontal rail. See docs/ui-kit.md §7.12.
 *
 *   Section title  (7 projects)   [search] [sort]   [All][Hot][...]
 *
 * The count is small and dimmed so it never competes with the title.
 */
export interface RailHeaderProps extends Omit<ComponentPropsWithoutRef<'header'>, 'title'> {
  title: ReactNode;
  /** For example "7 projects". */
  count?: ReactNode;
  /** Icon buttons on the right. */
  actions?: ReactNode;
  /** Filter chip row below the title. */
  filters?: ReactNode;
}

export function RailHeader({
  title,
  count,
  actions,
  filters,
  className,
  ...props
}: RailHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3', className)} {...props}>
      <div className="flex items-center gap-3">
        <h2 className="font-display text-2xl font-semibold tracking-[-0.03em]">{title}</h2>
        {count !== undefined && <span className="text-xs text-fg-40">{count}</span>}

        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        {filters && (
          <div className={cn('min-w-0 flex-1', actions ? 'ml-3' : 'ml-auto')}>{filters}</div>
        )}
      </div>
    </header>
  );
}

/**
 * Horizontally scrolling card row — the layout primitive that lets a dense
 * dashboard show many collections without a long vertical scroll.
 */
export type CardRailProps = ComponentPropsWithoutRef<'div'>;

export function CardRail({ className, children, ...props }: CardRailProps) {
  return (
    <div
      className={cn(
        'scrollbar-none flex snap-x snap-proximity gap-4 overflow-x-auto pb-1',
        '[&>*]:snap-start',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
