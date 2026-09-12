'use client';

import { Bold, Italic } from 'lucide-react';
import { cn } from '@ideanest/ui';
import { isMarkActive, toggleMark, type StoryMark } from '../../lib/projects/story';
import type { StoryToolbarCopy } from '../../lib/i18n/campaign-editor-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

/**
 * Bold and emphasis, applied to whatever is selected in one text control.
 *
 * TWO ICON BUTTONS, AND BOTH ARE NAMED. `aria-label` carries the name and the
 * shortcut, because an icon-only control that announces "button" is not a control
 * (docs/ui-kit.md §9.4). The glyph is `aria-hidden`, so the name is not read twice.
 *
 * `aria-pressed` IS THE POINT OF THIS COMPONENT. Formatting state has to be
 * announced and not only coloured (§9.2), and a toggle button carrying
 * `aria-pressed` is the one control the platform already announces as "pressed" or
 * "not pressed" without any live region at all. Colour follows it rather than
 * carrying it.
 *
 * IT DOES NOT OWN THE TEXT. `toggleMark` returns the new value and where the
 * selection should be; this hands both to the caller, which owns the controlled
 * component's value. Writing into the textarea directly would fight React, and the
 * caret has to be restored after the re-render either way.
 *
 * WHY THE TOOLBAR IS NOT ABOVE THE WHOLE EDITOR. One toolbar for a page of blocks
 * has to guess which control it acts on, and it guesses wrong the moment focus goes
 * anywhere else — including to the toolbar itself. One per text control, rendered
 * beside the field it belongs to, has no such question to answer.
 *
 * MOTION: colour only, 150ms. The campaign editor's budget is "none — autosave
 * indicator only" (docs/motion-system.md §5).
 */

/**
 * The two marks, in the order they are offered.
 *
 * NO `label` AND NO `shortcut` ANY MORE — issue #324. Both are catalogue copy, read from
 * `copy`, so a control and the word announced with it cannot be spelled in two places.
 */
const CONTROLS: readonly { mark: StoryMark; icon: typeof Bold }[] = [
  { mark: 'strong', icon: Bold },
  { mark: 'em', icon: Italic },
];

/** The keyboard shortcuts, so a control and its shortcut cannot disagree. */
export function markForShortcut(key: string): StoryMark | null {
  const lower = key.toLowerCase();
  if (lower === 'b') return 'strong';
  if (lower === 'i') return 'em';
  return null;
}

export interface StoryMarkToolbarProps {
  /** The two controls' words. */
  copy: StoryToolbarCopy;
  /** The control's current value, in the inline mark syntax. */
  value: string;
  selectionStart: number;
  selectionEnd: number;
  disabled?: boolean;
  /** Names what this toolbar formats, e.g. "Paragraph 2 of 7". */
  label: string;
  onApply: (result: { text: string; selectionStart: number; selectionEnd: number }) => void;
}

export function StoryMarkToolbar({
  copy,
  value,
  selectionStart,
  selectionEnd,
  disabled = false,
  label,
  onApply,
}: StoryMarkToolbarProps) {
  return (
    /*
      A `group` rather than a `toolbar`. `role="toolbar"` promises arrow-key
      navigation between its controls and a single tab stop, and two buttons that
      Tab reaches individually are what a creator moving between a paragraph and its
      formatting expects. Promising the arrow keys and not implementing them is
      worse than not promising them.
    */
    <div role="group" aria-label={fillPlaceholders(copy.formattingFor, { label })} className="flex items-center gap-1">
      {CONTROLS.map(({ mark, icon: Icon }) => {
        const active = isMarkActive(value, selectionStart, selectionEnd, mark);
        const name = mark === 'strong' ? copy.bold : copy.italic;
        const shortcut = mark === 'strong' ? copy.boldShortcut : copy.italicShortcut;

        return (
          <button
            key={mark}
            type="button"
            aria-pressed={active}
            aria-label={`${name}, ${shortcut}`}
            disabled={disabled}
            /*
              `onMouseDown` with `preventDefault` rather than `onClick`: pressing a
              button takes focus, and taking focus from a textarea collapses its
              selection — so by the time a click handler ran there would be nothing
              selected to embolden. Keyboard activation still arrives as a click,
              which is why both are wired.
            */
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onApply(toggleMark(value, selectionStart, selectionEnd, mark))}
            className={cn(
              'inline-grid size-8 place-items-center rounded-md border text-[13px]',
              'transition-[background-color,color,border-color] duration-150 ease-in-out',
              'disabled:pointer-events-none disabled:opacity-40',
              active
                ? // White for "on", never lime: emphasising a word is not urgent
                  // (docs/ui-kit.md §7.3).
                  'border-transparent bg-white text-on-white'
                : 'border-white/8 bg-surface-3 text-white/64 hover:bg-surface-4 hover:text-white',
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
