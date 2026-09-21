'use client';

import { useState } from 'react';
import { useRouter } from '../../i18n/navigation';
import { Reply, Trash2 } from 'lucide-react';
import { ApiError } from '../../lib/api/problem';
import { deleteComment } from '../../lib/community/comments';
import { ReportControl } from '../moderation/ReportControl';
import { useSession } from '../session/SessionProvider';
import { CommentComposer } from './CommentComposer';
import type { CommentCopy } from '../../lib/i18n/campaign-copy';
import type { ReportControlCopy } from '../../lib/i18n/report-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

/**
 * What a signed-in reader may do about one comment — §4.9's C-03, C-07 and the withdrawal.
 *
 * <h2>One island per comment, not three</h2>
 *
 * Replying, withdrawing and reporting all need the session, and two of the three need a write.
 * Mounting them separately would put three context consumers under every comment on the page;
 * one component that renders whichever of the three apply is one subscription and one prop
 * object per row. `ReportControl` is mounted from in here rather than from the server list for
 * the same reason — it is already a client component, and reaching it through this one keeps
 * a comment row to a single boundary.
 *
 * <h2>The reply control is placed by `acceptsReplies` and never by arithmetic</h2>
 *
 * §4.9's thread depth is bounded at one and states the rule three times over — the domain
 * refuses it, a database constraint refuses it under a support script, and every row carries
 * `acceptsReplies` "so a client places the reply control rather than discovering the rule by
 * being refused". This reads that flag. `depth === 0` recomputed here would be a fourth
 * statement of the rule, and the day it disagreed it would offer somebody a form the server
 * was always going to reject with a 422.
 *
 * <h2>Withdrawing is offered only to the author, and the server decides anyway</h2>
 *
 * `DELETE /v1/comments/{id}` also accepts the campaign's team (CD-14) and platform staff
 * (AD-09). Neither is offered from here, because this page has no way to know whether the
 * reader is on the campaign's team: `GET /v1/projects/{creatorSlug}/{projectSlug}` carries
 * the creator's slug, name and avatar and no collaborator list, and inventing the check from
 * "is the reader's slug the creator's slug" would be an authorisation decision made in a
 * browser. The creator's own removals belong on the dashboard (CD-14), which has the
 * authority to make them.
 *
 * So the control appears when the signed-in account wrote the comment, which is a comparison
 * of two identifiers the page already holds — and the server re-decides it regardless, which
 * is the only decision that counts.
 *
 * <h2>The wording is "withdraw", because §4.9 says it is not a removal</h2>
 *
 * The row stays, its body stays, and the read serves a tombstone. Calling the control
 * "Delete" would promise an erasure the platform deliberately does not perform — and somebody
 * pressing it to make a sentence disappear from the internet is entitled to know that it
 * will still be there, marked as withdrawn, for the moderator holding a report about it.
 */

export interface CommentControlsProps {
  /** The words this control draws, resolved on the server. See `lib/i18n/campaign-copy.ts`. */
  readonly copy: CommentCopy;
  readonly commentId: string;
  /** `null` on a tombstone. Compared with the signed-in account to place the withdrawal. */
  readonly authorId: string | null;
  /** The service's own answer to "may this be replied to". Read, never recomputed. */
  readonly acceptsReplies: boolean;
  /** §10.2's canonical path for this campaign — where a sign-in returns to. */
  readonly returnTo: string;
  /** The campaign's title, for the report dialog's heading. */
  readonly campaignTitle: string;
  /** The report dialog's own words. Resolved beside {@link CommentCopy}, on the server. */
  readonly reportCopy: ReportControlCopy;
}

export function CommentControls({
  commentId,
  authorId,
  acceptsReplies,
  returnTo,
  campaignTitle,
  copy,
  reportCopy,
}: CommentControlsProps) {
  const router = useRouter();
  const { status, session } = useSession();

  const [replying, setReplying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signedIn = status === 'signed-in';
  const isAuthor = signedIn && session !== null && authorId !== null && session.id === authorId;

  async function withdraw(): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      await deleteComment(commentId);
      setConfirming(false);
      /*
       * The list is re-read rather than patched, and here the reason is stronger than it is in
       * the composer: what replaces the comment is a tombstone the SERVER renders, with the
       * replies still hanging off it. A row removed locally would orphan them until the next
       * reload, which is the exact failure §4.9's tombstone exists to prevent.
       */
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? (cause.problem?.detail ?? cause.problem?.title ?? 'That could not be withdrawn.')
          : 'The service could not be reached. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        {acceptsReplies && (
          <button
            type="button"
            onClick={() => setReplying((open) => !open)}
            aria-expanded={replying}
            className="inline-flex items-center gap-1.5 rounded-sm text-xs text-white/64 transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
          >
            <Reply aria-hidden="true" className="size-3.5" />
            {copy.reply}
          </button>
        )}

        {isAuthor && !confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex items-center gap-1.5 rounded-sm text-xs text-white/64 transition-colors duration-150 ease-in-out hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
            {copy.withdraw}
          </button>
        )}

        {/*
          §4.9's C-07, through the control the platform already has. `ReportControl` argues why
          there is one component over a target type rather than one per surface; this is the
          third mount of it and it needed nothing but a `target`.

          Not offered on a tombstone: there is nothing left to read, and a report about a
          comment nobody can see is a queue item a moderator cannot act on. The server list
          decides that by not rendering these controls under a withdrawn comment at all.
        */}
        <ReportControl
          target={{ kind: 'comment', id: commentId }}
          name={fillPlaceholders(reportCopy.commentOn, { title: campaignTitle })}
          returnTo={returnTo}
          copy={reportCopy}
        />
      </div>

      {confirming && (
        /*
          ASKED IN PLACE, NOT IN A DIALOG. The action is small, reversible in the sense that
          matters (the row and its replies survive) and irreversible in the sense that matters
          more (there is no edit endpoint and no undelete). A modal for it would be heavier
          machinery than the decision deserves, and the sentence below is what somebody
          actually needs to read before pressing.
        */
        <div className="flex flex-col gap-2 rounded-lg border border-white/8 bg-surface-3 p-3">
          <p className="text-xs text-reading">
            {copy.withdrawWarning}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void withdraw()}
              className="rounded-sm text-xs font-medium text-danger underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)] disabled:opacity-40"
            >
              {busy ? 'Withdrawing' : 'Withdraw it'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-sm text-xs text-white/64 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)]"
            >
              {copy.keep}
            </button>
          </div>
        </div>
      )}

      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      {replying && (
        <CommentComposer
          copy={copy}
          target={{ kind: 'reply', commentId }}
          returnTo={returnTo}
          label={copy.replyLabel}
          submitLabel={copy.postReply}
          onPosted={() => setReplying(false)}
          onCancel={() => setReplying(false)}
        />
      )}
    </div>
  );
}
