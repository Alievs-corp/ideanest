import { cva } from 'class-variance-authority';

/**
 * The shared skin for typed input: `TextInput`, `Textarea`, `Select`.
 * See docs/ui-kit.md §7.13.
 *
 * `--surface-3` is the input fill because §3 assigns it to "nested block,
 * input" — a field inside a `--surface-2` card has to read as a well, not as
 * another card.
 *
 * No focus style is declared here on purpose. The global `:focus-visible` rule
 * in the token file already draws the lime ring; a per-component ring drifts
 * from it and eventually contradicts it (docs/ui-kit.md §9.3).
 *
 * Transitions are colour only, 150ms — the budget for checkout and the campaign
 * editor is near zero (docs/motion-system.md §5).
 */
export const inputSkin = cva(
  [
    'w-full rounded-md bg-surface-3 text-white',
    'border border-white/8',
    // --text-tertiary, the floor for readable text. --text-disabled (24%)
    // measures 2.6:1 and is prohibited for text (docs/ui-kit.md §9.2).
    'placeholder:text-white/40',
    'transition-[background-color,border-color] duration-150 ease-in-out',
    'hover:border-white/16 focus:border-white/16',
    'disabled:pointer-events-none disabled:opacity-40',
    'in-data-on-white:bg-on-white/4 in-data-on-white:text-on-white',
    'in-data-on-white:border-on-white/16 in-data-on-white:placeholder:text-on-white/48',
    'in-data-on-white:hover:border-on-white/32 in-data-on-white:focus:border-on-white/32',
  ],
  {
    variants: {
      size: {
        sm: 'h-9 px-3 text-[13px]',
        md: 'h-11 px-3.5 text-sm',
        lg: 'h-12 px-4 text-[15px]',
      },
      invalid: {
        true: 'border-danger hover:border-danger focus:border-danger in-data-on-white:border-danger in-data-on-white:hover:border-danger in-data-on-white:focus:border-danger',
        false: '',
      },
    },
    defaultVariants: { size: 'md', invalid: false },
  },
);
