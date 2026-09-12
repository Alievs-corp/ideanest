'use client';

import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import { cn } from '@ideanest/ui';
import type { SaveStatusCopy } from '../../lib/i18n/campaign-editor-copy';
import type { SaveState } from './useAutosave';

/**
 * Whether the work is safe. The only moving thing in the campaign editor.
 *
 * The motion budget for this surface is "none — autosave indicator only"
 * (docs/motion-system.md §5), and this is that indicator: one rotating glyph,
 * transform only, dropped entirely under `prefers-reduced-motion` through
 * `motion-safe`. Creators spend hours here and anything else that moved would
 * be in the way.
 *
 * "Saved" is `--success`, never lime. Lime means *urgent*, "act now"
 * (docs/ui-kit.md §2.4), and a saved draft is the opposite of that.
 *
 * COLOUR IS NOT THE STATE. Each state is a word with an icon beside it, so the
 * difference between saved and not saved does not depend on telling green from
 * red (§9.2).
 *
 * ONLY THE OUTCOMES ARE ANNOUNCED. The live region carries "Saved" and "Not
 * saved" but not "Saving" — a screen-reader user gains nothing from being told
 * a request is in progress, and being told it after every pause in typing is
 * noise that drowns the message that matters.
 */
export interface SaveStatusProps {
  state: SaveState;
  copy: SaveStatusCopy;
  className?: string;
}

export function SaveStatus({ state, copy, className }: SaveStatusProps) {
  const announced = state === 'saved' ? copy.saved : state === 'failed' ? copy.notSaved : '';

  return (
    <p className={cn('flex items-center gap-1.5 text-[13px]', className)}>
      {state === 'saving' && (
        <span aria-hidden="true" className="flex items-center gap-1.5 text-white/40">
          <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
          {copy.saving}
        </span>
      )}

      {state === 'saved' && (
        <span aria-hidden="true" className="flex items-center gap-1.5 text-success">
          <CircleCheck className="size-3.5" />
          {copy.saved}
        </span>
      )}

      {state === 'failed' && (
        <span aria-hidden="true" className="flex items-center gap-1.5 text-danger">
          <CircleAlert className="size-3.5" />
          {copy.notSaved}
        </span>
      )}

      {/*
        Present from the first render, so the region is registered before
        anything is put in it — one created and filled in the same commit is not
        reliably announced.
      */}
      <span role="status" aria-live="polite" className="sr-only">
        {announced}
      </span>
    </p>
  );
}
