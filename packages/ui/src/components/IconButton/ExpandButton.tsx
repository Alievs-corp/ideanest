import { ArrowUpRight } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * Corner expand affordance. See docs/ui-kit.md §7.4.
 *
 * Revealed on card hover, so the parent card must carry the `group` class.
 * On hover the arrow shifts two pixels up and right — a detail small enough to
 * go unnoticed and large enough to feel (docs/motion-system.md §4.10).
 *
 * It also appears on keyboard focus. Hover-only would make it unreachable
 * without a pointer.
 */
export interface ExpandButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  label?: string;
  onLime?: boolean;
}

export function ExpandButton({
  label = 'View details',
  onLime = false,
  className,
  type = 'button',
  ...props
}: ExpandButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'absolute top-4 right-4 z-10 grid size-8 place-items-center rounded-full',
        'opacity-0 transition-[opacity,transform,background-color] duration-200 ease-in-out',
        'group-hover:opacity-100 focus-visible:opacity-100',
        'hover:translate-x-0.5 hover:-translate-y-0.5',
        onLime
          ? 'bg-on-lime/10 text-on-lime hover:bg-on-lime/20'
          : 'bg-surface-4 text-fg hover:bg-fg/16',
        className,
      )}
      {...props}
    >
      <ArrowUpRight className="size-4" />
    </button>
  );
}
