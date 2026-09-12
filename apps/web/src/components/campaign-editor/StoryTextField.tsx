'use client';

import { useEffect, useRef, useState } from 'react';
import { Textarea } from '@ideanest/ui';
import { toggleMark } from '../../lib/projects/story';
import { markForShortcut, StoryMarkToolbar } from './StoryMarkToolbar';

/**
 * A run of marked text: a real `<textarea>`, a formatting toolbar, and the caret
 * arithmetic that keeps the two in step.
 *
 * THE CONTROL IS A REAL ONE, AND THAT IS THE DESIGN. Everything a text field does
 * for free — the caret, selection with the keyboard and with a pointer, undo,
 * dictation, an IME, the screen reader's typing echo, "select all" — keeps working
 * because nothing here reimplements it. A `contentEditable` region would have to
 * rebuild all of it, and the half that gets rebuilt badly is always the half a
 * screen-reader user depends on.
 *
 * THE SELECTION IS TRACKED IN STATE, not read on demand, because `aria-pressed` on
 * the toolbar has to re-render when the selection moves. `selectionchange` on the
 * document is the only event that fires for every way a selection can change —
 * dragging, double-clicking, Shift+Arrow, Ctrl+A, a caret moved by an IME — and
 * `onSelect` alone misses several of them. It is listened to only while this field
 * has focus, so a page of thirty blocks is not thirty listeners re-rendering
 * together.
 *
 * MOTION: none. `docs/motion-system.md` §5 gives the campaign editor "none —
 * autosave indicator only".
 */
import type { StoryToolbarCopy } from '../../lib/i18n/campaign-editor-copy';

export interface StoryTextFieldProps {
  /** The mark toolbar's words. */
  toolbar: StoryToolbarCopy;
  value: string;
  /** Names what is being edited, for the toolbar and for the control itself. */
  label: string;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Wired by the surrounding `Field`, or passed for a control inside a group. */
  id?: string;
  describedBy?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}

export function StoryTextField({
  toolbar,
  value,
  label,
  rows = 4,
  placeholder,
  disabled = false,
  invalid = false,
  id,
  describedBy,
  onChange,
  onBlur,
}: StoryTextFieldProps) {
  const control = useRef<HTMLTextAreaElement | null>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });

  /**
   * Where the caret has to be put after the next render.
   *
   * A controlled component's value comes from React, so applying a mark is two
   * steps: the value changes now, and the selection is restored once the DOM holds
   * the new value. Setting it before the re-render would place the caret in the old
   * text and the browser would clamp it somewhere surprising.
   */
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    const restore = pendingSelection.current;
    if (restore === null) return;
    pendingSelection.current = null;

    const element = control.current;
    if (element === null) return;
    element.focus();
    element.setSelectionRange(restore.start, restore.end);
    setSelection(restore);
  }, [value]);

  useEffect(() => {
    const element = control.current;
    if (element === null) return;

    const read = (): void => {
      if (document.activeElement !== element) return;
      setSelection({ start: element.selectionStart, end: element.selectionEnd });
    };

    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, []);

  function apply(result: { text: string; selectionStart: number; selectionEnd: number }): void {
    pendingSelection.current = { start: result.selectionStart, end: result.selectionEnd };
    onChange(result.text);
  }

  return (
    <div className="flex flex-col gap-2">
      <StoryMarkToolbar
        copy={toolbar}
        value={value}
        selectionStart={selection.start}
        selectionEnd={selection.end}
        disabled={disabled}
        label={label}
        onApply={apply}
      />

      <Textarea
        ref={control}
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        invalid={invalid}
        aria-label={label}
        aria-describedby={describedBy}
        onChange={(event) => {
          setSelection({ start: event.target.selectionStart, end: event.target.selectionEnd });
          onChange(event.target.value);
        }}
        onSelect={(event) => {
          // Belt to `selectionchange`'s braces. jsdom does not dispatch
          // `selectionchange` at all, so without this the toolbar's state would be
          // untestable — and a behaviour that cannot be tested is one that quietly
          // stops working.
          const element = event.currentTarget;
          setSelection({ start: element.selectionStart, end: element.selectionEnd });
        }}
        onKeyDown={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          const mark = markForShortcut(event.key);
          if (mark === null) return;

          // Ctrl+B and Ctrl+I are what everyone tries first, and in a textarea the
          // browser does nothing with them — so they are free to take, and taking
          // them is what makes the toolbar optional rather than the only way.
          event.preventDefault();
          const element = event.currentTarget;
          // The same `toggleMark` the toolbar button calls. Two paths to "make this
          // bold" would be two behaviours to keep in step.
          apply(toggleMark(element.value, element.selectionStart, element.selectionEnd, mark));
        }}
        onBlur={onBlur}
      />
    </div>
  );
}
