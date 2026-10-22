import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/cn';
import { useFieldControl } from '../form/Field';
import { inputSkin } from '../form/inputSkin';

/**
 * A text input with a listbox popup — ARIA's combobox, in the shape
 * docs/ui-kit.md §7.13 reserved for it.
 *
 * §7.13 calls the native `<select>` a decision rather than a shortcut and sends
 * "the rich listbox — multi-select, async search" to overlay work instead. This
 * is that overlay: options arrive from somewhere else, asynchronously, and the
 * reader is typing rather than choosing from a fixed vocabulary. Nothing here
 * replaces `Select`, and a control with five fixed options must still use it.
 *
 * CONTROLLED, like every other overlay (§7.14). `value`, `open`, and the option
 * list are the caller's; what is *active* inside the list is not, because it is
 * a property of one keyboard walk rather than application state.
 *
 * DOM FOCUS NEVER LEAVES THE INPUT. The active option is named by
 * `aria-activedescendant` and nothing else. Moving real focus into the list is
 * the version of this control that cannot be typed into: every keystroke after
 * the first arrow press would go to an `<li>`, and the reader would have to
 * find their way back to correct a typo.
 *
 * NO INLINE COMPLETION. Arrowing through the options does not rewrite what was
 * typed — `aria-autocomplete="list"`, not `"both"`. Two reasons. The typed text
 * is what a plain Enter submits, and a control that quietly replaces it makes
 * "search for what I typed" unreachable once the reader has looked at the list.
 * And the options here are not all completions of the fragment: a list that
 * mixes a campaign title with a category name would write a category name into
 * the box and then submit it as free text.
 *
 * THE ACTIVE OPTION WRAPS. Down from the last option lands on the first and Up
 * from the first lands on the last. The list is bounded and short — ten rows —
 * so a wrap costs one keypress and a hard stop costs the reader the discovery
 * that the list ended. Escape, not Up, is how the list is left.
 *
 * HOME AND END NAVIGATE THE LIST ONLY ONCE THE LIST IS BEING NAVIGATED — that
 * is, only while an option is active. Before that they are the caret shortcuts
 * they are in every other text field, because a reader fixing the first letter
 * of what they typed must not be thrown into a dropdown to do it.
 *
 * TAB LEAVES WITHOUT SELECTING. It closes the popup and moves on; it does not
 * accept the active option. Tab means "I am done here", and a control that
 * commits a highlighted row on the way past is one that changes the page when
 * somebody was only trying to reach the next control.
 *
 * MOTION: none. The popup appears and disappears. docs/motion-system.md §5.1
 * gives the filter rail "150ms colour only" because "a panel that animates
 * while somebody is using it is a panel that is slower to use", and a
 * suggestion list is that panel with a keyboard in it — it is read between two
 * keystrokes.
 */

export interface ComboboxOption {
  /**
   * Unique within one list and stable across renders. It becomes the option's
   * DOM id, which is what `aria-activedescendant` points at.
   */
  readonly id: string;
  /** The visible text. */
  readonly label: string;
  /**
   * What kind of thing this is, AS TEXT. Rendered beside the label and included
   * in the option's accessible name, because colour and icon never carry
   * meaning alone (docs/ui-kit.md §9.2) — and a list whose rows lead to four
   * different places has to say which is which out loud.
   */
  readonly kind?: string;
}

