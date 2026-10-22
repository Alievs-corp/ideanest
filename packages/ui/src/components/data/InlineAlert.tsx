import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * A message attached to the thing it is about. See docs/ui-kit.md §7.15.
 *
 * SHAPE. `--surface-2` with a left rule in the status colour — the same form
 * §8.1 gives "payment failed", so a failed pledge looks the same wherever it
 * appears.
 *
 * SUCCESS IS `--success`, NEVER LIME. Lime means *urgent*, "act now". A backer
 * who sees lime and reads it as "done" has been told the opposite of the truth,
 * which is exactly why the two tokens exist separately (§2.4).
 *
 * COLOUR IS NEVER ALONE. Every variant pairs its hue with an icon (§9.2), so
 * the message still reads for a user with a colour-vision deficiency, in a
 * high-contrast mode, or on a printout.
 *
 * ONLY `warning` AND `danger` ASSERT. They take `role="alert"`, which
 * interrupts whatever a screen reader is saying. `info` and `success` are
 * plain: interrupting someone to say "saved" is a cost with no payoff, and an
 * alert that fires for everything stops being an alert.
 */
const inlineAlert = cva(
  ['flex items-start gap-3 rounded-md border-l-2 bg-surface-2 p-4 text-sm'],
  {
    variants: {
      variant: {
        info: 'border-l-info',
        success: 'border-l-success',
        warning: 'border-l-warning',
        danger: 'border-l-danger',
      },
    },
    defaultVariants: { variant: 'info' },
  },
);

const VARIANT_ICON = {
  info: { Icon: Info, tone: 'text-info' },
  success: { Icon: CircleCheck, tone: 'text-success' },
  warning: { Icon: TriangleAlert, tone: 'text-warning' },
  danger: { Icon: CircleAlert, tone: 'text-danger' },
} as const;

export interface InlineAlertProps
  extends Omit<ComponentPropsWithoutRef<'div'>, 'color' | 'title'>,
    VariantProps<typeof inlineAlert> {
  title?: ReactNode;
  children?: ReactNode;
  /** Shows the dismiss button. Omit for a message the user must not lose. */
  onDismiss?: () => void;
  /** Accessible name for the dismiss button — it is icon-only (§9.4). */
  dismissLabel?: string;
}

export function InlineAlert({
  variant = 'info',
  title,
  children,
  onDismiss,
  dismissLabel = 'Dismiss',
  className,
  ...props
}: InlineAlertProps) {
  const resolved = variant ?? 'info';
  const { Icon, tone } = VARIANT_ICON[resolved];
  const assertive = resolved === 'warning' || resolved === 'danger';

  return (
    <div
      role={assertive ? 'alert' : undefined}
      className={cn(inlineAlert({ variant: resolved }), className)}
      {...props}
    >
      <Icon aria-hidden="true" className={cn('mt-px size-4 shrink-0', tone)} />

      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-fg">{title}</p>}
        {children && <div className={cn('text-fg-64', title && 'mt-1')}>{children}</div>}
      </div>

      {onDismiss && (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className={cn(
            '-m-1 shrink-0 rounded-full p-1 text-fg-40',
            'transition-colors duration-150 ease-in-out hover:bg-surface-3 hover:text-fg',
          )}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}
