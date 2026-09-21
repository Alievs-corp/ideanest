'use client';

import { useState } from 'react';
import { Bell, BellOff, Bookmark, BookmarkCheck, Check, Share2 } from 'lucide-react';
import { Pill } from '@ideanest/ui';
import { ApiError } from '../../lib/api/problem';
import { signInHref } from '../../lib/auth/redirect';
import { forgetMe, remindMe, saveCampaign, type ProjectState } from '../../lib/projects/api';
import { unsaveCampaign } from '../../lib/community/signals';
import { useSession } from '../session/SessionProvider';
import { localeHref, useLocale } from '../../i18n/navigation';
import type { CampaignActionsCopy } from '../../lib/i18n/campaign-copy';
import { fillPlaceholders } from '../../lib/i18n/placeholders';

/**
 * §4.4's save, share and reminder controls — issue #281, and §4.9's C-09, C-11 and C-13.
 *
 * <h2>One client boundary for three controls, and why the count matters here</h2>
 *
 * Every one of these is a write or a browser capability, so none of them can be a Server
 * Component. They are one island rather than three because each of the three would otherwise
 * read the session independently, and `useSession` is a context read whose provider wraps the
 * root layout: three consumers is three subscriptions and three re-renders for one answer.
 * The page's own comment explains what a boundary costs on the route #119 exists for; this
 * is the cheapest shape that still ships all three.
 *
 * It imports `@ideanest/ui` rather than `@ideanest/ui/server` for `Pill`, which is what the
 * kit's own barrel comment asks a client component to do — `Pill` is stateless either way,
 * and `ReportControl` at the foot of this page already puts that barrel in the route's graph.
 * Nothing here reaches `@ideanest/ui/motion`: 116 kB of animation runtime for a button that
 * changes its word is exactly the trade the page comment refuses.
 *
 * <h2>Save: the control offers the action, because the platform publishes no state</h2>
 *
 * §10.2 has `GET /v1/me/saved` — a cursor-paginated list — and no per-campaign "have I saved
 * this". A page cannot know the initial state without walking every page of somebody's saved
 * campaigns, so the button reads "Save" until it is pressed and reads the answer from the
 * response afterwards.
 *
 * <strong>That is honest rather than merely convenient.</strong> The write is idempotent and
 * the service says so: saving an already-saved campaign is the same success. So the worst
 * case is a reader who saved this campaign last week pressing Save again and being told it is
 * saved, which is true. The alternative — a button that guesses "Saved" and is wrong — would
 * quietly unsave a campaign on the next press.
 *
 * <h2>Share: the native sheet where there is one, the clipboard where there is not</h2>
 *
 * C-13 asks for the native sheet on mobile. `navigator.share` is that sheet, and it is absent
 * on most desktop browsers, so the fallback is copying the address. Both end in a sentence in
 * a polite live region, because a control whose whole effect happened somewhere else — an
 * operating-system sheet, or a clipboard — has told a sighted reader nothing and a screen
 * reader user less than that.
 *
 * A dismissal is not a failure. `navigator.share` rejects with an `AbortError` when somebody
 * closes the sheet, and reporting that as "sharing failed" would accuse the reader of a bug.
 *
 * §4.4 lists a reminder control in the header without qualifying the state.
 * `POST /v1/projects/{id}/remind` is a <em>launch</em> reminder: the service answers 409
 * `reminders-closed` — "this campaign has already opened, so there is nothing left to be
 * reminded about" — for anything past `PRELAUNCH`. A control that was always shown would be a
 * control that fails on eight of the nine public states, so it is rendered on the one state
 * that has something to promise.
 *
 * <h2>Fourteen of its twenty-one words are ones nobody reviewing this page can see</h2>
 *
 * Nine are what the live region announces and five are accessible names, and until #101 all
 * twenty-one were typed here — on a page whose every other component read the catalogue, and
 * in a component that was already being handed three of them as a prop and ignoring two of
 * those. `lib/i18n/campaign-copy.ts` sets out why the three refusals are this control's own
 * rather than `auth.failures`'.
 *
 * <p>The campaign's title is filled in here rather than on the server, because the server
 * resolves this copy once for a route and the title belongs to the campaign the route is
 * about. `fillPlaceholders` is the substitution; `lib/i18n/placeholders.ts` argues why a
 * sentence with a hole in it survives a component boundary and a concatenation does not —
 * "Save {title}" puts the name in a different place in three of the four languages.
 *
 * <h2>The reminder is only offered where the endpoint accepts one</h2>
 *
 * A signed-out reader is sent to the campaign's pre-launch page rather than offered a
 * shortened version of its form. That page (#39) already collects an address, is already rate
 * limited per address as well as per source, and already explains that it writes once. A
 * second address field here would be a second thing to keep in step with an endpoint that
 * promises to send mail.
 */

