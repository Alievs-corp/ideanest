'use client';

import { useId, useState, type FormEvent } from 'react';
import { localeHref, useLocale, useRouter } from '../../i18n/navigation';
import { Field, InlineAlert, Pill, Textarea } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import { signInHref } from '../../lib/auth/redirect';
import { isSubmittableComment, postComment, replyToComment } from '../../lib/community/comments';
import { useSession } from '../session/SessionProvider';
import type { CommentCopy } from '../../lib/i18n/campaign-copy';

/**
 * Writing a comment, and answering one — §4.9's C-01 and C-03, issue #285.
 *
 * <h2>One component for both, because they are one form</h2>
 *
 * A new conversation and a reply differ by the endpoint they post to and by nothing a reader
 * can see: the same textarea, the same signed-out branch, the same rate-limit message, the
 * same refresh afterwards. Two components would be two places for the 429 wording to drift
 * and two places to forget that the list has to be re-read.
 *
 * <h2>It does not build the new comment; it asks the server to render the list again</h2>
 *
 * `router.refresh()` re-runs the Server Component that fetched the threads, and the new
 * comment arrives in the next render of the list. Splicing it into local state instead would
 * mean this component deciding where a reply nests, where a thread sorts, and whether the
 * author counts as the campaign — and §4.9 settles all three on the server precisely because
 * a client cannot be trusted with them. `by_creator` in particular "is never accepted from
 * the request body, where it would be a claim of authority made by the side making the
 * claim", and a client that rendered its own new comment would be doing exactly that.
 *
 * The cost is a round trip before the comment appears. That is the right trade on a surface
 * where the alternative is a comment that looks posted and is not.
 *
 * <h2>Signed out is a link, never a form</h2>
 *
 * The write needs a bearer token, and §4.9 gives the reason it is a mechanism rather than
 * friction. `ReportControl` on this same page resolves the identical question the same way:
 * offer a sign-in that comes back here, and never a box that collects somebody's paragraph
 * and loses it at the last step.
 *
 * <h2>What it deliberately does not validate</h2>
 *
 * Only "something was typed". §10.2 publishes no length bound on a comment body, so a maximum
 * invented here would refuse a long comment the platform would have accepted, and nobody
 * could find the rule that refused it. `isSubmittableComment` says the same thing from the
 * lib side.
 *
 * <h2>Motion</h2>
 *
 * None. docs/motion-system.md §5 gives this page a moderate budget and nothing in it is spent
 * on a form; §9.4 of docs/ui-kit.md also puts an error message here, and an animated error is
 * one that arrives after it was needed.
 */

export type CommentTarget =
  | { readonly kind: 'campaign'; readonly projectId: string }
  | { readonly kind: 'reply'; readonly commentId: string };

export interface CommentComposerProps {
  /** The words this control draws, resolved on the server. See `lib/i18n/campaign-copy.ts`. */
  readonly copy: CommentCopy;
  readonly target: CommentTarget;
  /** Where a sign-in should return to — §10.2's canonical path for this campaign. */
  readonly returnTo: string;
  /** The textarea's label. Says what is being written, so the two uses are distinguishable. */
  readonly label: string;
  readonly submitLabel: string;
  /**
   * Called after a successful post, when there is a client parent to tell.
   *
   * Optional because a Server Component renders this too and cannot pass a function. The
   * reply form uses it to close itself; the campaign-level form has nothing to close.
   */
  readonly onPosted?: (() => void) | undefined;
  readonly onCancel?: (() => void) | undefined;
}

function messageFor(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Your session has expired. Sign in and try again.';
    if (cause.status === 429) {
      const seconds = cause.problem?.retryAfterSeconds;
      return seconds === undefined
        ? 'That is a lot of comments in a short time. Try again in a few minutes.'
        : `That is a lot of comments in a short time. Try again in about ${Math.ceil(seconds / 60)} minutes.`;
    }
    // The service's own wording wherever there is one: it knows which of its rules refused
    // the request and this function cannot.
    return cause.problem?.detail ?? cause.problem?.title ?? 'That could not be posted.';
  }
  return 'The service could not be reached. Check your connection and try again.';
}

export function CommentComposer({
  target,
  returnTo,
  label,
  submitLabel,
  onPosted,
  onCancel,
  copy,
}: CommentComposerProps) {
  const router = useRouter();
  const { status } = useSession();
  /*
   * The sign-in below is a full-document anchor rather than a `Link`, deliberately — signing
   * in is a boundary the client cache should not carry state across — and the language still
   * has to survive it. Without this a reader signing in from a Russian page lands wherever
   * their cookie last pointed. `i18n/navigation.tsx` carries the argument.
   */
  const locale = useLocale();

  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);

  const noticeId = useId();

  if (status === 'signed-out') {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-white/8 bg-surface-2 p-5">
        <p className="text-sm text-white/64">
          {copy.signedOut}
        </p>
        <div>
          <a href={localeHref(signInHref(returnTo), locale)} className="rounded-full">
            <Pill size="sm">{copy.signIn}</Pill>
          </a>
        </div>
      </div>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;

    if (!isSubmittableComment(body)) {
      setError('Write something first.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (target.kind === 'campaign') {
        await postComment(target.projectId, body);
      } else {
        await replyToComment(target.commentId, body);
      }

      setBody('');
      setPosted(true);
      /*
       * The list is re-read rather than patched. See the class comment; the refresh is what
       * makes the creator highlight, the nesting and the ordering the server's answer instead
       * of this component's guess.
       */
      router.refresh();
      onPosted?.();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-3">
      {error !== null && (
        <InlineAlert variant="danger" title={copy.notPosted}>
          <p>{error}</p>
        </InlineAlert>
      )}

      <Field label={label}>
        <Textarea
          rows={3}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            setError(null);
            setPosted(false);
          }}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Pill type="submit" size="sm" disabled={busy}>
          {busy ? copy.posting : submitLabel}
        </Pill>

        {onCancel !== undefined && (
          <Pill type="button" variant="ghost" size="sm" onClick={onCancel}>
            {copy.cancel}
          </Pill>
        )}

        {/*
          A polite region rather than an alert. The comment has appeared in the list a moment
          later, so this is a confirmation of something that is now visible rather than an
          interruption; it is always in the document so that a screen reader announces it when
          it fills, which a region inserted at that moment usually is not.
        */}
        <span id={noticeId} aria-live="polite" className="text-xs text-white/64">
          {posted ? 'Posted.' : ''}
        </span>
      </div>
    </form>
  );
}
