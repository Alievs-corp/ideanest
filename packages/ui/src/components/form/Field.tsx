import { createContext, useContext, useId, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * The wrapper every form control composes with. See docs/ui-kit.md §7.13.
 *
 * Label, hint, and error are useless unless they are WIRED to the control:
 * a hint nobody's screen reader reaches is decoration. `Field` owns the ids —
 * `htmlFor`/`id`, `aria-describedby` covering hint AND error, `aria-invalid`
 * when errored — so no caller has to remember to.
 *
 * The error is text plus `CircleAlert`, never a red border alone. A red border
 * says nothing to a colour-blind user and nothing at all to a screen reader
 * (docs/ui-kit.md §9.2).
 *
 * Motion: colour transitions only, 150ms. Forms live on checkout and the
 * campaign editor, where the budget is "near zero" and "none" respectively
 * (docs/motion-system.md §5) — an animating field reads as hesitation.
 */

interface FieldContextValue {
  /** Id of the single control the label points at. Absent for grouped fields. */
  controlId: string | undefined;
  /** Id of the label element. Grouped fields name themselves with it. */
  labelId: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Aria a single control inherits from its surrounding `Field`. */
export interface FieldControlAria {
  id: string | undefined;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  required: boolean | undefined;
  /** Resolved invalid state, for styling. */
  invalid: boolean;
}

export interface FieldControlOwnProps {
  id?: string;
  'aria-describedby'?: string;
  invalid?: boolean | null;
  required?: boolean;
}

function join(parts: (string | undefined)[]): string | undefined {
  const kept = parts.filter((p): p is string => Boolean(p));
  return kept.length > 0 ? kept.join(' ') : undefined;
}

/**
 * Merges a control's own props with the surrounding `Field`. Explicit props
 * always win, so a control stays usable outside a `Field`.
 */
export function useFieldControl(own: FieldControlOwnProps): FieldControlAria {
  const field = useContext(FieldContext);
  const invalid = own.invalid ?? field?.invalid ?? false;
  return {
    id: own.id ?? field?.controlId,
    'aria-describedby': join([field?.describedBy, own['aria-describedby']]),
    'aria-invalid': invalid ? true : undefined,
    required: own.required ?? (field?.required ? true : undefined),
    invalid,
  };
}

/** Aria a composite control (radio group, drop zone) inherits from its `Field`. */
export interface FieldGroupAria {
  'aria-labelledby': string | undefined;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  invalid: boolean;
}

export function useFieldGroup(own: {
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  invalid?: boolean | null;
}): FieldGroupAria {
  const field = useContext(FieldContext);
  const invalid = own.invalid ?? field?.invalid ?? false;
  return {
    'aria-labelledby': own['aria-labelledby'] ?? field?.labelId,
    'aria-describedby': join([field?.describedBy, own['aria-describedby']]),
    'aria-invalid': invalid ? true : undefined,
    invalid,
  };
}

export interface FieldProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  label: ReactNode;
  /** Guidance shown before the user gets it wrong. */
  hint?: ReactNode;
  /** Present means errored. The string is announced, the colour is not. */
  error?: ReactNode;
  /** Marks the label and sets `required` on the control inside. */
  required?: boolean;
  /**
   * For controls that are a SET — radios, checkbox lists, the drop zone.
   * There is no single element to point `htmlFor` at, so the label names the
   * group through `aria-labelledby` instead.
   */
  grouped?: boolean;
  children: ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required = false,
  grouped = false,
  className,
  children,
  ...props
}: FieldProps) {
  const uid = useId();
  const controlId = `${uid}-control`;
  const labelId = `${uid}-label`;
  const hintId = `${uid}-hint`;
  const errorId = `${uid}-error`;

  // Hint first, then error: a screen reader reads them in DOM order and the
  // guidance is worth less after the correction.
  const describedBy = join([hint ? hintId : undefined, error ? errorId : undefined]);

  const labelContent = (
    <>
      {label}
      {required && (
        <span aria-hidden="true" className="ml-0.5 text-fg-40 in-data-on-white:text-on-white/48">
          *
        </span>
      )}
    </>
  );

  return (
    <FieldContext.Provider
      value={{
        controlId: grouped ? undefined : controlId,
        labelId,
        describedBy,
        invalid: Boolean(error),
        required,
      }}
    >
      <div className={cn('flex flex-col gap-1.5', className)} {...props}>
        {grouped ? (
          <span id={labelId} className="text-sm font-medium text-fg in-data-on-white:text-on-white">
            {labelContent}
          </span>
        ) : (
          <label id={labelId} htmlFor={controlId} className="text-sm font-medium text-fg in-data-on-white:text-on-white">
            {labelContent}
          </label>
        )}

        {children}

        {hint && (
          <p id={hintId} className="text-[13px] text-fg-64 in-data-on-white:text-on-white/64">
            {hint}
          </p>
        )}

        {error && (
          <p id={errorId} className="flex items-start gap-1.5 text-[13px] text-danger">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
