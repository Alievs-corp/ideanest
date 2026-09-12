import { Eye, EyeOff } from 'lucide-react';
import { useState, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn';
import { TextInput, type TextInputProps } from './TextInput';

/**
 * A password field with a reveal toggle. See docs/ui-kit.md §7.13.
 *
 * <h2>Why the toggle exists</h2>
 *
 * A masked field is a field somebody types into blind, and the only way to
 * check what came out is to submit it. On registration that costs a refusal
 * over a typo in a password nobody ever saw; on sign-in it costs an attempt
 * against a rate limit. Every other defence against a mistyped password —
 * a confirmation field, a strength meter — asks the person to type more. This
 * asks them to look.
 *
 * <h2>The toggle is a button, and it says which way it is pointing</h2>
 *
 * `aria-pressed` carries the state, so a screen reader announces the control
 * as pressed rather than leaving the reader to infer it from an icon they
 * cannot see. The icon alone would be colour-and-shape meaning, which §9.2
 * forbids as the sole carrier: the accessible name changes with the state too,
 * from "Show password" to "Hide password".
 *
 * `tabIndex={-1}` is DELIBERATELY NOT SET. A reveal the keyboard cannot reach
 * is a reveal for pointer users only, and the people most likely to need it
 * are the ones least likely to be using a mouse.
 *
 * <h2>What it does not do</h2>
 *
 * **It never remembers.** The field returns to masked on every mount. A
 * revealed password that survives a navigation is a password left on screen in
 * a room the person has since walked out of.
 *
 * **It is not in the form's tab-to-submit path as a submit.** `type="button"`
 * is set by default on the element, because a bare `<button>` inside a form
 * submits it, and a reveal that signs you in is a bug with a wrong-password
 * branch at the end of it.
 *
 * <h2>Motion</h2>
 *
 * Colour only, 150ms. `docs/motion-system.md` §5 gives authentication a budget
 * of "None — 150ms colour on controls", so the icon swaps without a transform
 * and the button does not scale on hover the way `IconButton` does. An
 * animating control on a sign-in form reads as hesitation.
 */
export interface PasswordInputProps extends Omit<TextInputProps, 'type' | 'trailing'> {
  /** Accessible name while the password is masked. */
  showLabel?: string;
  /** Accessible name while the password is visible. */
  hideLabel?: string;
  /** Props forwarded to the toggle, for a caller that needs to reach it. */
  toggleProps?: Omit<ComponentPropsWithoutRef<'button'>, 'onClick' | 'aria-pressed' | 'type'>;
}

export function PasswordInput({
  showLabel = 'Show password',
  hideLabel = 'Hide password',
  toggleProps,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const label = visible ? hideLabel : showLabel;
  const Icon = visible ? EyeOff : Eye;

  return (
    <TextInput
      {...props}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          {...toggleProps}
          type="button"
          aria-pressed={visible}
          aria-label={label}
          title={label}
          onClick={() => setVisible((current) => !current)}
          className={cn(
            'grid size-8 place-items-center rounded-full text-white/64',
            'transition-[color,background-color] duration-150 ease-in-out',
            'hover:bg-surface-4 hover:text-white',
            'disabled:pointer-events-none disabled:opacity-40',
            toggleProps?.className,
          )}
          disabled={props.disabled}
        >
          <Icon aria-hidden="true" className="size-4" />
        </button>
      }
    />
  );
}