export interface ComboboxProps
  extends Omit<
    ComponentPropsWithoutRef<'input'>,
    'value' | 'onChange' | 'onSelect' | 'onSubmit' | 'size' | 'type' | 'role'
  > {
  /** What is in the box. The source of truth for what a plain Enter submits. */
  value: string;
  onValueChange: (value: string) => void;

  /** The rows. Empty is a legitimate state and is announced, not hidden. */
  options: readonly ComboboxOption[];

  /** Whether the popup is displayed. `aria-expanded` mirrors it exactly. */
  open: boolean;
  onOpenChange: (open: boolean) => void;

  /** A row was chosen — by Enter on the active option, or by pointer. */
  onSelect: (option: ComboboxOption) => void;

  /** Enter with no active option: the typed text, as typed. */
  onSubmit?: (value: string) => void;

  /** The listbox's accessible name. Required — it is a named region. */
  listboxLabel: string;

  /**
   * Shown inside the popup above the rows: "Loading", a refusal, "no
   * suggestions". Its presence is enough to display the popup with no rows in
   * it, because "nothing found" is an answer and silence is a broken control.
   */
  message?: ReactNode;

  /**
   * What the polite live region says. Defaults to the row count, or to "No
   * suggestions" when the popup is open and empty. Pass a string to describe a
   * state the count cannot — loading, or a refusal.
   */
  announcement?: string;

  size?: 'sm' | 'md' | 'lg';
  invalid?: boolean;
  /** Decoration, not a control — kept out of the pointer path. */
  leading?: ReactNode;
  /** Wrapper class. The input's own class is `inputClassName`. */
  className?: string;
  inputClassName?: string;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function Combobox({
  value,
  onValueChange,
  options,
  open,
  onOpenChange,
  onSelect,
  onSubmit,
  listboxLabel,
  message,
  announcement,
  size,
  invalid,
  leading,
  className,
  inputClassName,
  onKeyDown,
  ...props
}: ComboboxProps) {
  const uid = useId();
  const listId = `${uid}-listbox`;

  const aria = useFieldControl({
    id: props.id,
    'aria-describedby': props['aria-describedby'],
    invalid,
    required: props.required,
  });

  /**
   * The active option, by id rather than by index.
   *
   * An index would survive the list changing underneath it and point at a
   * different campaign than the one that was highlighted a moment ago — which
   * on a list that reloads while you type is the difference between opening
   * what you chose and opening its neighbour. An id that is no longer in the
   * list simply means "nothing active", resolved on every render below rather
   * than through an effect that would repaint once with the stale value.
   */
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo(
    () => options.find((option) => option.id === activeId) ?? null,
    [options, activeId],
  );

  const listRef = useRef<HTMLUListElement>(null);

  /** The popup is displayed when it has something in it. Nothing else. */
  const expanded = open && (options.length > 0 || message != null);

  /**
   * The highlighted row is scrolled into view because it is not focused —
   * without this, arrowing past the sixth of ten options moves an
   * `aria-activedescendant` a sighted keyboard user cannot see.
   */
  useEffect(() => {
    if (activeId === null) return;
    // Found by attribute rather than by id selector: an option id is caller
    // data and may contain a character a CSS selector reads as syntax.
    const node = listRef.current?.querySelector('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const move = useCallback(
    (to: 'next' | 'previous' | 'first' | 'last') => {
      if (options.length === 0) return;

      const current = options.findIndex((option) => option.id === activeId);
      const last = options.length - 1;

      let next: number;
      switch (to) {
        case 'first':
          next = 0;
          break;
        case 'last':
          next = last;
          break;
        case 'next':
          // From nothing active, Down opens on the first row rather than the
          // second — `current` is -1 and -1 + 1 is 0, which is why this reads
          // as one expression rather than two.
          next = current === last ? 0 : current + 1;
          break;
        case 'previous':
          next = current <= 0 ? last : current - 1;
          break;
      }

      setActiveId(options[next]?.id ?? null);
      if (!open) onOpenChange(true);
    },
    [options, activeId, open, onOpenChange],
  );

  const close = useCallback(() => {
    setActiveId(null);
    onOpenChange(false);
  }, [onOpenChange]);

  const choose = useCallback(
    (option: ComboboxOption) => {
      setActiveId(null);
      onOpenChange(false);
      onSelect(option);
    },
    [onSelect, onOpenChange],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move('next');
        return;
      case 'ArrowUp':
        event.preventDefault();
        move('previous');
        return;
      case 'Home':
        // Only once the reader is walking the list. See the note above.
        if (!expanded || active === null) return;
        event.preventDefault();
        move('first');
        return;
      case 'End':
        if (!expanded || active === null) return;
        event.preventDefault();
        move('last');
        return;
      case 'Enter':
        // Always prevented, so a surrounding form cannot submit a second time
        // for the same keypress.
        event.preventDefault();
        if (expanded && active !== null) {
          choose(active);
          return;
        }
        close();
        onSubmit?.(value);
        return;
      case 'Escape':
        // The typed value is untouched. Escape closes a list; it does not undo
        // typing, and a search box that empties itself on Escape loses work
        // nobody asked it to throw away.
        if (!expanded) return;
        event.preventDefault();
        close();
        return;
      case 'Tab':
        // Leave, do not accept. Not prevented — the focus move is the point.
        if (expanded) close();
        return;
      default:
        return;
    }
  }

  const defaultAnnouncement = expanded
    ? options.length === 0
      ? 'No suggestions.'
      : `${plural(options.length, 'suggestion', 'suggestions')} available.`
    : '';

  return (
    <div
      className={cn('relative', className)}
      onBlur={(event) => {
        // A pointer press inside the popup must not close it before the click
        // lands, and the popup is inside this element — so the only blur worth
        // acting on is one that leaves the whole control.
        if (event.currentTarget.contains(event.relatedTarget)) return;
        close();
      }}
    >
      {leading && (
        <span className="pointer-events-none absolute inset-y-0 left-3 z-10 grid place-items-center text-fg-40 [&_svg]:size-4">
          {leading}
        </span>
      )}

      <input
        {...props}
        type="text"
        role="combobox"
        value={value}
        onChange={(event) => {
          setActiveId(null);
          onValueChange(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        // The browser's own suggestion list over the top of this one is two
        // dropdowns for one field, and only one of them is wired to the ARIA.
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={active?.id}
        id={aria.id}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={aria['aria-invalid']}
        required={aria.required}
        className={cn(inputSkin({ size, invalid: aria.invalid }), leading && 'pl-10', inputClassName)}
      />

      {expanded && (
        <div
          className={cn(
            'absolute top-[calc(100%+4px)] right-0 left-0 z-20 overflow-hidden',
            // §7.14: a popover is dark and one layer up from what it sits over,
            // and it takes a border rather than a shadow (§3).
            'rounded-md border border-fg/8 bg-surface-3',
          )}
        >
          {message != null && (
            <p className="px-3 py-2.5 text-[13px] text-fg-64">{message}</p>
          )}

          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={listboxLabel}
            className="max-h-[min(60vh,320px)] list-none overflow-y-auto"
          >
            {options.map((option) => {
              const isActive = option.id === active?.id;
              return (
                <li
                  key={option.id}
                  id={option.id}
                  role="option"
                  aria-selected={isActive}
                  data-active={isActive ? 'true' : undefined}
                  // The press, not the click: mousedown would blur the input
                  // and close the popup out from under the click that follows.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                  onPointerMove={() => setActiveId(option.id)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-sm',
                    'transition-colors duration-150 ease-in-out',
                    isActive ? 'bg-surface-4 text-fg' : 'text-fg-64',
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {option.kind !== undefined && (
                    <span className="shrink-0 text-xs text-fg-40">{option.kind}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/*
        THE ANNOUNCEMENT. Polite, and a permanent region whose text changes — a
        live region that only exists while it has something in it is inserted
        and read as ordinary content rather than announced. "No suggestions" is
        announced as loudly as three of them, because silence from a control
        that was just typed into reads as a control that has broken.

        It does not talk over the typing echo: the text changes when a list
        arrives, and a debounced caller produces one of those per burst of
        keystrokes rather than one per key.

        `aria-live` WITHOUT `role="status"`, and that is deliberate. The two
        announce identically, but `status` is a page-level role, and a page
        typically has one — the feed's, on `/discover`. A widget that claimed it
        too would put a second "status" in the document, so "the status" would
        no longer identify anything: not for a reader navigating by role, and
        not for the tests that query by it either.
      */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement ?? defaultAnnouncement}
      </p>
    </div>
  );
}
