'use client';

import { useEffect, useRef, useState } from 'react';
import { InlineAlert, Pill } from '@ideanest/ui';
import type { RevisionCopy } from '@ideanest/campaign-editor/copy';
import {
  isRevisionField,
  revisionRefusalOf,
  revisionView,
} from '@ideanest/campaign-editor/revision';
import { ApiError } from '../../lib/api/problem';
import {
  discardRevision,
  getProjectEdit,
  submitRevision,
  type ProjectEdit,
} from '../../lib/projects/api';

/**
 * Where a launched campaign's edit stands, on every editor tab (#561).
 *
 * Edits to a launched campaign are held for a moderator, so the creator has to be told three
 * things the fields alone do not say: the changes are not public, the public still sees the
 * approved version, and what happens next. `revisionView` decides which of the four situations
 * this is; this draws it.
 *
 * Nothing here is lime. Lime means urgent, and an edit waiting in review is neither urgent nor
 * successful. The situation is a title and an icon, never a colour alone.
 *
 * MOTION: none, like the rest of the editor (docs/motion-system.md §5). The discard is asked
 * inline rather than in a dialog for the reason `ReviewPanel` gives for the launch: `Modal`
 * carries the animation runtime this route has no budget for.
 */
export interface RevisionNoticeProps {
  projectId: string;
  project: ProjectEdit;
  copy: RevisionCopy;
  /** The server's answer to a submit, a discard, or the re-read after a refusal. */
  onProject: (project: ProjectEdit) => void;
  /** After a discard, so a tab holding a seeded draft can take the live values back. */
  onDiscarded?: () => void;
}

type Busy = 'submit' | 'discard' | null;

export function RevisionNotice({ projectId, project, copy, onProject, onDiscarded }: RevisionNoticeProps) {
  const view = revisionView(project);
  const [busy, setBusy] = useState<Busy>(null);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [returned, setReturned] = useState(false);
  const previous = useRef(view.kind);

  /*
   * Editing a PENDING revision returns it to DRAFT. The save's answer is what shows it, and
   * the creator was not told, so say so once the kind moves that way.
   */
  useEffect(() => {
    if (previous.current === 'pending' && view.kind === 'draft') setReturned(true);
    else if (view.kind !== 'draft') setReturned(false);
    previous.current = view.kind;
  }, [view.kind]);

  if (view.kind === 'none') return null;

  async function run(action: Exclude<Busy, null>): Promise<void> {
    setBusy(action);
    setProblem(null);
    try {
      const saved =
        action === 'submit' ? await submitRevision(projectId) : await discardRevision(projectId);
      setConfirming(false);
      setReturned(false);
      onProject(saved);
      if (action === 'discard') onDiscarded?.();
    } catch (cause) {
      if (cause instanceof ApiError && cause.problem?.code === 'REVISION_NOT_AVAILABLE') {
        setProblem(copy.refusals[revisionRefusalOf(cause.problem.meta)]);
        setConfirming(false);
        try {
          onProject(await getProjectEdit(projectId));
        } catch {
          // The refusal is already on screen; the next load shows the true state.
        }
      } else {
        setProblem(cause instanceof ApiError ? (cause.problem?.detail ?? copy.failed) : copy.failed);
      }
    } finally {
      setBusy(null);
    }
  }

  const title =
    view.kind === 'rejected'
      ? copy.rejectedTitle
      : view.kind === 'pending'
        ? copy.pendingTitle
        : copy.draftTitle;
  const body =
    view.kind === 'rejected'
      ? copy.rejectedBody
      : view.kind === 'pending'
        ? copy.pendingBody
        : copy.draftBody;
  const working = busy !== null;

  return (
    <div className="mb-8 flex flex-col gap-3" data-revision={view.kind}>
      <InlineAlert variant={view.kind === 'rejected' ? 'warning' : 'info'} title={title}>
        <p>{body}</p>

        {view.reason !== null && (
          <p className="mt-3">
            <span className="font-medium text-fg">{copy.reasonLabel}: </span>
            {view.reason}
          </p>
        )}

        {view.changedFields.length > 0 && (
          <>
            <p className="mt-3 font-medium text-fg">{copy.changedHeading}</p>
            <ul className="mt-1 list-disc ps-5">
              {view.changedFields.map((field) => (
                <li key={field}>{isRevisionField(field) ? copy.fields[field] : field}</li>
              ))}
            </ul>
          </>
        )}

        {returned && (
          <p role="status" className="mt-3 font-medium text-fg">
            {copy.returnedToDraft}
          </p>
        )}

        {(view.kind === 'draft' || view.kind === 'pending') &&
          (confirming ? (
            <div role="group" aria-labelledby="revision-discard-heading" className="mt-4">
              <p id="revision-discard-heading" className="font-medium text-fg">
                {copy.confirmDiscardTitle}
              </p>
              <p className="mt-1">{copy.confirmDiscardBody}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Pill
                  variant="primary"
                  size="sm"
                  autoFocus
                  aria-disabled={working}
                  className={working ? 'opacity-40' : undefined}
                  onClick={() => {
                    if (!working) void run('discard');
                  }}
                >
                  {busy === 'discard' ? copy.discarding : copy.confirmDiscard}
                </Pill>
                <Pill
                  variant="ghost"
                  size="sm"
                  aria-disabled={working}
                  onClick={() => {
                    if (!working) setConfirming(false);
                  }}
                >
                  {copy.keepEditing}
                </Pill>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <Pill
                variant="primary"
                size="sm"
                aria-disabled={working || !view.canSubmit}
                className={working || !view.canSubmit ? 'opacity-40' : undefined}
                onClick={() => {
                  if (!working && view.canSubmit) void run('submit');
                }}
              >
                {busy === 'submit' ? copy.submitting : copy.submit}
              </Pill>
              <Pill
                variant="ghost"
                size="sm"
                aria-disabled={working || !view.canDiscard}
                className={working || !view.canDiscard ? 'opacity-40' : undefined}
                onClick={() => {
                  if (!working && view.canDiscard) setConfirming(true);
                }}
              >
                {copy.discard}
              </Pill>
            </div>
          ))}
      </InlineAlert>

      {problem !== null && (
        <InlineAlert variant="danger" title={copy.refusedTitle}>
          <p>{problem}</p>
        </InlineAlert>
      )}
    </div>
  );
}
