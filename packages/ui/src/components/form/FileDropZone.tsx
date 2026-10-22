import { Upload } from 'lucide-react';
import { useRef, useState, type ComponentPropsWithoutRef, type DragEvent } from 'react';
import { cn } from '../../lib/cn';
import { useFieldGroup } from './Field';

/**
 * File drop zone. See docs/ui-kit.md §7.13.
 *
 * The button is NOT optional. Drag-and-drop is unreachable by keyboard, by
 * switch control, and on every touch device; a drop zone without a picker
 * button is a control a large share of users simply cannot operate. Dragging
 * is the shortcut, the button is the control.
 *
 * Drag-over is announced by swapping the instruction text and the border, not
 * by colour alone (docs/ui-kit.md §9.2).
 *
 * The nesting counter exists because `dragleave` fires when the pointer
 * crosses onto a CHILD element. Toggling on the raw event makes the zone
 * flicker off and on as the cursor moves over the icon and the button.
 */
export interface FileDropZoneProps extends Omit<ComponentPropsWithoutRef<'div'>, 'onDrop'> {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Instruction shown when idle. */
  prompt?: string;
  /** Instruction shown while a drag is over the zone. */
  dragPrompt?: string;
  /** Accessible name of the picker button. */
  buttonLabel?: string;
  /** Constraint line: accepted types, size limit. */
  hint?: string;
}

export function FileDropZone({
  onFiles,
  accept,
  multiple = false,
  disabled = false,
  prompt = 'Drag files here',
  dragPrompt = 'Release to add these files',
  buttonLabel = 'Choose files',
  hint,
  className,
  ...props
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const group = useFieldGroup({
    'aria-labelledby': props['aria-labelledby'],
    'aria-describedby': props['aria-describedby'],
  });

  function emit(list: FileList | File[] | null | undefined) {
    const files = list ? Array.from(list) : [];
    if (files.length > 0) onFiles(files);
  }

  function onDragEnter(event: DragEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    depth.current += 1;
    setDragging(true);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (disabled) return;
    // Without this the browser navigates to the dropped file.
    event.preventDefault();
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    emit(event.dataTransfer?.files);
  }

  return (
    <div
      role="group"
      {...props}
      aria-labelledby={group['aria-labelledby']}
      aria-describedby={group['aria-describedby']}
      data-dragging={dragging ? '' : undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center',
        'transition-[background-color,border-color] duration-150 ease-in-out',
        dragging ? 'border-lime-ink bg-surface-3' : 'border-fg/16 bg-surface-2',
        disabled && 'pointer-events-none opacity-40',
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          emit(event.currentTarget.files);
          // Re-selecting the same file must fire `change` again.
          event.currentTarget.value = '';
        }}
      />

      <Upload
        aria-hidden="true"
        className={cn('size-5', dragging ? 'text-lime-ink' : 'text-fg-40')}
      />

      <p className="text-sm text-fg">{dragging ? dragPrompt : prompt}</p>

      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'mt-1 inline-flex h-9 items-center rounded-full px-4 text-[13px] font-medium',
          'bg-surface-3 text-fg transition-colors duration-150 ease-in-out hover:bg-surface-4',
        )}
      >
        {buttonLabel}
      </button>

      {hint && <p className="text-[13px] text-fg-40">{hint}</p>}
    </div>
  );
}
