import { Check, Minus } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { useFieldControl } from './Field';

/**
 * Checkbox. See docs/ui-kit.md §7.13.
 *
 * The box is drawn by the real `<input type="checkbox">` with
 * `appearance: none`, not by a `<div>` next to a hidden input. Keeping the
 * input as the visible, focusable box means the tri-state `indeterminate`
 * property, space-to-toggle, label association, and form submission all keep
 * working, and the global `:focus-visible` ring lands on the thing the user
 * sees.
 *
 * Checked is `--lime-500` with a `--text-on-lime` mark: §8.1 reads lime as
 * "active choice" for a selected reward tier, and a chosen option is the same
 * gesture. `data-on-lime` flips the focus ring on the lime fill (theme.css).
 *
 * The 6px radius is derived, not invented: §4's concentric rule is
 * `parent_radius − padding`, and the 14px input radius minus the 8px gutter
 * lands there. `--radius-sm` (10px) on a 20px box is a circle, which would
 * read as a radio.
 */
export interface CheckboxProps
  extends Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'size' | 'color'> {
  /** Inline label. Omit it when a `Field` already names the control. */
  label?: ReactNode;
  /** Secondary line under the label. */
  description?: ReactNode;
  /**
   * "Some children are checked". Cannot be expressed as an attribute — it is a
   * DOM property only — so it is written through a ref.
   */
  indeterminate?: boolean;
  invalid?: boolean;
}

export function Checkbox({
  label,
  description,
  indeterminate = false,
  invalid,
  className,
  ...props
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  const aria = useFieldControl({
    id: props.id,
    'aria-describedby': props['aria-describedby'],
    invalid,
    required: props.required,
  });

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  // Mirrors the DOM so the lime fill — and therefore `data-on-lime` — stays
  // right when the checkbox is uncontrolled.
  const controlled = props.checked;
  const [on, setOn] = useState(Boolean(controlled ?? props.defaultChecked));
  useEffect(() => {
    if (controlled !== undefined) setOn(controlled);
  }, [controlled]);

  const marked = indeterminate || on;

  const control = (
    <span className="relative inline-grid shrink-0 place-items-center">
      <input
        ref={ref}
        type="checkbox"
        {...props}
        onChange={(event) => {
          setOn(event.currentTarget.checked);
          props.onChange?.(event);
        }}
        id={aria.id}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={aria['aria-invalid']}
        required={aria.required}
        {...(marked ? { 'data-on-lime': '' } : {})}
        className={cn(
          'peer col-start-1 row-start-1 size-5 cursor-pointer appearance-none rounded-[6px]',
          'border border-fg/16 bg-surface-3',
          'transition-[background-color,border-color] duration-150 ease-in-out',
          'hover:border-fg/40',
          'checked:border-transparent checked:bg-lime-500',
          'indeterminate:border-transparent indeterminate:bg-lime-500',
          'disabled:pointer-events-none disabled:opacity-40',
          aria.invalid && 'border-danger hover:border-danger',
          className,
        )}
      />
      {indeterminate ? (
        <Minus
          aria-hidden="true"
          className="pointer-events-none col-start-1 row-start-1 size-3.5 text-on-lime"
        />
      ) : (
        <Check
          aria-hidden="true"
          className="pointer-events-none col-start-1 row-start-1 size-3.5 text-on-lime opacity-0 transition-opacity duration-150 ease-in-out peer-checked:opacity-100"
        />
      )}
    </span>
  );

  if (label === undefined && description === undefined) return control;

  return (
    <label className="flex cursor-pointer items-start gap-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40">
      {control}
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-fg">{label}</span>
        {description && <span className="text-[13px] text-fg-64">{description}</span>}
      </span>
    </label>
  );
}
