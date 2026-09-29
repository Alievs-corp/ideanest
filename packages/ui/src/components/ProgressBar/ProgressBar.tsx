import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * Funding progress. See docs/ui-kit.md §7.11.
 *
 * Colour logic (docs/ui-kit.md §8.1):
 *   below 100%  -> lime     (in progress)
 *   at/over     -> success + glow  (goal reached)
 *
 * The bar fills to 100% and stops, but `value` may exceed it — an
 * overfunded campaign shows its real figure as text while the track stays full.
 *
 * THE FILL MOVES, IT DOES NOT GROW — issue 146. It is always the track's full width,
 * slid left by the part not yet funded, and the track's `overflow-hidden`
 * hides what is outside. Animating `width` forced layout on every frame of the
 * most frequently animated element on the platform (every card, and
 * `LiveFunding` in place); `transform` is composited. It is a translate rather
 * than the `scaleX` issue 146 suggested because a scaled fill squashes its rounded
 * leading edge at low percentages, and a translated one keeps it exact.
 */
export interface ProgressBarProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** Percentage. May exceed 100. */
  value: number;
  size?: 'sm' | 'md';
  /** Accessible description, e.g. "Funding: 87 percent". */
  label?: string;
  /** Disable the fill transition — worth doing in long virtualised lists. */
  animate?: boolean;
}

export function ProgressBar({
  value,
  size = 'sm',
  label,
  animate = true,
  className,
  ...props
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(value, 100));
  const complete = value >= 100;

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? `Funding: ${Math.round(value)} percent`}
      className={cn(
        'w-full overflow-hidden rounded-full bg-surface-3',
        size === 'sm' ? 'h-1.5' : 'h-2.5',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'h-full w-full rounded-full',
          complete ? 'bg-success shadow-[0_0_12px_var(--lime-glow)]' : 'bg-lime-500',
          animate && 'transition-transform duration-[800ms] ease-[var(--ease-standard)]',
        )}
        style={{ transform: `translateX(${clamped - 100}%)` }}
      />
    </div>
  );
}