export interface CampaignActionsProps {
  /** The words this control draws, resolved on the server. See `lib/i18n/campaign-copy.ts`. */
  readonly copy: CampaignActionsCopy;
  readonly projectId: string;
  readonly state: ProjectState;
  /** The campaign's title, for the share sheet and for each control's accessible name. */
  readonly title: string;
  /** §10.2's canonical path for this campaign — the share target and the sign-in return. */
  readonly path: string;
}

type SaveState = 'idle' | 'busy' | 'saved';
type RemindState = 'idle' | 'busy' | 'following';

/**
 * What went wrong, said in the reader's language where this side knows what it was.
 *
 * `problem.detail` is the exception and is deliberate: it is the SERVICE's sentence about this
 * particular refusal, which is more specific than anything this side could say, and
 * `lib/pledges/failure.ts` made the same trade for the checkout. What is replaced here is the
 * three sentences this side invents when the service offered none.
 */
function messageFor(cause: unknown, failures: CampaignActionsCopy['failures']): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return failures.signIn;
    return cause.problem?.detail ?? cause.problem?.title ?? failures.notSaved;
  }
  return failures.unreachable;
}

export function CampaignActions({ projectId, state, title, path,
  copy,
}: CampaignActionsProps) {
  const { status } = useSession();
  /*
   * The sign-in below is a full-document anchor rather than a `Link`, deliberately — signing
   * in is a boundary the client cache should not carry state across — and the language still
   * has to survive it. Without this a reader signing in from a Russian page lands wherever
   * their cookie last pointed. `i18n/navigation.tsx` carries the argument.
   */
  const locale = useLocale();

  const [save, setSave] = useState<SaveState>('idle');
  const [remind, setRemind] = useState<RemindState>('idle');
  const [shared, setShared] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const signedOut = status === 'signed-out';

  async function toggleSave(): Promise<void> {
    if (save === 'busy') return;

    const wasSaved = save === 'saved';
    setSave('busy');
    setNotice(null);
    try {
      if (wasSaved) {
        await unsaveCampaign(projectId);
        setSave('idle');
        setNotice(fillPlaceholders(copy.notices.removed, { title }));
      } else {
        const result = await saveCampaign(projectId);
        // The response decides, not this side. See the class comment on idempotency.
        setSave(result.saved ? 'saved' : 'idle');
        setNotice(
          fillPlaceholders(result.saved ? copy.notices.saved : copy.notices.notSaved, { title }),
        );
      }
    } catch (cause) {
      setSave(wasSaved ? 'saved' : 'idle');
      setNotice(messageFor(cause, copy.failures));
    }
  }

  async function share(): Promise<void> {
    const url = new URL(path, window.location.origin).toString();

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        setNotice(copy.notices.shared);
      } catch (cause) {
        // Somebody closing the sheet is not an error and must not be reported as one.
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setNotice(copy.notices.shareFailed);
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setNotice(copy.notices.copied);
    } catch {
      /*
       * A clipboard write can be refused outright — an insecure origin, or a browser that
       * asks first. The address bar already holds the link, so the honest answer is to say
       * where it is rather than to fail silently.
       */
      setNotice(copy.notices.copyFailed);
    }
  }

  async function toggleRemind(): Promise<void> {
    if (remind === 'busy') return;

    const wasFollowing = remind === 'following';
    setRemind('busy');
    setNotice(null);
    try {
      if (wasFollowing) {
        await forgetMe(projectId);
        setRemind('idle');
        setNotice(copy.notices.remindOff);
      } else {
        await remindMe(projectId);
        setRemind('following');
        setNotice(copy.notices.remindOn);
      }
    } catch (cause) {
      setRemind(wasFollowing ? 'following' : 'idle');
      setNotice(messageFor(cause, copy.failures));
    }
  }

  const saved = save === 'saved';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {/*
          `unknown` renders the signed-in shape, matching `ReportControl`'s reasoning: the
          session takes a round trip after hydration, and a control that appeared a beat later
          would arrive under the reader's cursor. Pressing it before the answer lands raises a
          401, which `messageFor` turns into "Sign in first."
        */}
        {signedOut ? (
          <a href={localeHref(signInHref(path), locale)} className="rounded-full">
            <Pill
              variant="ghost"
              size="sm"
              iconLeft={<Bookmark aria-hidden="true" className="size-4" />}
            >
              {copy.save}
            </Pill>
          </a>
        ) : (
          <Pill
            variant="ghost"
            size="sm"
            disabled={save === 'busy'}
            onClick={() => void toggleSave()}
            /*
             * The name says which campaign, because this control is one of several on the
             * page and a list of buttons all called "Save" is a list nothing can tell apart
             * (docs/ui-kit.md §9.4). `aria-pressed` is what carries the state to a screen
             * reader — the icon change carries it to everybody else, and colour carries it to
             * nobody, which is §9.2.
             */
            aria-pressed={saved}
            aria-label={fillPlaceholders(saved ? copy.savedLabel : copy.saveLabel, { title })}
            iconLeft={
              saved ? (
                <BookmarkCheck aria-hidden="true" className="size-4" />
              ) : (
                <Bookmark aria-hidden="true" className="size-4" />
              )
            }
          >
            {saved ? copy.saved : copy.save}
          </Pill>
        )}

        <Pill
          variant="ghost"
          size="sm"
          onClick={() => void share()}
          aria-label={fillPlaceholders(copy.shareLabel, { title })}
          iconLeft={
            shared ? (
              <Check aria-hidden="true" className="size-4" />
            ) : (
              <Share2 aria-hidden="true" className="size-4" />
            )
          }
        >
          {copy.share}
        </Pill>

        {state === 'PRELAUNCH' &&
          (signedOut ? (
            <a
              href={localeHref(`/projects/${encodeURIComponent(projectId)}/prelaunch`, locale)}
              className="rounded-full"
            >
              <Pill variant="ghost" size="sm" iconLeft={<Bell aria-hidden="true" className="size-4" />}>
                {copy.remind}
              </Pill>
            </a>
          ) : (
            <Pill
              variant="ghost"
              size="sm"
              disabled={remind === 'busy'}
              onClick={() => void toggleRemind()}
              aria-pressed={remind === 'following'}
              aria-label={fillPlaceholders(
                remind === 'following' ? copy.remindingLabel : copy.remindLabel,
                { title },
              )}
              iconLeft={
                remind === 'following' ? (
                  <BellOff aria-hidden="true" className="size-4" />
                ) : (
                  <Bell aria-hidden="true" className="size-4" />
                )
              }
            >
              {remind === 'following' ? copy.reminderSet : copy.remind}
            </Pill>
          ))}
      </div>

      {/*
        ONE POLITE REGION FOR ALL THREE. Every control here finishes somewhere the reader
        cannot see — a row in a table, an operating-system sheet, a clipboard — so the result
        has to be said. Polite rather than assertive: none of it interrupts anything, and an
        assertive region would cut across whatever was being read to announce a bookmark.

        It is always in the document, empty, rather than mounted when there is something to
        say: a live region inserted at the moment of the announcement is a region most screen
        readers do not announce at all.
      */}
      <p aria-live="polite" className="min-h-[1.25rem] text-xs text-white/64">
        {notice}
      </p>
    </div>
  );
}
