import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Circular icon button. See docs/ui-kit.md §7.4.
 *
 * `label` is REQUIRED: an icon-only control needs an accessible name, or a
 * screen reader announces "button" and nothing else.
 *
 * `light` inverts on a white surface, as `Pill`'s `primary` does, and
 * `danger` draws a near-black glyph (docs/ui-kit.md §7.2).
 */
const iconButton = cva(
  [
    'inline-grid place-items-center rounded-full',
    'transition-[background-color,transform,color] duration-150 ease-in-out',
    'hover:scale-[1.06] active:scale-100',
    'disabled:pointer-events-none disabled:opacity-40',
  ],
  {
    variants: {
      variant: {
        default: 'bg-surface-3 text-white hover:bg-surface-4',
        light: [
          'bg-white text-on-white hover:bg-[var(--white-muted)]',
          'in-data-on-white:bg-surface-1 in-data-on-white:text-white',
          'in-data-on-white:hover:bg-surface-3',
        ],
        accent: 'bg-lime-500 text-on-lime hover:bg-lime-400',
        danger: 'bg-danger text-on-danger hover:brightness-110',
        ghost: 'bg-transparent text-white/64 hover:bg-surface-3 hover:text-white',
      },
      size: {
        sm: 'size-8 [&_svg]:size-4',
        md: 'size-10 [&_svg]:size-[18px]',
        lg: 'size-12 [&_svg]:size-5',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface IconButtonProps
  extends Omit<ComponentPropsWithoutRef<'button'>, 'color' | 'children'>,
    VariantProps<typeof iconButton> {
  icon: ReactNode;
  /** Accessible name. Required for icon-only controls. */
  label: string;
}

export function IconButton({
  icon,
  label,
  variant,
  size,
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(iconButton({ variant, size }), className)}
      {...(variant === 'accent' ? { 'data-on-lime': '' } : {})}
      {...props}
    >
      {icon}
    </button>
  );
}
