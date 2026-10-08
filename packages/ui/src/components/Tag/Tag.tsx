import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * Small label for source, category, or status. See docs/ui-kit.md §7.5.
 *
 * CONTEXT MATTERS: the `default` variant disappears inside a lime card — dark
 * on dark. Use `onLime` there, which is a black tint instead, and `onAccent`
 * on a sun, mint or sky card, where a status colour is illegible as text too.
 */
const tag = cva(
  ['inline-flex h-[26px] items-center gap-1 rounded-sm px-2.5', 'text-xs font-medium'],
  {
    variants: {
      variant: {
        default: 'bg-surface-3 text-white/64',
        onLime: 'bg-on-lime/10 text-on-lime/72',
        onAccent: 'bg-on-accent/10 text-on-accent',
        onWhite: 'bg-black/6 text-on-white/64',
        success: 'bg-success/12 text-success',
        warning: 'bg-warning/12 text-warning',
        danger: 'bg-danger/12 text-danger',
        hot: 'bg-hot/12 text-hot',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface TagProps
  extends Omit<ComponentPropsWithoutRef<'span'>, 'color'>,
    VariantProps<typeof tag> {}

export function Tag({ variant, className, ...props }: TagProps) {
  return <span className={cn(tag({ variant }), className)} {...props} />;
}
