'use client';

import { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import { blockBySlug, blockFailureMessage, isBlocked, unblockBySlug } from '../../lib/community/blocks';
import type { BlockControlCopy } from '../../lib/i18n/block-copy';
import { useSession } from '../session/SessionProvider';

/**
 * "Block this account" on a public profile — §4.9's C-08, issue #324.
 *
 * Mounted beside `ProfileReportControl` at the foot of the page, quiet in the same way: somebody
 * who wants to block a person has read their profile. It addresses the account by slug, because
 * the profile deliberately carries no account id (`lib/community/blocks.ts`).
 *
 * <h2>Two readers see nothing</h2>
 *
 * The owner, who cannot block themselves, and a visitor who is not signed in, who has no blocks
 * to keep — unlike Report, a block without an account is not a thing that can be filed and
 * kept. While the session or the current state is still being read nothing is drawn either:
 * the control sits at the foot of the page, below anything a cursor is resting on, so it
 * appearing a moment later moves nothing.
 *
 * <h2>Asked in place, like Withdraw under a comment</h2>
 *
 * The question carries the sentence that matters before pressing — what a block hides, that the
 * other person cannot reply and is not told, and that their campaigns stay visible — and two
 * buttons. Once blocked the control says so and offers Unblock, so a block made by mistake is
 * undone where it was made rather than only from privacy settings.
 *
 * <h2>The result is said in a live region that is always there</h2>
 *
 * `FollowControl`'s reason: a region mounted at the moment of speaking is one most screen readers
 * never announce.
 */
export interface ProfileBlockControlProps {
  readonly slug: string;
  /** Resolved on the server from `blocking`. */
  readonly copy: BlockControlCopy;
  /** The wrapper's spacing. */
  readonly className?: string;
}

/** The link-like trigger, matching `ReportControl`'s on the same row. */
const TRIGGER =
  'inline-flex items-center gap-2 rounded-sm text-sm text-white/40 transition-colors duration-150 ease-in-out ' +
  'hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lime-500)] ' +
  'disabled:opacity-40';

const ACTION =
  'rounded-sm text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-[var(--lime-500)] disabled:opacity-40';

export function ProfileBlockControl(props: ProfileBlockControlProps) {
  const { session } = useSession();
  // A different profile, or a different reader, starts again — `FollowControl`'s reason.
  return <BlockToggle key={`${props.slug}:${session?.id ?? ''}`} {...props} />;
}

function BlockToggle({ slug, copy, className }: ProfileBlockControlProps) {
  const { status, session } = useSession();

  /** `null` until the service has said whether this reader blocked the account. */
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const self = session !== null && session.slug === slug;

  useEffect(() => {
    if (status !== 'signed-in' || self) return;

    const controller = new AbortController();
    isBlocked(slug, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setBlocked(answer);
      })
      .catch(() => {
        // Unread is not "not blocked", but offering Block is safe: it is idempotent, and the
        // service's answer decides what is drawn next.
        if (!controller.signal.aborted) setBlocked(false);
      });
    return () => controller.abort();
  }, [status, self, slug]);

  if (status !== 'signed-in' || self) return null;

  async function change(next: boolean): Promise<void> {
    if (busy) return;

    setBusy(true);
    setNotice(null);
    try {
      const now = next ? await blockBySlug(slug) : await unblockBySlug(slug);
      setBlocked(now);
      setConfirming(false);
      setNotice(now ? copy.blocked : copy.unblocked);
    } catch (cause) {
      setNotice(blockFailureMessage(cause, copy.failures));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      {blocked === true ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="inline-flex items-center gap-2 text-sm text-white/64">
            <Ban aria-hidden="true" className="size-4" />
            {copy.blockedState}
          </p>
          <button type="button" disabled={busy} onClick={() => void change(false)} className={`${ACTION} text-white`}>
            {busy ? copy.unblocking : copy.unblock}
          </button>
        </div>
      ) : blocked === false && !confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className={TRIGGER}>
          <Ban aria-hidden="true" className="size-4" />
          {copy.trigger}
        </button>
      ) : blocked === false ? (
        <div className="flex max-w-[40rem] flex-col gap-3 rounded-lg border border-white/8 bg-surface-3 p-4">
          <p className="text-sm text-reading">{copy.warning}</p>
          <div className="flex flex-wrap gap-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => void change(true)}
              className={`${ACTION} font-medium text-white`}
            >
              {busy ? copy.blocking : copy.confirm}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={`${ACTION} text-white/64`}>
              {copy.cancel}
            </button>
          </div>
        </div>
      ) : null}

      <p aria-live="polite" className="mt-2 min-h-[1.25rem] text-xs text-white/64">
        {notice}
      </p>
    </div>
  );
}
