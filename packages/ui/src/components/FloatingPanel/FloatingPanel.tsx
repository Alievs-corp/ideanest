import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * White surface that sits above the system. See docs/ui-kit.md §7.9.
 *
 * The only place shadow is used, because this is the only thing genuinely
 * elevated — a dark shadow under a dark card renders as nothing (§3).
 *
 * Text inside is near-black, so `text-white/64` does NOT work here.
 * Use `text-on-white/64`.
 */
export interface FloatingPanelProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  title?: ReactNode;
  /** Right side of the header row, usually icon buttons. */
  actions?: ReactNode;
}

export function FloatingPanel({
  title,
  actions,
  className,
  children,
  ...props
}: FloatingPanelProps) {
  return (
    <div
      // `Pill`'s primary inverts under this and the focus ring turns near-black.
      data-on-white=""
      className={cn('overflow-hidden rounded-xl bg-white text-on-white shadow-float', className)}
      {...props}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between gap-4 px-5 pt-5 pb-3">
          {typeof title === 'string' ? (
            <h3 className="text-lg font-medium tracking-[-0.02em]">{title}</h3>
          ) : (
            title
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="px-5 pb-5">{children}</div>
    </div>
  );
}
