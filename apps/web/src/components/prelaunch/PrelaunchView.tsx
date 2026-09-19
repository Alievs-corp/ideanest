'use client';

import { useEffect, useId, useState } from 'react';
import Image from 'next/image';
import { CircleAlert, CircleCheck, Users } from 'lucide-react';
import {
  Field,
  InlineAlert,
  MediaFrame,
  Pill,
  Skeleton,
  SkeletonGroup,
  TextInput,
} from '@ideanest/ui';
import { FadeUp } from '@ideanest/ui/motion';
import { currentAccessToken } from '../../lib/api/access-token';
import { PRELAUNCH_COVER_SIZES } from '../../lib/images/sizes';
import { canOptimise, intrinsicSize } from '../../lib/images/source';
import { ApiError } from '../../lib/api/problem';
import { getPrelaunchPage, remindMe, type PrelaunchPage } from '../../lib/projects/api';
import type { PrelaunchCopy } from '../../lib/i18n/prelaunch-copy';
import type { Locale } from '../../lib/i18n/locale';
import { fillNodes, fillPlaceholders } from '../../lib/i18n/placeholders';
import { pluralForm } from '../../lib/i18n/plurals';

/**
 * A campaign's public pre-launch page: what is coming, and the one control that
 * asks to be told when it opens.
 *
 * NO SESSION IS REQUIRED, and that is the feature rather than a detail. The
 * people a pre-launch page exists to collect are people who have never heard of
 * the platform; a form behind a sign-in wall collects nobody. The address is
 * typed and the server stores it (docs/architecture.md §17.4 decided the shape),
 * so this page never asks anybody to register.
 *
 * WHEN THERE *IS* A SESSION the address field disappears and the reminder is
 * registered against the account. That is not a guess about the visitor: it is
 * exactly what `publicFetch` will do with the request, so the form is showing
 * what is about to happen rather than offering a field the server would ignore.
 *
 * MOTION: one `FadeUp`, once, on the page's own content — the only scroll-entry
 * animation the system has (docs/motion-system.md §4.1), transform and opacity
 * only, and static under `prefers-reduced-motion` because `FadeUp` renders
 * without the transform when the query matches. Nothing else on this page moves:
 * the follower count is a number that changes, per §6's rule for countdowns, and
 * the submit control shows a word rather than a spinner.
 *
 * ACCESSIBILITY: a real `<form>` with a real `<label>`, a submit button rather
 * than a click handler on a `div`, one live region for the failure and one for
 * the success, and a confirmed state that says plainly that the visitor is on
 * the list and will be written to once.
 */

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; page: PrelaunchPage }
  /** The campaign has no pre-launch page — it never opened one, or it has launched. */
  | { kind: 'unavailable'; message: string }
  | { kind: 'failed'; message: string };

const LOADING_ROWS = [0, 1];

