'use client';

import { useEffect, useState } from 'react';
import { UserCheck, UserPlus } from 'lucide-react';
import { Pill } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import { signInHref } from '../../lib/auth/redirect';
import { followCreator, isFollowing, unfollowCreator } from '../../lib/community/signals';
import type { FollowControlCopy } from '../../lib/i18n/profile-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';
import { useSession } from '../session/SessionProvider';
import { localeHref, useLocale } from '../../i18n/navigation';

/**
 * §4.9's C-10 from the web — a Follow / Following toggle. Issue #143.
 *
 * Mounted on the public profile (`/u/[slug]`) and in the campaign page's Creator tab. The
 * service has had `POST` and `DELETE /v1/users/{slug}/follow` and `GET /v1/me/following` since
 * #90, and `/account/following` lists the result; until this control nothing on the web could
 * write a row into that list.
 *
 * <h2>Three readers, three shapes</h2>
 *
 * <ul>
 *   <li><strong>Signed out</strong> — a sign-in link that returns here. Following needs a
 *       bearer token, and a button that failed with a 401 would be a wall reached by pressing
 *       it; this is the same wall, shown first. `CampaignActions` does the same for Save.
 *   <li><strong>The account the page is about</strong> — nothing. Following yourself is a 400
 *       the service refuses (`CannotFollowYourselfException`), so the control is not offered.
 *   <li><strong>Anybody else signed in</strong> — the toggle, starting from what
 *       `GET /v1/me/following` says. `isFollowing` walks that list; there is no per-creator
 *       read yet (#137 proposes one).
 * </ul>
 *
 * While the session or the list is still being read the button is drawn disabled, reading
 * "Follow": it keeps its place in the layout so nothing moves under the cursor, and it cannot
 * be pressed into a state nobody has checked. If the list cannot be read the button offers
 * Follow, which is safe because following is idempotent — pressing it on somebody already
 * followed is the same success, and the response decides what is drawn.
 *
 * <h2>The result is said, not only shown</h2>
 *
 * `aria-pressed` carries the state and the icon and word change carry it to everybody else,
 * never colour alone (§9.2). The sentence afterwards goes to a polite live region that is
 * always in the document, for the reason `CampaignActions` gives: a region mounted at the
 * moment of speaking is one most screen readers never announce.
 *
 * <h2>Motion: none</h2>
 *
 * A button that changes its word. The campaign page ships no animation runtime and this does
 * not add one.
 */

export interface FollowControlProps {
  /** The account's public slug — how the service addresses a person outside their module. */
  readonly slug: string;
  /** The account's display name, for the accessible name and the announcement. */
  readonly name: string;
  /** Where signing in returns to. */
  readonly returnTo: string;
  /** Resolved on the server from `profile.follow`. */
  readonly copy: FollowControlCopy;
}

function messageFor(cause: unknown, copy: FollowControlCopy): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return copy.signIn;
    return cause.problem?.detail ?? cause.problem?.title ?? copy.refused;
  }
  return copy.unreachable;
}

export function FollowControl({ slug, name, returnTo, copy }: FollowControlProps) {
  const { status, session } = useSession();
  const locale = useLocale();

  /** `null` until `GET /v1/me/following` has answered. */
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const self = session !== null && session.slug === slug;

  useEffect(() => {
    if (status !== 'signed-in' || self) return;

    const controller = new AbortController();
    isFollowing(slug, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setFollowing(answer);
      })
      .catch(() => {
        // Unread is not "not following" — but offering Follow is safe, see the class comment.
        if (!controller.signal.aborted) setFollowing(false);
      });
    return () => controller.abort();
  }, [status, self, slug]);

  if (self) return null;

  const label = fillPlaceholders(copy.label, { name });

  if (status === 'signed-out') {
    return (
      <a href={localeHref(signInHref(returnTo), locale)} aria-label={label} className="rounded-full">
        <Pill
          type="button"
          variant="outline"
          size="sm"
          iconLeft={<UserPlus aria-hidden="true" className="size-4" />}
        >
          {copy.follow}
        </Pill>
      </a>
    );
  }

  async function toggle(): Promise<void> {
    if (busy || following === null) return;

    const was = following;
    setBusy(true);
    setNotice(null);
    try {
      if (was) {
        await unfollowCreator(slug);
        setFollowing(false);
        setNotice(fillPlaceholders(copy.unfollowed, { name }));
      } else {
        const now = await followCreator(slug);
        setFollowing(now);
        setNotice(fillPlaceholders(now ? copy.followed : copy.unfollowed, { name }));
      }
    } catch (cause) {
      setFollowing(was);
      setNotice(messageFor(cause, copy));
    } finally {
      setBusy(false);
    }
  }

  const pressed = following === true;

  return (
    <div className="flex flex-col items-start gap-1">
      <Pill
        type="button"
        variant={pressed ? 'ghost' : 'outline'}
        size="sm"
        disabled={busy || following === null}
        onClick={() => void toggle()}
        aria-pressed={pressed}
        aria-label={label}
        iconLeft={
          pressed ? (
            <UserCheck aria-hidden="true" className="size-4" />
          ) : (
            <UserPlus aria-hidden="true" className="size-4" />
          )
        }
      >
        {pressed ? copy.following : copy.follow}
      </Pill>
      <p aria-live="polite" className="min-h-[1.25rem] text-xs text-white/64">
        {notice}
      </p>
    </div>
  );
}
