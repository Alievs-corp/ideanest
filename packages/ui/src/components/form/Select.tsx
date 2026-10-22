import type { VariantProps } from 'class-variance-authority';
import { ChevronDown } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn';
import { useFieldControl } from './Field';
import { inputSkin } from './inputSkin';

/**
 * A native `<select>` wearing the system skin. See docs/ui-kit.md §7.13.
 *
 * NATIVE ON PURPOSE. A hand-built listbox has to re-implement type-ahead,
 * Home/End, PageUp/PageDown, screen-reader announcements, and the platform
 * wheel picker on iOS and Android — and it gets one of them wrong. The native
 * control ships all of it, correctly, for free. `color-scheme: dark` in the
 * token file makes the browser render the option list dark to match
 * (docs/ui-kit.md §9.4).
 *
 * The custom listbox — multi-select, rich rows, async search — belongs to the
 * overlay work, not to the form primitives.
 */
export interface SelectProps
  extends Omit<ComponentPropsWithoutRef<'select'>, 'size' | 'color'>,
    VariantProps<typeof inputSkin> {
  /**
   * Renders a disabled empty option first, so "nothing chosen yet" is a state
   * the user can see rather than a silent default.
   */
  placeholder?: string;
}

export function Select({
  size,
  invalid,
  placeholder,
  className,
  children,
  ...props
}: SelectProps) {
  const aria = useFieldControl({
    id: props.id,
    'aria-describedby': props['aria-describedby'],
    invalid,
    required: props.required,
  });

  return (
    <div className="relative">
      <select
        {...props}
        id={aria.id}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={aria['aria-invalid']}
        required={aria.required}
        // Without this an uncontrolled select silently adopts the first real
        // option, and the placeholder never appears.
        defaultValue={
          placeholder !== undefined && props.value === undefined && props.defaultValue === undefined
            ? ''
            : props.defaultValue
        }
        className={cn(
          inputSkin({ size, invalid: aria.invalid }),
          'cursor-pointer appearance-none pr-10',
          className,
        )}
      >
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {children}
      </select>

      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-fg-40"
      />
    </div>
  );
}
