import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Headline figure with an optional delta badge. See docs/ui-kit.md §7.7.
 */
export interface StatBlockProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  value: ReactNode;
  label: string;
  /** Change indicator, e.g. "+3". */
  badge?: string;
  badgeTone?: 'up' | 'down' | 'neutral';
  size?: 'md' | 'lg';
}

export function StatBlock({
  value,
  label,
  badge,
  badgeTone = 'up',
  size = 'lg',
  className,
  ...props
}: StatBlockProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)} {...props}>
      <div className="flex items-start gap-1.5">
        <span
          className={cn(
            'font-display font-semibold tracking-[-0.04em] tabular-nums',
            size === 'lg'
              ? 'text-[clamp(2.5rem,2rem+2.2vw,4rem)] leading-none'
              : 'text-3xl leading-none',
          )}
        >
          {value}
        </span>
        {badge && (
          <span
            className={cn(
              'mt-1 inline-flex h-5 items-center rounded-full px-[7px]',
              'text-[11px] font-semibold tabular-nums',
              badgeTone === 'up' && 'bg-lime-500 text-on-lime',
              badgeTone === 'down' && 'bg-danger text-on-danger',
              badgeTone === 'neutral' && 'bg-surface-4 text-white/64',
            )}
          >
            {badge}
          </span>
        )}
      </div>
      <span className="text-sm text-white/64">{label}</span>
    </div>
  );
}

/** Row of headline figures across the top of a dashboard. */
export function StatRow({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('flex flex-wrap items-end gap-x-10 gap-y-6', className)} {...props} />;
}
