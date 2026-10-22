import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn';

/**
 * Button whose label rotates away on a horizontal axis while a duplicate
 * rotates in from below. The signature micro-interaction of the system.
 * See docs/motion-system.md §4.3.
 *
 * Accessibility: the duplicate label is `aria-hidden`. Without it every
 * screen reader announces the button text twice.
 *
 * Reduced motion: the CSS transition is neutralised globally by the
 * `prefers-reduced-motion` block in the token stylesheet, so the duplicate
 * simply snaps into place rather than tumbling.
 */
const flipButton = cva(
  [
    'group relative inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded-full font-medium tracking-[-0.01em]',
    'transition-colors duration-300 ease-in-out',
    'disabled:pointer-events-none disabled:opacity-40',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-inverse text-on-inverse hover:bg-inverse-muted',
        accent: 'bg-lime-500 text-on-lime hover:bg-lime-400',
        ghost: 'bg-surface-3 text-fg hover:bg-surface-4',
        outline: 'border border-fg/16 bg-transparent text-fg hover:bg-surface-3',
      },
      size: {
        sm: 'h-8 px-3.5 text-[13px]',
        md: 'h-10 px-[18px] text-sm',
        lg: 'h-12 px-6 text-base',
      },
      fullWidth: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', fullWidth: false },
  },
);

export interface FlipButtonProps
  extends Omit<ComponentPropsWithoutRef<'button'>, 'color' | 'children'>,
    VariantProps<typeof flipButton> {
  /** Plain text only — the label is duplicated, so nodes would be duplicated too. */
  label: string;
}

export function FlipButton({
  label,
  variant,
  size,
  fullWidth,
  className,
  type = 'button',
  ...props
}: FlipButtonProps) {
  return (
    <button
      type={type}
      className={cn(flipButton({ variant, size, fullWidth }), className)}
      {...(variant === 'accent' ? { 'data-on-lime': '' } : {})}
      {...props}
    >
      {/* `perspective` on the clipping wrapper is what makes the rotation read
          as depth rather than a vertical squash. */}
      <span className="relative inline-flex overflow-hidden [perspective:1000px]">
        <span
          className={cn(
            'inline-block [transform-style:preserve-3d]',
            'transition-transform duration-300 ease-[var(--ease-standard)]',
            'group-hover:[transform:translateY(52%)_rotateX(-90deg)]',
          )}
        >
          {label}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-0 inline-block [transform-style:preserve-3d]',
            '[transform:translateY(-100%)_rotateX(90deg)]',
            'transition-transform duration-300 ease-[var(--ease-standard)]',
            'group-hover:[transform:translateY(0)_rotateX(0deg)]',
          )}
        >
          {label}
        </span>
      </span>
    </button>
  );
}
