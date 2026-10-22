import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * Left icon navigation rail. See docs/ui-kit.md §7.10.
 *
 * The active item is marked by a lime *icon*, not a lime surface. Lime
 * surfaces are reserved for large areas that carry urgency; using one here
 * would make permanent chrome shout as loudly as a campaign about to close.
 */
export interface RailProps extends ComponentPropsWithoutRef<'nav'> {
  /** Rendered at the top, above the items. */
  header?: ReactNode;
  /** Rendered at the bottom, pinned. */
  footer?: ReactNode;
}

export function Rail({ header, footer, className, children, ...props }: RailProps) {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        'flex w-[72px] shrink-0 flex-col items-center gap-3 py-6',
        'bg-surface-1',
        className,
      )}
      {...props}
    >
      {header && <div className="mb-2">{header}</div>}
      <ul className="flex flex-col items-center gap-2">{children}</ul>
      {footer && <div className="mt-auto pt-4">{footer}</div>}
    </nav>
  );
}

export interface RailItemProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  icon: ReactNode;
  /** Accessible name — icon-only controls need one. */
  label: string;
  active?: boolean;
  /** Unread count shown as a dot. */
  badge?: boolean;
}

export function RailItem({
  icon,
  label,
  active = false,
  badge = false,
  className,
  type = 'button',
  ...props
}: RailItemProps) {
  return (
    <li className="relative">
      <button
        type={type}
        aria-label={label}
        title={label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'grid size-11 place-items-center rounded-full',
          'transition-[background-color,color] duration-200 ease-in-out',
          '[&_svg]:size-5',
          active
            ? 'bg-surface-4 text-lime-ink'
            : 'text-fg-40 hover:bg-surface-3 hover:text-fg',
          className,
        )}
        {...props}
      >
        {icon}
      </button>
      {badge && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1 right-1 size-2 rounded-full bg-lime-500 ring-2 ring-[var(--surface-1)]"
        />
      )}
    </li>
  );
}
