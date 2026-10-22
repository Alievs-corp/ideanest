import type { VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { useFieldControl } from './Field';
import { inputSkin } from './inputSkin';

/**
 * Single-line text input. See docs/ui-kit.md §7.13.
 *
 * Inside a `Field` it inherits the id, the description ids, and the invalid
 * state; outside one it still works, because a control that only functions in
 * a wrapper is a wrapper, not a control.
 */
export interface TextInputProps
  extends Omit<ComponentPropsWithoutRef<'input'>, 'size' | 'color'>,
    VariantProps<typeof inputSkin> {
  /** Decoration, not a control — kept out of the pointer path. */
  leading?: ReactNode;
  /** May be interactive (a clear or reveal button). */
  trailing?: ReactNode;
}

export function TextInput({
  size,
  invalid,
  leading,
  trailing,
  className,
  type = 'text',
  ...props
}: TextInputProps) {
  const aria = useFieldControl({
    id: props.id,
    'aria-describedby': props['aria-describedby'],
    invalid,
    required: props.required,
  });

  return (
    <div className="relative">
      {leading && (
        <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-fg-40 [&_svg]:size-4">
          {leading}
        </span>
      )}

      <input
        type={type}
        {...props}
        id={aria.id}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={aria['aria-invalid']}
        required={aria.required}
        className={cn(
          inputSkin({ size, invalid: aria.invalid }),
          leading && 'pl-10',
          trailing && 'pr-10',
          className,
        )}
      />

      {trailing && (
        <span className="absolute inset-y-0 right-3 grid place-items-center text-fg-40 [&_svg]:size-4">
          {trailing}
        </span>
      )}
    </div>
  );
}
