'use client';

import { useEffect, useState } from 'react';
import { CharacterCount, Field, InlineAlert, Pill, Textarea } from '@ideanest/ui';
import { Modal } from '@ideanest/ui/motion';
import type { CampaignOutcome, QueuedReport, ReportOutcome, ReportTargetType } from '../../lib/moderation/api';
import { requiresNote } from '../../lib/moderation/api';
import { shortId } from '../../lib/moderation/describe';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import type { ModerationCopy } from '../../lib/i18n/admin/content-copy';

/**
 * Which of the five verbs is being confirmed.
 *
 * A discriminated union rather than a flat string, because the two halves reach
 * different endpoints with different consequences and the type is what stops one
 * being sent to the other's function.
 */
export type Decision =
  | { readonly kind: 'report'; readonly outcome: ReportOutcome }
  | { readonly kind: 'campaign'; readonly outcome: CampaignOutcome };

export type ReportDecision = Extract<Decision, { readonly kind: 'report' }>;

/** What the note may hold — the `@Size` both request bodies carry. */
export const NOTE_MAX_CHARACTERS = 2000;

interface Copy {
  readonly title: string;
  readonly description: string;
  readonly body: string | null;
  readonly confirmLabel: string;
  readonly busyLabel: string;
  readonly noteLabel: string;
  readonly noteHint: string;
  readonly noteRequired: boolean;
  readonly destructive: boolean;
}

/**
 * The words for each verb, assembled from `admin.moderation.decision`.
 *
 * <h2>The table moved to the catalogue and the two booleans did not</h2>
 *
 * Every `description` says what the decision does AND what it does not do. The service is
 * emphatic that upholding a report does not suspend anything and that rejecting a campaign
 * does not close the complaint; a moderator who believes one button did both has been misled
 * by the interface into thinking a job is finished. Those sentences are copy and they are in
 * `messages/*.json` since #324.
 *
 * <p><strong>`noteRequired` and `destructive` stayed here</strong>, because neither is a
 * word. One mirrors what the service's request body demands and the other decides which
 * token the confirm control is painted in — a translator who could change either would be
 * able to turn off a validation rule or make a rejection look ordinary by editing a
 * sentence.
 *
 * <h2>Two ways to name the target, and Russian is why</h2>
 *
 * A report outcome says "the complaint about <em>campaign 1a2b3c4d</em>" and a campaign
 * outcome says "<em>campaign 1a2b3c4d</em> is cleared for launch". The noun is the object of
 * the first and the subject of the second, which is one word in English and two in Russian —
 * so the name is built from `targetName` in one branch and `campaignName` in the other.
 */
function copyFor(decision: Decision, subject: DecisionSubject, copy: ModerationCopy): Copy {
  const verb = copy.decision.verb[decision.outcome];
  const name =
    decision.kind === 'report'
      ? fillPlaceholders(copy.targetName, {
          kind: copy.target[subject.targetType],
          id: shortId(subject.targetId),
        })
      : subject.title ?? fillPlaceholders(copy.campaignName, { id: shortId(subject.targetId) });

  return {
    title: verb.title,
    description: fillPlaceholders(verb.description, { name }),
    body: verb.body ?? null,
    confirmLabel: verb.confirmLabel,
    busyLabel: verb.busyLabel,
    noteLabel: verb.noteLabel,
    noteHint: verb.noteHint,
    noteRequired: decision.kind === 'campaign' && requiresNote(decision.outcome),
    destructive: decision.kind === 'campaign' && decision.outcome === 'reject',
  };
}

/**
 * What a decision is about, which is less than a report.
 *
 * <p>This dialog took a whole {@link QueuedReport} until the submission queue needed it,
 * and used three fields of one: an identity to key the note on, and the pair that names
 * the thing in the sentence. A submitted campaign has all three and is not a report —
 * nobody complained about it — so the prop is now the three fields rather than the object
 * that happened to be the first thing carrying them.
 *
 * @param key identity, so a note typed for one decision does not survive into the next
 * @param targetType only read on the `report` branch, where the sentence names the kind
 *     of thing complained about. A campaign outcome always concerns a campaign
 * @param targetId what gets shortened into the sentence
 */
