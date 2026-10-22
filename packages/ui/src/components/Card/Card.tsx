import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * The primary surface of the system. See docs/ui-kit.md §7.1.
 *
 * All three variants are the same size; they encode STATE, not elevation:
 *   default  — ordinary item
 *   active   — current / priority / URGENT  (not "successful" — see §8.1)
 *   floating — modal or panel sitting above the system
 */
const card = cva(
  [
    'relative isolate',
    'transition-[background-color,transform,border-color]',
    'duration-300 ease-[var(--ease-standard)]',
  ],
  {
    variants: {
      variant: {
        default: ['bg-surface-2 border border-fg/8 text-fg', 'hover:bg-surface-3'],
        // data-on-lime switches the focus ring to near-black (see theme.css)
        active: ['bg-lime-500 border border-transparent text-on-lime', 'hover:bg-lime-400'],
        floating: ['bg-white text-on-white border-transparent shadow-float'],
      },
      size: {
        sm: 'rounded-md p-4',
        md: 'rounded-lg p-5',
        lg: 'rounded-xl p-6',
      },
      interactive: {
        true: 'cursor-pointer hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.995]',
        false: '',
      },
    },
    defaultVariants: { variant: 'default', size: 'md', interactive: false },
  },
);

export interface CardProps
  extends Omit<ComponentPropsWithoutRef<'div'>, 'color'>,
    VariantProps<typeof card> {
  children?: ReactNode;
}

export function Card({ variant, size, interactive, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(card({ variant, size, interactive }), className)}
      {...(variant === 'active' ? { 'data-on-lime': '' } : {})}
      {...props}
    >
      {children}
    </div>
  );
}

/* ── Card parts (anatomy: docs/ui-kit.md §7.1) ─────────────────────── */

export function CardTitle({ className, ...props }: ComponentPropsWithoutRef<'h3'>) {
  return <h3 className={cn('text-lg font-medium tracking-[-0.02em]', className)} {...props} />;
}

/**
 * Secondary text.
 *
 * `currentColor` is deliberately not used: white/64 disappears on a lime card,
 * so the caller states the context and the component picks a legible tone.
 */
export function CardSubtitle({
  onLime = false,
  className,
  ...props
}: ComponentPropsWithoutRef<'p'> & { onLime?: boolean }) {
  return (
    <p
      className={cn('mt-0.5 text-sm', onLime ? 'text-on-lime/70' : 'text-fg-64', className)}
      {...props}
    />
  );
}

export function CardFooter({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('mt-4 flex items-center gap-2', className)} {...props} />;
}
