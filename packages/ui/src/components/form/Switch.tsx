import { useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { useFieldControl } from './Field';

/**
 * On/off switch. See docs/ui-kit.md §7.13.
 *
 * `role="switch"` rather than a checkbox, because the two mean different
 * things: a checkbox selects something for later, a switch takes effect now.
 * A screen reader says "on"/"off" for one and "checked"/"not checked" for the
 * other, and a setting that announces itself as "checked" is a small lie.
 *
 * The thumb moves with `translate-x`, never `left` — transform is the only
 * property that stays off the layout path (docs/motion-system.md §8). 150ms,
 * matching the near-zero budget of the surfaces forms live on.
 *
 * `data-on-lime` sits on the track, not on the button: the button also holds
 * the label text, which is on the dark page and must keep the lime focus ring.
 */
export interface SwitchProps
  extends Omit<ComponentPropsWithoutRef<'button'>, 'onChange' | 'type' | 'value' | 'children'> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Inline label. Omit it when a `Field` already names the control. */
  label?: ReactNode;
  /**
   * When set, a hidden checkbox carries the value into a native form
   * submission — `role="switch"` on a button has no form value of its own.
   */
  name?: string;
}

export function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  label,
  name,
  className,
  disabled,
  ...props
}: SwitchProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultChecked);
  const on = checked ?? uncontrolled;

  const aria = useFieldControl({
    id: props.id,
    'aria-describedby': props['aria-describedby'],
  });

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        {...props}
        id={aria.id}
        aria-describedby={aria['aria-describedby']}
        onClick={(event) => {
          if (checked === undefined) setUncontrolled(!on);
          onCheckedChange?.(!on);
          props.onClick?.(event);
        }}
        className={cn(
          'inline-flex items-center gap-3 rounded-full text-sm text-fg',
          'disabled:pointer-events-none disabled:opacity-40',
          className,
        )}
      >
        <span
          aria-hidden="true"
          {...(on ? { 'data-on-lime': '' } : {})}
          className={cn(
            'inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5',
            'transition-colors duration-150 ease-in-out',
            on ? 'bg-lime-500' : 'bg-surface-4',
          )}
        >
          <span
            className={cn(
              'size-5 rounded-full transition-transform duration-150 ease-in-out',
              // White on lime measures 1.3:1 — the thumb has to flip too.
              on ? 'translate-x-5 bg-on-lime' : 'translate-x-0 bg-white',
            )}
          />
        </span>
        {label}
      </button>

      {name && (
        <input type="checkbox" name={name} checked={on} readOnly hidden aria-hidden="true" />
      )}
    </>
  );
}