export interface DecisionSubject {
  readonly key: string;
  readonly targetType: ReportTargetType;
  readonly targetId: string;
  readonly title?: string;
}

export interface DecisionDialogProps {
  readonly decision: Decision | null;
  readonly subject: DecisionSubject | null;
  readonly busy: boolean;
  /** A refusal from the service. Keeps the dialog open — nothing has changed. */
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: (note: string | null) => void;
  /** The moderation vocabulary, resolved on the server by whichever screen opened this. */
  readonly copy: ModerationCopy;
}

/**
 * The one place a moderation decision is committed.
 *
 * A dialog rather than an inline form because every one of these five verbs is
 * privileged and hard to reverse, and because `Modal` is the only overlay that
 * traps focus and gives it back to the control that opened it
 * (docs/ui-kit.md §7.14). Backdrop dismissal is off — the user has to make a
 * choice — and Escape stays on, because cancelling IS one of the two choices.
 *
 * MOTION: the modal's own 200ms entry (docs/motion-system.md §4.11.1) and
 * nothing else. That is the overlay budget even on checkout, and it collapses to
 * an instant state change under `prefers-reduced-motion`.
 */
export function DecisionDialog({
  decision,
  subject,
  busy,
  error,
  onCancel,
  onConfirm,
  copy: moderation,
}: DecisionDialogProps) {
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  const key = decision === null || subject === null ? null : `${subject.key}:${decision.outcome}`;

  /*
   * A note typed for one decision must not survive into the next one. Keyed on
   * the pair rather than on `open`, so reopening the same dialog after a refusal
   * keeps what was written — the moderator has not changed their mind, the
   * service refused.
   */
  useEffect(() => {
    setNote('');
    setNoteError(null);
  }, [key]);

  if (decision === null || subject === null) {
    // Nothing to confirm. Rendering a closed `Modal` would put a dialog with no
    // title in the tree, and `title` is what names it.
    return null;
  }

  const copy = copyFor(decision, subject, moderation);
  const count = Array.from(note).length;

  function confirm(): void {
    const trimmed = note.trim();

    if (copy.noteRequired && trimmed === '') {
      setNoteError(moderation.decision.noteRequired);
      return;
    }
    if (count > NOTE_MAX_CHARACTERS) {
      setNoteError(
        fillPlaceholders(moderation.decision.tooLong, { limit: String(NOTE_MAX_CHARACTERS) }),
      );
      return;
    }

    setNoteError(null);
    // An empty optional note is absent, not an empty string: a blank note that
    // round-trips reads as a moderator who wrote nothing on purpose.
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
      description={copy.description}
      closeOnBackdropClick={false}
      showClose={false}
      footer={
        <>
          <Pill variant="ghost" disabled={busy} onClick={onCancel}>
            {moderation.cancel}
          </Pill>
          <Pill
            variant={copy.destructive ? 'danger' : 'primary'}
            disabled={busy}
            onClick={confirm}
          >
            {busy ? copy.busyLabel : copy.confirmLabel}
          </Pill>
        </>
      }
    >
      {copy.body !== null && <p className="mb-4 text-sm text-on-white/72">{copy.body}</p>}

      <div>
        <Field
          label={copy.noteLabel}
          required={copy.noteRequired}
          hint={copy.noteHint}
          error={noteError}
        >
          {/*
            No `maxLength`. A hard cap silently truncates a pasted note and takes
            the counter's only useful message away — "3 characters too many" is
            actionable, losing three words is not.
          */}
          <Textarea
            rows={4}
            value={note}
            disabled={busy}
            onChange={(event) => setNote(event.target.value)}
          />
          <CharacterCount count={count} limit={NOTE_MAX_CHARACTERS} />
        </Field>
      </div>

      {/* `InlineAlert` carries `role="alert"` for danger — a refused privileged
          action must interrupt rather than wait to be noticed. */}
      {error && (
        <InlineAlert variant="danger" title={moderation.decision.errorTitle} className="mt-4">
          {error}
        </InlineAlert>
      )}
    </Modal>
  );
}
