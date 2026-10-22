import { Inbox, SearchX } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * What a list shows when it has nothing to show. See docs/ui-kit.md §7.15.
 *
 * TWO VARIANTS, BECAUSE THE RECOVERY DIFFERS:
 *   empty     — nothing exists yet. The way out is to CREATE something.
 *   filtered  — things exist, this query matched none of them. The way out is
 *               to CLEAR THE FILTER.
 * Collapsing them into one message sends a creator to "New campaign" when all
 * they did was type a typo into search.
 *
 * The icon is decoration and is hidden from the accessibility tree; the title
 * is a heading and carries the whole meaning. An empty state announced as
 * "image, inbox" tells a screen-reader user nothing about why the list is
 * blank.
 *
 * Restrained on purpose: no illustration, no animation. An empty list is a
 * dead end, and a dead end that performs is worse than one that explains.
 */

const DEFAULT_ICON = {
  empty: Inbox,
  filtered: SearchX,
} as const;

export interface EmptyStateProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  variant?: 'empty' | 'filtered';
  /** Overrides the variant's default icon. Rendered decoratively. */
  icon?: ReactNode;
  /** The sentence that explains the blank list. */
  title: ReactNode;
  description?: ReactNode;
  /** The recovery: "New campaign" for `empty`, "Clear filters" for `filtered`. */
  action?: ReactNode;
  /** Match the surrounding document outline. */
  headingLevel?: 2 | 3 | 4;
}

export function EmptyState({
  variant = 'empty',
  icon,
  title,
  description,
  action,
  headingLevel = 3,
  className,
  ...props
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  const Icon = DEFAULT_ICON[variant];

  return (
    <div
      data-variant={variant}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg px-6 py-12 text-center',
        'border border-fg/8 bg-surface-2',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-full bg-surface-3 text-fg-40"
      >
        {icon ?? <Icon className="size-5" />}
      </span>

      <Heading className="text-base font-medium tracking-[-0.02em] text-fg">{title}</Heading>

      {description && <p className="max-w-[42ch] text-sm text-fg-64">{description}</p>}

      {action && <div className="mt-1 flex items-center gap-2">{action}</div>}
    </div>
  );
}
