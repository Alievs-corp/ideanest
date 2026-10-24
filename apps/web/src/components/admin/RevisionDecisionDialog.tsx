'use client';

import { useState } from 'react';
import { CharacterCount, Field, InlineAlert, Pill, Textarea } from '@ideanest/ui';
import { Modal } from '@ideanest/ui/motion';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useRouteLocale } from '../../lib/i18n/useRouteLocale';
import type { RevisionDialogCopy } from '../../lib/i18n/admin/revision-copy';
import type { ConsoleChromeCopy } from '../../lib/i18n/admin/common-copy';

/** The `@Size` on the moderation decision body. */
const NOTE_MAX_CHARACTERS = 2000;

export interface RevisionDecisionDialogProps {
  /** Rejecting needs a reason the creator can act on; approving does not. */
  readonly noteRequired: boolean;
  readonly destructive: boolean;
  readonly title: string;
  readonly copy: RevisionDialogCopy;
  readonly noteRequiredMessage: string;
  readonly tooLongMessage: string;
  readonly chrome: Pick<ConsoleChromeCopy, 'cancel' | 'errorTitle' | 'counter'>;
  readonly busy: boolean;
  /** A refusal from the service. Keeps the dialog open: nothing has changed. */
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: (note: string | null) => void;
}

/**
 * The confirmation for approving or rejecting an edit — issue #560, part of epic #557.
 *
 * <p><strong>Its own module, and fetched when it opens.</strong> `Modal` brings the motion
 * library, about 120 KiB, and the review route is opened to read a comparison, not to decide
 * it. The screen loads this with `React.lazy`, as `/admin/staff` loads its confirmation, and
 * nothing here imports a helper from a module that would pull `Modal` in statically.
 *
 * <p>Backdrop dismissal is off, so the moderator has to choose, and Escape stays on because
 * cancelling is one of the two choices. A note typed here survives a refusal and is dropped
 * with the dialog.
 */
export function RevisionDecisionDialog({
  noteRequired,
  destructive,
  title,
  copy,
  noteRequiredMessage,
  tooLongMessage,
  chrome,
  busy,
  error,
  onCancel,
  onConfirm,
}: RevisionDecisionDialogProps) {
  const locale = useRouteLocale();
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  const count = Array.from(note).length;

  function confirm(): void {
    const trimmed = note.trim();

    if (noteRequired && trimmed === '') {
      setNoteError(noteRequiredMessage);
      return;
    }
    if (count > NOTE_MAX_CHARACTERS) {
      setNoteError(fillPlaceholders(tooLongMessage, { limit: String(NOTE_MAX_CHARACTERS) }));
      return;
    }

    setNoteError(null);
    // An empty optional note is absent, not an empty string.
    onConfirm(trimmed === '' ? null : trimmed);
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
      size="md"
      title={copy.title}
      description={fillPlaceholders(copy.description, { title })}
      closeOnBackdropClick={false}
      showClose={false}
      footer={
        <>
          <Pill variant="ghost" disabled={busy} onClick={onCancel}>
            {chrome.cancel}
          </Pill>
          <Pill variant={destructive ? 'danger' : 'primary'} disabled={busy} onClick={confirm}>
            {busy ? copy.busyLabel : copy.confirmLabel}
          </Pill>
        </>
      }
    >
      <Field label={copy.noteLabel} required={noteRequired} hint={copy.noteHint} error={noteError}>
        {/* No `maxLength`: a hard cap silently truncates a pasted note and takes the counter's message away. */}
        <Textarea
          rows={4}
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
        />
        <CharacterCount count={count} limit={NOTE_MAX_CHARACTERS} copy={chrome.counter} locale={locale} />
      </Field>

      {error !== null && (
        <InlineAlert variant="danger" title={chrome.errorTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}
    </Modal>
  );
}