function wasAborted(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

/**
 * Loosely, and on purpose.
 *
 * The server's own definition is deliberately loose for the reason `EmailAddress`
 * gives: the only reliable test of an address is sending to it, and a stricter
 * pattern rejects valid addresses. This exists to catch the mistake somebody has
 * just made — no `@`, or nothing after the dot — before it costs them a round
 * trip, not to be an authority on what an address is.
 */
function looksLikeAnAddress(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

function messageFor(cause: unknown, copy: PrelaunchCopy): string {
  if (cause instanceof ApiError) {
    if (cause.status === 429) {
      const seconds = cause.problem?.retryAfterSeconds;
      return seconds === undefined
        ? copy.errors.rateLimited
        : fillPlaceholders(copy.errors.rateLimitedIn, {
            minutes: String(Math.ceil(seconds / 60)),
          });
    }
    // The service's own wording wherever there is one: the endpoint knows which
    // of its rules refused the request and this function cannot.
    return (
      cause.problem?.detail ?? cause.problem?.title ?? copy.errors.notSaved
    );
  }
  return copy.errors.unreachable;
}

export interface PrelaunchViewProps {
  projectId: string;
  /** Resolved by the route. See `lib/i18n/prelaunch-copy.ts`. */
  readonly copy: PrelaunchCopy;
  /** The reader's language, for the one plural on the page. */
  readonly locale: Locale;
}

export function PrelaunchView({ projectId, copy, locale }: PrelaunchViewProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [following, setFollowing] = useState(false);

  /**
   * Read once, on mount. `currentAccessToken` is a module variable rather than
   * React state, so reading it during render would be reading something the
   * renderer cannot see change — and on the server it is always null, which would
   * make the first client render disagree with the markup it is hydrating.
   */
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => setSignedIn(currentAccessToken() !== null), []);

  const headingId = useId();

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        setPhase({ kind: 'ready', page: await getPrelaunchPage(projectId, controller.signal) });
      } catch (cause) {
        if (controller.signal.aborted || wasAborted(cause)) return;

        if (cause instanceof ApiError && cause.status === 404) {
          /*
           * 404 covers "no such campaign", "still a draft", and "already
           * launched", deliberately indistinguishable — the service will not say
           * which, because saying would report on what other people are
           * preparing. So neither does this.
           */
          setPhase({
            kind: 'unavailable',
            message: copy.unavailable,
          });
          return;
        }
        setPhase({ kind: 'failed', message: messageFor(cause, copy) });
      }
    })();

    return () => controller.abort();
  }, [projectId]);

  async function submit(): Promise<void> {
    setFailure(null);

    if (!signedIn && !looksLikeAnAddress(email)) {
      setFieldError(copy.emailInvalid);
      return;
    }
    setFieldError(null);
    setSubmitting(true);

    try {
      const result = await remindMe(projectId, signedIn ? {} : { email: email.trim() });
      setFollowing(true);
      if (phase.kind === 'ready') {
        setPhase({ kind: 'ready', page: { ...phase.page, followerCount: result.followerCount } });
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.problem?.code === 'REMINDERS_CLOSED') {
        // The visitor left this page open until the campaign opened. Telling them
        // the signup failed would be true and useless; what changed is that there
        // is now a campaign to look at.
        setPhase({
          kind: 'unavailable',
          message: copy.alreadyOpen,
        });
        return;
      }
      setFailure(messageFor(cause, copy));
    } finally {
      setSubmitting(false);
    }
  }

  if (phase.kind === 'loading') {
    return (
      <div className="mx-auto w-full max-w-[720px] px-5 py-14 sm:px-6">
        <SkeletonGroup label={copy.loading}>
          <div className="flex flex-col gap-5">
            <Skeleton height="14rem" />
            {LOADING_ROWS.map((row) => (
              <Skeleton key={row} height="1.25rem" width={row === 0 ? '70%' : '90%'} />
            ))}
          </div>
        </SkeletonGroup>
      </div>
    );
  }

  if (phase.kind !== 'ready') {
    return (
      <div className="mx-auto w-full max-w-[720px] px-5 py-14 sm:px-6">
        <InlineAlert
          variant={phase.kind === 'unavailable' ? 'info' : 'danger'}
          title={phase.kind === 'unavailable' ? copy.unavailableTitle : copy.failedTitle}
        >
          {phase.message}
        </InlineAlert>
      </div>
    );
  }

  const { page } = phase;

  return (
    <div className="mx-auto w-full max-w-[720px] px-5 py-14 sm:px-6">
      <article aria-labelledby={headingId}>
        {/*
          The one entry animation in the system, used once, on the part of the
          page that is being read rather than used.

          THE FORM IS OUTSIDE IT, for two reasons. The motion budget is the
          smaller one: §5's rule is that motion decreases as the user gets closer
          to acting, and the signup is the action. The larger one is mechanical —
          `FadeUp` calls `motion.create()` during render, which produces a new
          component type on every render, and React unmounts and remounts
          everything underneath it. A controlled input inside would lose its focus
          and its value on the first keystroke. Worth fixing in the design system;
          not worth working around here by animating a form that should not
          animate anyway.
        */}
        <FadeUp>
        {page.coverImage != null && (
          /*
            THE COVER IS SHOWN WHOLE, so it reserves the shape it really is
            rather than a crop. A creator's 4:3 photograph forced into 16:9
            would be a layout shift with extra steps — the box would be right
            and the picture would not be in it. `intrinsicSize` refuses a
            measurement of zero, which is what a failed read leaves behind, and
            the crop token is the honest reservation when the shape is unknown.

            IT IS THE LARGEST CONTENTFUL PAINT ON THIS ROUTE, so it is eager and
            prioritised: it is the first thing above the fold and there is
            exactly one of it.
          */
          <MediaFrame
            ratio={intrinsicSize(page.coverImage) ?? '16/9'}
            radius="lg"
            className="mb-8 border border-white/8"
          >
            <Image
              src={page.coverImage.url}
              alt=""
              fill
              sizes={PRELAUNCH_COVER_SIZES}
              unoptimized={!canOptimise(page.coverImage.url)}
              priority
              className="object-cover"
            />
          </MediaFrame>
        )}

        <p className="text-xs font-medium tracking-[0.06em] text-white/40 uppercase">
          {copy.comingSoon}
        </p>
        <h1
          id={headingId}
          className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl"
        >
          {page.title}
        </h1>

        {page.blurb != null && page.blurb !== '' && (
          <p className="mt-4 text-lg text-reading">{page.blurb}</p>
        )}

        <p className="mt-6 flex items-center gap-2 text-sm text-white/64">
          <Users aria-hidden="true" className="size-4" />
          <span>
            {fillNodes(pluralForm(locale, copy.waiting, page.followerCount), {
              count: (
                <strong className="font-semibold text-white">{page.followerCount}</strong>
              ),
            })}
          </span>
        </p>
        </FadeUp>

        <section className="mt-10 rounded-lg border border-white/8 bg-surface-2 p-6">
          {following ? (
            /*
             * The already-signed-up state. It says what will happen and when,
             * and it says it once — the alternative, leaving the form on screen,
             * invites somebody to press the button again and wonder whether they
             * are now on the list twice.
             */
            <div className="flex items-start gap-3">
              <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
              <div>
                <h2 className="text-base font-semibold text-white">{copy.onListTitle}</h2>
                <p className="mt-1 text-sm text-white/64">
                  {signedIn ? copy.onListSignedIn : copy.onListGuest}
                </p>
              </div>
              {/*
                Announced as well as shown. `role="status"` rather than
                `role="alert"`: this is an outcome the visitor asked for, not an
                interruption.
              */}
              <span role="status" aria-live="polite" className="sr-only">
                {copy.onListAnnouncement}
              </span>
            </div>
          ) : (
            <form
              className="flex flex-col gap-4"
              /*
               * `noValidate`, and the field keeps `type="email"` and `required`.
               *
               * The attributes stay because they change the keyboard on a phone
               * and tell assistive technology what the control is. The browser's
               * own enforcement goes because its message is a transient bubble
               * that several screen readers never announce, that disappears on
               * the next keystroke, and that cannot be worded — "Please include
               * an '@'" is not the sentence we would write. The check below says
               * the same thing in a message that is wired to the field with
               * `aria-describedby` and stays on screen.
               */
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div>
                <h2 className="text-base font-semibold text-white">{copy.formTitle}</h2>
                <p className="mt-1 text-sm text-white/64">{copy.formIntro}</p>
              </div>

              {failure !== null && (
                // A live region that exists only while there is something in it
                // would not be announced, so this one is only rendered on
                // failure and carries `role="alert"`, which is announced on
                // insertion.
                <p
                  role="alert"
                  className="flex items-start gap-1.5 text-[13px] text-danger"
                >
                  <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <span>{failure}</span>
                </p>
              )}

              {signedIn ? (
                <p className="text-sm text-white/64">{copy.accountAddress}</p>
              ) : (
                <Field label={copy.emailLabel} required error={fieldError ?? undefined}>
                  <TextInput
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder={copy.emailPlaceholder}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
              )}

              <div>
                {/*
                  Lime: this is the one urgent action on the page, and there is
                  exactly one (docs/ui-kit.md §7.2). Near-black text on it, never
                  the other way round.
                */}
                <Pill type="submit" variant="accent" disabled={submitting}>
                  {submitting ? copy.submitting : copy.submit}
                </Pill>
              </div>
            </form>
          )}
        </section>
      </article>
    </div>
  );
}
