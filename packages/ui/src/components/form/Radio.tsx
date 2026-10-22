import {
  createContext,
  useContext,
  useId,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/cn';
import { useFieldGroup } from './Field';

/**
 * Radio group. See docs/ui-kit.md §7.13.
 *
 * Arrow-key navigation, wrap-around, and "the group is one tab stop" are not
 * implemented here. Native radios that share a `name` already do all of it,
 * and every hand-rolled version of that behaviour is a subset of it. The
 * wrapper only adds `role="radiogroup"` and an accessible name, which the
 * platform does not infer from a `<div>`.
 *
 * Selected is `--lime-500` with a `--text-on-lime` dot — §8.1's "active
 * choice", the same reading as a selected reward tier.
 */

interface RadioGroupContextValue {
  name: string;
  value: string | undefined;
  controlled: boolean;
  onSelect: (value: string) => void;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

export interface RadioGroupProps extends Omit<ComponentPropsWithoutRef<'div'>, 'onChange'> {
  /** Shared `name`. Generated when omitted — radios must agree on one. */
  name?: string;
  /** Accessible name. Unnecessary inside a `Field grouped`, which supplies it. */
  label?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  invalid?: boolean;
}

export function RadioGroup({
  name,
  label,
  value,
  defaultValue,
  onValueChange,
  invalid,
  className,
  children,
  ...props
}: RadioGroupProps) {
  const generatedName = useId();
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const group = useFieldGroup({
    'aria-labelledby': props['aria-labelledby'],
    'aria-describedby': props['aria-describedby'],
    invalid,
  });

  const current = value ?? uncontrolled;

  return (
    <RadioGroupContext.Provider
      value={{
        name: name ?? generatedName,
        value: current,
        controlled: value !== undefined,
        onSelect: (next) => {
          if (value === undefined) setUncontrolled(next);
          onValueChange?.(next);
        },
      }}
    >
      <div
        role="radiogroup"
        {...props}
        aria-label={label}
        // An explicit `label` wins; otherwise the surrounding Field names it.
        aria-labelledby={label === undefined ? group['aria-labelledby'] : undefined}
        aria-describedby={group['aria-describedby']}
        aria-invalid={group['aria-invalid']}
        className={cn('flex flex-col gap-2.5', className)}
      >
        {children}
      </div>
    </RadioGroupContext.Provider>
  );
}

export interface RadioProps
  extends Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'size' | 'color'> {
  value: string;
  label?: ReactNode;
  description?: ReactNode;
}

export function Radio({ value, label, description, className, ...props }: RadioProps) {
  const group = useContext(RadioGroupContext);
  const [uncontrolled, setUncontrolled] = useState(Boolean(props.defaultChecked));

  const checked = group
    ? group.controlled
      ? group.value === value
      : undefined
    : props.checked;

  // Only used to colour the fill; the DOM stays the source of truth.
  const marked = group ? group.value === value : (props.checked ?? uncontrolled);

  const control = (
    <span className="relative inline-grid shrink-0 place-items-center">
      <input
        type="radio"
        {...props}
        name={props.name ?? group?.name}
        value={value}
        checked={checked}
        defaultChecked={
          group && !group.controlled ? group.value === value : props.defaultChecked
        }
        onChange={(event) => {
          setUncontrolled(event.currentTarget.checked);
          group?.onSelect(value);
          props.onChange?.(event);
        }}
        {...(marked ? { 'data-on-lime': '' } : {})}
        className={cn(
          'peer col-start-1 row-start-1 size-5 cursor-pointer appearance-none rounded-full',
          'border border-fg/16 bg-surface-3',
          'transition-[background-color,border-color] duration-150 ease-in-out',
          'hover:border-fg/40',
          'checked:border-transparent checked:bg-lime-500',
          'disabled:pointer-events-none disabled:opacity-40',
          className,
        )}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none col-start-1 row-start-1 size-2 rounded-full bg-on-lime opacity-0 transition-opacity duration-150 ease-in-out peer-checked:opacity-100"
      />
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
