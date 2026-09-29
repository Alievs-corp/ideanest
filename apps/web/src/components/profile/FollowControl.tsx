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
 * <h2>The visible word is inside the name</h2>
 *
 * WCAG 2.5.3, Label in Name. The name says whom — a profile page and a campaign tab can each
 * hold more than one of these — but an `aria-label` of "Follow {name}" over a button that
 * reads "Following" is a name a voice-control user cannot say: "click Following" matches
 * nothing. So there is no `aria-label`. The word on the button is the word in the name, and
 * the rest of `profile.follow.accessibleName` — the person, and whatever the language wraps
 * around them — is visually hidden text beside it. The template puts the word where its
 * grammar wants it with `{action}`: "Follow Aysel", "Подписаться на Aysel", "Aysel adlı
 * istifadəçini izlə".
 *
 * <h2>A different person, or a different reader, starts again</h2>
 *
 * The toggle is keyed by the slug and the signed-in account. A client navigation from one
 * profile to another, or signing in as somebody else, keeps this component where it is in the
 * tree; without the key it would carry the last person's Following, and the sentence said
 * about them, onto the next.
 *
 * <h2>Where the sentence goes</h2>
 *
 * Under the button, in the flow, where there is room for it — the campaign's Creator tab.
 * Beside the name on a profile the header centres its row, and a line reserved under the
 * button pushed the button above the name's centre, so there `notice="overlay"` draws the
 * live region out of the flow, hanging under the button's end edge.
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
  /**
   * `flow` (the default) keeps a line under the button for the sentence said after a press;
   * `overlay` hangs it under the button's end edge without taking space, for a row that
   * centres the control beside something else.
   */
  readonly notice?: 'flow' | 'overlay';
}

/** `Pill`'s outline variant at `sm`, on the link a signed-out reader is given instead. */
const SIGN_IN_PILL =
  'inline-flex h-8 items-center justify-center gap-2 rounded-full border border-white/16 ' +
  'bg-transparent px-3.5 text-[13px] font-medium tracking-[-0.01em] whitespace-nowrap ' +
  'text-white transition-colors duration-150 ease-in-out hover:bg-surface-3';

function messageFor(cause: unknown, copy: FollowControlCopy): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return copy.signIn;
    return cause.problem?.detail ?? cause.problem?.title ?? copy.refused;
  }
  return copy.unreachable;
}

/**
 * The visible word, with the rest of the accessible name beside it as visually hidden text.
 * One span, so the pill's flex gap does not open between the pieces.
 *
 * The spaces between the pieces stay outside the hidden spans, as text of their own: a name is
 * computed per element and an element's text is trimmed, so a space kept inside would be lost
 * and "Follow" and the name would run together. On screen a space at either end of the line
 * collapses, so it draws nothing.
 */
function Named({ word, name, template }: { word: string; name: string; template: string }) {
  const [before = '', after = ''] = template.split('{action}');
  const hidden = (text: string) => {
    const [, lead = '', words = '', trail = ''] = /^(\s*)(.*?)(\s*)$/su.exec(text) ?? [];
    return (
      <>
        {lead}
        {words !== '' && <span className="sr-only">{fillPlaceholders(words, { name })}</span>}
        {trail}
      </>
    );
  };

  return (
    <span>
      {hidden(before)}
      {word}
      {hidden(after)}
    </span>
  );
}

export function FollowControl(props: FollowControlProps) {
  const { session } = useSession();

  return <FollowToggle key={`${props.slug}:${session?.id ?? ''}`} {...props} />;
}

function FollowToggle({ slug, name, returnTo, copy, notice: placement = 'flow' }: FollowControlProps) {
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

  if (status === 'signed-out') {
    /*
     * One focusable element: a link drawn as the outline pill, not a button inside a link,
     * which is two tab stops for one action and an interactive element nested in another.
     */
    return (
      <a href={localeHref(signInHref(returnTo), locale)} className={SIGN_IN_PILL}>
        <UserPlus aria-hidden="true" className="size-4" />
        <Named word={copy.follow} name={name} template={copy.accessibleName} />
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
    <div
      className={
        placement === 'overlay' ? 'relative inline-flex' : 'flex flex-col items-start gap-1'
      }
    >
      <Pill
        type="button"
        variant={pressed ? 'ghost' : 'outline'}
        size="sm"
        disabled={busy || following === null}
        onClick={() => void toggle()}
        aria-pressed={pressed}
        iconLeft={
          pressed ? (
            <UserCheck aria-hidden="true" className="size-4" />
          ) : (
            <UserPlus aria-hidden="true" className="size-4" />
          )
        }
      >
        <Named
          word={pressed ? copy.following : copy.follow}
          name={name}
          template={copy.accessibleName}
        />
      </Pill>
      <p
        aria-live="polite"
        className={
          placement === 'overlay'
            ? 'absolute end-0 top-full mt-1 w-max max-w-[min(20rem,calc(100vw-2.5rem))] text-end text-xs text-white/64'
            : 'min-h-[1.25rem] text-xs text-white/64'
        }
      >
        {notice}
      </p>
    </div>
  );
}
