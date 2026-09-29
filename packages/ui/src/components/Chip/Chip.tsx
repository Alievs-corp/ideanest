import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, FocusEvent, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { revealFocusedItem } from '../../lib/reveal-focused-item';

/**
 * Filter chip. See docs/ui-kit.md §7.3.
 *
 * The selected state is WHITE, not lime. Filters appear in rows, and lime
 * carries the meaning "urgent" — which is meaningless for a filter.
 */
export interface ChipProps extends Omit<ComponentPropsWithoutRef<'button'>, 'color'> {
  active?: boolean;
  /** Result count rendered after the label. */
  count?: number;
  icon?: ReactNode;
}

export function Chip({
  active = false,
  count,
  icon,
  className,
  children,
  type = 'button',
  ...props
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        'inline-flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap',
        'rounded-full px-4 text-[13px] font-medium',
        'transition-[background-color,color,border-color] duration-150 ease-in-out',
        active
          ? 'border border-transparent bg-white text-on-white'
          : 'border border-white/8 bg-surface-2 text-white/64 hover:bg-surface-3 hover:text-white',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
      {count !== undefined && (
        <span className={cn('tabular-nums', active ? 'text-on-white/50' : 'text-white/40')}>
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * A chip that represents a choice already made, and removes it when pressed.
 *
 * NOT A `Chip` WITH AN ICON IN IT. `Chip` is a toggle and says so with
 * `aria-pressed`; this is a button that deletes something, and announcing a
 * delete control as "pressed" tells a screen-reader user it is a switch that is
 * currently on. Two different controls, two different contracts.
 *
 * THE ACCESSIBLE NAME SAYS WHAT PRESSING IT DOES. A row of chips reading
 * "Live", "Games", "Handmade" is unusable by ear: every one of them announces
 * as a button whose name is the thing it is about rather than the thing it
 * does. `removeLabel` carries the sentence — "Remove Status filter: Live" — and
 * it must contain the visible text, so that speech input reaches the control by
 * the words on it (WCAG 2.5.3).
 *
 * WHITE, NOT LIME, exactly as `Chip[data-active]`: an applied filter is where
 * the reader is, not something to hurry about (docs/ui-kit.md §7.3). The X is
 * decorative — colour and icon never carry the meaning alone here, because the
 * name already does.
 */
export interface RemovableChipProps extends Omit<ComponentPropsWithoutRef<'button'>, 'color'> {
  /**
   * What pressing this does, as a sentence. Required, and it must contain the
   * visible label.
   */
  removeLabel: string;
}

export function RemovableChip({
  removeLabel,
  className,
  children,
  type = 'button',
  ...props
}: RemovableChipProps) {
  return (
    <button
      type={type}
      aria-label={removeLabel}
      className={cn(
        'inline-flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap',
        'rounded-full border border-transparent bg-white px-3 pl-4 text-[13px] font-medium',
        'text-on-white',
        'transition-[background-color,color] duration-150 ease-in-out',
        'hover:bg-[var(--white-muted)]',
        className,
      )}
      {...props}
    >
      {children}
      <X aria-hidden="true" className="size-3.5 text-on-white/56" />
    </button>
  );
}

/**
 * Horizontally scrolling chip row.
 *
 * The right edge fades rather than cutting off, so "there is more" is legible
 * without a scrollbar.
 *
 * A chip that takes focus while it is partly off the row's edge is scrolled
 * fully into view, which Chromium does not do by itself — see
 * `lib/reveal-focused-item.ts`. A caller's own `onFocus` still runs, after it.
 */
export interface ChipRowProps extends ComponentPropsWithoutRef<'div'> {
  /** Right-edge fade mask. Disable when every chip already fits. */
  fadeEdge?: boolean;
}

export function ChipRow({
  fadeEdge = true,
  className,
  children,
  onFocus,
  ...props
}: ChipRowProps) {
  function handleFocus(event: FocusEvent<HTMLDivElement>): void {
    revealFocusedItem(event);
    onFocus?.(event);
  }

  return (
    <div
      role="group"
      className={cn(
        'scrollbar-none flex gap-2 overflow-x-auto',
        fadeEdge && 'fade-edge-r',
        className,
      )}
      {...props}
      onFocus={handleFocus}
    >
      {children}
    </div>
  );
}
