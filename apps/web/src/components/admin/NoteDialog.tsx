'use client';

import { useEffect, useState } from 'react';
import { CharacterCount, Field, Pill, Textarea } from '@ideanest/ui';
import { Modal } from '@ideanest/ui/motion';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { NoteDialogCopy } from '../../lib/i18n/admin/common-copy';

/** The `@Size` the curation request bodies carry, matching the moderation notes. */
export const NOTE_MAX_CHARACTERS = 2000;

export interface NoteDialogProps {
  /** What is about to happen, in the title. Null closes the dialog. */
  readonly title: string | null;
  readonly description?: string;
  /** The sentence above the field, saying what the change costs. */
  readonly body?: string;
  readonly confirmLabel: string;
  readonly busyLabel: string;
  /** Draws the confirm control in `--danger`. For a change that takes something away. */
  readonly destructive?: boolean;
  /** A confirmation without a reason, for a change whose endpoint has nowhere to keep one. */
  readonly noteless?: boolean;
  readonly busy: boolean;
  /** A refusal from the service. Keeps the dialog open — nothing has changed. */
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: (note: string) => void;
  /**
   * The dialog's own words. Everything above them — the title, the confirm label — stays with
   * the screen that opens it, because those name the change rather than the note.
   */
  readonly copy: NoteDialogCopy;
}

/**
 * The one place a curation change is committed — AD-03, issues #300 to #303.
 *
 * <h2>The note is required, and that is the service's rule rather than this file's</h2>
 *
 * Publishing a collection, withdrawing one, adding a campaign and removing one all carry
 * `minLength: 1` on their note in the contract. The reason is worth repeating where somebody
 * is typing: in a badge-granting collection, adding a campaign <strong>is</strong> §3.2's
 * "apply an editorial badge" — a decision about which campaigns the platform itself stands
 * behind, audited, and one somebody may have to justify a year later.
 *
 * <p>Checked here as well as in the service so that a curator is told before the request
 * rather than by a 400 after it. `lib/moderation/api.ts` states the same principle for the
 * moderation notes, which are optional for the opposite reason: nothing shows those to
 * anybody, so requiring one would produce a field people type "ok" into.
 *
 * <h2>A dialog rather than an inline form</h2>
 *
 * The same argument `DecisionDialog` makes: every one of these verbs is privileged and
 * audited, and `Modal` is the only overlay in the kit that traps focus and returns it to the
 * control that opened it (docs/ui-kit.md §7.14). Backdrop dismissal is off — a curator has to
 * choose — and Escape stays on, because cancelling is one of the two choices.
 *
 * <h2>Motion</h2>
 *
 * The modal's own 200ms entry and nothing else, which collapses to an instant state change
 * under `prefers-reduced-motion` (docs/motion-system.md §4.11.1).
 */
export function NoteDialog({
  title,
  description,
  body,
  confirmLabel,
  busyLabel,
  destructive = false,
  noteless = false,
  busy,
  error,
  onCancel,
  onConfirm,
  copy,
}: NoteDialogProps) {
  const locale = useRouteLocale();
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  /*
   * A note typed for one change must not survive into the next. Keyed on the title rather
   * than on open/closed, so reopening after a refusal keeps what was written — the curator
   * has not changed their mind, the service refused.
   */
  useEffect(() => {
    setNote('');
    setNoteError(null);
  }, [title]);

  if (title === null) {
    // Rendering a closed `Modal` would put a dialog with no title in the tree, and the
    // title is what names it.
    return null;
  }

  const count = Array.from(note).length;

  function confirm(): void {
    if (noteless) {
      onConfirm('');
      return;
    }

    const trimmed = note.trim();

    if (trimmed === '') {
      setNoteError(copy.required);
      return;
    }
    if (count > NOTE_MAX_CHARACTERS) {
      setNoteError(fillPlaceholders(copy.tooLong, { limit: String(NOTE_MAX_CHARACTERS) }));
      return;
    }

    setNoteError(null);
    onConfirm(trimmed);
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
      size="md"
      title={title}
      description={description}
      closeOnBackdropClick={false}
      showClose={false}
      footer={
        <>
          <Pill variant="ghost" disabled={busy} onClick={onCancel}>
            {copy.cancel}
          </Pill>
          <Pill variant={destructive ? 'danger' : 'primary'} disabled={busy} onClick={confirm}>
            {busy ? busyLabel : confirmLabel}
          </Pill>
        </>
      }
    >
      {body !== undefined && <p className="text-sm text-on-white/72">{body}</p>}

      {!noteless && (
        <div className="mt-4">
          <Field label={copy.why} required hint={copy.hint} error={noteError}>
            {/*
              No `maxLength`. A hard cap silently truncates a pasted note and takes the
              counter's only useful message away — "3 characters too many" is actionable,
              losing three words is not.
            */}
            <Textarea
              rows={4}
              value={note}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <CharacterCount
            count={count}
            limit={NOTE_MAX_CHARACTERS}
            copy={copy.counter}
            locale={locale}
            className="mt-1"
          />
        </div>
      )}

      {error !== null && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}
