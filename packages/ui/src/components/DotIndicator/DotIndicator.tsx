import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * Five-dot funding indicator. See docs/ui-kit.md §2.4.
 *
 * ACCESSIBILITY: this must never be the only carrier of the information
 * (docs/ui-kit.md §9.4). `aria-label` states the percentage in words, and a
 * numeric figure should sit beside it in the layout.
 */
const TOTAL = 5;

function toneFor(percent: number): { filled: number; className: string } {
  if (percent >= 100) return { filled: 5, className: 'bg-success' };
  if (percent >= 75) return { filled: 4, className: 'bg-lime-500' };
  if (percent >= 50) return { filled: 3, className: 'bg-lime-500' };
  if (percent >= 25) return { filled: 2, className: 'bg-warning' };
  if (percent > 0) return { filled: 1, className: 'bg-warning' };
  return { filled: 0, className: 'bg-fg/24' };
}

export interface DotIndicatorProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  percent: number;
  onLime?: boolean;
}

export function DotIndicator({ percent, onLime = false, className, ...props }: DotIndicatorProps) {
  const { filled, className: tone } = toneFor(percent);

  return (
    <div
      role="img"
      aria-label={`Funding: ${Math.floor(percent)} percent`}
      className={cn('flex items-center gap-1', className)}
      {...props}
    >
      {Array.from({ length: TOTAL }, (_, i) => {
        // Status hues fail on lime: success (#34D058) over lime (#C6F432)
        // measures roughly 1.2:1, so the dots vanish. Near-black instead.
        const filledClass = onLime ? 'bg-on-lime' : tone;
        const emptyClass = onLime ? 'bg-on-lime/20' : 'bg-fg/16';
        return (
          <span
            key={i}
            aria-hidden="true"
            className={cn(
              'size-1.5 rounded-full transition-colors duration-300',
              i < filled ? filledClass : emptyClass,
            )}
          />
        );
      })}
    </div>
  );
}
